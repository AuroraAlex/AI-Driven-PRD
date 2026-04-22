import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RAGIndex(Base):
    """Tracks indexing status for any RAG-able source (file / canvas / chat / prd).

    `doc_id` is what we pass to LightRAG; format suggestions:
      file:{attachment_id}  |  canvas:{session_id}:{group_id}
      chat:{session_id}:{message_id}  |  prd:{prd_id}:{anchor}
    """
    __tablename__ = "rag_indexes"
    __table_args__ = (
        UniqueConstraint("project_id", "doc_id", name="uq_rag_doc"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # New: generic source descriptor
    source_type: Mapped[str] = mapped_column(String(32), default="file")  # file|canvas|chat|prd
    source_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    doc_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    # Legacy column kept (renamed via migration). NULL for non-resource sources.
    resource_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("resource_blocks.id", ondelete="CASCADE"), nullable=True, unique=True
    )

    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | indexing | indexed | failed | unindexed
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    resource: Mapped["ResourceBlock | None"] = relationship("ResourceBlock", back_populates="rag_index")  # noqa: F821
