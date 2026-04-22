"""app/api/rag.py — RAG status, manual rebuild, debug query, and cross-source sync."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import AppDeps, get_deps
from agents.base import AgentContext
from agents.canvas.context import build_canvas_context
from config import get_settings
from infra.models import (
    Canvas,
    CanvasSession,
    ChatMessage,
    ChatSession,
    RAGIndex,
    ResourceBlock,
)

router = APIRouter(prefix="/projects/{project_id}/rag", tags=["rag"])


class RAGQueryRequest(BaseModel):
    query: str
    mode: str = "hybrid"
    model: str = "openai/gpt-4o"


class SyncRequest(BaseModel):
    """If session_ids omitted: sync all sessions of that source type."""
    source_type: Literal["canvas", "chat", "prd"]
    session_ids: list[str] | None = None


@router.get("/status")
async def rag_status(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Return indexing status for all file resources in the project."""
    result = await deps.db.execute(
        select(ResourceBlock).where(
            ResourceBlock.project_id == project_id,
            ResourceBlock.kind == "file",
        )
    )
    return [
        {
            "file_id": a.id,
            "filename": a.original_filename or a.title,
            "rag_status": "indexed" if a.is_in_kb else "pending",
        }
        for a in result.scalars().all()
    ]


@router.get("/sources")
async def list_sources(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    res = await deps.db.execute(
        select(RAGIndex).where(RAGIndex.project_id == project_id).order_by(RAGIndex.created_at.desc())
    )
    return [
        {
            "id": r.id,
            "source_type": r.source_type,
            "source_session_id": r.source_session_id,
            "source_ref": r.source_ref,
            "doc_id": r.doc_id,
            "status": r.status,
            "indexed_at": r.indexed_at.isoformat() if r.indexed_at else None,
            "error_msg": r.error_msg,
        }
        for r in res.scalars().all()
    ]


async def _upsert_index_row(
    deps: AppDeps,
    *,
    project_id: str,
    source_type: str,
    source_session_id: str | None,
    source_ref: str | None,
    doc_id: str,
    status: str,
    error_msg: str | None = None,
    resource_id: str | None = None,
):
    res = await deps.db.execute(
        select(RAGIndex).where(
            RAGIndex.project_id == project_id, RAGIndex.doc_id == doc_id
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        row = RAGIndex(
            id=str(uuid.uuid4()),
            project_id=project_id,
            source_type=source_type,
            source_session_id=source_session_id,
            source_ref=source_ref,
            doc_id=doc_id,
            status=status,
            error_msg=error_msg,
            resource_id=resource_id,
        )
        deps.db.add(row)
    else:
        row.status = status
        row.error_msg = error_msg
        if resource_id and not row.resource_id:
            row.resource_id = resource_id
    if status == "indexed":
        row.indexed_at = datetime.now(timezone.utc)


@router.post("/sync")
async def sync_source(
    project_id: str,
    body: SyncRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    indexed: list[str] = []
    failed: list[dict] = []

    if body.source_type == "canvas":
        sq = select(CanvasSession).where(CanvasSession.project_id == project_id)
        if body.session_ids:
            sq = sq.where(CanvasSession.id.in_(body.session_ids))
        sessions = (await deps.db.execute(sq)).scalars().all()
        for s in sessions:
            cv = (await deps.db.execute(
                select(Canvas).where(Canvas.canvas_session_id == s.id)
            )).scalar_one_or_none()
            text = build_canvas_context(
                [(s.id, s.title, cv.elements_json if cv else "[]")], mode="full"
            )
            doc_id = f"canvas:{s.id}"
            try:
                await deps.rag_agent.upsert(project_id, text, doc_id)
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="canvas",
                    source_session_id=s.id, source_ref=s.id, doc_id=doc_id, status="indexed",
                )
                indexed.append(doc_id)
            except Exception as exc:
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="canvas",
                    source_session_id=s.id, source_ref=s.id, doc_id=doc_id,
                    status="failed", error_msg=str(exc),
                )
                failed.append({"doc_id": doc_id, "error": str(exc)})

    elif body.source_type == "chat":
        sq = select(ChatSession).where(ChatSession.project_id == project_id)
        if body.session_ids:
            sq = sq.where(ChatSession.id.in_(body.session_ids))
        sessions = (await deps.db.execute(sq)).scalars().all()
        for s in sessions:
            msgs = (await deps.db.execute(
                select(ChatMessage).where(ChatMessage.chat_session_id == s.id)
                .order_by(ChatMessage.created_at)
            )).scalars().all()
            if not msgs:
                continue
            text = "\n\n".join(f"[{m.role}] {m.content}" for m in msgs)
            doc_id = f"chat:{s.id}"
            try:
                await deps.rag_agent.upsert(project_id, text, doc_id)
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="chat",
                    source_session_id=s.id, source_ref=s.id, doc_id=doc_id, status="indexed",
                )
                indexed.append(doc_id)
            except Exception as exc:
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="chat",
                    source_session_id=s.id, source_ref=s.id, doc_id=doc_id,
                    status="failed", error_msg=str(exc),
                )
                failed.append({"doc_id": doc_id, "error": str(exc)})

    elif body.source_type == "prd":
        prds = (await deps.db.execute(
            select(ResourceBlock).where(
                ResourceBlock.project_id == project_id,
                ResourceBlock.kind == "document",
            )
        )).scalars().all()
        for p in prds:
            text = (p.markdown_content or "").strip()
            if not text:
                continue
            doc_id = f"resource:{p.id}"
            try:
                await deps.rag_agent.upsert(project_id, text, doc_id)
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="resource",
                    source_session_id=None, source_ref=p.id, doc_id=doc_id, status="indexed",
                    resource_id=p.id,
                )
                p.is_in_kb = True
                indexed.append(doc_id)
            except Exception as exc:
                await _upsert_index_row(
                    deps, project_id=project_id, source_type="resource",
                    source_session_id=None, source_ref=p.id, doc_id=doc_id,
                    status="failed", error_msg=str(exc), resource_id=p.id,
                )
                failed.append({"doc_id": doc_id, "error": str(exc)})

    await deps.db.flush()
    return {"indexed": indexed, "failed": failed}


