"""
app/api/canvas_snapshot.py — Canvas version history, scoped per canvas session.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db
from infra.models.canvas_session import CanvasSession
from infra.models.canvas_snapshot import CanvasSnapshot

router = APIRouter(tags=["canvas-snapshots"])

PREFIX = "/projects/{project_id}/canvas-sessions/{session_id}/snapshots"


class SnapshotCreate(BaseModel):
    elements_json: str = "[]"
    app_state_json: str = "{}"
    label: str = "快照"


class SnapshotMeta(BaseModel):
    id: str
    label: str
    created_at: datetime
    model_config = {"from_attributes": True}


class SnapshotOut(SnapshotMeta):
    elements_json: str
    app_state_json: str


async def _require_session(project_id: str, session_id: str, db: AsyncSession) -> CanvasSession:
    sess = await db.get(CanvasSession, session_id)
    if not sess or sess.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Canvas session not found")
    return sess


@router.post(PREFIX, response_model=SnapshotOut, status_code=status.HTTP_201_CREATED)
async def create_snapshot(
    project_id: str,
    session_id: str,
    body: SnapshotCreate,
    db: AsyncSession = Depends(get_db),
) -> SnapshotOut:
    await _require_session(project_id, session_id, db)
    snap = CanvasSnapshot(
        id=str(uuid.uuid4()),
        canvas_session_id=session_id,
        elements_json=body.elements_json,
        app_state_json=body.app_state_json,
        label=body.label,
    )
    db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return SnapshotOut.model_validate(snap)


@router.get(PREFIX, response_model=List[SnapshotMeta])
async def list_snapshots(
    project_id: str,
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> List[SnapshotMeta]:
    await _require_session(project_id, session_id, db)
    res = await db.execute(
        select(CanvasSnapshot)
        .where(CanvasSnapshot.canvas_session_id == session_id)
        .order_by(CanvasSnapshot.created_at.desc())
        .limit(20)
    )
    return [SnapshotMeta.model_validate(s) for s in res.scalars().all()]


@router.get(PREFIX + "/{snapshot_id}", response_model=SnapshotOut)
async def get_snapshot(
    project_id: str,
    session_id: str,
    snapshot_id: str,
    db: AsyncSession = Depends(get_db),
) -> SnapshotOut:
    await _require_session(project_id, session_id, db)
    snap = await db.get(CanvasSnapshot, snapshot_id)
    if not snap or snap.canvas_session_id != session_id:
        raise HTTPException(404, "Snapshot not found")
    return SnapshotOut.model_validate(snap)


@router.post(PREFIX + "/{snapshot_id}/restore", response_model=SnapshotOut)
async def restore_snapshot(
    project_id: str,
    session_id: str,
    snapshot_id: str,
    db: AsyncSession = Depends(get_db),
) -> SnapshotOut:
    await _require_session(project_id, session_id, db)
    snap = await db.get(CanvasSnapshot, snapshot_id)
    if not snap or snap.canvas_session_id != session_id:
        raise HTTPException(404, "Snapshot not found")
    return SnapshotOut.model_validate(snap)
