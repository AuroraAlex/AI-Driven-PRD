"""
agents/rag/graph_store.py — LightRAG per-project instance manager.

Each project gets its own isolated LightRAG knowledge graph stored under
rag_data/{project_id}/. Instances are cached in an LRU dict to avoid
re-initialisation on every request.
"""
from __future__ import annotations

import logging
from collections import OrderedDict
from pathlib import Path

from lightrag import LightRAG, QueryParam
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc

from config import get_settings

logger = logging.getLogger(__name__)


class GraphStore:
    """
    LRU-cached manager for per-project LightRAG instances.

    Thread-safety note: FastAPI runs async; all access is single-threaded
    per worker, so a plain dict is sufficient.
    """

    def __init__(
        self,
        storage_base: Path | None = None,
        max_instances: int | None = None,
    ) -> None:
        settings = get_settings()
        self._base = storage_base or settings.rag_data_dir
        self._max = max_instances or settings.rag_max_instances
        self._cache: OrderedDict[str, LightRAG] = OrderedDict()

    def _project_dir(self, project_id: str) -> Path:
        d = self._base / project_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _make_instance(self, project_id: str) -> LightRAG:
        settings = get_settings()

        async def llm_fn(prompt, system_prompt=None, history_messages=None, **kwargs):
            return await openai_complete_if_cache(
                "gpt-4o-mini",  # cheaper model for entity extraction
                prompt,
                system_prompt=system_prompt,
                history_messages=history_messages or [],
                api_key=settings.openai_api_key,
                **kwargs,
            )

        async def embed_fn(texts: list[str]) -> list[list[float]]:
            return await openai_embed(
                texts,
                model="text-embedding-3-small",
                api_key=settings.openai_api_key,
            )

        return LightRAG(
            working_dir=str(self._project_dir(project_id)),
            llm_model_func=llm_fn,
            embedding_func=EmbeddingFunc(
                embedding_dim=1536,
                max_token_size=8192,
                func=embed_fn,
            ),
        )

    def get(self, project_id: str) -> LightRAG:
        """Return cached instance, evicting LRU entry if cache is full."""
        if project_id in self._cache:
            self._cache.move_to_end(project_id)
            return self._cache[project_id]

        if len(self._cache) >= self._max:
            evicted_id, _ = self._cache.popitem(last=False)
            logger.debug("GraphStore: evicted project %s from cache", evicted_id)

        instance = self._make_instance(project_id)
        self._cache[project_id] = instance
        logger.debug("GraphStore: initialised LightRAG for project %s", project_id)
        return instance

    def invalidate(self, project_id: str) -> None:
        """Remove a project's instance (forces re-init on next access)."""
        self._cache.pop(project_id, None)
