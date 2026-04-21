"""
infra/storage.py — File I/O abstraction.

Keeps file path logic in one place.
Currently uses local filesystem; swap the implementation to add S3/OSS later.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from config import get_settings


class LocalStorage:
    """Manages uploaded files under uploads/{project_id}/."""

    def __init__(self, base_dir: Path | None = None):
        self._base = base_dir or get_settings().uploads_dir

    def project_dir(self, project_id: str) -> Path:
        d = self._base / project_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def file_path(self, project_id: str, filename: str) -> Path:
        return self.project_dir(project_id) / filename

    def save(self, project_id: str, filename: str, data: bytes) -> Path:
        path = self.file_path(project_id, filename)
        path.write_bytes(data)
        return path

    def read(self, project_id: str, filename: str) -> bytes:
        return self.file_path(project_id, filename).read_bytes()

    def delete(self, project_id: str, filename: str) -> None:
        path = self.file_path(project_id, filename)
        if path.exists():
            path.unlink()

    def delete_project(self, project_id: str) -> None:
        d = self.project_dir(project_id)
        if d.exists():
            shutil.rmtree(d)

    def exists(self, project_id: str, filename: str) -> bool:
        return self.file_path(project_id, filename).exists()
