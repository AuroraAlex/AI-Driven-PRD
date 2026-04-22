"""app/api/export.py — Export PRD documents (now Markdown) to DOCX, PDF, PPTX."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.deps import AppDeps, get_deps
from infra.models import PPTTemplate, ResourceBlock

router = APIRouter(prefix="/prd/{prd_id}/export", tags=["export"])


class PPTExportRequest(BaseModel):
    template_id: str | None = None
    model: str = "openai/gpt-4o"


async def _load_doc(deps: AppDeps, prd_id: str) -> ResourceBlock:
    r = await deps.db.get(ResourceBlock, prd_id)
    if not r or r.kind != "document":
        raise HTTPException(status_code=404, detail="PRD not found")
    return r


@router.get("/docx")
async def export_docx(prd_id: str, deps: Annotated[AppDeps, Depends(get_deps)]):
    r = await _load_doc(deps, prd_id)
    from services.export import markdown_to_docx
    docx_bytes = markdown_to_docx(r.markdown_content or "")
    filename = f"{r.title or 'prd'}.docx".replace(" ", "_")
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/pdf")
async def export_pdf(prd_id: str, deps: Annotated[AppDeps, Depends(get_deps)]):
    r = await _load_doc(deps, prd_id)
    try:
        from services.export import markdown_to_pdf
        pdf_bytes = markdown_to_pdf(r.markdown_content or "")
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    filename = f"{r.title or 'prd'}.pdf".replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/markdown")
async def export_markdown(prd_id: str, deps: Annotated[AppDeps, Depends(get_deps)]):
    r = await _load_doc(deps, prd_id)
    filename = f"{r.title or 'prd'}.md".replace(" ", "_")
    return Response(
        content=(r.markdown_content or "").encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/pptx")
async def export_pptx(
    prd_id: str,
    req: PPTExportRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    r = await _load_doc(deps, prd_id)

    template_path = None
    if req.template_id:
        tpl = await deps.db.get(PPTTemplate, req.template_id)
        if tpl:
            from config import get_settings
            template_path = get_settings().ppt_templates_dir / tpl.file_path

    deck = await deps.prd_agent.generate_slide_json(r.markdown_content or "", model=req.model)

    from services.ppt_renderer import render
    pptx_bytes = render(deck, template_path)

    filename = f"{r.title or 'prd'}.pptx".replace(" ", "_")
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
