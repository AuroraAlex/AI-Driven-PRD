"""app/api/export.py — Export PRD to DOCX, PDF, PPTX."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import AppDeps, get_deps
from infra.models import PRDDocument, PPTTemplate

router = APIRouter(prefix="/prd/{prd_id}/export", tags=["export"])


class PPTExportRequest(BaseModel):
    template_id: str | None = None      # PPTTemplate.id; None → blank
    model: str = "openai/gpt-4o"


@router.get("/docx")
async def export_docx(prd_id: str, deps: Annotated[AppDeps, Depends(get_deps)]):
    prd = await deps.db.get(PRDDocument, prd_id)
    if not prd:
        raise HTTPException(status_code=404, detail="PRD not found")

    from services.export import html_to_docx
    docx_bytes = html_to_docx(prd.content_html)

    filename = f"{prd.title or 'prd'}.docx".replace(" ", "_")
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/pdf")
async def export_pdf(prd_id: str, deps: Annotated[AppDeps, Depends(get_deps)]):
    prd = await deps.db.get(PRDDocument, prd_id)
    if not prd:
        raise HTTPException(status_code=404, detail="PRD not found")

    try:
        from services.export import html_to_pdf
        pdf_bytes = html_to_pdf(prd.content_html)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    filename = f"{prd.title or 'prd'}.pdf".replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/pptx")
async def export_pptx(
    prd_id: str,
    req: PPTExportRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    prd = await deps.db.get(PRDDocument, prd_id)
    if not prd:
        raise HTTPException(status_code=404, detail="PRD not found")

    # Resolve PPT template path
    template_path = None
    if req.template_id:
        tpl = await deps.db.get(PPTTemplate, req.template_id)
        if tpl:
            from config import get_settings
            settings = get_settings()
            template_path = settings.ppt_templates_dir / tpl.file_path

    # AI generates slide JSON
    deck = await deps.prd_agent.generate_slide_json(prd.content_html, model=req.model)

    from services.ppt_renderer import render
    pptx_bytes = render(deck, template_path)

    filename = f"{prd.title or 'prd'}.pptx".replace(" ", "_")
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
