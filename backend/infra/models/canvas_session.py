"""Canvas Session — a named container for one Excalidraw canvas + its snapshots."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CanvasSession(Base):
    __tablename__ = "canvas_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), default="未命名画布")
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    canvas: Mapped["Canvas"] = relationship(  # noqa: F821
        "Canvas", back_populates="session", uselist=False, cascade="all, delete-orphan"
    )
    snapshots: Mapped[list["CanvasSnapshot"]] = relationship(  # noqa: F821
        "CanvasSnapshot", back_populates="session", cascade="all, delete-orphan"
    )
    project: Mapped["Project"] = relationship("Project", back_populates="canvas_sessions")  # noqa: F821
