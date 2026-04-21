import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RAGIndex(Base):
    __tablename__ = "rag_indexes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    attachment_id: Mapped[str] = mapped_column(String(36), ForeignKey("attachments.id", ondelete="CASCADE"), nullable=False, unique=True)

    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | indexing | indexed | failed
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    attachment: Mapped["Attachment"] = relationship("Attachment", back_populates="rag_index")  # noqa: F821
