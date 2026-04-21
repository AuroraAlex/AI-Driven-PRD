import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PPTTemplate(Base):
    __tablename__ = "ppt_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)         # relative to ppt_templates/
    thumbnail_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
