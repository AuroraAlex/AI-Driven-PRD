"""app/api/references.py — Generic reference graph between content nodes."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from infra.db import get_db
from infra.models import Reference, REF_TYPES, REF_RELATIONS, Project

router = APIRouter(prefix="/projects/{project_id}/references", tags=["references"])

RefType = Literal["canvas_card", "chat_message", "prd_section", "rag_chunk", "file"]


class ReferenceCreate(BaseModel):
    source_type: str
    source_id: str
    source_session_id: str | None = None
    target_type: str
    target_id: str
    target_session_id: str | None = None
    relation: str = "cites"
    created_by: str = "user"


class ReferenceOut(BaseModel):
    id: str
    project_id: str
    source_type: str
    source_id: str
    source_session_id: str | None
    target_type: str
    target_id: str
    target_session_id: str | None
    relation: str
    created_by: str
    created_at: datetime
    model_config = {"from_attributes": True}


def _validate(body: ReferenceCreate) -> None:
    if body.source_type not in REF_TYPES or body.target_type not in REF_TYPES:
        raise HTTPException(400, f"type must be one of {REF_TYPES}")
    if body.relation not in REF_RELATIONS:
        raise HTTPException(400, f"relation must be one of {REF_RELATIONS}")


@router.get("", response_model=list[ReferenceOut])
async def list_references(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    node_type: str | None = Query(None, description="Filter by source/target type"),
    node_id: str | None = Query(None, description="Filter by source/target id"),
    direction: str | None = Query(None, description="outgoing | incoming"),
):
    if not await db.get(Project, project_id):
        raise HTTPException(404, "Project not found")

    stmt = select(Reference).where(Reference.project_id == project_id)
    if node_id and node_type:
        if direction == "outgoing":
            stmt = stmt.where(Reference.source_type == node_type, Reference.source_id == node_id)
        elif direction == "incoming":
            stmt = stmt.where(Reference.target_type == node_type, Reference.target_id == node_id)
        else:
            stmt = stmt.where(or_(
                (Reference.source_type == node_type) & (Reference.source_id == node_id),
                (Reference.target_type == node_type) & (Reference.target_id == node_id),
            ))
    res = await db.execute(stmt.order_by(Reference.created_at.desc()).limit(500))
    return res.scalars().all()


@router.post("", response_model=ReferenceOut, status_code=status.HTTP_201_CREATED)
async def create_reference(
    project_id: str,
    body: ReferenceCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if not await db.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    _validate(body)
    # Idempotent upsert based on the unique edge constraint
    res = await db.execute(
        select(Reference).where(
            Reference.project_id == project_id,
            Reference.source_type == body.source_type,
            Reference.source_id == body.source_id,
            Reference.target_type == body.target_type,
            Reference.target_id == body.target_id,
            Reference.relation == body.relation,
        )
    )
    existing = res.scalar_one_or_none()
    if existing:
        return existing
    ref = Reference(
        id=str(uuid.uuid4()),
        project_id=project_id,
        source_type=body.source_type,
        source_id=body.source_id,
        source_session_id=body.source_session_id,
        target_type=body.target_type,
        target_id=body.target_id,
        target_session_id=body.target_session_id,
        relation=body.relation,
        created_by=body.created_by,
    )
    db.add(ref)
    await db.flush()
    await db.refresh(ref)
    return ref


@router.delete("/{reference_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reference(
    project_id: str,
    reference_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    ref = await db.get(Reference, reference_id)
    if not ref or ref.project_id != project_id:
        raise HTTPException(404, "Reference not found")
    await db.delete(ref)
