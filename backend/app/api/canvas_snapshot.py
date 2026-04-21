"""
app/api/canvas_snapshot.py — Canvas version history endpoints.
"""
from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db
from infra.models.canvas_snapshot import CanvasSnapshot
from infra.models.project import Project

router = APIRouter(tags=["canvas-snapshots"])


# ── Schemas ───────────────────────────────────────────────────────────────────

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


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _require_project(project_id: str, db: AsyncSession) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post(
    "/projects/{project_id}/canvas/snapshots",
    response_model=SnapshotOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_snapshot(
    project_id: str,
    body: SnapshotCreate,
    db: AsyncSession = Depends(get_db),
) -> SnapshotOut:
    await _require_project(project_id, db)
    snap = CanvasSnapshot(
        project_id=project_id,
        elements_json=body.elements_json,
        app_state_json=body.app_state_json,
        label=body.label,
    )
    db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return SnapshotOut.model_validate(snap)


@router.get(
    "/projects/{project_id}/canvas/snapshots",
    response_model=List[SnapshotMeta],
)
async def list_snapshots(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> List[SnapshotMeta]:
    await _require_project(project_id, db)
    result = await db.execute(
        select(CanvasSnapshot)
        .where(CanvasSnapshot.project_id == project_id)
        .order_by(CanvasSnapshot.created_at.desc())
        .limit(20)
    )
    snaps = result.scalars().all()
    return [SnapshotMeta.model_validate(s) for s in snaps]


@router.get(
    "/projects/{project_id}/canvas/snapshots/{snapshot_id}",
    response_model=SnapshotOut,
)
async def get_snapshot(
    project_id: str,
    snapshot_id: str,
    db: AsyncSession = Depends(get_db),
) -> SnapshotOut:
    await _require_project(project_id, db)
    result = await db.execute(
        select(CanvasSnapshot).where(
            CanvasSnapshot.id == snapshot_id,
            CanvasSnapshot.project_id == project_id,
        )
    )
    snap = result.scalar_one_or_none()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return SnapshotOut.model_validate(snap)


@router.post(
    "/projects/{project_id}/canvas/snapshots/{snapshot_id}/restore",
    response_model=SnapshotOut,
)
async def restore_snapshot(
    project_id: str,
    snapshot_id: str,
    db: AsyncSession = Depends(get_db),
) -> SnapshotOut:
    """Return the snapshot content; the client is responsible for calling updateScene."""
    await _require_project(project_id, db)
    result = await db.execute(
        select(CanvasSnapshot).where(
            CanvasSnapshot.id == snapshot_id,
            CanvasSnapshot.project_id == project_id,
        )
    )
    snap = result.scalar_one_or_none()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return SnapshotOut.model_validate(snap)
