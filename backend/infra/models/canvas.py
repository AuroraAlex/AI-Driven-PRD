import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Canvas(Base):
    __tablename__ = "canvases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    canvas_session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("canvas_sessions.id", ondelete="CASCADE"),
        nullable=False, unique=True,
    )

    # Excalidraw serialised state
    elements_json: Mapped[str] = mapped_column(Text, default="[]")
    app_state_json: Mapped[str] = mapped_column(Text, default="{}")
    files_json: Mapped[str] = mapped_column(Text, default="{}")   # embedded images/files

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    session: Mapped["CanvasSession"] = relationship("CanvasSession", back_populates="canvas")  # noqa: F821
