"""
Unified configuration via Pydantic Settings.
All values can be overridden by environment variables.
"""
from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ────────────────────────────────────────────────────
    app_name: str = "AI PRD Tool"
    debug: bool = False
    api_prefix: str = "/api"

    # ── Database ───────────────────────────────────────────────
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR}/data/prd.db"

    # ── Storage ────────────────────────────────────────────────
    uploads_dir: Path = BASE_DIR / "uploads"
    rag_data_dir: Path = BASE_DIR / "rag_data"
    ppt_templates_dir: Path = BASE_DIR / "ppt_templates"

    # ── File limits ────────────────────────────────────────────
    max_file_size_mb: int = 100

    # ── LLM (LiteLLM) ─────────────────────────────────────────
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    dashscope_api_key: str = ""          # 阿里云百炼 / DashScope
    default_model: str = "openai/gpt-4o"

    # ── LightRAG ───────────────────────────────────────────────
    rag_max_instances: int = 10          # LRU cache size for per-project instances
    rag_embedding_model: str = "openai/text-embedding-3-small"

    # ── CORS ───────────────────────────────────────────────────
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024

    def ensure_dirs(self) -> None:
        """Create required directories if they don't exist."""
        for d in (self.uploads_dir, self.rag_data_dir, self.ppt_templates_dir,
                  BASE_DIR / "data"):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s
