"""app/api/ai_cards.py — Generate AI card rich content (markdown + sources)."""
from __future__ import annotations

import json
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import AppDeps, get_deps
from agents.canvas.ai_card import AICardAgent, AICardContent
from agents.canvas.context import build_canvas_context
from agents.base import FileContext
from infra.models import Canvas, CanvasSession, ResourceBlock

router = APIRouter(prefix="/projects/{project_id}/ai-cards", tags=["ai-cards"])


class AICardGenerateRequest(BaseModel):
    prompt: str
    model: str = "openai/gpt-4o"
    canvas_session_ids: list[str] = []
    canvas_context_mode: str = "summary"
    rag_enabled: bool = True
    rag_mode: str = "hybrid"
    chat_session_id: str | None = None


@router.post("/generate")
async def generate_card(
    project_id: str,
    req: AICardGenerateRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    # Canvas context (optional)
    canvas_text = ""
    if req.canvas_session_ids:
        cs = await deps.db.execute(
            select(CanvasSession).where(
                CanvasSession.project_id == project_id,
                CanvasSession.id.in_(req.canvas_session_ids),
            )
        )
        sessions = cs.scalars().all()
        cv = await deps.db.execute(
            select(Canvas).where(Canvas.canvas_session_id.in_([s.id for s in sessions]))
        )
        cv_map = {c.canvas_session_id: c for c in cv.scalars().all()}
        canvas_text = build_canvas_context(
            [(s.id, s.title, cv_map[s.id].elements_json if s.id in cv_map else "[]") for s in sessions],
            mode=req.canvas_context_mode,  # type: ignore[arg-type]
        )

    # Files
    files_res = await deps.db.execute(
        select(ResourceBlock).where(
            ResourceBlock.project_id == project_id,
            ResourceBlock.kind == "file",
        )
    )
    file_ctxs = [
        FileContext(
            file_id=a.id,
            filename=a.original_filename or a.title,
            file_type=a.file_type or "other",
            extracted_text=a.extracted_text or "",
            rag_ready=a.is_in_kb,
            file_size=a.file_size or 0,
        )
        for a in files_res.scalars().all()
    ]

    agent = AICardAgent(deps.chat_agent)

    async def stream():
        result_payload: dict | None = None
        async for item in agent.generate(
            project_id=project_id,
            prompt=req.prompt,
            canvas_text=canvas_text,
            attached_files=file_ctxs,
            canvas_session_ids=req.canvas_session_ids,
            chat_session_id=req.chat_session_id,
            model=req.model,
            rag_enabled=req.rag_enabled,
            rag_mode=req.rag_mode,
        ):
            if isinstance(item, AICardContent):
                payload = asdict(item)
                payload["sources"] = [s for s in payload["sources"]]
                result_payload = payload
                yield f"data: {json.dumps({'type': 'card', 'data': payload}, ensure_ascii=False)}\n\n"
            else:
                yield f"data: {item.to_json()}\n\n"
        if result_payload is None:
            yield 'data: {"type":"error","data":{"message":"empty result"}}\n\n'

    return StreamingResponse(stream(), media_type="text/event-stream")
