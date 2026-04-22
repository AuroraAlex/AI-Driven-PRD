"""app/api/resources.py — Unified resource block CRUD + KB toggle.

Replaces the old `files.py` endpoints. The legacy
`/projects/{pid}/files/...` paths are kept as compatibility aliases for
file-kind resources only (see legacy_files_router below).
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import AppDeps, get_deps
from config import get_settings
from infra.models import RAGIndex, ResourceBlock, RESOURCE_KINDS
from services.text_extractor import extract_text

router = APIRouter(prefix="/projects/{project_id}/resources", tags=["resources"])

# Compatibility alias for the old /files endpoints (file-kind only).
legacy_files_router = APIRouter(prefix="/projects/{project_id}/files", tags=["files"])

logger = logging.getLogger(__name__)


# ── Per-project ingestion queue ──────────────────────────────────────────────
#
# LightRAG's pipeline is not safe for concurrent invocations on the same
# workspace, AND every background ingestion job needs its own DB session
# (otherwise SQLite contends with concurrent foreground requests, surfacing
# as "database is locked"). To keep things simple and bullet-proof we run a
# single asyncio worker per project that drains a queue one job at a time.
# Different projects still ingest in parallel (one worker each).

@dataclass
class _IngestJob:
    project_id: str
    resource_id: str
    text: str


_INGEST_QUEUES: dict[str, "asyncio.Queue[_IngestJob]"] = {}
_INGEST_WORKERS: dict[str, asyncio.Task] = {}
# True while the worker is mid-`upsert` for a given project. Combined with
# queue.qsize() this lets the UI distinguish "waiting" from "processing".
_INGEST_ACTIVE: dict[str, bool] = {}


def ingest_queue_depth(project_id: str) -> int:
    """Number of jobs still WAITING in the queue (excludes the one currently
    being processed). Used by /rag/progress to show a non-overlapping
    'waiting' chip alongside LightRAG's own 'processing' counter.
    """
    q = _INGEST_QUEUES.get(project_id)
    return q.qsize() if q else 0


def ingest_active(project_id: str) -> bool:
    """True if the worker is currently inside `rag_agent.upsert`."""
    return bool(_INGEST_ACTIVE.get(project_id))


def _ensure_worker(project_id: str, rag_agent) -> "asyncio.Queue[_IngestJob]":
    """Lazily spin up the per-project worker + queue."""
    queue = _INGEST_QUEUES.get(project_id)
    if queue is None:
        queue = asyncio.Queue()
        _INGEST_QUEUES[project_id] = queue
    task = _INGEST_WORKERS.get(project_id)
    if task is None or task.done():
        _INGEST_WORKERS[project_id] = asyncio.create_task(
            _ingest_worker_loop(project_id, queue, rag_agent),
            name=f"ingest-worker:{project_id}",
        )
    return queue


async def _ingest_worker_loop(
    project_id: str,
    queue: "asyncio.Queue[_IngestJob]",
    rag_agent,
) -> None:
    """Drain the queue forever; one ingestion at a time per project."""
    from infra.db import get_session  # local import to avoid cycles
    while True:
        job: _IngestJob = await queue.get()
        _INGEST_ACTIVE[project_id] = True
        try:
            await _process_one(job, rag_agent, get_session)
        except asyncio.CancelledError:
            # Worker cancelled (interrupt). Re-raise so the task ends cleanly.
            _INGEST_ACTIVE[project_id] = False
            raise
        except Exception:
            logger.exception("Ingest worker crashed on job %s", job.resource_id)
        finally:
            _INGEST_ACTIVE[project_id] = False
            queue.task_done()


async def _process_one(job: _IngestJob, rag_agent, get_session) -> None:
    doc_id = f"resource:{job.resource_id}"
    # Mark indexing in its own short-lived session, then commit so the row
    # is visible to other readers immediately.
    async with get_session() as session:
        idx = (await session.execute(
            select(RAGIndex).where(
                RAGIndex.project_id == job.project_id,
                RAGIndex.doc_id == doc_id,
            )
        )).scalar_one_or_none()
        rb = await session.get(ResourceBlock, job.resource_id)
        if rb is None:
            # Resource deleted while waiting in the queue.
            if idx is not None:
                await session.delete(idx)
            return
        if idx is None:
            idx = RAGIndex(
                id=str(uuid.uuid4()),
                project_id=job.project_id,
                source_type=("file" if rb.kind == "file" else "resource"),
                source_session_id=None,
                source_ref=job.resource_id,
                doc_id=doc_id,
                resource_id=job.resource_id,
            )
            session.add(idx)
        idx.status = "indexing"
        idx.error_msg = None

    # Heavy lifting OUTSIDE any DB session so SQLite stays unlocked
    # while we hit the embedding/extraction APIs.
    err: str | None = None
    try:
        await rag_agent.upsert(job.project_id, job.text, doc_id)
    except Exception as exc:
        logger.warning("Ingest failed for %s/%s: %s", job.project_id, doc_id, exc)
        err = str(exc)

    # Final status write in another short session.
    async with get_session() as session:
        idx = (await session.execute(
            select(RAGIndex).where(
                RAGIndex.project_id == job.project_id,
                RAGIndex.doc_id == doc_id,
            )
        )).scalar_one_or_none()
        rb = await session.get(ResourceBlock, job.resource_id)
        if idx is None:
            return
        if err is None:
            idx.status = "indexed"
            idx.indexed_at = datetime.now(timezone.utc)
            if rb:
                rb.is_in_kb = True
        else:
            idx.status = "failed"
            idx.error_msg = err


def _enqueue_ingest(project_id: str, resource_id: str, text: str, rag_agent) -> None:
    """Enqueue a job onto the per-project worker."""
    queue = _ensure_worker(project_id, rag_agent)
    queue.put_nowait(_IngestJob(project_id=project_id, resource_id=resource_id, text=text))


async def cancel_ingest(project_id: str) -> dict:
    """Drain the project's queue and cancel any in-flight ingestion.

    Returns counts of (drained, cancelled_active). The worker task is left
    cancelled; it will be re-spawned lazily on the next enqueue.
    """
    drained_ids: list[str] = []
    queue = _INGEST_QUEUES.get(project_id)
    if queue is not None:
        while True:
            try:
                job = queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            drained_ids.append(job.resource_id)
            queue.task_done()
    cancelled_active = False
    task = _INGEST_WORKERS.get(project_id)
    if task is not None and not task.done():
        task.cancel()
        cancelled_active = True
        # Drop the cached worker; next enqueue creates a fresh one.
        _INGEST_WORKERS.pop(project_id, None)
    _INGEST_ACTIVE[project_id] = False
    return {"drained": drained_ids, "cancelled_active": cancelled_active}



# ── Response schema ───────────────────────────────────────────────────────────


class ResourceOut(BaseModel):
    id: str
    project_id: str
    kind: str
    title: str
    summary: str | None = None
    markdown_content: str = ""
    origin_type: str
    origin_ref: dict | list | str | None = None
    template_type: str | None = None
    tags: list[str] = []
    is_in_kb: bool = False
    rag_status: str = "unindexed"
    # File-only
    storage_filename: str | None = None
    original_filename: str | None = None
    file_type: str | None = None
    file_size: int = 0
    extracted_text: str | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm_with_status(cls, r: ResourceBlock, status: str = "unindexed") -> "ResourceOut":
        try:
            origin_ref = json.loads(r.origin_ref) if r.origin_ref else None
        except (json.JSONDecodeError, TypeError):
            origin_ref = r.origin_ref
        try:
            tags = json.loads(r.tags_json) if r.tags_json else []
        except (json.JSONDecodeError, TypeError):
            tags = []
        return cls(
            id=r.id,
            project_id=r.project_id,
            kind=r.kind,
            title=r.title,
            summary=r.summary,
            markdown_content=r.markdown_content or "",
            origin_type=r.origin_type,
            origin_ref=origin_ref,
            template_type=r.template_type,
            tags=tags,
            is_in_kb=r.is_in_kb,
            rag_status=status,
            storage_filename=r.storage_filename,
            original_filename=r.original_filename,
            file_type=r.file_type,
            file_size=r.file_size or 0,
            extracted_text=r.extracted_text,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )


class ResourceCreate(BaseModel):
    kind: Literal["snippet", "document"]
    title: str = "Untitled"
    markdown_content: str = ""
    summary: str | None = None
    origin_type: str = "manual"
    origin_ref: dict | None = None
    template_type: str | None = None
    tags: list[str] = []


class ResourceUpdate(BaseModel):
    title: str | None = None
    markdown_content: str | None = None
    summary: str | None = None
    kind: Literal["snippet", "document"] | None = None  # snippet -> document promotion
    tags: list[str] | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _ext_to_type(ext: str) -> str:
    return {
        "pdf": "pdf", "docx": "docx", "doc": "docx",
        "txt": "txt", "md": "txt",
        "png": "image", "jpg": "image", "jpeg": "image", "webp": "image", "tiff": "image",
    }.get(ext, "other")


async def _status_map(deps: AppDeps, project_id: str) -> dict[str, str]:
    """Return resource_id -> rag_status."""
    res = await deps.db.execute(
        select(RAGIndex).where(RAGIndex.project_id == project_id)
    )
    out: dict[str, str] = {}
    for row in res.scalars().all():
        if row.resource_id:
            out[row.resource_id] = row.status
    return out


async def _index_resource_background(
    project_id: str,
    resource_id: str,
    text_content: str,
    rag_agent,
) -> None:
    """Compatibility wrapper — enqueue onto the per-project worker.

    Kept synchronous-looking so existing call sites (FastAPI BackgroundTasks)
    don't change shape; the actual ingestion is now serial per project.
    """
    _enqueue_ingest(project_id, resource_id, text_content, rag_agent)


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[ResourceOut])
async def list_resources(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
    kind: Literal["file", "snippet", "document"] | None = Query(None),
    in_kb: bool | None = Query(None),
):
    q = select(ResourceBlock).where(ResourceBlock.project_id == project_id)
    if kind:
        q = q.where(ResourceBlock.kind == kind)
    if in_kb is not None:
        q = q.where(ResourceBlock.is_in_kb == in_kb)
    q = q.order_by(ResourceBlock.updated_at.desc())
    rows = (await deps.db.execute(q)).scalars().all()
    statuses = await _status_map(deps, project_id)
    return [ResourceOut.from_orm_with_status(r, statuses.get(r.id, "unindexed")) for r in rows]


@router.get("/{resource_id}", response_model=ResourceOut)
async def get_resource(
    project_id: str,
    resource_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    r = await deps.db.get(ResourceBlock, resource_id)
    if not r or r.project_id != project_id:
        raise HTTPException(404, "Resource not found")
    statuses = await _status_map(deps, project_id)
    return ResourceOut.from_orm_with_status(r, statuses.get(r.id, "unindexed"))


@router.post("", response_model=ResourceOut, status_code=status.HTTP_201_CREATED)
async def create_resource(
    project_id: str,
    body: ResourceCreate,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    if body.kind not in ("snippet", "document"):
        raise HTTPException(400, "kind must be snippet or document for /resources POST; use /upload for files")
    r = ResourceBlock(
        id=str(uuid.uuid4()),
        project_id=project_id,
        kind=body.kind,
        title=body.title or "Untitled",
        summary=body.summary,
        markdown_content=body.markdown_content or "",
        origin_type=body.origin_type or "manual",
        origin_ref=json.dumps(body.origin_ref) if body.origin_ref else None,
        template_type=body.template_type,
        tags_json=json.dumps(body.tags) if body.tags else None,
        is_in_kb=False,
    )
    deps.db.add(r)
    await deps.db.flush()
    await deps.db.refresh(r)
    return ResourceOut.from_orm_with_status(r, "unindexed")


@router.patch("/{resource_id}", response_model=ResourceOut)
async def update_resource(
    project_id: str,
    resource_id: str,
    body: ResourceUpdate,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    r = await deps.db.get(ResourceBlock, resource_id)
    if not r or r.project_id != project_id:
        raise HTTPException(404, "Resource not found")
    if body.title is not None:
        r.title = body.title
    if body.markdown_content is not None:
        r.markdown_content = body.markdown_content
    if body.summary is not None:
        r.summary = body.summary
    if body.kind is not None:
        if r.kind == "file":
            raise HTTPException(400, "Cannot change kind of a file resource")
        r.kind = body.kind
    if body.tags is not None:
        r.tags_json = json.dumps(body.tags) if body.tags else None
    r.updated_at = datetime.now(timezone.utc)
    await deps.db.flush()
    await deps.db.refresh(r)
    statuses = await _status_map(deps, project_id)
    return ResourceOut.from_orm_with_status(r, statuses.get(r.id, "unindexed"))


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resource(
    project_id: str,
    resource_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    r = await deps.db.get(ResourceBlock, resource_id)
    if not r or r.project_id != project_id:
        raise HTTPException(404, "Resource not found")
    if r.kind == "file" and r.storage_filename:
        try:
            deps.storage.delete(project_id, r.storage_filename)
        except Exception:
            pass
    await deps.db.delete(r)


@router.post("/upload", response_model=ResourceOut, status_code=status.HTTP_201_CREATED)
async def upload_file_resource(
    project_id: str,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    deps: Annotated[AppDeps, Depends(get_deps)],
    auto_index: bool = Query(False, description="Immediately add to knowledge base"),
):
    settings = get_settings()
    data = await file.read()
    if len(data) > settings.max_file_size_bytes:
        raise HTTPException(413, f"File exceeds {settings.max_file_size_mb}MB limit")

    original_name = file.filename or "upload"
    ext = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
    file_type = _ext_to_type(ext)
    stored_name = f"{uuid.uuid4()}.{ext}" if ext else str(uuid.uuid4())

    deps.storage.save(project_id, stored_name, data)
    file_path = deps.storage.file_path(project_id, stored_name)
    extracted = extract_text(file_path, file_type)

    r = ResourceBlock(
        id=str(uuid.uuid4()),
        project_id=project_id,
        kind="file",
        title=original_name,
        markdown_content=extracted or "",
        origin_type="upload",
        is_in_kb=False,
        storage_filename=stored_name,
        original_filename=original_name,
        file_type=file_type,
        file_size=len(data),
        extracted_text=extracted,
    )
    deps.db.add(r)
    await deps.db.flush()
    await deps.db.refresh(r)

    if auto_index and extracted and extracted.strip():
        await _mark_queued(deps, project_id, r.id, kind=r.kind)
        background_tasks.add_task(
            _index_resource_background,
            project_id=project_id,
            resource_id=r.id,
            text_content=extracted,
            rag_agent=deps.rag_agent,
        )

    return ResourceOut.from_orm_with_status(r, "queued" if auto_index else "unindexed")


async def _mark_queued(
    deps: AppDeps, project_id: str, resource_id: str, *, kind: str
) -> None:
    """Insert/update a `queued` RAGIndex row inside the current request
    session — guarantees the next /resources poll reflects the queued state.
    """
    doc_id = f"resource:{resource_id}"
    res = await deps.db.execute(
        select(RAGIndex).where(RAGIndex.project_id == project_id, RAGIndex.doc_id == doc_id)
    )
    idx = res.scalar_one_or_none()
    if idx is None:
        idx = RAGIndex(
            id=str(uuid.uuid4()),
            project_id=project_id,
            source_type=("file" if kind == "file" else "resource"),
            source_session_id=None,
            source_ref=resource_id,
            doc_id=doc_id,
            resource_id=resource_id,
        )
        deps.db.add(idx)
    idx.status = "queued"
    idx.error_msg = None
    await deps.db.flush()


@router.post("/{resource_id}/index", response_model=ResourceOut)
async def index_resource(
    project_id: str,
    resource_id: str,
    background_tasks: BackgroundTasks,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    r = await deps.db.get(ResourceBlock, resource_id)
    if not r or r.project_id != project_id:
        raise HTTPException(404, "Resource not found")
    text_content = (
        r.extracted_text if r.kind == "file" else r.markdown_content
    ) or ""
    if not text_content.strip():
        raise HTTPException(400, "Resource has no indexable content")
    await _mark_queued(deps, project_id, r.id, kind=r.kind)
    background_tasks.add_task(
        _index_resource_background,
        project_id=project_id,
        resource_id=r.id,
        text_content=text_content,
        rag_agent=deps.rag_agent,
    )
    return ResourceOut.from_orm_with_status(r, "queued")


# ── Bulk in/out KB ───────────────────────────────────────────────────────────


class BulkIdsBody(BaseModel):
    resource_ids: list[str]


@router.post("/index-batch")
async def index_batch(
    project_id: str,
    body: BulkIdsBody,
    background_tasks: BackgroundTasks,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Enqueue many resources for ingestion. Returns counts."""
    if not body.resource_ids:
        return {"queued": 0, "skipped": 0}
    rows = (await deps.db.execute(
        select(ResourceBlock).where(
            ResourceBlock.project_id == project_id,
            ResourceBlock.id.in_(body.resource_ids),
        )
    )).scalars().all()
    queued = 0
    skipped = 0
    for r in rows:
        text_content = (r.extracted_text if r.kind == "file" else r.markdown_content) or ""
        if not text_content.strip():
            skipped += 1
            continue
        await _mark_queued(deps, project_id, r.id, kind=r.kind)
        background_tasks.add_task(
            _index_resource_background,
            project_id=project_id,
            resource_id=r.id,
            text_content=text_content,
            rag_agent=deps.rag_agent,
        )
        queued += 1
    return {"queued": queued, "skipped": skipped}


