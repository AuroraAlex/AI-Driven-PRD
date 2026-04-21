"""
app/deps.py — FastAPI dependency injection container.

All agents and infrastructure are instantiated once (per-worker) and
injected into route handlers. This keeps route handlers thin and agents
fully testable outside FastAPI.

Usage in a route:
    @router.post("/chat")
    async def chat(deps: Annotated[AppDeps, Depends(get_deps)]):
        async for event in deps.chat_agent.run(ctx):
            ...
"""
from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from infra.db import get_db
from infra.llm import LLMClient
from infra.storage import LocalStorage
from agents.chat.agent import ChatAgent
from agents.rag.agent import RAGAgent
from agents.prd.agent import PRDAgent


@lru_cache
def _llm_client() -> LLMClient:
    return LLMClient(get_settings())


@lru_cache
def _rag_agent() -> RAGAgent:
    settings = get_settings()
    return RAGAgent(llm=_llm_client(), storage_base=settings.rag_data_dir)


@lru_cache
def _chat_agent() -> ChatAgent:
    return ChatAgent(llm=_llm_client(), rag_agent=_rag_agent())


@lru_cache
def _prd_agent() -> PRDAgent:
    return PRDAgent(llm=_llm_client())


@lru_cache
def _storage() -> LocalStorage:
    return LocalStorage()


class AppDeps:
    """
    Bundled dependencies for route handlers.
    Agents are singletons; DB session is per-request.
    """

    def __init__(
        self,
        db: AsyncSession,
        chat_agent: ChatAgent,
        rag_agent: RAGAgent,
        prd_agent: PRDAgent,
        storage: LocalStorage,
    ) -> None:
        self.db = db
        self.chat_agent = chat_agent
        self.rag_agent = rag_agent
        self.prd_agent = prd_agent
        self.storage = storage


async def get_deps(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AppDeps:
    return AppDeps(
        db=db,
        chat_agent=_chat_agent(),
        rag_agent=_rag_agent(),
        prd_agent=_prd_agent(),
        storage=_storage(),
    )
