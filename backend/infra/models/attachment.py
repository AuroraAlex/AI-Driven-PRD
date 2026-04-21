import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    filename: Mapped[str] = mapped_column(String(512), nullable=False)        # stored filename (uuid-based)
    original_name: Mapped[str] = mapped_column(String(512), nullable=False)   # user-visible name
    file_type: Mapped[str] = mapped_column(String(32), nullable=False)        # pdf | docx | txt | image | other
    file_size: Mapped[int] = mapped_column(Integer, default=0)                # bytes
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)   # text extracted from file

    # RAG indexing status
    rag_status: Mapped[str] = mapped_column(String(16), default="pending")    # pending | indexing | indexed | failed

    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    project: Mapped["Project"] = relationship("Project", back_populates="attachments")  # noqa: F821
    rag_index: Mapped["RAGIndex | None"] = relationship("RAGIndex", back_populates="attachment", uselist=False, cascade="all, delete-orphan")  # noqa: F821
