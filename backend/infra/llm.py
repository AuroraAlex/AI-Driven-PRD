"""
infra/llm.py — Unified LiteLLM client.

Wraps LiteLLM so the rest of the codebase never imports litellm directly.
This makes it easy to swap providers or add middleware (logging, caching).

Usage:
    client = LLMClient()
    # Non-streaming
    response = await client.complete(messages, model="openai/gpt-4o")
    # Streaming
    async for chunk in client.stream(messages, model="anthropic/claude-3-5-sonnet-20241022"):
        print(chunk, end="")
    # JSON output
    data = await client.complete_json(messages, schema=MyPydanticModel)
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, AsyncGenerator, Type, TypeVar

import litellm
from pydantic import BaseModel

from config import get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


# Heuristic mapping from model-name prefix to LiteLLM provider prefix.
# Used when the user supplies a bare model name (no "provider/" segment),
# e.g. "qwen-plus", "gpt-4o", "claude-sonnet-4-5".
_MODEL_PREFIX_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("gpt-", "o1", "o3", "o4-", "chatgpt-", "text-embedding-", "davinci", "babbage"), "openai"),
    (("claude-",), "anthropic"),
    (("qwen", "qwq", "qvq", "deepseek-", "llama", "baichuan", "yi-"), "dashscope"),
    (("gemini-",), "gemini"),
)

# Map settings field → LiteLLM provider prefix, used as fallback when the
# model name carries no recognizable prefix.
_PROVIDER_FIELDS: tuple[tuple[str, str], ...] = (
    ("dashscope_api_key", "dashscope"),
    ("openai_api_key", "openai"),
    ("anthropic_api_key", "anthropic"),
)


def _normalize_model(model: str, settings=None) -> str:
    """Ensure the model string carries a LiteLLM provider prefix.

    LiteLLM requires "provider/model" syntax (e.g. "dashscope/qwen-plus").
    Resolution order for a bare model name:
      1. Already has "/" → leave as-is.
      2. Known prefix heuristic (gpt-*, claude-*, qwen*, gemini-*, …).
      3. Fallback to the only configured provider (if exactly one API key is set).
      4. Return unchanged and let LiteLLM raise.
    """
    if not model or "/" in model:
        return model

    lower = model.lower()
    for prefixes, provider in _MODEL_PREFIX_RULES:
        if any(lower.startswith(p) for p in prefixes):
            return f"{provider}/{model}"

    # Fallback: if the user has configured exactly one provider, assume that one.
    s = settings or get_settings()
    configured = [prov for field, prov in _PROVIDER_FIELDS if getattr(s, field, "")]
    if len(configured) == 1:
        logger.info("Model %r has no provider prefix; defaulting to %s/", model, configured[0])
        return f"{configured[0]}/{model}"

    return model  # let LiteLLM raise its own error if still ambiguous


class LLMClient:
    """
    Thin async wrapper around LiteLLM.

    - All agents receive an instance via dependency injection.
    - Can be replaced with MockLLMClient in tests.
    """

    def __init__(self, settings=None):
        self._settings = settings or get_settings()
        self._configure()

    def _configure(self) -> None:
        s = self._settings
        if s.openai_api_key:
            os.environ["OPENAI_API_KEY"] = s.openai_api_key
        if s.anthropic_api_key:
            os.environ["ANTHROPIC_API_KEY"] = s.anthropic_api_key
        if s.dashscope_api_key:
            os.environ["DASHSCOPE_API_KEY"] = s.dashscope_api_key
        # Suppress LiteLLM's verbose default logging
        litellm.suppress_debug_info = True

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs: Any,
    ) -> str:
        """Return the full completion as a string."""
        model = _normalize_model(model or self._settings.default_model, self._settings)
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs,
        )
        return response.choices[0].message.content or ""

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        usage_sink: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Yield text tokens as they arrive.

        If `usage_sink` is provided, it is mutated in-place at the end with
        ``{"prompt_tokens": int, "completion_tokens": int, "total_tokens": int}``
        when the upstream model reports usage (LiteLLM with `stream_options`).
        """
        model = _normalize_model(model or self._settings.default_model, self._settings)
        # Ask LiteLLM to include usage in the final stream chunk if supported.
        stream_options = kwargs.pop("stream_options", {"include_usage": True})
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
            stream_options=stream_options,
            **kwargs,
        )
        async for chunk in response:
            try:
                if chunk.choices:
                    content = chunk.choices[0].delta.content
                    if content:
                        yield content
            except Exception:
                pass
            # Final chunk may carry usage even with empty choices
            usage = getattr(chunk, "usage", None)
            if usage and usage_sink is not None:
                try:
                    usage_sink["prompt_tokens"] = int(getattr(usage, "prompt_tokens", 0) or 0)
                    usage_sink["completion_tokens"] = int(getattr(usage, "completion_tokens", 0) or 0)
                    usage_sink["total_tokens"] = int(getattr(usage, "total_tokens", 0) or 0)
                except Exception:
                    pass

    async def complete_json(
        self,
        messages: list[dict[str, str]],
        schema: Type[T],
        *,
        model: str | None = None,
        temperature: float = 0.3,
        **kwargs: Any,
    ) -> T:
        """
        Request a JSON response and parse it into a Pydantic model.
        Falls back to best-effort JSON extraction if response_format is unsupported.
        """
        model = model or self._settings.default_model
        try:
            raw = await self.complete(
                messages,
                model=model,
                temperature=temperature,
                response_format={"type": "json_object"},
                **kwargs,
            )
        except Exception:
            # Some models don't support response_format; retry without it
            raw = await self.complete(messages, model=model, temperature=temperature, **kwargs)

        # Extract JSON from markdown code blocks if present
        raw = raw.strip()
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])

        data = json.loads(raw)
        return schema.model_validate(data)


class MockLLMClient:
    """
    Drop-in replacement for unit tests.

    Usage:
        mock = MockLLMClient(response="Hello world")
        agent = ChatAgent(llm=mock, ...)
    """

    def __init__(self, response: str = "mock response", tokens: list[str] | None = None):
        self._response = response
        self._tokens = tokens or list(response)

    async def complete(self, messages, **kwargs) -> str:
        return self._response

    async def stream(self, messages, **kwargs) -> AsyncGenerator[str, None]:
        for token in self._tokens:
            yield token

    async def complete_json(self, messages, schema: Type[T], **kwargs) -> T:
        return schema.model_validate_json(self._response)
