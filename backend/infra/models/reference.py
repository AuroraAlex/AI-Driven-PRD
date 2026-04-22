"""
Reference — directional edge between two content nodes across canvas / chat / prd / rag.

Used to power 「引用 / 被谁引用」reverse-lookup widgets and to support
GC of stale references when a source/target disappears.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Allowed values for source_type / target_type
# `file` is kept as an alias for `resource_block` of kind=file for backward
# compatibility; `resource_block` covers file/snippet/document uniformly.
REF_TYPES = (
    "canvas_card",
    "chat_message",
    "prd_section",
    "rag_chunk",
    "file",
    "resource_block",
)
REF_RELATIONS = ("cites", "derived_from", "mentions", "embedded_in")


class Reference(Base):
    __tablename__ = "references"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "source_type", "source_id",
            "target_type", "target_id", "relation",
            name="uq_reference_edge",
        ),
        Index("ix_reference_source", "project_id", "source_type", "source_id"),
        Index("ix_reference_target", "project_id", "target_type", "target_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )

    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_id: Mapped[str] = mapped_column(String(255), nullable=False)
    source_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[str] = mapped_column(String(255), nullable=False)
    target_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    relation: Mapped[str] = mapped_column(String(32), default="cites")
    created_by: Mapped[str] = mapped_column(String(16), default="user")  # user | ai

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