@router.post("/rebuild")
async def rebuild_index(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Rebuild the knowledge graph from every resource currently flagged ``is_in_kb=True``.

    Includes files, snippets and documents. Resources that are not in the KB
    have their RAGIndex rows reset to ``unindexed``.
    """
    result = await deps.db.execute(
        select(ResourceBlock).where(
            ResourceBlock.project_id == project_id,
            ResourceBlock.is_in_kb.is_(True),
        )
    )
    in_kb = result.scalars().all()

    documents: list[tuple[str, str]] = []
    selected_ids: set[str] = set()
    for r in in_kb:
        text = (r.extracted_text if r.kind == "file" else r.markdown_content) or ""
        text = text.strip()
        if not text:
            continue
        doc_id = f"resource:{r.id}"
        documents.append((doc_id, text))
        selected_ids.add(r.id)

    if not documents:
        raise HTTPException(status_code=400, detail="No indexable resources are marked is_in_kb=True")

    failed_doc_ids = await deps.rag_agent.rebuild(project_id, documents)
    failed_set = set(failed_doc_ids)

    # Refresh RAGIndex rows for every resource of this project.
    all_idx = (await deps.db.execute(
        select(RAGIndex).where(RAGIndex.project_id == project_id)
    )).scalars().all()
    by_doc: dict[str, RAGIndex] = {row.doc_id: row for row in all_idx}

    now = datetime.now(timezone.utc)
    for doc_id, _text in documents:
        row = by_doc.get(doc_id)
        rid = doc_id.split(":", 1)[1] if ":" in doc_id else None
        if row is None:
            row = RAGIndex(
                id=str(uuid.uuid4()),
                project_id=project_id,
                source_type="resource",
                source_session_id=None,
                source_ref=rid,
                doc_id=doc_id,
                resource_id=rid,
            )
            deps.db.add(row)
        if doc_id in failed_set:
            row.status = "failed"
            row.error_msg = "rebuild insert failed"
        else:
            row.status = "indexed"
            row.indexed_at = now
            row.error_msg = None

    # Anything that was previously indexed but not in the rebuild set → unindexed
    for row in all_idx:
        if row.resource_id and row.resource_id not in selected_ids:
            row.status = "unindexed"
            row.indexed_at = None
            row.error_msg = None

    await deps.db.flush()
    return {
        "message": f"Rebuilt knowledge graph with {len(documents)} documents",
        "rebuilt": len(documents) - len(failed_doc_ids),
        "failed": failed_doc_ids,
    }


@router.post("/reset")
async def reset_index(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Hard-reset the project's knowledge base.

    - Wipes the LightRAG working dir (chunks / vectors / graph / doc_status).
    - Clears the in-memory pipeline_status (so progress widget no longer
      shows stale failure messages).
    - Deletes every RAGIndex row of the project so no ``failed`` /
      ``indexed`` entries linger.
    - Resets ``ResourceBlock.is_in_kb`` to False.
    """
    await deps.rag_agent.reset(project_id)
    # Hard-delete RAGIndex rows so any prior ``failed`` state is gone.
    from sqlalchemy import delete as sa_delete
    await deps.db.execute(
        sa_delete(RAGIndex).where(RAGIndex.project_id == project_id)
    )
    a_res = await deps.db.execute(
        select(ResourceBlock).where(ResourceBlock.project_id == project_id)
    )
    for a in a_res.scalars().all():
        a.is_in_kb = False
    await deps.db.flush()
    return {"message": "knowledge graph reset"}


@router.post("/query")
async def debug_query(
    project_id: str,
    req: RAGQueryRequest,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    ctx = AgentContext(
        project_id=project_id,
        user_query=req.query,
        rag_mode=req.mode,
        model=req.model,
    )
    events = []
    async for event in deps.rag_agent.query(ctx):
        events.append({"type": event.type, "data": event.data})

    rag_hits = [e["data"] for e in events if e["type"] == "rag_hit"]
    return {"query": req.query, "mode": req.mode, "results": rag_hits}


# ── Graph visualization ──────────────────────────────────────────────────────


def _graphml_path(project_id: str) -> Path:
    return get_settings().rag_data_dir / project_id / "graph_chunk_entity_relation.graphml"


@router.get("/graph")
async def get_graph(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
    limit: int = Query(500, ge=1, le=5000, description="Max nodes returned (top-degree first)"),
):
    """Return the project's knowledge graph as JSON for force-directed rendering."""
    path = _graphml_path(project_id)
    if not path.exists():
        return {"nodes": [], "links": [], "truncated": False, "total_nodes": 0, "total_links": 0}
    try:
        import networkx as nx
    except ImportError as exc:
        raise HTTPException(500, f"networkx not installed: {exc}")

    g = nx.read_graphml(str(path))
    total_nodes, total_links = g.number_of_nodes(), g.number_of_edges()
    truncated = total_nodes > limit

    if truncated:
        # Keep the highest-degree nodes; cull the rest.
        kept = [n for n, _d in sorted(g.degree, key=lambda kv: kv[1], reverse=True)[:limit]]
        g = g.subgraph(kept).copy()

    nodes = []
    for node_id, attrs in g.nodes(data=True):
        nodes.append({
            "id": str(node_id),
            "label": str(attrs.get("entity_name") or attrs.get("d0") or node_id),
            "type": str(attrs.get("entity_type") or attrs.get("d1") or "entity"),
            "description": str(attrs.get("description") or attrs.get("d2") or "")[:240],
            "degree": int(g.degree(node_id)),
        })
    links = []
    for src, tgt, attrs in g.edges(data=True):
        links.append({
            "source": str(src),
            "target": str(tgt),
            "weight": float(attrs.get("weight") or attrs.get("d3") or 1.0),
            "relation": str(attrs.get("keywords") or attrs.get("description") or "")[:120],
        })

    return {
        "nodes": nodes,
        "links": links,
        "truncated": truncated,
        "total_nodes": total_nodes,
        "total_links": total_links,
    }


@router.get("/graph.graphml")
async def download_graphml(project_id: str):
    """Stream the raw GraphML file for offline analysis."""
    path = _graphml_path(project_id)
    if not path.exists():
        raise HTTPException(404, "No graph file yet — index at least one resource first")
    return FileResponse(
        path,
        media_type="application/xml",
        filename=f"{project_id}-knowledge-graph.graphml",
    )


# ── Embedded chunks & live progress ──────────────────────────────────────────


def _project_data_dir(project_id: str) -> Path:
    return get_settings().rag_data_dir / project_id


@router.get("/chunks")
async def list_chunks(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str = Query("", description="Substring filter on chunk text (case-insensitive)"),
    doc_id: str | None = Query(None, description="Filter to one source document, e.g. resource:<uuid>"),
):
    """Enumerate every embedded text chunk LightRAG has stored for the project.

    Reads `kv_store_text_chunks.json` directly so this endpoint stays cheap
    and avoids spinning up the LightRAG instance for browsing.
    """
    chunks_file = _project_data_dir(project_id) / "kv_store_text_chunks.json"
    if not chunks_file.exists():
        return {"items": [], "total": 0, "offset": offset, "limit": limit}

    try:
        raw = json.loads(chunks_file.read_text())
    except Exception as exc:
        raise HTTPException(500, f"Failed to parse chunks store: {exc}")

    # Resolve doc_id → resource title for nicer display
    rid_to_title: dict[str, str] = {}
    res = await deps.db.execute(
        select(ResourceBlock).where(ResourceBlock.project_id == project_id)
    )
    for r in res.scalars().all():
        rid_to_title[r.id] = r.title or r.original_filename or "未命名"

    needle = search.strip().lower()
    items: list[dict] = []
    for cid, c in raw.items():
        full_doc = c.get("full_doc_id") or ""
        if doc_id and full_doc != doc_id:
            continue
        content = c.get("content") or ""
        if needle and needle not in content.lower():
            continue
        rid = full_doc.split(":", 1)[1] if ":" in full_doc else full_doc
        items.append({
            "chunk_id": cid,
            "doc_id": full_doc,
            "resource_id": rid,
            "resource_title": rid_to_title.get(rid),
            "tokens": c.get("tokens"),
            "chunk_order_index": c.get("chunk_order_index"),
            "content": content,
            "create_time": c.get("create_time"),
        })

    # Stable order: by source doc, then chunk_order_index
    items.sort(key=lambda x: (x["doc_id"] or "", x["chunk_order_index"] or 0))
    total = len(items)
    return {
        "items": items[offset : offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/progress")
async def rag_progress(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Return live indexing progress + KB readiness for the project.

    `kb_ready` is true when at least one document is in the PROCESSED state
    AND no job is currently busy. Frontend uses this to gate query/chat
    features that depend on a populated knowledge graph.
    """
    counts: dict[str, int] = {"pending": 0, "processing": 0, "processed": 0, "failed": 0}
    failed_docs: list[dict] = []

    status_file = _project_data_dir(project_id) / "kv_store_doc_status.json"
    if status_file.exists():
        try:
            raw = json.loads(status_file.read_text())
            for doc_key, info in raw.items():
                st = (info.get("status") or "").lower()
                if st in counts:
                    counts[st] += 1
                if st == "failed":
                    failed_docs.append({
                        "doc_id": doc_key,
                        "summary": info.get("content_summary"),
                        "error": info.get("error") or info.get("error_msg"),
                        "updated_at": info.get("updated_at"),
                    })
        except Exception:
            pass

    # Live pipeline status — only available if the LightRAG instance is in cache
    busy = False
    job_name: str | None = None
    latest_message: str | None = None
    history_messages: list[str] = []
    cur_batch = 0
    total_batches = 0
    try:
        store = deps.rag_agent.store
        # Use cached instance only — do NOT trigger a full rebuild here.
        if project_id in getattr(store, "_cache", {}):
            from lightrag.kg.shared_storage import get_namespace_data
            inst = store._cache[project_id]
            ws = getattr(inst, "workspace", "") or ""
            ns = await get_namespace_data("pipeline_status", workspace=ws)  # type: ignore[arg-type]
            if isinstance(ns, dict):
                busy = bool(ns.get("busy"))
                job_name = ns.get("job_name")
                latest_message = ns.get("latest_message")
                history_messages = list(ns.get("history_messages") or [])[-20:]
                cur_batch = int(ns.get("cur_batch") or 0)
                total_batches = int(ns.get("batchs") or 0)
    except Exception:
        # Pipeline-status is best-effort; never fail the endpoint over it.
        pass

    kb_ready = counts["processed"] > 0 and not busy
    # Surface the per-project ingestion queue so the UI can show "x in queue".
    from app.api.resources import ingest_queue_depth, ingest_active
    queue_depth = ingest_queue_depth(project_id)
    active = ingest_active(project_id)
    return {
        "kb_ready": kb_ready,
        "busy": busy or queue_depth > 0 or active,
        "job_name": job_name,
        "latest_message": latest_message,
        "history_messages": history_messages,
        "cur_batch": cur_batch,
        "total_batches": total_batches,
        "doc_counts": counts,
        "failed_docs": failed_docs[:50],
        "queue_depth": queue_depth,
        "ingest_active": active,
    }

