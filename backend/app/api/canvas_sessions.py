"""app/api/canvas_sessions.py — CRUD for canvas sessions (named canvas threads)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from infra.db import get_db
from infra.models import Canvas, CanvasSession, Project

router = APIRouter(prefix="/projects/{project_id}/canvas-sessions", tags=["canvas-sessions"])


class CanvasSessionCreate(BaseModel):
    title: str | None = None


class CanvasSessionUpdate(BaseModel):
    title: str | None = None
    order_index: int | None = None
    archived: bool | None = None


class CanvasSessionOut(BaseModel):
    id: str
    project_id: str
    title: str
    order_index: int
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


async def _ensure_project(db: AsyncSession, project_id: str) -> Project:
    proj = await db.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")
    return proj


@router.get("", response_model=list[CanvasSessionOut])
async def list_sessions(project_id: str, db: Annotated[AsyncSession, Depends(get_db)]):
    await _ensure_project(db, project_id)
    res = await db.execute(
        select(CanvasSession)
        .where(CanvasSession.project_id == project_id)
        .order_by(CanvasSession.archived_at.is_(None).desc(),
                  CanvasSession.order_index, CanvasSession.created_at)
    )
    return res.scalars().all()


@router.post("", response_model=CanvasSessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    project_id: str,
    body: CanvasSessionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _ensure_project(db, project_id)
    # Default title: 画布 N+1
    res = await db.execute(
        select(CanvasSession).where(CanvasSession.project_id == project_id)
    )
    n = len(res.scalars().all())
    sess = CanvasSession(
        id=str(uuid.uuid4()),
        project_id=project_id,
        title=body.title or f"画布 {n + 1}",
        order_index=n,
    )
    db.add(sess)
    await db.flush()
    # Eagerly create empty Canvas row
    db.add(Canvas(id=str(uuid.uuid4()), canvas_session_id=sess.id))
    await db.flush()
    await db.refresh(sess)
    return sess


@router.patch("/{session_id}", response_model=CanvasSessionOut)
async def update_session(
    project_id: str,
    session_id: str,
    body: CanvasSessionUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    sess = await db.get(CanvasSession, session_id)
    if not sess or sess.project_id != project_id:
        raise HTTPException(404, "Canvas session not found")
    if body.title is not None:
        sess.title = body.title
    if body.order_index is not None:
        sess.order_index = body.order_index
    if body.archived is not None:
        sess.archived_at = datetime.now(timezone.utc) if body.archived else None
    await db.flush()
    await db.refresh(sess)
    return sess


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    project_id: str,
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    sess = await db.get(CanvasSession, session_id)
    if not sess or sess.project_id != project_id:
        raise HTTPException(404, "Canvas session not found")
    await db.delete(sess)
