import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from infra.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    # Relationships
    canvas_sessions: Mapped[list["CanvasSession"]] = relationship(  # noqa: F821
        "CanvasSession", back_populates="project", cascade="all, delete-orphan",
        order_by="CanvasSession.order_index",
    )
    chat_sessions: Mapped[list["ChatSession"]] = relationship(  # noqa: F821
        "ChatSession", back_populates="project", cascade="all, delete-orphan",
        order_by="ChatSession.order_index",
    )
    attachments: Mapped[list["ResourceBlock"]] = relationship(  # noqa: F821
        "ResourceBlock", back_populates="project", cascade="all, delete-orphan",
        viewonly=True, primaryjoin="and_(Project.id==ResourceBlock.project_id, ResourceBlock.kind=='file')",
    )
    resource_blocks: Mapped[list["ResourceBlock"]] = relationship("ResourceBlock", back_populates="project", cascade="all, delete-orphan")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Project id={self.id!r} name={self.name!r}>"