@router.post("/unindex-batch")
async def unindex_batch(
    project_id: str,
    body: BulkIdsBody,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Remove many resources from the KB. Synchronous – waits for LightRAG."""
    if not body.resource_ids:
        return {"unindexed": 0}
    rows = (await deps.db.execute(
        select(ResourceBlock).where(
            ResourceBlock.project_id == project_id,
            ResourceBlock.id.in_(body.resource_ids),
        )
    )).scalars().all()
    count = 0
    for r in rows:
        doc_id = f"resource:{r.id}"
        try:
            await deps.rag_agent.delete_by_doc_id(project_id, doc_id)
        except Exception as exc:
            logger.warning("unindex_batch delete failed for %s: %s", doc_id, exc)
        idx = (await deps.db.execute(
            select(RAGIndex).where(
                RAGIndex.project_id == project_id, RAGIndex.doc_id == doc_id
            )
        )).scalar_one_or_none()
        if idx:
            idx.status = "unindexed"
            idx.indexed_at = None
            idx.error_msg = None
        r.is_in_kb = False
        count += 1
    await deps.db.flush()
    return {"unindexed": count}


@router.post("/cancel-ingest")
async def cancel_ingest_endpoint(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Interrupt: drain the project's ingestion queue and cancel the
    currently running upsert. Any RAGIndex rows still in `queued` /
    `indexing` are reset to `unindexed` so the UI reflects reality.
    """
    result = await cancel_ingest(project_id)
    # Reset queued/indexing rows to unindexed.
    rows = (await deps.db.execute(
        select(RAGIndex).where(
            RAGIndex.project_id == project_id,
            RAGIndex.status.in_(["queued", "indexing"]),
        )
    )).scalars().all()
    reset_count = 0
    for idx in rows:
        idx.status = "unindexed"
        idx.error_msg = "用户中断"
        reset_count += 1
    await deps.db.flush()
    return {
        "drained": len(result["drained"]),
        "cancelled_active": result["cancelled_active"],
        "reset_rows": reset_count,
    }


@router.delete("/{resource_id}/index", response_model=ResourceOut)
async def unindex_resource(
    project_id: str,
    resource_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    r = await deps.db.get(ResourceBlock, resource_id)
    if not r or r.project_id != project_id:
        raise HTTPException(404, "Resource not found")
    doc_id = f"resource:{resource_id}"
    res = await deps.db.execute(
        select(RAGIndex).where(RAGIndex.project_id == project_id, RAGIndex.doc_id == doc_id)
    )
    idx = res.scalar_one_or_none()
    if idx:
        try:
            await deps.rag_agent.delete_by_doc_id(project_id, doc_id)
        except Exception:
            pass
        idx.status = "unindexed"
        idx.indexed_at = None
    r.is_in_kb = False
    await deps.db.flush()
    await deps.db.refresh(r)
    return ResourceOut.from_orm_with_status(r, "unindexed")


# ── Legacy /files endpoints (file kind only) ─────────────────────────────────


@legacy_files_router.get("", response_model=list[ResourceOut])
async def legacy_list_files(project_id: str, deps: Annotated[AppDeps, Depends(get_deps)]):
    return await list_resources(project_id, deps, kind="file", in_kb=None)


@legacy_files_router.post("", response_model=ResourceOut, status_code=status.HTTP_201_CREATED)
async def legacy_upload_file(
    project_id: str,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    # Preserve historical behaviour: auto index uploads.
    return await upload_file_resource(project_id, file, background_tasks, deps, auto_index=True)


@legacy_files_router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def legacy_delete_file(
    project_id: str,
    file_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    return await delete_resource(project_id, file_id, deps)
