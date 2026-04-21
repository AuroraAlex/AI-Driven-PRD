"""app/api/prd.py — PRD generation and editing endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import AppDeps, get_deps
from agents.base import AgentContext, FileContext, Message
from infra.models import Attachment, Canvas, ChatMessage, PRDDocument

router = APIRouter(prefix="/projects/{project_id}/prd", tags=["prd"])


AVAILABLE_TEMPLATES = ["agile", "aspice", "ieee_srs", "custom"]


class GenerateRequest(BaseModel):
    template_type: str = "agile"
    model: str = "openai/gpt-4o"
    title: str | None = None


class PRDUpdate(BaseModel):
    title: str | None = None
    content_html: str | None = None


class PRDOut(BaseModel):
    id: str
    project_id: str
    template_type: str
    title: str
    content_html: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


@router.post("/generate")
async def generate_prd(
    project_id: str,
    req: GenerateRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    if req.template_type not in AVAILABLE_TEMPLATES:
        raise HTTPException(status_code=400, detail=f"Unknown template. Available: {AVAILABLE_TEMPLATES}")

    # Gather context
    canvas_result = await deps.db.execute(select(Canvas).where(Canvas.project_id == project_id))
    canvas = canvas_result.scalar_one_or_none()

    files_result = await deps.db.execute(select(Attachment).where(Attachment.project_id == project_id))
    attachments = files_result.scalars().all()
    file_contexts = [
        FileContext(
            file_id=a.id,
            filename=a.original_name,
            file_type=a.file_type,
            extracted_text=a.extracted_text or "",
            rag_ready=(a.rag_status == "indexed"),
        )
        for a in attachments
    ]

    history_result = await deps.db.execute(
        select(ChatMessage)
        .where(ChatMessage.project_id == project_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(30)
    )
    history = [
        Message(role=m.role, content=m.content)
        for m in reversed(history_result.scalars().all())
    ]

    # RAG query for enriched context
    rag_context = ""
    if any(f.rag_ready for f in file_contexts):
        from agents.base import AgentContext as AC
        rag_ctx = AC(project_id=project_id, user_query=f"Generate {req.template_type} PRD requirements")
        async for event in deps.rag_agent.query(rag_ctx):
            if event.type == "rag_hit":
                rag_context = event.data.get("context", "")

    from app.api.chat import _extract_canvas_text
    ctx = AgentContext(
        project_id=project_id,
        user_query=f"Generate a complete {req.template_type} PRD",
        canvas_text=_extract_canvas_text(canvas.elements_json if canvas else "[]"),
        attached_files=file_contexts,
        chat_history=history,
        model=req.model,
        metadata={"template_type": req.template_type, "rag_context": rag_context},
    )

    # Create PRD record upfront (will be updated as stream completes)
    prd_id = str(uuid.uuid4())
    prd = PRDDocument(
        id=prd_id,
        project_id=project_id,
        template_type=req.template_type,
        title=req.title or f"PRD ({req.template_type})",
        content_html="",
    )
    deps.db.add(prd)
    await deps.db.flush()

    accumulated: list[str] = []

    async def event_stream():
        async for event in deps.prd_agent.run(ctx):
            if event.type == "token":
                accumulated.append(event.data)
            yield f"data: {event.to_json()}\n\n"
            if event.type == "done":
                # Persist final HTML
                from infra.db import get_session
                async with get_session() as session:
                    doc = await session.get(PRDDocument, prd_id)
                    if doc:
                        doc.content_html = "".join(accumulated)
                        doc.updated_at = datetime.now(timezone.utc)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"X-PRD-ID": prd_id},
    )


@router.get("", response_model=list[PRDOut])
async def list_prds(project_id: str, deps: Annotated[AppDeps, Depends(get_deps)]):
    result = await deps.db.execute(
        select(PRDDocument)
        .where(PRDDocument.project_id == project_id)
        .order_by(PRDDocument.updated_at.desc())
    )
    return result.scalars().all()


@router.get("/{prd_id}", response_model=PRDOut)
async def get_prd(project_id: str, prd_id: str, deps: Annotated[AppDeps, Depends(get_deps)]):
    prd = await deps.db.get(PRDDocument, prd_id)
    if not prd or prd.project_id != project_id:
        raise HTTPException(status_code=404, detail="PRD not found")
    return prd


@router.put("/{prd_id}", response_model=PRDOut)
async def update_prd(
    project_id: str,
    prd_id: str,
    body: PRDUpdate,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    prd = await deps.db.get(PRDDocument, prd_id)
    if not prd or prd.project_id != project_id:
        raise HTTPException(status_code=404, detail="PRD not found")
    if body.title is not None:
        prd.title = body.title
    if body.content_html is not None:
        prd.content_html = body.content_html
    prd.updated_at = datetime.now(timezone.utc)
    await deps.db.flush()
    await deps.db.refresh(prd)
    return prd
