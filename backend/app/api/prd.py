"""app/api/prd.py — PRD generation as Markdown documents.

PRD documents are now stored as `ResourceBlock(kind='document', template_type=...)`.
This module keeps the legacy `/projects/{pid}/prd` paths so the existing
frontend keeps working while it migrates to the unified `/resources` API.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import AppDeps, get_deps
from agents.base import AgentContext, FileContext, Message
from infra.models import Canvas, ChatMessage, ResourceBlock

router = APIRouter(prefix="/projects/{project_id}/prd", tags=["prd"])


AVAILABLE_TEMPLATES = ["agile", "aspice", "ieee_srs", "custom"]


class GenerateRequest(BaseModel):
    template_type: str = "agile"
    model: str = "openai/gpt-4o"
    title: str | None = None


class PRDUpdate(BaseModel):
    title: str | None = None
    content_html: str | None = None      # legacy alias (HTML auto-converted)
    markdown_content: str | None = None


class PRDOut(BaseModel):
    id: str
    project_id: str
    template_type: str
    title: str
    markdown_content: str = ""
    content_html: str = ""
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_resource(cls, r: ResourceBlock) -> "PRDOut":
        return cls(
            id=r.id,
            project_id=r.project_id,
            template_type=r.template_type or "custom",
            title=r.title,
            markdown_content=r.markdown_content or "",
            content_html="",
            created_at=r.created_at,
            updated_at=r.updated_at,
        )


def _doc_query(project_id: str):
    return select(ResourceBlock).where(
        ResourceBlock.project_id == project_id,
        ResourceBlock.kind == "document",
    )


@router.post("/generate")
async def generate_prd(
    project_id: str,
    req: GenerateRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    if req.template_type not in AVAILABLE_TEMPLATES:
        raise HTTPException(status_code=400, detail=f"Unknown template. Available: {AVAILABLE_TEMPLATES}")

    canvas_result = await deps.db.execute(select(Canvas).where(Canvas.project_id == project_id))
    canvas = canvas_result.scalar_one_or_none()

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
        .where(ChatMessage.project_id == project_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(30)
    )
    history = [
        Message(role=m.role, content=m.content)
        for m in reversed(history_result.scalars().all())
    ]

    rag_context = ""
    if any(f.rag_ready for f in file_contexts):
        rag_ctx = AgentContext(project_id=project_id, user_query=f"Generate {req.template_type} PRD requirements")
        async for event in deps.rag_agent.query(rag_ctx):
            if event.type == "rag_hit":
                rag_context = event.data.get("context", "")

    from app.api.chat import _extract_canvas_text  # type: ignore
    ctx = AgentContext(
        project_id=project_id,
        user_query=f"Generate a complete {req.template_type} PRD",
        canvas_text=_extract_canvas_text(canvas.elements_json if canvas else "[]"),
        attached_files=file_contexts,
        chat_history=history,
        model=req.model,
        metadata={
            "template_type": req.template_type,
            "rag_context": rag_context,
            "output_format": "markdown",
        },
    )

    prd_id = str(uuid.uuid4())
    r = ResourceBlock(
        id=prd_id,
        project_id=project_id,
        kind="document",
        title=req.title or f"PRD ({req.template_type})",
        template_type=req.template_type,
        origin_type="prd_template",
        origin_ref=json.dumps({"template_type": req.template_type}),
        markdown_content="",
    )
    deps.db.add(r)
    await deps.db.flush()

    accumulated: list[str] = []

    async def event_stream():
        async for event in deps.prd_agent.run(ctx):
            if event.type == "token":
                accumulated.append(event.data)
            yield f"data: {event.to_json()}\n\n"
            if event.type == "done":
                from infra.db import get_session
                async with get_session() as session:
                    doc = await session.get(ResourceBlock, prd_id)
                    if doc:
                        doc.markdown_content = "".join(accumulated)
                        doc.updated_at = datetime.now(timezone.utc)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"X-PRD-ID": prd_id},
    )


@router.get("", response_model=list[PRDOut])
async def list_prds(project_id: str, deps: Annotated[AppDeps, Depends(get_deps)]):
    result = await deps.db.execute(_doc_query(project_id).order_by(ResourceBlock.updated_at.desc()))
    return [PRDOut.from_resource(r) for r in result.scalars().all()]


@router.get("/{prd_id}", response_model=PRDOut)
async def get_prd(project_id: str, prd_id: str, deps: Annotated[AppDeps, Depends(get_deps)]):
    r = await deps.db.get(ResourceBlock, prd_id)
    if not r or r.project_id != project_id or r.kind != "document":
        raise HTTPException(status_code=404, detail="PRD not found")
    return PRDOut.from_resource(r)


@router.put("/{prd_id}", response_model=PRDOut)
async def update_prd(
    project_id: str,
    prd_id: str,
    body: PRDUpdate,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    r = await deps.db.get(ResourceBlock, prd_id)
    if not r or r.project_id != project_id or r.kind != "document":
        raise HTTPException(status_code=404, detail="PRD not found")
    if body.title is not None:
        r.title = body.title
    if body.markdown_content is not None:
        r.markdown_content = body.markdown_content
    elif body.content_html is not None:
        try:
            from markdownify import markdownify as _md
            r.markdown_content = _md(body.content_html, heading_style="ATX").strip()
        except ImportError:
            r.markdown_content = body.content_html
    r.updated_at = datetime.now(timezone.utc)
    await deps.db.flush()
    await deps.db.refresh(r)
    return PRDOut.from_resource(r)
