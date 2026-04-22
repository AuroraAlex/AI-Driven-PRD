"""Per-project knowledge-base configuration overrides."""
from datetime import datetime, timezone

from sqlalchemy import String, Integer, Float, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ProjectSetting(Base):
    __tablename__ = "project_settings"

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    # Knowledge-base / RAG knobs (NULL → fall back to global defaults)
    embedding_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    extraction_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    rerank_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    min_rerank_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Per-component provider overrides — None means "auto-detect from API keys".
    embedding_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    extraction_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    rerank_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    chunk_token_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_overlap_token_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    top_k: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_rag_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    rag_max_instances: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

