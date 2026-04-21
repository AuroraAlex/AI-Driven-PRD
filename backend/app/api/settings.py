"""app/api/settings.py — API Key configuration endpoint.

Saves provider API keys to data/settings.json and applies them to os.environ
so LiteLLM picks them up immediately without a server restart.
"""
from __future__ import annotations

import json
import os
from typing import Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from config import BASE_DIR

router = APIRouter(prefix="/settings", tags=["settings"])

SETTINGS_FILE = BASE_DIR / "data" / "settings.json"

# Maps settings field → environment variable name consumed by LiteLLM
_PROVIDER_MAP: dict[str, str] = {
    "openai_api_key": "OPENAI_API_KEY",
    "anthropic_api_key": "ANTHROPIC_API_KEY",
    "dashscope_api_key": "DASHSCOPE_API_KEY",
}


# ── Schemas ───────────────────────────────────────────────────────────────────

class SettingsIn(BaseModel):
    """PUT body.  null = leave unchanged, "" = clear the key."""
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    dashscope_api_key: Optional[str] = None


class ProviderStatus(BaseModel):
    configured: bool   # whether a non-empty key exists
    preview: str       # e.g. "sk-ab••••ef" or ""


class SettingsOut(BaseModel):
    openai: ProviderStatus
    anthropic: ProviderStatus
    dashscope: ProviderStatus


class ModelInfo(BaseModel):
    label: str
    value: str
    provider: str


class ModelsOut(BaseModel):
    models: list[ModelInfo]


class VerifyIn(BaseModel):
    provider: str   # "openai" | "anthropic" | "dashscope"
    api_key: str


class VerifyOut(BaseModel):
    valid: bool
    message: str


class VerifyModelIn(BaseModel):
    model: str      # full LiteLLM id, e.g. "dashscope/qwen3-72b-instruct"


class VerifyModelOut(BaseModel):
    valid: bool
    message: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mask(key: str) -> str:
    """Return a safely masked preview of an API key."""
    if not key:
        return ""
    if len(key) <= 8:
        return "••••••••"
    return key[:4] + "••••" + key[-4:]


def load_saved_settings() -> dict[str, str]:
    """Read persisted keys from disk (call once on startup)."""
    if SETTINGS_FILE.exists():
        try:
            return json.loads(SETTINGS_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def apply_settings_to_env(saved: dict[str, str]) -> None:
    """Push saved keys into os.environ so LiteLLM picks them up."""
    for field, env_key in _PROVIDER_MAP.items():
        val = saved.get(field, "")
        if val:
            os.environ.setdefault(env_key, val)


def _save_to_disk(data: dict[str, str]) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))


def _current_status() -> SettingsOut:
    saved = load_saved_settings()
    fields = ["openai_api_key", "anthropic_api_key", "dashscope_api_key"]
    provider_keys = ["openai", "anthropic", "dashscope"]
    result: dict[str, ProviderStatus] = {}
    for field, provider in zip(fields, provider_keys):
        env_key = _PROVIDER_MAP[field]
        val = os.environ.get(env_key) or saved.get(field, "")
        result[provider] = ProviderStatus(configured=bool(val), preview=_mask(val))
    return SettingsOut(**result)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=SettingsOut)
async def get_settings():
    """Return masked status of each provider's API key."""
    return _current_status()


@router.put("", response_model=SettingsOut)
async def update_settings(body: SettingsIn):
    """
    Update one or more API keys.
    - Pass a non-empty string to set/replace a key.
    - Pass "" (empty string) to clear a key.
    - Omit a field (null) to leave it unchanged.
    """
    saved = load_saved_settings()

    updates = {
        "openai_api_key": body.openai_api_key,
        "anthropic_api_key": body.anthropic_api_key,
        "dashscope_api_key": body.dashscope_api_key,
    }

    for field, new_val in updates.items():
        if new_val is None:
            continue  # not provided — leave unchanged
        env_key = _PROVIDER_MAP[field]
        if new_val == "":
            saved.pop(field, None)
            os.environ.pop(env_key, None)
        else:
            saved[field] = new_val
            os.environ[env_key] = new_val

    _save_to_disk(saved)
    return _current_status()


# ── Provider model registry ───────────────────────────────────────────────────

