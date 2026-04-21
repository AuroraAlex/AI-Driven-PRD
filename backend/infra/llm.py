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
        model = model or self._settings.default_model
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
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Yield text tokens as they arrive."""
        model = model or self._settings.default_model
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
            **kwargs,
        )
        async for chunk in response:
            content = chunk.choices[0].delta.content
            if content:
                yield content

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
