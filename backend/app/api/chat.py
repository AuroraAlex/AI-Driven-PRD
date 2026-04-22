"""app/api/chat.py — Streaming chat endpoint (SSE), scoped to a chat session."""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete, select

from app.deps import AppDeps, get_deps
from agents.base import AgentContext, FileContext, Message
from agents.canvas.context import build_canvas_context, estimate_tokens
from infra.models import (
    Canvas,
    CanvasSession,
    ChatMessage,
    ChatSession,
    ResourceBlock,
)

router = APIRouter(
    prefix="/projects/{project_id}/chat-sessions/{session_id}",
    tags=["chat"],
)


class ChatRequest(BaseModel):
    message: str
    model: str = "openai/gpt-4o"
    rag_mode: str = "hybrid"
    rag_enabled: bool = True
    include_canvas_context: bool = True
    canvas_context_mode: str = "full"  # full | summary
    canvas_session_ids: list[str] = []  # if empty → no canvas context


async def _ensure_session(deps: AppDeps, project_id: str, session_id: str) -> ChatSession:
    sess = await deps.db.get(ChatSession, session_id)
    if not sess or sess.project_id != project_id:
        raise HTTPException(404, "Chat session not found")
    return sess


@router.post("/chat")
async def stream_chat(
    project_id: str,
    session_id: str,
    req: ChatRequest,
    request: Request,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    await _ensure_session(deps, project_id, session_id)

    ctx, valid_canvas_ids, canvas_text = await _build_context(
        deps, project_id, session_id, req,
    )

    # Save user message
    user_msg = ChatMessage(
        id=str(uuid.uuid4()),
        chat_session_id=session_id,
        role="user",
        content=req.message,
        model_used=req.model,
    )
    deps.db.add(user_msg)
    # IMPORTANT: commit + close the request-scoped session BEFORE returning
    # the StreamingResponse — otherwise SQLite holds a write lock for the
    # entire stream and the assistant-message INSERT in the finally block of
    # _run_chat_stream fails with "database is locked".
    await deps.db.commit()
    await deps.db.close()

    # Initial meta event so the client can show context size estimate
    meta = {
        "user_message_id": user_msg.id,
        "canvas_session_ids": valid_canvas_ids,
        "estimated_canvas_tokens": estimate_tokens(canvas_text),
    }

    return StreamingResponse(
        _run_chat_stream(deps, session_id, req.model, ctx, request, meta),
        media_type="text/event-stream",
    )


@router.post("/messages/{message_id}/regenerate")
async def regenerate_from(
    project_id: str,
    session_id: str,
    message_id: str,
    req: ChatRequest,
    request: Request,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Re-run the assistant turn that follows the given user message.

    Deletes any messages strictly after `message_id` (typically the prior
    assistant reply) and re-streams a fresh response with the supplied
    settings (model / rag / canvas selection may differ).
    """
    await _ensure_session(deps, project_id, session_id)
    anchor = await deps.db.get(ChatMessage, message_id)
    if not anchor or anchor.chat_session_id != session_id:
        raise HTTPException(404, "Anchor message not found")
    if anchor.role != "user":
        raise HTTPException(400, "Can only regenerate from a user message")

    # Optionally update the user message content if changed
    if req.message and req.message != anchor.content:
        anchor.content = req.message
        anchor.meta_json = json.dumps({
            "edited_at": datetime.now(timezone.utc).isoformat(),
        })

    # Delete every message after this one
    await deps.db.execute(
        sa_delete(ChatMessage).where(
            ChatMessage.chat_session_id == session_id,
            ChatMessage.created_at > anchor.created_at,
        )
    )
    # Commit + release the request-scoped connection so the streaming
    # finally-block can acquire the SQLite write lock to persist the
    # assistant reply.
    await deps.db.commit()
    await deps.db.close()

    # Build context with the (possibly edited) anchor message as user_query
    req_for_ctx = req.model_copy(update={"message": anchor.content})
    ctx, valid_canvas_ids, canvas_text = await _build_context(
        deps, project_id, session_id, req_for_ctx,
        skip_last_user=True,  # anchor is already in DB; don't double-append
    )

    meta = {
        "user_message_id": anchor.id,
        "regenerated": True,
        "canvas_session_ids": valid_canvas_ids,
        "estimated_canvas_tokens": estimate_tokens(canvas_text),
    }

    return StreamingResponse(
        _run_chat_stream(deps, session_id, req.model, ctx, request, meta),
        media_type="text/event-stream",
    )


class MessagePatch(BaseModel):
    content: str


@router.patch("/messages/{message_id}")
async def edit_message(
    project_id: str,
    session_id: str,
    message_id: str,
    body: MessagePatch,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    await _ensure_session(deps, project_id, session_id)
    msg = await deps.db.get(ChatMessage, message_id)
    if not msg or msg.chat_session_id != session_id:
        raise HTTPException(404, "Message not found")
    msg.content = body.content
    existing = json.loads(msg.meta_json) if msg.meta_json else {}
    existing["edited_at"] = datetime.now(timezone.utc).isoformat()
    msg.meta_json = json.dumps(existing)
    await deps.db.flush()
    return _serialize_message(msg)


@router.delete("/messages/{message_id}", status_code=204)
async def delete_message(
    project_id: str,
    session_id: str,
    message_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    await _ensure_session(deps, project_id, session_id)
    msg = await deps.db.get(ChatMessage, message_id)
    if not msg or msg.chat_session_id != session_id:
        raise HTTPException(404, "Message not found")
    await deps.db.delete(msg)


# ── Export ──────────────────────────────────────────────────────────────────


class ExportRequest(BaseModel):
    target: Literal["canvas", "document"]
    selection: str | None = None       # markdown substring; defaults to full message
    title: str | None = None
    canvas_session_id: str | None = None  # only used for target='canvas' (UI-side hint)


class ExportResponse(BaseModel):
    resource_id: str
    kind: str                           # 'snippet' for canvas, 'document' for document
    title: str
    markdown: str
    target: str
    canvas_payload: dict | None = None  # populated when target='canvas'


def _summary_from_md(md: str, limit: int = 120) -> str:
    for line in md.splitlines():
        s = line.strip().lstrip("#").strip()
        if s:
            return s[:limit]
    return ""


@router.post("/messages/{message_id}/export", response_model=ExportResponse)
async def export_message(
    project_id: str,
    session_id: str,
    message_id: str,
    body: ExportRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Export a chat message (or a selected substring) into a resource block.

    Always creates a ResourceBlock + a Reference edge from the source chat
    message. For target='canvas' we additionally return a payload the
    frontend can drop straight into the Excalidraw scene as an AI card.
    """
    from infra.models import Reference

    await _ensure_session(deps, project_id, session_id)
    msg = await deps.db.get(ChatMessage, message_id)
    if not msg or msg.chat_session_id != session_id:
        raise HTTPException(404, "Message not found")

    markdown = (body.selection or msg.content or "").strip()
    if not markdown:
        raise HTTPException(400, "Empty selection")

    summary = _summary_from_md(markdown)
    title = (body.title or summary or "Chat export").strip()[:200]
    kind = "snippet" if body.target == "canvas" else "document"

    rb = ResourceBlock(
        id=str(uuid.uuid4()),
        project_id=project_id,
        kind=kind,
        title=title,
        summary=summary,
        markdown_content=markdown,
        origin_type="chat_message",
        origin_ref=json.dumps({
            "chat_session_id": session_id,
            "message_id": message_id,
            "is_partial": bool(body.selection),
        }),
    )
    deps.db.add(rb)
    await deps.db.flush()

    # Reference edge: chat_message -> resource_block (derived_from)
    deps.db.add(Reference(
        id=str(uuid.uuid4()),
        project_id=project_id,
        source_type="chat_message",
        source_id=message_id,
        source_session_id=session_id,
        target_type="resource_block",
        target_id=rb.id,
        relation="derived_from",
        created_by="user",
    ))

    canvas_payload = None
    if body.target == "canvas":
        canvas_payload = {
            "schemaVersion": 1,
            "markdown": markdown,
            "summary": summary,
            "sources": [{
                "type": "chat_message",
                "id": message_id,
                "label": "AI Chat",
            }],
            "prompt": "",
            "model": msg.model_used or "",
            "generated_at": datetime.now(timezone.utc).timestamp(),
            "version": 1,
            "resource_id": rb.id,
        }

    return ExportResponse(
        resource_id=rb.id,
        kind=kind,
        title=title,
        markdown=markdown,
        target=body.target,
        canvas_payload=canvas_payload,
    )


# ── Internal helpers ────────────────────────────────────────────────────────


async def _build_context(
    deps: AppDeps,
    project_id: str,
    session_id: str,
    req: ChatRequest,
    *,
    skip_last_user: bool = False,
) -> tuple[AgentContext, list[str], str]:
    """Resolve canvas + files + history into an AgentContext.

    ``skip_last_user``: when regenerating, the anchor user message is already
    in the DB; we skip the final user row of history so it isn't duplicated
    (the prompt builder appends ``ctx.user_query`` separately).
    """
    canvas_text = ""
    valid_canvas_ids: list[str] = []
    if req.include_canvas_context and req.canvas_session_ids:
        cs_res = await deps.db.execute(
            select(CanvasSession).where(
                CanvasSession.project_id == project_id,
                CanvasSession.id.in_(req.canvas_session_ids),
            )
        )
        sessions = cs_res.scalars().all()
        valid_canvas_ids = [s.id for s in sessions]
        cv_res = await deps.db.execute(
            select(Canvas).where(Canvas.canvas_session_id.in_(valid_canvas_ids))
        )
        canvases_by_sid = {c.canvas_session_id: c for c in cv_res.scalars().all()}
        triples = [
            (s.id, s.title, (canvases_by_sid.get(s.id).elements_json if canvases_by_sid.get(s.id) else "[]"))
            for s in sessions
        ]
        canvas_text = build_canvas_context(triples, mode=req.canvas_context_mode or "full")  # type: ignore[arg-type]

    files_result = await deps.db.execute(
        select(ResourceBlock).where(
            ResourceBlock.project_id == project_id,
            ResourceBlock.kind == "file",
        )
    )
    attachments = files_result.scalars().all()
    file_contexts = [
        FileContext(
            file_id=a.id,
            filename=a.original_filename or a.title,
            file_type=a.file_type or "other",
            extracted_text=a.extracted_text or "",
            rag_ready=a.is_in_kb,
            file_size=a.file_size or 0,
        )
        for a in attachments
    ]

    history_result = await deps.db.execute(
        select(ChatMessage)
        .where(ChatMessage.chat_session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    )
    history_msgs = list(reversed(history_result.scalars().all()))
    if skip_last_user:
        # Drop the trailing user message — its content is already in user_query
        while history_msgs and history_msgs[-1].role == "user":
            history_msgs.pop()
    history = [Message(role=m.role, content=m.content) for m in history_msgs]

    ctx = AgentContext(
        project_id=project_id,
        user_query=req.message,
        canvas_text=canvas_text,
        attached_files=file_contexts,
        chat_history=history,
        canvas_session_ids=valid_canvas_ids,
        chat_session_id=session_id,
        include_canvas_context=req.include_canvas_context,
        canvas_context_mode=req.canvas_context_mode,  # type: ignore[arg-type]
        rag_mode=req.rag_mode,
        rag_enabled=req.rag_enabled,
        model=req.model,
    )
    return ctx, valid_canvas_ids, canvas_text


async def _run_chat_stream(
    deps: AppDeps,
    session_id: str,
    model: str,
    ctx: AgentContext,
    request: Request,
    meta: dict,
):
    """Common SSE generator: forwards agent events, persists assistant msg,
    and aborts cleanly when the client disconnects."""
    accumulated: list[str] = []
    rag_sources: list[dict] = []
    usage: dict = {}
    trace_id_holder: list[str] = []
    stopped = False

    yield f"data: {json.dumps({'type': 'meta', 'data': meta}, ensure_ascii=False)}\n\n"

    agen = deps.chat_agent.run(ctx)
    try:
        async for event in agen:
            if event.type == "token":
                accumulated.append(event.data)
            elif event.type == "rag_hit":
                rag_sources.append({
                    "mode": event.data.get("mode") if isinstance(event.data, dict) else None,
                    "context": (event.data.get("context") if isinstance(event.data, dict) else "") or "",
                })
            elif event.type == "done" and isinstance(event.data, dict):
                usage = event.data.get("usage") or {}

            if not trace_id_holder:
                trace_id_holder.append(event.trace_id)

            yield f"data: {event.to_json()}\n\n"
    except asyncio.CancelledError:
        # Real client disconnect / explicit abort
        stopped = True
        raise
    finally:
        try:
            await agen.aclose()
        except Exception:
            pass

        full_response = "".join(accumulated)
        if full_response:
            from infra.db import get_session
            meta_payload: dict = {}
            if rag_sources:
                meta_payload["rag_sources"] = rag_sources
            if usage:
                meta_payload["usage"] = usage
            if stopped:
                meta_payload["stopped"] = True

            async with get_session() as session:
                assistant_msg = ChatMessage(
                    id=str(uuid.uuid4()),
                    chat_session_id=session_id,
                    role="assistant",
                    content=full_response,
                    model_used=model,
                    trace_id=trace_id_holder[0] if trace_id_holder else None,
                    meta_json=json.dumps(meta_payload, ensure_ascii=False) if meta_payload else None,
                )
                session.add(assistant_msg)

        if stopped:
            yield f"data: {json.dumps({'type': 'aborted', 'data': None}, ensure_ascii=False)}\n\n"


def _serialize_message(m: ChatMessage) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "model_used": m.model_used,
        "trace_id": m.trace_id,
        "meta": json.loads(m.meta_json) if m.meta_json else None,
        "created_at": m.created_at.isoformat(),
    }


@router.get("/messages")
async def get_history(
    project_id: str,
    session_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
    limit: int = 100,
):
    await _ensure_session(deps, project_id, session_id)
    result = await deps.db.execute(
        select(ChatMessage)
        .where(ChatMessage.chat_session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
    )
    return [_serialize_message(m) for m in result.scalars().all()]
