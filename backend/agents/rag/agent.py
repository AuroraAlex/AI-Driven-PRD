"""
agents/rag/agent.py — RAGAgent (Agentic GraphRAG via LightRAG).
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import AsyncGenerator

from lightrag import QueryParam

from agents.base import AgentContext, AgentEvent, new_trace_id
from agents.rag.graph_store import GraphStore
from infra.llm import LLMClient

logger = logging.getLogger(__name__)


async def _load_overrides(project_id: str) -> dict:
    """Pull per-project ProjectSetting row (if any) into an overrides dict."""
    try:
        from infra.db import get_session
        from infra.models import ProjectSetting
        async with get_session() as session:
            row = await session.get(ProjectSetting, project_id)
            if row is None:
                return {}
            out: dict = {}
            if row.embedding_model:
                out["embedding_model"] = row.embedding_model
            if row.extraction_model:
                out["extraction_model"] = row.extraction_model
            if row.rerank_model:
                out["rerank_model"] = row.rerank_model
            if row.min_rerank_score is not None:
                out["min_rerank_score"] = row.min_rerank_score
            if row.embedding_provider:
                out["embedding_provider"] = row.embedding_provider
            if row.extraction_provider:
                out["extraction_provider"] = row.extraction_provider
            if row.rerank_provider:
                out["rerank_provider"] = row.rerank_provider
            if row.chunk_token_size:
                out["chunk_token_size"] = row.chunk_token_size
            if row.chunk_overlap_token_size:
                out["chunk_overlap_token_size"] = row.chunk_overlap_token_size
            if row.top_k:
                out["top_k"] = row.top_k
            return out
    except Exception as exc:
        logger.debug("RAGAgent: failed to load project settings for %s: %s", project_id, exc)
        return {}


class RAGAgent:
    agent_name = "rag"

    def __init__(
        self,
        llm: LLMClient,
        storage_base: Path | None = None,
        graph_store: GraphStore | None = None,
    ) -> None:
        self.llm = llm
        self._store = graph_store or GraphStore(storage_base=storage_base)

    @property
    def store(self) -> GraphStore:
        return self._store

    async def _instance(self, project_id: str):
        overrides = await _load_overrides(project_id)
        return await self._store.aget(project_id, overrides=overrides)

    # ── Indexing ─────────────────────────────────────────────────────────────

    async def index(self, project_id: str, text: str, doc_id: str) -> None:
        rag = await self._instance(project_id)
        await rag.ainsert(text, ids=[doc_id])
        logger.info("RAGAgent: indexed doc %s for project %s", doc_id, project_id)

    async def upsert(self, project_id: str, text: str, doc_id: str) -> None:
        rag = await self._instance(project_id)
        try:
            await rag.adelete_by_doc_id(doc_id)  # type: ignore[attr-defined]
        except Exception as exc:
            logger.debug("RAGAgent: delete-before-upsert failed for %s: %s", doc_id, exc)
        await rag.ainsert(text, ids=[doc_id])
        logger.info("RAGAgent: upserted doc %s for project %s", doc_id, project_id)

    async def delete_by_doc_id(self, project_id: str, doc_id: str) -> bool:
        rag = await self._instance(project_id)
        try:
            await rag.adelete_by_doc_id(doc_id)  # type: ignore[attr-defined]
            return True
        except Exception as exc:
            logger.warning("RAGAgent: delete failed for %s: %s", doc_id, exc)
            return False

    async def reset(self, project_id: str) -> None:
        """Wipe the entire LightRAG working dir for a project.

        Also clears the in-process ``pipeline_status`` shared memory so the
        next progress poll doesn't show stale ``latest_message`` / failure
        history from the now-deleted graph.
        """
        import shutil
        from config import get_settings

        # Best-effort: clear LightRAG's shared pipeline_status namespace before
        # we drop the cached instance. The namespace is keyed by workspace, so
        # we need a live instance to discover its workspace name.
        try:
            rag = self._store._cache.get(project_id)  # type: ignore[attr-defined]
            if rag is not None:
                from lightrag.kg.shared_storage import get_namespace_data
                ps = await get_namespace_data("pipeline_status", workspace=rag.workspace)
                ps.update({
                    "busy": False,
                    "job_name": "",
                    "job_start": None,
                    "docs": 0,
                    "batchs": 0,
                    "cur_batch": 0,
                    "request_pending": False,
                    "latest_message": "",
                })
                hm = ps.get("history_messages")
                if hm is not None:
                    try:
                        hm.clear()
                    except Exception:
                        ps["history_messages"] = []
        except Exception as exc:
            logger.debug("RAGAgent: pipeline_status clear failed for %s: %s", project_id, exc)

        self._store.invalidate(project_id)
        target = get_settings().rag_data_dir / project_id
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        target.mkdir(parents=True, exist_ok=True)
        logger.info("RAGAgent: reset graph for project %s", project_id)

    async def rebuild(self, project_id: str, documents: list[tuple[str, str]]) -> list[str]:
        """Reset then re-insert all docs. Returns list of doc_ids that failed."""
        await self.reset(project_id)
        rag = await self._instance(project_id)
        failed: set[str] = set()
        for doc_id, text in documents:
            try:
                await rag.ainsert(text, ids=[doc_id])
            except Exception as exc:
                logger.warning("RAGAgent: rebuild insert %s failed: %s", doc_id, exc)
                failed.add(doc_id)
        # LightRAG's pipeline may swallow embedding/extraction errors and only
        # mark the doc as FAILED in its internal status store. Reconcile here.
        try:
            from lightrag.base import DocStatus
            failed_docs = await rag.get_docs_by_status(DocStatus.FAILED)
            for raw_id in failed_docs:
                # LightRAG normalises ids to "resource:<doc_id>" — strip prefix.
                norm = raw_id.split(":", 1)[1] if ":" in raw_id else raw_id
                if any(norm == d_id or raw_id == d_id for d_id, _ in documents):
                    failed.add(norm if any(norm == d_id for d_id, _ in documents) else raw_id)
        except Exception as exc:
            logger.debug("RAGAgent: could not query doc_status: %s", exc)

        logger.info(
            "RAGAgent: rebuilt graph for %s (%d docs, %d failed)",
            project_id, len(documents), len(failed),
        )
        return sorted(failed)

    # ── Querying ─────────────────────────────────────────────────────────────

    async def query(
        self,
        ctx: AgentContext,
        trace_id: str | None = None,
    ) -> AsyncGenerator[AgentEvent, None]:
        trace_id = trace_id or new_trace_id()

        yield AgentEvent(
            type="tool_call",
            agent=self.agent_name,
            data={"tool": "lightrag.query", "mode": ctx.rag_mode},
            trace_id=trace_id,
        )

        try:
            overrides = await _load_overrides(ctx.project_id)
            rag = await self._store.aget(ctx.project_id, overrides=overrides)
            param_kwargs: dict = {"mode": ctx.rag_mode}
            if overrides.get("top_k"):
                param_kwargs["top_k"] = overrides["top_k"]
            if overrides.get("rerank_model"):
                param_kwargs["enable_rerank"] = True
            result: str = await rag.aquery(
                ctx.user_query,
                param=QueryParam(**param_kwargs),
            )
            yield AgentEvent(
                type="rag_hit",
                agent=self.agent_name,
                data={"context": result, "mode": ctx.rag_mode},
                trace_id=trace_id,
            )
        except Exception as exc:
            logger.exception("RAGAgent query failed: %s", exc)
            yield AgentEvent.make_error(self.agent_name, trace_id, str(exc), code="RAG_QUERY_ERROR")
            return

        yield AgentEvent(type="done", agent=self.agent_name, data=None, trace_id=trace_id)

    async def run(
        self,
        ctx: AgentContext,
        *,
        dry_run: bool = False,
    ) -> AsyncGenerator[AgentEvent, None]:
        trace_id = new_trace_id()
        if dry_run:
            yield AgentEvent(
                type="done",
                agent=self.agent_name,
                data={"dry_run": True, "query": ctx.user_query, "mode": ctx.rag_mode},
                trace_id=trace_id,
            )
            return
        async for event in self.query(ctx, trace_id):
            yield event


# ── CLI entrypoint ───────────────────────────────────────────────────────────

async def _cli_main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="RAGAgent CLI (debug)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    idx = sub.add_parser("index", help="Index a file into the knowledge graph")
    idx.add_argument("--project-id", required=True)
    idx.add_argument("--file", required=True, help="Path to file to index")

    qry = sub.add_parser("query", help="Query the knowledge graph")
    qry.add_argument("--project-id", required=True)
    qry.add_argument("--query", required=True)
    qry.add_argument("--mode", default="hybrid", choices=["naive", "local", "global", "hybrid"])

    args = parser.parse_args()

    from config import get_settings
    settings = get_settings()
    llm = LLMClient(settings)
    agent = RAGAgent(llm=llm, storage_base=settings.rag_data_dir)

    if args.cmd == "index":
        from services.text_extractor import extract_text
        text = extract_text(args.file)
        doc_id = Path(args.file).name
        await agent.index(args.project_id, text, doc_id)
        print(f"Indexed {doc_id} into project {args.project_id}")

    elif args.cmd == "query":
        ctx = AgentContext(project_id=args.project_id, user_query=args.query, rag_mode=args.mode)
        async for event in agent.query(ctx):
            if event.type == "rag_hit":
                print("=== RAG Context ===")
                print(event.data["context"])
            elif event.type == "error":
                print(f"ERROR: {event.data}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(_cli_main())
