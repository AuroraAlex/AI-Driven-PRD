"""app/api/rag.py — RAG status, manual rebuild, and debug query endpoint."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import AppDeps, get_deps
from agents.base import AgentContext
from infra.models import Attachment, RAGIndex

router = APIRouter(prefix="/projects/{project_id}/rag", tags=["rag"])


class RAGQueryRequest(BaseModel):
    query: str
    mode: str = "hybrid"
    model: str = "openai/gpt-4o"


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


@router.post("/rebuild")
async def rebuild_index(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Rebuild the entire knowledge graph for the project."""
    result = await deps.db.execute(
        select(Attachment)
        .where(Attachment.project_id == project_id)
        .where(Attachment.extracted_text.isnot(None))
    )
    attachments = result.scalars().all()

    if not attachments:
        raise HTTPException(status_code=400, detail="No indexed files found for this project")

    documents = [
        (a.id, a.extracted_text)
        for a in attachments
        if a.extracted_text
    ]

    await deps.rag_agent.rebuild(project_id, documents)

    # Reset statuses
    for a in attachments:
        a.rag_status = "indexed"
    await deps.db.flush()

    return {"message": f"Rebuilt knowledge graph with {len(documents)} documents"}


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