_PROVIDER_MODELS: dict[str, list[dict[str, str]]] = {
    "openai": [
        {"label": "GPT-4o", "value": "openai/gpt-4o"},
        {"label": "GPT-4o mini", "value": "openai/gpt-4o-mini"},
        {"label": "GPT-4.1", "value": "openai/gpt-4.1"},
        {"label": "GPT-4.1 mini", "value": "openai/gpt-4.1-mini"},
    ],
    "anthropic": [
        {"label": "Claude Sonnet 4.5", "value": "anthropic/claude-sonnet-4-5"},
        {"label": "Claude Haiku 3.5", "value": "anthropic/claude-haiku-3-5"},
        {"label": "Claude Opus 4", "value": "anthropic/claude-opus-4-5"},
    ],
    "dashscope": [
        {"label": "Qwen-Max", "value": "dashscope/qwen-max"},
        {"label": "Qwen-Plus", "value": "dashscope/qwen-plus"},
        {"label": "Qwen-Turbo", "value": "dashscope/qwen-turbo"},
        {"label": "Qwen3-235B", "value": "dashscope/qwen3-235b-a22b"},
    ],
}


@router.get("/models", response_model=ModelsOut)
async def list_available_models():
    """Return preset models for every provider that has an API key configured.

    The UI groups these by `provider` and appends a "custom model" option
    per platform, so no server-side cap is needed.
    """
    status = _current_status()
    provider_configured = {
        "openai": status.openai.configured,
        "anthropic": status.anthropic.configured,
        "dashscope": status.dashscope.configured,
    }
    models: list[ModelInfo] = []
    for provider, available in provider_configured.items():
        if not available:
            continue
        for m in _PROVIDER_MODELS.get(provider, []):
            models.append(ModelInfo(provider=provider, **m))
    return ModelsOut(models=models)


# ── Verify endpoint ───────────────────────────────────────────────────────────

_VERIFY_CONFIGS: dict[str, dict] = {
    "openai": {
        "url": "https://api.openai.com/v1/models",
        "headers_fn": lambda key: {"Authorization": f"Bearer {key}"},
    },
    "anthropic": {
        "url": "https://api.anthropic.com/v1/models",
        "headers_fn": lambda key: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
    },
    "dashscope": {
        "url": "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
        "headers_fn": lambda key: {"Authorization": f"Bearer {key}"},
    },
}


@router.post("/verify", response_model=VerifyOut)
async def verify_api_key(body: VerifyIn):
    """Test whether an API key is valid by calling the provider's models list endpoint."""
    cfg = _VERIFY_CONFIGS.get(body.provider)
    if not cfg:
        return VerifyOut(valid=False, message=f"未知平台: {body.provider}")

    if not body.api_key.strip():
        return VerifyOut(valid=False, message="API Key 不能为空")

    headers = cfg["headers_fn"](body.api_key.strip())
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(cfg["url"], headers=headers)
        if resp.status_code == 200:
            return VerifyOut(valid=True, message="验证成功 ✓")
        elif resp.status_code == 401:
            return VerifyOut(valid=False, message="API Key 无效或已过期")
        elif resp.status_code == 403:
            return VerifyOut(valid=False, message="API Key 权限不足")
        else:
            return VerifyOut(valid=False, message=f"验证失败 (HTTP {resp.status_code})")
    except httpx.TimeoutException:
        return VerifyOut(valid=False, message="请求超时，请检查网络连接")
    except Exception as e:
        return VerifyOut(valid=False, message=f"网络错误: {str(e)[:60]}")


@router.post("/verify-model", response_model=VerifyModelOut)
async def verify_model(body: VerifyModelIn):
    """Check whether a (possibly custom) model id is usable.

    Performs a minimal non-streaming completion through LiteLLM using the
    currently configured credentials. Returns a friendly error message
    suitable for display in the UI.
    """
    from infra.llm import LLMClient  # local import avoids startup cost

    model = (body.model or "").strip()
    if not model:
        return VerifyModelOut(valid=False, message="模型 ID 不能为空")

    try:
        client = LLMClient()
        reply = await client.complete(
            [{"role": "user", "content": "ping"}],
            model=model,
            temperature=0,
            max_tokens=4,
        )
        if reply is None:
            return VerifyModelOut(valid=False, message="模型返回为空")
        return VerifyModelOut(valid=True, message="验证成功 ✓")
    except Exception as e:
        msg = str(e)
        low = msg.lower()
        if "api key" in low or "authentication" in low or "401" in msg:
            hint = "API Key 无效或未配置"
        elif "not found" in low or "404" in msg or "does not exist" in low:
            hint = "模型不存在或无访问权限"
        elif "llm provider" in low:
            hint = "模型 ID 缺少平台前缀（如 openai/、dashscope/）"
        else:
            hint = msg.splitlines()[0][:120] if msg else "未知错误"
        return VerifyModelOut(valid=False, message=f"验证失败：{hint}")
