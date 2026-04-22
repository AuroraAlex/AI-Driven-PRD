"""app/api/rag.py — RAG status, manual rebuild, debug query, and cross-source sync."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import AppDeps, get_deps
from agents.base import AgentContext
from agents.canvas.context import build_canvas_context
from infra.models import (
    Attachment,
    Canvas,
    CanvasSession,
    ChatMessage,
    ChatSession,
    PRDDocument,
    RAGIndex,
)

router = APIRouter(prefix="/projects/{project_id}/rag", tags=["rag"])


class RAGQueryRequest(BaseModel):
    query: str
    mode: str = "hybrid"
    model: str = "openai/gpt-4o"


class SyncRequest(BaseModel):
    """If session_ids omitted: sync all sessions of that source type."""
    source_type: Literal["canvas", "chat", "prd"]
    session_ids: list[str] | None = None


@router.get("/status")
async def rag_status(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Return indexing status for all files in the project."""
    result = await deps.db.execute(
        select(Attachment).where(Attachment.project_id == project_id)
    )
    attachments = result.scalars().all()
    return [
        {
            "file_id": a.id,
            "filename": a.original_name,
            "rag_status": a.rag_status,
        }
        for a in attachments
    ]


@router.get("/sources")
async def list_sources(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """List every RAG-indexed source (file/canvas/chat/prd) and its status."""
    res = await deps.db.execute(
        select(RAGIndex).where(RAGIndex.project_id == project_id).order_by(RAGIndex.created_at.desc())
    )
    return [
        {
            "id": r.id,
            "source_type": r.source_type,
            "source_session_id": r.source_session_id,
            "source_ref": r.source_ref,
            "doc_id": r.doc_id,
            "status": r.status,
            "indexed_at": r.indexed_at.isoformat() if r.indexed_at else None,
            "error_msg": r.error_msg,
        }
        for r in res.scalars().all()
    ]


async def _upsert_index_row(
    deps: AppDeps,
    *,
    project_id: str,
    source_type: str,
    source_session_id: str | None,
    source_ref: str | None,
    doc_id: str,
    status: str,
    error_msg: str | None = None,
):
    res = await deps.db.execute(
        select(RAGIndex).where(
            RAGIndex.project_id == project_id, RAGIndex.doc_id == doc_id
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        row = RAGIndex(
            id=str(uuid.uuid4()),
            project_id=project_id,
            source_type=source_type,
            source_session_id=source_session_id,
            source_ref=source_ref,
            doc_id=doc_id,
            status=status,
            error_msg=error_msg,
        )
        deps.db.add(row)
    else:
        row.status = status
        row.error_msg = error_msg
    if status == "indexed":
        row.indexed_at = datetime.now(timezone.utc)


@router.post("/sync")
async def sync_source(
    project_id: str,
    body: SyncRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Push canvas / chat / prd content into the knowledge graph as documents.

    Strategy: per session we build one big document keyed `<type>:<session_id>`.
    """
    indexed: list[str] = []
    failed: list[dict] = []

    if body.source_type == "canvas":
        sq = select(CanvasSession).where(CanvasSession.project_id == project_id)
        if body.session_ids:
            sq = sq.where(CanvasSession.id.in_(body.session_ids))
        sessions = (await deps.db.execute(sq)).scalars().all()
        for s in sessions:
            cv = (await deps.db.execute(
                select(Canvas).where(Canvas.canvas_session_id == s.id)
            )).scalar_one_or_none()
            text = build_canvas_context(
                [(s.id, s.title, cv.elements_json if cv else "[]")], mode="full"
            )
            doc_id = f"canvas:{s.id}"
            try:
                await deps.rag_agent.upsert(project_id, text, doc_id)
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="canvas",
                    source_session_id=s.id, source_ref=s.id, doc_id=doc_id, status="indexed",
                )
                indexed.append(doc_id)
            except Exception as exc:
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="canvas",
                    source_session_id=s.id, source_ref=s.id, doc_id=doc_id,
                    status="failed", error_msg=str(exc),
                )
                failed.append({"doc_id": doc_id, "error": str(exc)})

    elif body.source_type == "chat":
        sq = select(ChatSession).where(ChatSession.project_id == project_id)
        if body.session_ids:
            sq = sq.where(ChatSession.id.in_(body.session_ids))
        sessions = (await deps.db.execute(sq)).scalars().all()
        for s in sessions:
            msgs = (await deps.db.execute(
                select(ChatMessage).where(ChatMessage.chat_session_id == s.id)
                .order_by(ChatMessage.created_at)
            )).scalars().all()
            if not msgs:
                continue
            text = "\n\n".join(f"[{m.role}] {m.content}" for m in msgs)
            doc_id = f"chat:{s.id}"
            try:
                await deps.rag_agent.upsert(project_id, text, doc_id)
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="chat",
                    source_session_id=s.id, source_ref=s.id, doc_id=doc_id, status="indexed",
                )
                indexed.append(doc_id)
            except Exception as exc:
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="chat",
                    source_session_id=s.id, source_ref=s.id, doc_id=doc_id,
                    status="failed", error_msg=str(exc),
                )
                failed.append({"doc_id": doc_id, "error": str(exc)})

    elif body.source_type == "prd":
        prds = (await deps.db.execute(
            select(PRDDocument).where(PRDDocument.project_id == project_id)
        )).scalars().all()
        for p in prds:
            text = p.content_html or ""
            if not text.strip():
                continue
            doc_id = f"prd:{p.id}"
            try:
                await deps.rag_agent.upsert(project_id, text, doc_id)
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="prd",
                    source_session_id=None, source_ref=p.id, doc_id=doc_id, status="indexed",
                )
                indexed.append(doc_id)
            except Exception as exc:
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="prd",
                    source_session_id=None, source_ref=p.id, doc_id=doc_id,
                    status="failed", error_msg=str(exc),
                )
                failed.append({"doc_id": doc_id, "error": str(exc)})

    await deps.db.flush()
    return {"indexed": indexed, "failed": failed}


@router.post("/rebuild")
async def rebuild_index(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Rebuild the entire knowledge graph for the project (files only)."""
    result = await deps.db.execute(
        select(Attachment)
        .where(Attachment.project_id == project_id)
        .where(Attachment.extracted_text.isnot(None))
    )
    attachments = result.scalars().all()

    if not attachments:
        raise HTTPException(status_code=400, detail="No indexed files found for this project")

    documents = [(a.id, a.extracted_text) for a in attachments if a.extracted_text]
    await deps.rag_agent.rebuild(project_id, documents)

    for a in attachments:
        a.rag_status = "indexed"
    await deps.db.flush()

    return {"message": f"Rebuilt knowledge graph with {len(documents)} documents"}


@router.post("/reset")
async def reset_index(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Drop the entire LightRAG working dir and mark all index rows as unindexed."""
    await deps.rag_agent.reset(project_id)
    res = await deps.db.execute(
        select(RAGIndex).where(RAGIndex.project_id == project_id)
    )
    for row in res.scalars().all():
        row.status = "unindexed"
        row.indexed_at = None
        row.error_msg = None
    # Also clear file rag_status so the UI reflects reality
    a_res = await deps.db.execute(
        select(Attachment).where(Attachment.project_id == project_id)
    )
    for a in a_res.scalars().all():
        a.rag_status = "pending"
    await deps.db.flush()
    return {"message": "knowledge graph reset"}


@router.post("/query")
async def debug_query(
    project_id: str,
    req: RAGQueryRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Direct RAG query — for debugging/testing the knowledge graph."""
    ctx = AgentContext(
        project_id=project_id,
        user_query=req.query,
        rag_mode=req.mode,
        model=req.model,
    )
    events = []
    async for event in deps.rag_agent.query(ctx):
        events.append({"type": event.type, "data": event.data})

    rag_hits = [e["data"] for e in events if e["type"] == "rag_hit"]
    return {"query": req.query, "mode": req.mode, "results": rag_hits}
