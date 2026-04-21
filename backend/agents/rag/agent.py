"""
agents/rag/agent.py — RAGAgent (Agentic GraphRAG via LightRAG).

Responsibilities:
  - index(project_id, text, doc_id): insert document into the knowledge graph
  - query(ctx, trace_id): retrieve relevant context and emit AgentEvents

Standalone debugging:
    python -m agents.rag index --project-id proj_1 --file uploads/proj_1/spec.pdf
    python -m agents.rag query --project-id proj_1 --mode hybrid --query "auth requirements"
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

    # ── Indexing ─────────────────────────────────────────────────────────────

    async def index(self, project_id: str, text: str, doc_id: str) -> None:
        """
        Insert document text into the project's knowledge graph.
        Called as a BackgroundTask after file upload + text extraction.
        """
        rag = self._store.get(project_id)
        await rag.ainsert(text, ids=[doc_id])
        logger.info("RAGAgent: indexed doc %s for project %s", doc_id, project_id)

    async def rebuild(self, project_id: str, documents: list[tuple[str, str]]) -> None:
        """
        Rebuild the entire knowledge graph for a project.
        documents: list of (doc_id, text) tuples
        """
        self._store.invalidate(project_id)
        rag = self._store.get(project_id)
        for doc_id, text in documents:
            await rag.ainsert(text, ids=[doc_id])
        logger.info("RAGAgent: rebuilt graph for project %s (%d docs)", project_id, len(documents))

    # ── Querying ─────────────────────────────────────────────────────────────

    async def query(
        self,
        ctx: AgentContext,
        trace_id: str | None = None,
    ) -> AsyncGenerator[AgentEvent, None]:
        """
        Retrieve context from the knowledge graph and emit events.

        Emits:
          - tool_call: "rag.query" started
          - rag_hit:   retrieved context chunks
          - done:      query complete
          - error:     if retrieval failed
        """
        trace_id = trace_id or new_trace_id()

        yield AgentEvent(
            type="tool_call",
            agent=self.agent_name,
            data={"tool": "lightrag.query", "mode": ctx.rag_mode},
            trace_id=trace_id,
        )

        try:
            rag = self._store.get(ctx.project_id)
            result: str = await rag.aquery(
                ctx.user_query,
                param=QueryParam(mode=ctx.rag_mode),
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

    # ── Protocol compatibility (run() alias) ────────────────────────────────

    async def run(
        self,
        ctx: AgentContext,
        *,
        dry_run: bool = False,
    ) -> AsyncGenerator[AgentEvent, None]:
        """Alias so RAGAgent satisfies the BaseAgent protocol."""
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
