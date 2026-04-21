"""app/api/projects.py — Project CRUD (thin HTTP layer)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import AppDeps, get_deps
from infra.db import get_db
from infra.models import Project

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ProjectOut])
async def list_projects(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(select(Project).order_by(Project.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectCreate, db: Annotated[AsyncSession, Depends(get_db)]):
    project = Project(
        id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
    )
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, db: Annotated[AsyncSession, Depends(get_db)]):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    project.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    project = await deps.db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Delete uploaded files from storage
    deps.storage.delete_project(project_id)
    # Invalidate RAG instance cache
    deps.rag_agent._store.invalidate(project_id)
    await deps.db.delete(project)
