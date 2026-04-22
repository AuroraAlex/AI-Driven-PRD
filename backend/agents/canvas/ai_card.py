"""
agents/canvas/ai_card.py — Generate rich AI-card content (markdown + sources)
using the existing ChatAgent + RAG pipeline.

Returns a single AICardContent payload for the frontend to embed in the canvas
element's customData.aiContent.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import AsyncGenerator

from agents.base import AgentContext, AgentEvent, FileContext, new_trace_id
from agents.chat.agent import ChatAgent


SCHEMA_VERSION = 1


@dataclass
class AICardSource:
    type: str        # canvas_card | chat_message | rag_chunk | file
    id: str
    label: str = ""


@dataclass
class AICardContent:
    schemaVersion: int
    markdown: str
    summary: str
    sources: list[AICardSource]
    prompt: str
    model: str
    generated_at: float
    version: int = 1


class AICardAgent:
    """Thin wrapper around ChatAgent that returns a single rich-text payload."""

    agent_name = "ai_card"

    def __init__(self, chat_agent: ChatAgent):
        self.chat = chat_agent

    async def generate(
        self,
        *,
        project_id: str,
        prompt: str,
        canvas_text: str = "",
        attached_files: list[FileContext] | None = None,
        canvas_session_ids: list[str] | None = None,
        chat_session_id: str | None = None,
        model: str = "openai/gpt-4o",
        rag_enabled: bool = True,
        rag_mode: str = "hybrid",
        kb_has_indexed: bool = False,
    ) -> AsyncGenerator[AgentEvent | AICardContent, None]:
        ctx = AgentContext(
            project_id=project_id,
            user_query=(
                "请根据上下文，针对以下需求产出结构化的 Markdown 内容，"
                "适合直接放入产品画布的 AI 卡片中（含小标题与要点列表）：\n\n"
                f"{prompt}"
            ),
            canvas_text=canvas_text,
            attached_files=attached_files or [],
            canvas_session_ids=canvas_session_ids or [],
            chat_session_id=chat_session_id,
            include_canvas_context=bool(canvas_text),
            rag_enabled=rag_enabled,
            rag_mode=rag_mode,
            kb_has_indexed=kb_has_indexed,
            model=model,
        )

        chunks: list[str] = []
        sources: list[AICardSource] = []
        trace_id_holder = [new_trace_id()]

        async for evt in self.chat.run(ctx):
            if not trace_id_holder[0]:
                trace_id_holder[0] = evt.trace_id
            if evt.type == "token":
                chunks.append(evt.data)
            elif evt.type == "rag_hit":
                # Store hit as source if shape recognisable
                data = evt.data or {}
                for hit in (data.get("hits") if isinstance(data, dict) else []) or []:
                    sources.append(AICardSource(
                        type="rag_chunk",
                        id=str(hit.get("doc_id", hit.get("id", ""))),
                        label=str(hit.get("title", ""))[:80],
                    ))
            yield evt

        markdown = "".join(chunks).strip()
        # Fallback summary: first non-empty line
        summary = next(
            (ln.strip("# ").strip() for ln in markdown.splitlines() if ln.strip()),
            "",
        )[:120]

        yield AICardContent(
            schemaVersion=SCHEMA_VERSION,
            markdown=markdown,
            summary=summary,
            sources=sources,
            prompt=prompt,
            model=model,
            generated_at=time.time(),
            version=1,
        )
