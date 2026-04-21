import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CanvasSnapshot(Base):
    __tablename__ = "canvas_snapshots"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elements_json: Mapped[str] = mapped_column(Text, default="[]")
    app_state_json: Mapped[str] = mapped_column(Text, default="{}")
    label: Mapped[str] = mapped_column(String(200), default="快照")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now
    )
