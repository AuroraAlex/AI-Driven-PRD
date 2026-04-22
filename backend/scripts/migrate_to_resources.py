"""
One-shot migration: attachments + prd_documents -> resource_blocks.

Run from backend/ with:
    python -m scripts.migrate_to_resources

Behaviour:
  1. Creates resource_blocks table (and its indexes) if missing.
  2. Copies every row from `attachments` -> resource_blocks(kind='file').
  3. Copies every row from `prd_documents` -> resource_blocks(kind='document'),
     converting content_html -> markdown via markdownify.
  4. Updates `rag_indexes.attachment_id` to point at the new resource_blocks
     row (id is preserved, so this is mostly a FK rewrite).
  5. Drops the old tables.

Idempotent: if a resource_blocks row with the same id already exists it is
skipped. Safe to re-run.
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone

from sqlalchemy import text

from infra.db import get_engine, get_session, init_db
from infra.models import ResourceBlock  # noqa: F401  (registers table)


HTML_TO_MD_AVAILABLE = True
try:
    from markdownify import markdownify as _md
except ImportError:
    HTML_TO_MD_AVAILABLE = False


def html_to_markdown(html: str) -> str:
    if not html:
        return ""
    if HTML_TO_MD_AVAILABLE:
        return _md(html, heading_style="ATX").strip()
    # Fallback: very crude tag stripping
    import re
    txt = re.sub(r"<[^>]+>", "", html)
    return txt.strip()


async def _table_exists(conn, name: str) -> bool:
    res = await conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
        {"n": name},
    )
    return res.scalar_one_or_none() is not None


async def _column_exists(conn, table: str, col: str) -> bool:
    res = await conn.execute(text(f"PRAGMA table_info({table})"))
    cols = [row[1] for row in res.fetchall()]
    return col in cols


async def main() -> int:
    # 1) Ensure new schema is created (this also registers all current models).
    await init_db()

    engine = get_engine()
    migrated_files = 0
    migrated_docs = 0

    async with engine.begin() as conn:
        has_attachments = await _table_exists(conn, "attachments")
        has_prds = await _table_exists(conn, "prd_documents")

        if not has_attachments and not has_prds:
            print("[migrate] no legacy tables found — nothing to do.")
            return 0

        # 2) Migrate attachments -> resource_blocks(kind='file')
        if has_attachments:
            res = await conn.execute(text("SELECT id, project_id, filename, original_name, "
                                          "file_type, file_size, extracted_text, rag_status, "
                                          "uploaded_at FROM attachments"))
            rows = res.fetchall()
            for r in rows:
                aid = r[0]
                exists = await conn.execute(
                    text("SELECT 1 FROM resource_blocks WHERE id=:id"), {"id": aid}
                )
                if exists.scalar_one_or_none():
                    continue
                await conn.execute(text("""
                    INSERT INTO resource_blocks
                      (id, project_id, kind, title, summary, markdown_content,
                       origin_type, origin_ref, template_type, tags_json, is_in_kb,
                       storage_filename, original_filename, file_type, file_size, extracted_text,
                       created_at, updated_at)
                    VALUES
                      (:id, :pid, 'file', :title, NULL, :md,
                       'upload', NULL, NULL, NULL, :in_kb,
                       :stor, :orig, :ft, :fs, :ext,
                       :ts, :ts)
                """), {
                    "id": aid,
                    "pid": r[1],
                    "title": r[3],
                    "md": r[6] or "",
                    "in_kb": 1 if r[7] == "indexed" else 0,
                    "stor": r[2],
                    "orig": r[3],
                    "ft": r[4],
                    "fs": r[5] or 0,
                    "ext": r[6],
                    "ts": r[8] or datetime.now(timezone.utc),
                })
                migrated_files += 1

        # 3) Migrate prd_documents -> resource_blocks(kind='document')
        if has_prds:
            res = await conn.execute(text("SELECT id, project_id, template_type, title, "
                                          "content_html, created_at, updated_at FROM prd_documents"))
            rows = res.fetchall()
            for r in rows:
                pid = r[0]
                exists = await conn.execute(
                    text("SELECT 1 FROM resource_blocks WHERE id=:id"), {"id": pid}
                )
                if exists.scalar_one_or_none():
                    continue
                md = html_to_markdown(r[4] or "")
                await conn.execute(text("""
                    INSERT INTO resource_blocks
                      (id, project_id, kind, title, summary, markdown_content,
                       origin_type, origin_ref, template_type, tags_json, is_in_kb,
                       storage_filename, original_filename, file_type, file_size, extracted_text,
                       created_at, updated_at)
                    VALUES
                      (:id, :pid, 'document', :title, NULL, :md,
                       'prd_template', :origin, :tpl, NULL, 0,
                       NULL, NULL, NULL, 0, NULL,
                       :c, :u)
                """), {
                    "id": pid,
                    "pid": r[1],
                    "title": r[3] or "Untitled PRD",
                    "md": md,
                    "origin": json.dumps({"legacy_prd_id": pid}),
                    "tpl": r[2],
                    "c": r[5] or datetime.now(timezone.utc),
                    "u": r[6] or datetime.now(timezone.utc),
                })
                migrated_docs += 1

        # 4) rag_indexes: rename attachment_id column to resource_id semantics.
        #    Old FK referenced attachments(id); since ids are preserved we keep
        #    the value but the column may need to be renamed for clarity.
        if await _column_exists(conn, "rag_indexes", "attachment_id") and not await _column_exists(
            conn, "rag_indexes", "resource_id"
        ):
            await conn.execute(text("ALTER TABLE rag_indexes RENAME COLUMN attachment_id TO resource_id"))

        # 5) Drop legacy tables — references already use the same id values.
        if has_attachments:
            await conn.execute(text("DROP TABLE attachments"))
        if has_prds:
            await conn.execute(text("DROP TABLE prd_documents"))

    print(f"[migrate] done — files: {migrated_files}, documents: {migrated_docs}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
