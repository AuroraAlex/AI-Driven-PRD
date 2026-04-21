"""app/api/canvas.py — Canvas save/load (thin HTTP layer)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from infra.db import get_db
from infra.models import Canvas, Project

router = APIRouter(prefix="/projects/{project_id}/canvas", tags=["canvas"])


class CanvasSave(BaseModel):
    elements_json: str = "[]"
    app_state_json: str = "{}"
    files_json: str = "{}"


class CanvasOut(BaseModel):
    id: str
    project_id: str
    elements_json: str
    app_state_json: str
    files_json: str
    updated_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=CanvasOut | None)
async def get_canvas(project_id: str, db: Annotated[AsyncSession, Depends(get_db)]):
    from sqlalchemy import select
    result = await db.execute(
        select(Canvas).where(Canvas.project_id == project_id)
    )
    return result.scalar_one_or_none()


@router.put("", response_model=CanvasOut)
async def save_canvas(
    project_id: str,
    body: CanvasSave,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from sqlalchemy import select
    # Verify project exists
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(select(Canvas).where(Canvas.project_id == project_id))
    canvas = result.scalar_one_or_none()

    if canvas is None:
        canvas = Canvas(
            id=str(uuid.uuid4()),
            project_id=project_id,
        )
        db.add(canvas)

    canvas.elements_json = body.elements_json
    canvas.app_state_json = body.app_state_json
    canvas.files_json = body.files_json
    canvas.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(canvas)
    return canvas
