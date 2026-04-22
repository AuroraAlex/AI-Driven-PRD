"""
ResourceBlock — unified content entity replacing Attachment + PRDDocument.

A resource block is one of:
  - kind='file'     : uploaded file (pdf/docx/txt/image). storage_filename and
                      extracted_text are populated; markdown_content mirrors
                      extracted_text for unified preview.
  - kind='snippet'  : a small piece of Markdown exported from chat / canvas;
                      no storage_filename; markdown_content is the body.
  - kind='document' : a full Markdown document — either created from scratch
                      or generated from a PRD template (template_type set).

This single table powers the Resources panel, the Markdown editor, and the
manual knowledge-base inclusion toggle (`is_in_kb`).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


RESOURCE_KINDS = ("file", "snippet", "document")
ORIGIN_TYPES = (
    "upload",          # file uploaded by user
    "manual",          # snippet/document created by user from scratch
    "chat_message",    # exported from a chat message
    "canvas_card",     # exported from a canvas AI card
    "prd_template",    # generated from a PRD template
)


class ResourceBlock(Base):
    __tablename__ = "resource_blocks"
    __table_args__ = (
        Index("ix_resource_project_kind", "project_id", "kind"),
        Index("ix_resource_project_in_kb", "project_id", "is_in_kb"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )

    kind: Mapped[str] = mapped_column(String(16), nullable=False)             # file | snippet | document
    title: Mapped[str] = mapped_column(String(512), default="Untitled")
    summary: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # Markdown body — main content for snippet/document; mirror of extracted text for file.
    markdown_content: Mapped[str] = mapped_column(Text, default="")

    # Provenance
    origin_type: Mapped[str] = mapped_column(String(32), default="manual")    # see ORIGIN_TYPES
    origin_ref: Mapped[str | None] = mapped_column(Text, nullable=True)       # JSON string with source ids
    template_type: Mapped[str | None] = mapped_column(String(32), nullable=True)  # only for kind=document from prd templates
    tags_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Knowledge-base inclusion (manual toggle)
    is_in_kb: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── File-only fields (NULL for snippet/document) ───────────────────────
    storage_filename: Mapped[str | None] = mapped_column(String(512), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(512), nullable=True)
    file_type: Mapped[str | None] = mapped_column(String(32), nullable=True)   # pdf|docx|txt|image|other
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project: Mapped["Project"] = relationship("Project", back_populates="resource_blocks")  # noqa: F821
    rag_index: Mapped["RAGIndex | None"] = relationship(  # noqa: F821
        "RAGIndex", back_populates="resource", uselist=False, cascade="all, delete-orphan"
    )
