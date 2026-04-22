"""
agents/rag/provider_resolver.py — Pick LLM/embedding for LightRAG based on
which provider keys are configured. DashScope > OpenAI > Anthropic order.

Anthropic is text-only (no embedding endpoint), so when only Anthropic is
configured we fall back to Anthropic for the LLM and raise a clear error
explaining the user must also supply an OpenAI/DashScope key for embeddings.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class RAGProviderConfig:
    # ── LLM (entity / relation extraction + answer synthesis) ─────────────
    provider: str            # "dashscope" | "openai" | "anthropic" — the LLM's provider
    llm_model: str           # full LiteLLM id, e.g. "openai/qwen-plus"
    api_key: str             # LLM key
    api_base: str | None     # LLM api_base (None → provider default)
    # ── Embedding (may live on a DIFFERENT provider than the LLM) ─────────
    embedding_provider: str
    embedding_model: str
    embedding_dim: int
    embedding_max_tokens: int
    embedding_api_key: str
    embedding_api_base: str | None
    # ── Optional rerank service ───────────────────────────────────────────
    rerank_model: str | None = None       # bare model id, e.g. "gte-rerank"
    rerank_api_base: str | None = None    # rerank service URL
    rerank_api_key: str | None = None
    min_rerank_score: float | None = None


# Defaults per provider (overridable via ProjectSetting).
# NOTE: For DashScope LLM we route through the OpenAI-compatible endpoint
# (``openai/<model>`` + custom api_base), because LiteLLM's native ``dashscope``
# provider has incomplete chat support across versions.
# DashScope EMBEDDING and RERANK use their **native** endpoints (the
# compatible-mode /embeddings path differs from the official one and is
# unreliable for newer models like text-embedding-v4); see
# ``graph_store.py`` for the request envelope.
_DEFAULTS = {
    "dashscope": {
        "llm_model": "openai/qwen-plus",
        "embedding_model": "text-embedding-v3",  # bare — we call DashScope native
        "embedding_dim": 1024,
        "embedding_max_tokens": 8192,
        "api_base": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "embedding_api_base": "https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding",
    },
    "openai": {
        "llm_model": "openai/gpt-4o-mini",
        "embedding_model": "openai/text-embedding-3-small",
        "embedding_dim": 1536,
        "embedding_max_tokens": 8192,
        "api_base": None,
        "embedding_api_base": None,
    },
    "anthropic": {
        "llm_model": "anthropic/claude-haiku-3-5",
        # Anthropic has no embedding endpoint — caller must provide an
        # OpenAI/DashScope key for embedding. We surface a meaningful error.
        "embedding_model": "",
        "embedding_dim": 0,
        "embedding_max_tokens": 0,
        "api_base": None,
        "embedding_api_base": None,
    },
}


# Approximate embedding dimensions for known models — used when the user
# overrides the embedding model so the vector store is sized correctly.
_EMBEDDING_DIMS = {
    "text-embedding-v3": 1024,
    "text-embedding-v4": 1024,
    "text-embedding-v2": 1536,
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
    "bge-large-zh-v1.5": 1024,
    "bge-m3": 1024,
}


def _detect_provider(settings) -> str:
    if getattr(settings, "dashscope_api_key", "") or os.environ.get("DASHSCOPE_API_KEY"):
        return "dashscope"
    if getattr(settings, "openai_api_key", "") or os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if getattr(settings, "anthropic_api_key", "") or os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    raise RuntimeError(
        "No LLM provider API key configured. Add a key in Settings before using the knowledge base."
    )


def _api_key_for(provider: str, settings) -> str:
    field = f"{provider}_api_key"
    return getattr(settings, field, "") or os.environ.get(f"{provider.upper()}_API_KEY", "")


# Heuristic: figure out which provider an embedding-model id belongs to.
def _provider_of_model(model: str) -> str:
    if "/" in model:
        return model.split("/", 1)[0]
    lo = model.lower()
    if lo.startswith("text-embedding-v") or lo.startswith("qwen") or lo.startswith("bge-"):
        return "dashscope"
    if lo.startswith(("text-embedding", "gpt-")):
        return "openai"
    if lo.startswith("claude"):
        return "anthropic"
    return "openai"


def _embedding_dim(model_id: str, fallback: int) -> int:
    """Look up the dimension for a known embedding model name."""
    bare = model_id.split("/", 1)[-1].lower()
    return _EMBEDDING_DIMS.get(bare, fallback)


_RERANK_DEFAULTS = {
    # Bare model name -> (api_base, provider-key-source)
    "gte-rerank": (
        "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank",
        "dashscope",
    ),
    "gte-rerank-v2": (
        "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank",
        "dashscope",
    ),
}


def resolve_provider(
    settings,
    *,
    embedding_model_override: str | None = None,
    extraction_model_override: str | None = None,
    rerank_model_override: str | None = None,
    min_rerank_score_override: float | None = None,
    # New: explicit provider overrides per component. None → auto-detect.
    embedding_provider_override: str | None = None,
    extraction_provider_override: str | None = None,
    rerank_provider_override: str | None = None,
) -> RAGProviderConfig:
    """Decide which provider/models to feed into LightRAG.

    Embedding, extraction (LLM) and rerank can each live on a different
    provider — DashScope's embedding endpoint and OpenAI's chat endpoint
    have different api_base URLs, so we resolve them independently.
    """
    auto = _detect_provider(settings)

    # ── LLM / extraction ─────────────────────────────────────────────────
    llm_provider = (extraction_provider_override or "").strip() or None
    llm_model_raw = extraction_model_override or _DEFAULTS[auto]["llm_model"]
    if llm_provider is None:
        llm_provider = _provider_of_model(llm_model_raw) if "/" in llm_model_raw else auto
    llm_defaults = _DEFAULTS.get(llm_provider, _DEFAULTS["openai"])
    llm_model = _normalize_model_for_provider(llm_model_raw, llm_provider)
    llm_api_key = _api_key_for(llm_provider, settings)
    llm_api_base = llm_defaults["api_base"]

    # ── Embedding ────────────────────────────────────────────────────────
    emb_provider = (embedding_provider_override or "").strip() or None
    emb_model_raw = embedding_model_override or _DEFAULTS[auto]["embedding_model"]
    if emb_provider is None:
        emb_provider = _provider_of_model(emb_model_raw) if "/" in emb_model_raw else auto
    if emb_provider == "anthropic":
        # Anthropic has no embedding endpoint — fall back to whatever is configured.
        for fallback in ("dashscope", "openai"):
            if _api_key_for(fallback, settings):
                emb_provider = fallback
                if not embedding_model_override:
                    emb_model_raw = _DEFAULTS[fallback]["embedding_model"]
                break
        else:
            raise RuntimeError(
                "Anthropic does not provide embeddings. Configure an OpenAI or DashScope key, "
                "or pick another embedding provider in knowledge-base settings."
            )
    emb_defaults = _DEFAULTS.get(emb_provider, _DEFAULTS["openai"])
    embedding_model = _normalize_embedding_model(emb_model_raw, emb_provider)
    emb_api_key = _api_key_for(emb_provider, settings)
    emb_api_base = emb_defaults.get("embedding_api_base", emb_defaults["api_base"])

    # ── Optional rerank ──────────────────────────────────────────────────
    rerank_model = (rerank_model_override or "").strip() or None
    rerank_api_base: str | None = None
    rerank_api_key: str | None = None
    if rerank_model:
        bare = rerank_model.split("/", 1)[-1]
        rr_provider = (rerank_provider_override or "").strip() or None
        if rr_provider is None:
            # Fall back to known defaults table → otherwise reuse embedding provider.
            preset = _RERANK_DEFAULTS.get(bare)
            rr_provider = preset[1] if preset else emb_provider
        if rr_provider == "dashscope":
            preset = _RERANK_DEFAULTS.get(bare)
            rerank_api_base = preset[0] if preset else _RERANK_DEFAULTS["gte-rerank"][0]
        else:
            # Generic / openai-compat rerank: assume the host exposes a
            # standard cohere-style /rerank endpoint; reuse the chat base.
            rerank_api_base = _DEFAULTS.get(rr_provider, _DEFAULTS["openai"])["api_base"]
        rerank_api_key = _api_key_for(rr_provider, settings) or emb_api_key

    return RAGProviderConfig(
        provider=llm_provider,
        llm_model=llm_model,
        api_key=llm_api_key,
        api_base=llm_api_base,
        embedding_provider=emb_provider,
        embedding_model=embedding_model,
        embedding_dim=_embedding_dim(embedding_model, emb_defaults["embedding_dim"] or 1536),
        embedding_max_tokens=emb_defaults["embedding_max_tokens"] or 8192,
        embedding_api_key=emb_api_key,
        embedding_api_base=emb_api_base,
        rerank_model=rerank_model,
        rerank_api_base=rerank_api_base,
        rerank_api_key=rerank_api_key,
        min_rerank_score=min_rerank_score_override,
    )


def _normalize_model_for_provider(model: str, provider: str) -> str:
    """Add the LiteLLM provider prefix if missing.

    DashScope LLM models are routed through the OpenAI-compatible endpoint,
    so they are always prefixed with ``openai/`` (and api_base must point
    to dashscope.aliyuncs.com).
    """
    if "/" in model:
        # Already prefixed — but if the user typed ``dashscope/qwen-plus``
        # but actually means ``openai/qwen-plus`` (compat mode), normalize.
        head, tail = model.split("/", 1)
        if head == "dashscope":
            return f"openai/{tail}"
        return model
    if provider == "dashscope":
        return f"openai/{model}"
    return f"{provider}/{model}"


def _normalize_embedding_model(model: str, provider: str) -> str:
    """For embeddings DashScope uses its **native** /api/v1 endpoint, so we
    keep the bare model id. Other providers reuse the LLM normalization.
    """
    if provider == "dashscope":
        return model.split("/", 1)[-1]
    return _normalize_model_for_provider(model, provider)
