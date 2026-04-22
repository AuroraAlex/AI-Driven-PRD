"""app/api/project_settings.py — Per-project knowledge-base configuration."""
from __future__ import annotations

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.deps import AppDeps, get_deps
from infra.models import Project, ProjectSetting

router = APIRouter(prefix="/projects/{project_id}/knowledge", tags=["knowledge-settings"])


_RAGMode = Literal["naive", "local", "global", "hybrid"]
_Provider = Literal["openai", "dashscope", "anthropic"]


class KBSettingsOut(BaseModel):
    project_id: str
    embedding_model: str | None = None
    extraction_model: str | None = None
    rerank_model: str | None = None
    embedding_provider: _Provider | None = None
    extraction_provider: _Provider | None = None
    rerank_provider: _Provider | None = None
    min_rerank_score: float | None = None
    chunk_token_size: int | None = None
    chunk_overlap_token_size: int | None = None
    top_k: int | None = None
    default_rag_mode: _RAGMode | None = None
    rag_max_instances: int | None = None


class KBSettingsIn(BaseModel):
    """All fields optional. Pass null/omit to leave unchanged; empty string clears."""
    embedding_model: Optional[str] = None
    extraction_model: Optional[str] = None
    rerank_model: Optional[str] = None
    embedding_provider: Optional[_Provider] = None
    extraction_provider: Optional[_Provider] = None
    rerank_provider: Optional[_Provider] = None
    min_rerank_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    chunk_token_size: Optional[int] = Field(None, ge=128, le=8192)
    chunk_overlap_token_size: Optional[int] = Field(None, ge=0, le=2048)
    top_k: Optional[int] = Field(None, ge=1, le=200)
    default_rag_mode: Optional[_RAGMode] = None
    rag_max_instances: Optional[int] = Field(None, ge=1, le=100)


def _to_out(row: ProjectSetting | None, project_id: str) -> KBSettingsOut:
    if row is None:
        return KBSettingsOut(project_id=project_id)
    return KBSettingsOut(
        project_id=project_id,
        embedding_model=row.embedding_model,
        extraction_model=row.extraction_model,
        rerank_model=row.rerank_model,
        embedding_provider=row.embedding_provider,  # type: ignore[arg-type]
        extraction_provider=row.extraction_provider,  # type: ignore[arg-type]
        rerank_provider=row.rerank_provider,  # type: ignore[arg-type]
        min_rerank_score=row.min_rerank_score,
        chunk_token_size=row.chunk_token_size,
        chunk_overlap_token_size=row.chunk_overlap_token_size,
        top_k=row.top_k,
        default_rag_mode=row.default_rag_mode,  # type: ignore[arg-type]
        rag_max_instances=row.rag_max_instances,
    )


