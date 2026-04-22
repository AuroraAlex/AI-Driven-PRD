"""
app/main.py — FastAPI application entry point.

Responsibilities:
  - Mount all routers with /api prefix
  - Configure CORS
  - Run DB init on startup
  - Provide /health endpoint
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from infra.db import init_db
from app.api import (
    projects,
    canvas,
    canvas_sessions,
    canvas_snapshot,
    chat,
    chat_sessions,
    files,
    rag,
    prd,
    export,
    references,
    ai_cards,
    settings as settings_api,
)
from app.api.settings import apply_settings_to_env, load_saved_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    get_settings().ensure_dirs()
    await init_db()
    # Restore persisted API keys into os.environ
    apply_settings_to_env(load_saved_settings())
    yield
    # Shutdown (nothing to clean up currently)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    prefix = settings.api_prefix

    app.include_router(projects.router, prefix=prefix)
    app.include_router(canvas_sessions.router, prefix=prefix)
    app.include_router(canvas.router, prefix=prefix)
    app.include_router(canvas_snapshot.router, prefix=prefix)
    app.include_router(chat_sessions.router, prefix=prefix)
    app.include_router(chat.router, prefix=prefix)
    app.include_router(files.router, prefix=prefix)
    app.include_router(rag.router, prefix=prefix)
    app.include_router(prd.router, prefix=prefix)
    app.include_router(export.router, prefix=prefix)
    app.include_router(references.router, prefix=prefix)
    app.include_router(ai_cards.router, prefix=prefix)
    app.include_router(settings_api.router, prefix=prefix)

    @app.get("/health", tags=["health"])
    async def health():
        return {"status": "ok", "app": settings.app_name}

    return app


app = create_app()
