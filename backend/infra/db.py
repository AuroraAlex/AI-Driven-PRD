"""
infra/db.py — Async SQLAlchemy engine and session factory.

Usage:
    async with get_session() as session:
        result = await session.execute(select(Project))

Or via FastAPI dependency:
    async def endpoint(session: AsyncSession = Depends(get_db)):
        ...
"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from config import get_settings


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


def _make_engine():
    settings = get_settings()
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
    )
    # Enable WAL mode for SQLite to allow concurrent readers during writes
    if "sqlite" in settings.database_url:
        @event.listens_for(engine.sync_engine, "connect")
        def _set_wal(dbapi_conn, _connection_record):
            dbapi_conn.execute("PRAGMA journal_mode=WAL")
    return engine


_engine = None
_session_factory = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = _make_engine()
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(),
            expire_on_commit=False,
            class_=AsyncSession,
        )
    return _session_factory


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Context-manager style session for use outside FastAPI."""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — yields a session per request."""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            # Skip final commit if the handler already closed the session
            # (e.g. SSE handlers commit + close early to release the SQLite
            # write lock before streaming).
            if session.is_active:
                await session.commit()
        except Exception:
            if session.is_active:
                await session.rollback()
            raise


async def init_db() -> None:
    """Create all tables. Called once on app startup."""
    # Import models so SQLAlchemy registers them before create_all
    import infra.models  # noqa: F401
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
