"""
agents/rag/graph_store.py — LightRAG per-project instance manager.

Each project gets its own isolated LightRAG knowledge graph stored under
rag_data/{project_id}/. Instances are cached in an LRU dict and rebuilt
lazily; per-project settings (chunk size / models / top_k) override globals.
"""
from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from pathlib import Path
from typing import Any

import litellm
import numpy as np
from lightrag import LightRAG
from lightrag.llm.openai import openai_embed
from lightrag.utils import EmbeddingFunc

from config import get_settings
from agents.rag.provider_resolver import RAGProviderConfig, resolve_provider

logger = logging.getLogger(__name__)


# DashScope's official text-embedding endpoint (multi-modal namespace).
# All ``text-embedding-v*`` models live here; the request envelope is the
# aliyun "input.texts" form, NOT the OpenAI ``input: [...]`` shape.
_DASHSCOPE_EMBED_URL = (
    "https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding"
)


async def dashscope_embed(
    texts: list[str],
    *,
    model: str,
    api_key: str,
    api_base: str | None = None,
) -> list[list[float]]:
    """Call DashScope's native text-embedding endpoint.

    Mirrors the official curl example:
        POST .../api/v1/services/embeddings/text-embedding/text-embedding
        { "model": "text-embedding-v4", "input": { "texts": [...] } }
    """
    import httpx

    url = api_base or _DASHSCOPE_EMBED_URL
    payload = {"model": model, "input": {"texts": list(texts)}}
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(
            f"DashScope embedding failed: HTTP {resp.status_code} {resp.text[:200]}"
        )
    data = resp.json()
    # Aliyun envelope: { "output": { "embeddings": [{"embedding": [...], "text_index": 0}, ...] } }
    embeddings = (data.get("output") or {}).get("embeddings") or []
    if not embeddings:
        raise RuntimeError(f"DashScope embedding returned no vectors: {str(data)[:200]}")
    embeddings.sort(key=lambda e: e.get("text_index", 0))
    return [e["embedding"] for e in embeddings]


