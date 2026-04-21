"""app/api/chat.py — Streaming chat endpoint (SSE)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import AppDeps, get_deps
from agents.base import AgentContext, FileContext, Message
from infra.models import Attachment, ChatMessage, Canvas

router = APIRouter(prefix="/projects/{project_id}/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    model: str = "openai/gpt-4o"
    rag_mode: str = "hybrid"


@router.post("")
async def stream_chat(
    project_id: str,
    req: ChatRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    # ── Gather context from DB ────────────────────────────────────────────
    # Canvas text
    canvas_result = await deps.db.execute(
        select(Canvas).where(Canvas.project_id == project_id)
    )
    canvas = canvas_result.scalar_one_or_none()
    canvas_text = _extract_canvas_text(canvas.elements_json if canvas else "[]")

    # Attached files
    files_result = await deps.db.execute(
        select(Attachment).where(Attachment.project_id == project_id)
    )
    attachments = files_result.scalars().all()
    file_contexts = [
        FileContext(
            file_id=a.id,
            filename=a.original_name,
            file_type=a.file_type,
            extracted_text=a.extracted_text or "",
            rag_ready=(a.rag_status == "indexed"),
            file_size=a.file_size,
        )
        for a in attachments
    ]

    # Recent chat history
    history_result = await deps.db.execute(
        select(ChatMessage)
        .where(ChatMessage.project_id == project_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    )
    history = [
        Message(role=m.role, content=m.content)
        for m in reversed(history_result.scalars().all())
    ]

    ctx = AgentContext(
        project_id=project_id,
        user_query=req.message,
        canvas_text=canvas_text,
        attached_files=file_contexts,
        chat_history=history,
        rag_mode=req.rag_mode,
        model=req.model,
    )

    # Save user message
    user_msg = ChatMessage(
        id=str(uuid.uuid4()),
        project_id=project_id,
        role="user",
        content=req.message,
        model_used=req.model,
    )
    deps.db.add(user_msg)
    await deps.db.flush()

    # ── Stream response ───────────────────────────────────────────────────
    accumulated = []
    trace_id_holder: list[str] = []

    async def event_stream():
        async for event in deps.chat_agent.run(ctx):
            if event.type == "token":
                accumulated.append(event.data)
            if not trace_id_holder:
                trace_id_holder.append(event.trace_id)
            yield f"data: {event.to_json()}\n\n"

        # Persist assistant message after stream ends
        full_response = "".join(accumulated)
        if full_response:
            from infra.db import get_session
            async with get_session() as session:
                assistant_msg = ChatMessage(
                    id=str(uuid.uuid4()),
                    project_id=project_id,
                    role="assistant",
                    content=full_response,
                    model_used=req.model,
                    trace_id=trace_id_holder[0] if trace_id_holder else None,
                )
                session.add(assistant_msg)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/history")
async def get_history(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
    limit: int = 50,
):
    result = await deps.db.execute(
        select(ChatMessage)
        .where(ChatMessage.project_id == project_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
    )
    messages = result.scalars().all()
    return [
        {"id": m.id, "role": m.role, "content": m.content, "model_used": m.model_used,
         "trace_id": m.trace_id, "created_at": m.created_at.isoformat()}
        for m in messages
    ]


def _extract_canvas_text(elements_json: str) -> str:
    """Extract text content from Excalidraw elements JSON."""
    try:
        elements = json.loads(elements_json)
        texts = [
            el.get("text", "")
            for el in elements
            if el.get("type") == "text" and not el.get("isDeleted", False)
        ]
        return "\n".join(t for t in texts if t.strip())
    except Exception:
        return ""
