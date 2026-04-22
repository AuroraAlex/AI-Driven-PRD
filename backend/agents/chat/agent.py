"""
agents/chat/agent.py — ChatAgent implementation.

Orchestrates:
  1. (Optional) RAG retrieval via RAGAgent
  2. Prompt assembly via prompts.py
  3. Streaming LLM response via LLMClient

Completely decoupled from FastAPI — can be run standalone:
    python -m agents.chat --project-id proj_1 --query "What are the main features?"
"""
from __future__ import annotations

import logging
from typing import AsyncGenerator, TYPE_CHECKING

from agents.base import AgentContext, AgentEvent, BaseAgent, new_trace_id
from agents.chat.prompts import build_messages
from infra.llm import LLMClient

if TYPE_CHECKING:
    from agents.rag.agent import RAGAgent

logger = logging.getLogger(__name__)


class ChatAgent:
    agent_name = "chat"

    def __init__(
        self,
        llm: LLMClient,
        rag_agent: "RAGAgent | None" = None,
    ) -> None:
        self.llm = llm
        self.rag = rag_agent

    async def run(
        self,
        ctx: AgentContext,
        *,
        dry_run: bool = False,
    ) -> AsyncGenerator[AgentEvent, None]:
        trace_id = new_trace_id()

        try:
            # ── Step 1: RAG retrieval ──────────────────────────────
            rag_context = ""
            if self.rag and ctx.has_rag_ready_files:
                yield AgentEvent(
                    type="tool_call",
                    agent=self.agent_name,
                    data={"tool": "rag.query", "mode": ctx.rag_mode},
                    trace_id=trace_id,
                )
                async for event in self.rag.query(ctx, trace_id):
                    yield event  # forward rag_hit / done events to caller
                    if event.type == "rag_hit":
                        rag_context = event.data.get("context", "")

            # ── Step 2: Build messages ──────────────────────────────
            messages = build_messages(ctx, rag_context)

            # dry_run: return assembled prompt without calling LLM
            if dry_run:
                yield AgentEvent(
                    type="done",
                    agent=self.agent_name,
                    data={"prompt": messages, "dry_run": True},
                    trace_id=trace_id,
                )
                return

            # ── Step 3: Stream LLM response ────────────────────────
            usage_sink: dict = {}
            async for token in self.llm.stream(messages, model=ctx.model, usage_sink=usage_sink):
                yield AgentEvent(
                    type="token",
                    agent=self.agent_name,
                    data=token,
                    trace_id=trace_id,
                )

            yield AgentEvent(
                type="done",
                agent=self.agent_name,
                data={"usage": usage_sink} if usage_sink else None,
                trace_id=trace_id,
            )

        except Exception as exc:
            logger.exception("ChatAgent run failed: %s", exc)
            yield AgentEvent.make_error(self.agent_name, trace_id, str(exc))


# ── CLI entrypoint for standalone debugging ──────────────────────────────────

async def _cli_main() -> None:
    import argparse
    import asyncio

    parser = argparse.ArgumentParser(description="Run ChatAgent from CLI (debug)")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--model", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from config import get_settings
    settings = get_settings()

    llm = LLMClient(settings)
    # Import lazily to avoid circular imports at module level
    from agents.rag.agent import RAGAgent
    rag = RAGAgent(llm=llm, storage_base=settings.rag_data_dir)
    agent = ChatAgent(llm=llm, rag_agent=rag)

    ctx = AgentContext(
        project_id=args.project_id,
        user_query=args.query,
        model=args.model or settings.default_model,
    )

    async for event in agent.run(ctx, dry_run=args.dry_run):
        if event.type == "token":
            print(event.data, end="", flush=True)
        else:
            print(f"\n[{event.type}] {event.data}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(_cli_main())