class GraphStore:
    """LRU-cached manager for per-project LightRAG instances."""

    def __init__(
        self,
        storage_base: Path | None = None,
        max_instances: int | None = None,
    ) -> None:
        settings = get_settings()
        self._base = storage_base or settings.rag_data_dir
        self._max = max_instances or settings.rag_max_instances
        self._cache: OrderedDict[str, LightRAG] = OrderedDict()
        self._locks: dict[str, asyncio.Lock] = {}

    # ── Path helpers ────────────────────────────────────────────────────────

    def project_dir(self, project_id: str) -> Path:
        d = self._base / project_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    # ── Instance construction ───────────────────────────────────────────────

    def _make_instance(self, project_id: str, overrides: dict | None = None) -> LightRAG:
        settings = get_settings()
        overrides = overrides or {}

        cfg: RAGProviderConfig = resolve_provider(
            settings,
            embedding_model_override=overrides.get("embedding_model"),
            extraction_model_override=overrides.get("extraction_model"),
            rerank_model_override=overrides.get("rerank_model"),
            min_rerank_score_override=overrides.get("min_rerank_score"),
            embedding_provider_override=overrides.get("embedding_provider"),
            extraction_provider_override=overrides.get("extraction_provider"),
            rerank_provider_override=overrides.get("rerank_provider"),
        )

        async def llm_fn(prompt, system_prompt=None, history_messages=None, **kwargs):
            messages: list[dict[str, Any]] = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            for h in history_messages or []:
                messages.append(h)
            messages.append({"role": "user", "content": prompt})
            for noise in ("hashing_kv", "keyword_extraction", "history_messages"):
                kwargs.pop(noise, None)
            resp = await litellm.acompletion(
                model=cfg.llm_model,
                messages=messages,
                api_key=cfg.api_key,
                api_base=cfg.api_base,
                temperature=kwargs.pop("temperature", 0.0),
                max_tokens=kwargs.pop("max_tokens", 4096),
                **kwargs,
            )
            return resp.choices[0].message.content or ""

        async def embed_fn(texts: list[str]) -> "np.ndarray":
            # DashScope: hit the official native endpoint with the aliyun
            # request envelope. The compatible-mode /embeddings path does not
            # support all newer models (e.g. text-embedding-v4) reliably.
            if cfg.embedding_provider == "dashscope":
                vecs = await dashscope_embed(
                    texts,
                    model=cfg.embedding_model,
                    api_key=cfg.embedding_api_key,
                    api_base=cfg.embedding_api_base,
                )
                return np.asarray(vecs, dtype=np.float32)
            # Native OpenAI path is faster and bypasses LiteLLM's encoding_format
            # quirks, but only valid when the embedding provider is actually OpenAI
            # AND the user is hitting the official endpoint (no custom base).
            if (
                cfg.embedding_provider == "openai"
                and cfg.embedding_model.startswith("openai/")
                and cfg.embedding_api_base is None
            ):
                vecs = await openai_embed(
                    texts,
                    model=cfg.embedding_model.split("/", 1)[1],
                    api_key=cfg.embedding_api_key,
                )
                return np.asarray(vecs, dtype=np.float32)
            resp = await litellm.aembedding(
                model=cfg.embedding_model,
                input=texts,
                api_key=cfg.embedding_api_key,
                api_base=cfg.embedding_api_base,
                # DashScope's OpenAI-compatible endpoint only accepts
                # "float" / "base64" — LiteLLM may default to a value it
                # rejects. Pin to "float" to stay safe across providers.
                encoding_format="float",
            )
            return np.asarray([d["embedding"] for d in resp["data"]], dtype=np.float32)

        kwargs: dict[str, Any] = {
            "working_dir": str(self.project_dir(project_id)),
            "llm_model_func": llm_fn,
            "embedding_func": EmbeddingFunc(
                embedding_dim=cfg.embedding_dim,
                max_token_size=cfg.embedding_max_tokens,
                func=embed_fn,
            ),
        }
        if overrides.get("chunk_token_size"):
            kwargs["chunk_token_size"] = overrides["chunk_token_size"]
        if overrides.get("chunk_overlap_token_size"):
            kwargs["chunk_overlap_token_size"] = overrides["chunk_overlap_token_size"]

        # Optional rerank — wraps lightrag.rerank.generic_rerank_api with the
        # per-project model + endpoint chosen in settings.
        if cfg.rerank_model and cfg.rerank_api_base:
            try:
                from functools import partial
                from lightrag.rerank import generic_rerank_api
                bare = cfg.rerank_model.split("/", 1)[-1]
                # DashScope's gte-rerank requires the "aliyun" request/response
                # envelope; everything else uses the standard cohere-style API.
                is_aliyun = "dashscope.aliyuncs.com" in cfg.rerank_api_base
                kwargs["rerank_model_func"] = partial(
                    generic_rerank_api,
                    model=bare,
                    base_url=cfg.rerank_api_base,
                    api_key=cfg.rerank_api_key,
                    response_format="aliyun" if is_aliyun else "standard",
                    request_format="aliyun" if is_aliyun else "standard",
                    return_documents=False,
                )
                if cfg.min_rerank_score is not None:
                    kwargs["min_rerank_score"] = cfg.min_rerank_score
            except Exception as exc:
                logger.warning("GraphStore: rerank wiring failed: %s", exc)

        instance = LightRAG(**kwargs)
        logger.info(
            "GraphStore: built LightRAG for %s (provider=%s llm=%s emb=%s)",
            project_id, cfg.provider, cfg.llm_model, cfg.embedding_model,
        )
        return instance

    # ── Public API ──────────────────────────────────────────────────────────

    async def aget(self, project_id: str, overrides: dict | None = None) -> LightRAG:
        if project_id in self._cache:
            self._cache.move_to_end(project_id)
            return self._cache[project_id]

        lock = self._locks.setdefault(project_id, asyncio.Lock())
        async with lock:
            if project_id in self._cache:
                return self._cache[project_id]
            if len(self._cache) >= self._max:
                evicted_id, _ = self._cache.popitem(last=False)
                logger.debug("GraphStore: evicted project %s from cache", evicted_id)
            instance = self._make_instance(project_id, overrides)
            init = getattr(instance, "initialize_storages", None)
            if callable(init):
                res = init()
                if asyncio.iscoroutine(res):
                    await res
            # LightRAG ≥1.3 also wants pipeline status init.
            try:
                from lightrag.kg.shared_storage import initialize_pipeline_status
                await initialize_pipeline_status()
            except Exception:
                pass
            self._cache[project_id] = instance
            return instance

    def get(self, project_id: str, overrides: dict | None = None) -> LightRAG:
        """Sync getter (does not run async storage init). Prefer ``aget``."""
        if project_id in self._cache:
            self._cache.move_to_end(project_id)
            return self._cache[project_id]
        if len(self._cache) >= self._max:
            evicted_id, _ = self._cache.popitem(last=False)
            logger.debug("GraphStore: evicted project %s from cache", evicted_id)
        instance = self._make_instance(project_id, overrides)
        self._cache[project_id] = instance
        return instance

    def invalidate(self, project_id: str) -> None:
        self._cache.pop(project_id, None)
        self._locks.pop(project_id, None)

    def invalidate_all(self) -> None:
        self._cache.clear()
        self._locks.clear()
