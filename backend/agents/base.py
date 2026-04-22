"""
agents/base.py — Core agent protocol definitions.

This module defines the data contracts shared by ALL agents:
  - AgentContext : what an agent receives as input
  - AgentEvent   : what an agent emits (streaming output)
  - BaseAgent    : the structural protocol every agent must satisfy

Design goals:
  1. Agents have ZERO dependency on the HTTP layer (app/).
  2. Agents can be tested in isolation via pytest or CLI.
  3. Uniform event stream enables tracing, replay and frontend rendering.
"""
from __future__ import annotations

import json
import uuid
import time
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Literal, Protocol, runtime_checkable

# ─────────────────────────────────────────────────────────────
# Input types
# ─────────────────────────────────────────────────────────────

@dataclass
class FileContext:
    """Represents an uploaded file that has been processed."""
    file_id: str
    filename: str
    file_type: str          # "pdf" | "docx" | "image" | "txt" | ...
    extracted_text: str     # raw text extracted from the file
    rag_ready: bool         # True once LightRAG indexing is complete
    file_size: int = 0      # bytes


@dataclass
class Message:
    """A single chat history entry."""
    role: Literal["user", "assistant", "system"]
    content: str
    created_at: float = field(default_factory=time.time)


@dataclass
class AgentContext:
    """
    The unified input container passed to every agent.

    Agents must not mutate this object — treat it as immutable.
    """
    project_id: str
    user_query: str

    # Optional context enrichment
    canvas_text: str = ""                             # already-rendered canvas block(s)
    attached_files: list[FileContext] = field(default_factory=list)
    chat_history: list[Message] = field(default_factory=list)

    # Session targeting (purely informational — used by callers / tracing)
    canvas_session_ids: list[str] = field(default_factory=list)
    chat_session_id: str | None = None

    # Context toggles
    include_canvas_context: bool = True
    canvas_context_mode: Literal["full", "summary"] = "full"

    # RAG settings
    rag_mode: Literal["naive", "local", "global", "hybrid"] = "hybrid"
    rag_enabled: bool = True

    # LLM settings (LiteLLM format: "openai/gpt-4o", "anthropic/claude-3-5-sonnet-…")
    model: str = "openai/gpt-4o"

    # Free-form extra data (template type, prd_id, etc.)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def has_rag_ready_files(self) -> bool:
        return self.rag_enabled and any(f.rag_ready for f in self.attached_files)


# ─────────────────────────────────────────────────────────────
# Output types (event stream)
# ─────────────────────────────────────────────────────────────

EventType = Literal[
    "token",        # streaming LLM text token
    "tool_call",    # agent is calling an internal tool
    "tool_result",  # result returned from a tool call
    "rag_hit",      # RAG retrieved context chunks
    "progress",     # background task progress update
    "done",         # run() completed successfully
    "error",        # run() failed; data contains {"message": str, "code": str}
]


@dataclass
class AgentEvent:
    """
    A single event emitted by an agent during a run().

    The HTTP layer serialises these to SSE `data:` frames.
    Tests can collect them into a list for assertion.
    """
    type: EventType
    agent: str          # agent_name of the emitting agent
    data: Any           # payload; shape depends on type
    trace_id: str       # unique ID for this run(); all events share it
    timestamp: float = field(default_factory=time.time)

    def to_json(self) -> str:
        return json.dumps({
            "type": self.type,
            "agent": self.agent,
            "data": self.data,
            "trace_id": self.trace_id,
            "timestamp": self.timestamp,
        }, ensure_ascii=False)

    @staticmethod
    def make_error(agent: str, trace_id: str, message: str, code: str = "AGENT_ERROR") -> "AgentEvent":
        return AgentEvent(
            type="error",
            agent=agent,
            data={"message": message, "code": code},
            trace_id=trace_id,
        )


def new_trace_id() -> str:
    """Generate a unique trace ID for a single agent run."""
    return str(uuid.uuid4())


# ─────────────────────────────────────────────────────────────
# Agent protocol
# ─────────────────────────────────────────────────────────────

@runtime_checkable
class BaseAgent(Protocol):
    """
    Structural protocol that every agent must satisfy.

    Usage:
        assert isinstance(my_agent, BaseAgent)

    Testing tips:
        - Pass dry_run=True to get the assembled prompt without LLM calls.
        - Use MockLLMClient / MockRAGAgent for fast unit tests.
    """
    agent_name: str

    def run(
        self,
        ctx: AgentContext,
        *,
        dry_run: bool = False,
    ) -> AsyncGenerator[AgentEvent, None]:
        """
        Execute the agent and stream AgentEvents.

        Args:
            ctx:      The input context.
            dry_run:  If True, emit a single "done" event with the
                      assembled prompt/plan; do NOT call external APIs.

        Yields:
            AgentEvent instances in order.
            The final event MUST be type "done" or "error".
        """
        ...