@router.get("/settings", response_model=KBSettingsOut)
async def get_kb_settings(
    project_id: str,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    proj = await deps.db.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")
    row = await deps.db.get(ProjectSetting, project_id)
    return _to_out(row, project_id)


@router.put("/settings", response_model=KBSettingsOut)
async def update_kb_settings(
    project_id: str,
    body: KBSettingsIn,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    proj = await deps.db.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")

    row = await deps.db.get(ProjectSetting, project_id)
    if row is None:
        row = ProjectSetting(project_id=project_id)
        deps.db.add(row)

    payload = body.model_dump(exclude_unset=True)
    for k, v in payload.items():
        # Empty string clears the override; None means "unchanged".
        if isinstance(v, str) and v == "":
            setattr(row, k, None)
        else:
            setattr(row, k, v)

    await deps.db.flush()
    # Force LightRAG instance rebuild on next access.
    deps.rag_agent.store.invalidate(project_id)
    return _to_out(row, project_id)


# ── Per-component verify ──────────────────────────────────────────────────────

_Component = Literal["llm", "embedding", "rerank"]


class VerifyKBIn(BaseModel):
    """Test a single KB component using current draft settings.

    Any field not provided falls back to the persisted ProjectSetting row.
    """
    component: _Component
    model: Optional[str] = None
    provider: Optional[_Provider] = None


class VerifyKBOut(BaseModel):
    valid: bool
    message: str
    detail: str | None = None


@router.post("/verify", response_model=VerifyKBOut)
async def verify_kb_component(
    project_id: str,
    body: VerifyKBIn,
    deps: Annotated[AppDeps, Depends(get_deps)],
):
    """Run a tiny live request against the chosen LLM/embedding/rerank model.

    Resolves the provider config exactly the way LightRAG would, so a
    success here means real ingestion / query will work too.
    """
    proj = await deps.db.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")

    # Build an overrides dict matching what `_load_overrides` produces, but
    # let body fields shadow persisted ones for the *single* component we test.
    row = await deps.db.get(ProjectSetting, project_id)
    overrides: dict = {}
    if row:
        if row.embedding_model:
            overrides["embedding_model"] = row.embedding_model
        if row.extraction_model:
            overrides["extraction_model"] = row.extraction_model
        if row.rerank_model:
            overrides["rerank_model"] = row.rerank_model
        if row.embedding_provider:
            overrides["embedding_provider"] = row.embedding_provider
        if row.extraction_provider:
            overrides["extraction_provider"] = row.extraction_provider
        if row.rerank_provider:
            overrides["rerank_provider"] = row.rerank_provider

    model = (body.model or "").strip() or None
    provider = body.provider
    if body.component == "llm":
        if model:
            overrides["extraction_model"] = model
        if provider:
            overrides["extraction_provider"] = provider
    elif body.component == "embedding":
        if model:
            overrides["embedding_model"] = model
        if provider:
            overrides["embedding_provider"] = provider
    else:  # rerank
        if model:
            overrides["rerank_model"] = model
        if provider:
            overrides["rerank_provider"] = provider

    # Resolve config — surfaces "no API key" / "anthropic embedding" errors clearly.
    from config import get_settings as _get_settings
    from agents.rag.provider_resolver import resolve_provider
    try:
        cfg = resolve_provider(
            _get_settings(),
            embedding_model_override=overrides.get("embedding_model"),
            extraction_model_override=overrides.get("extraction_model"),
            rerank_model_override=overrides.get("rerank_model"),
            embedding_provider_override=overrides.get("embedding_provider"),
            extraction_provider_override=overrides.get("extraction_provider"),
            rerank_provider_override=overrides.get("rerank_provider"),
        )
    except Exception as exc:
        return VerifyKBOut(valid=False, message="配置解析失败", detail=str(exc)[:200])

    try:
        if body.component == "llm":
            import litellm
            resp = await litellm.acompletion(
                model=cfg.llm_model,
                messages=[{"role": "user", "content": "ping"}],
                api_key=cfg.api_key,
                api_base=cfg.api_base,
                temperature=0,
                max_tokens=4,
            )
            reply = (resp.choices[0].message.content or "").strip()
            return VerifyKBOut(
                valid=True,
                message=f"LLM 可用 ✓ ({cfg.llm_model})",
                detail=reply[:120] or None,
            )
        elif body.component == "embedding":
            if cfg.embedding_provider == "dashscope":
                from agents.rag.graph_store import dashscope_embed
                vecs = await dashscope_embed(
                    ["ping"],
                    model=cfg.embedding_model,
                    api_key=cfg.embedding_api_key,
                    api_base=cfg.embedding_api_base,
                )
                dim = len(vecs[0])
            else:
                import litellm
                resp = await litellm.aembedding(
                    model=cfg.embedding_model,
                    input=["ping"],
                    api_key=cfg.embedding_api_key,
                    api_base=cfg.embedding_api_base,
                    encoding_format="float",
                )
                dim = len(resp["data"][0]["embedding"])
            return VerifyKBOut(
                valid=True,
                message=f"Embedding 可用 ✓ ({cfg.embedding_model})",
                detail=f"维度: {dim}",
            )
        else:  # rerank
            if not cfg.rerank_model or not cfg.rerank_api_base:
                return VerifyKBOut(valid=False, message="未配置 Rerank 模型")
            from functools import partial
            from lightrag.rerank import generic_rerank_api
            bare = cfg.rerank_model.split("/", 1)[-1]
            is_aliyun = "dashscope.aliyuncs.com" in cfg.rerank_api_base
            fn = partial(
                generic_rerank_api,
                model=bare,
                base_url=cfg.rerank_api_base,
                api_key=cfg.rerank_api_key,
                response_format="aliyun" if is_aliyun else "standard",
                request_format="aliyun" if is_aliyun else "standard",
                return_documents=False,
            )
            out = await fn(
                query="ping",
                documents=["hello world", "foo bar"],
                top_n=2,
            )
            n = len(out) if isinstance(out, list) else 0
            return VerifyKBOut(
                valid=True,
                message=f"Rerank 可用 ✓ ({bare})",
                detail=f"返回 {n} 条结果",
            )
    except Exception as exc:
        msg = str(exc)
        low = msg.lower()
        if "api key" in low or "authentication" in low or "401" in msg:
            hint = "API Key 无效或未配置"
        elif "not found" in low or "404" in msg or "does not exist" in low:
            hint = "模型不存在或无访问权限"
        elif "llm provider" in low:
            hint = "模型 ID 缺少平台前缀（如 openai/、dashscope/）"
        elif "timeout" in low:
            hint = "请求超时，请检查网络"
        else:
            hint = msg.splitlines()[0][:160] if msg else "未知错误"
        return VerifyKBOut(valid=False, message="验证失败", detail=hint)
