"""app/api/files.py — File upload, listing, deletion."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import AppDeps, get_deps
from config import get_settings
from infra.db import get_db
from infra.models import Attachment, RAGIndex
from services.text_extractor import extract_text

router = APIRouter(prefix="/projects/{project_id}/files", tags=["files"])


class AttachmentOut(BaseModel):
    id: str
    filename: str
    original_name: str
    file_type: str
    file_size: int
    rag_status: str
    uploaded_at: datetime

    model_config = {"from_attributes": True}


async def _index_file_background(
    project_id: str,
    attachment_id: str,
    file_text: str,
    doc_id: str,
    rag_agent,
) -> None:
    """Background task: run RAG indexing and update status in DB."""
    from datetime import timezone
    from infra.db import get_session
    async with get_session() as session:
        # Find or create RAGIndex row
        result = await session.execute(
            select(RAGIndex).where(RAGIndex.attachment_id == attachment_id)
        )
        rag_idx = result.scalar_one_or_none()
        if rag_idx is None:
            rag_idx = RAGIndex(
                id=str(uuid.uuid4()),
                project_id=project_id,
                attachment_id=attachment_id,
            )
            session.add(rag_idx)

        attachment = await session.get(Attachment, attachment_id)

        # Mark indexing
        rag_idx.status = "indexing"
        if attachment:
            attachment.rag_status = "indexing"
        await session.flush()

        try:
            await rag_agent.index(project_id, file_text, doc_id)
            rag_idx.status = "indexed"
            rag_idx.indexed_at = datetime.now(timezone.utc)
            if attachment:
                attachment.rag_status = "indexed"
        except Exception as exc:
            rag_idx.status = "failed"
            rag_idx.error_msg = str(exc)
            if attachment:
                attachment.rag_status = "failed"
        await session.flush()


@router.post("", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_file(
    project_id: str,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    settings = get_settings()

    # Size check
    data = await file.read()
    if len(data) > settings.max_file_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds {settings.max_file_size_mb}MB limit",
        )

    # Detect type and save
    original_name = file.filename or "upload"
    ext = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
    file_type = _ext_to_type(ext)
    stored_name = f"{uuid.uuid4()}.{ext}" if ext else str(uuid.uuid4())

    deps.storage.save(project_id, stored_name, data)

    # Extract text synchronously (fast for most files)
    file_path = deps.storage.file_path(project_id, stored_name)
    extracted = extract_text(file_path, file_type)

    # Persist DB record
    attachment = Attachment(
        id=str(uuid.uuid4()),
        project_id=project_id,
        filename=stored_name,
        original_name=original_name,
        file_type=file_type,
        file_size=len(data),
        extracted_text=extracted,
        rag_status="pending",
    )
    deps.db.add(attachment)
    await deps.db.flush()
    await deps.db.refresh(attachment)

    # Trigger background RAG indexing if text was extracted
    if extracted.strip():
        background_tasks.add_task(
            _index_file_background,
            project_id=project_id,
            attachment_id=attachment.id,
            file_text=extracted,
            doc_id=attachment.id,
            rag_agent=deps.rag_agent,
        )

    return attachment


@router.get("", response_model=list[AttachmentOut])
async def list_files(project_id: str, db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(Attachment)
        .where(Attachment.project_id == project_id)
        .order_by(Attachment.uploaded_at.desc())
    )
    return result.scalars().all()


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    project_id: str,
    file_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    attachment = await deps.db.get(Attachment, file_id)
    if not attachment or attachment.project_id != project_id:
        raise HTTPException(status_code=404, detail="File not found")
    deps.storage.delete(project_id, attachment.filename)
    await deps.db.delete(attachment)


def _ext_to_type(ext: str) -> str:
    return {
        "pdf": "pdf",
        "docx": "docx",
        "doc": "docx",
        "txt": "txt",
        "md": "txt",
        "png": "image",
        "jpg": "image",
        "jpeg": "image",
        "webp": "image",
        "tiff": "image",
    }.get(ext, "other")
