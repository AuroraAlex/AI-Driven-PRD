"""app/api/canvas.py — Canvas save/load (session-scoped)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from infra.db import get_db
from infra.models import Canvas, CanvasSession, Reference

router = APIRouter(
    prefix="/projects/{project_id}/canvas-sessions/{session_id}/canvas",
    tags=["canvas"],
)


class CanvasSave(BaseModel):
    elements_json: str = "[]"
    app_state_json: str = "{}"
    files_json: str = "{}"


class CanvasOut(BaseModel):
    id: str
    canvas_session_id: str
    elements_json: str
    app_state_json: str
    files_json: str
    updated_at: datetime

    model_config = {"from_attributes": True}


CARD_NODE_TYPES = {"sticky_note", "user_story", "ai_card", "prd_card", "file_card", "frame"}


async def _get_session(db: AsyncSession, project_id: str, session_id: str) -> CanvasSession:
    sess = await db.get(CanvasSession, session_id)
    if not sess or sess.project_id != project_id:
        raise HTTPException(404, "Canvas session not found")
    return sess


def _collect_card_ids(elements_json: str) -> set[str]:
    """Return ids that other nodes (references) might use to refer to a card.

    For grouped cards we store groupIds; for frames we store the frame's own id.
    """
    try:
        elems = json.loads(elements_json)
    except Exception:
        return set()
    out: set[str] = set()
    for el in elems:
        if el.get("isDeleted"):
            continue
        nt = (el.get("customData") or {}).get("nodeType")
        if nt not in CARD_NODE_TYPES:
            continue
        for gid in (el.get("groupIds") or []):
            out.add(gid)
        if nt == "frame":
            out.add(el["id"])
    return out


@router.get("", response_model=CanvasOut | None)
async def get_canvas(
    project_id: str,
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _get_session(db, project_id, session_id)
    res = await db.execute(select(Canvas).where(Canvas.canvas_session_id == session_id))
    return res.scalar_one_or_none()


@router.put("", response_model=CanvasOut)
async def save_canvas(
    project_id: str,
    session_id: str,
    body: CanvasSave,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _get_session(db, project_id, session_id)

    res = await db.execute(select(Canvas).where(Canvas.canvas_session_id == session_id))
    canvas = res.scalar_one_or_none()

    if canvas is not None:
        # Reference GC: drop refs that point to disappeared card ids
        old_ids = _collect_card_ids(canvas.elements_json or "[]")
        new_ids = _collect_card_ids(body.elements_json)
        removed = old_ids - new_ids
        if removed:
            for direction in ("source", "target"):
                where = [
                    Reference.project_id == project_id,
                    getattr(Reference, f"{direction}_type") == "canvas_card",
                    getattr(Reference, f"{direction}_session_id") == session_id,
                    getattr(Reference, f"{direction}_id").in_(list(removed)),
                ]
                ref_res = await db.execute(select(Reference).where(*where))
                for r in ref_res.scalars().all():
                    await db.delete(r)
    else:
        canvas = Canvas(id=str(uuid.uuid4()), canvas_session_id=session_id)
        db.add(canvas)

    canvas.elements_json = body.elements_json
    canvas.app_state_json = body.app_state_json
    canvas.files_json = body.files_json
    canvas.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(canvas)
    return canvas
