"""
services/text_extractor.py — Stateless text extraction from uploaded files.

Supports: PDF, DOCX, TXT, and basic image OCR (if pytesseract is available).
All functions are synchronous and pure — no side effects.
"""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def extract_text(file_path: str | Path, file_type: str | None = None) -> str:
    """
    Extract plain text from a file.

    Args:
        file_path:  Absolute path to the file.
        file_type:  Optional hint: "pdf" | "docx" | "txt" | "image".
                    Auto-detected from extension if not provided.

    Returns:
        Extracted text string (may be empty if extraction fails).
    """
    path = Path(file_path)
    ft = file_type or _detect_type(path)

    try:
        if ft == "pdf":
            return _extract_pdf(path)
        elif ft == "docx":
            return _extract_docx(path)
        elif ft == "txt":
            return path.read_text(encoding="utf-8", errors="replace")
        elif ft == "image":
            return _extract_image(path)
        else:
            logger.warning("Unsupported file type %r for %s", ft, path.name)
            return ""
    except Exception as exc:
        logger.error("Text extraction failed for %s: %s", path.name, exc)
        return ""


def _detect_type(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".pdf": "pdf",
        ".docx": "docx",
        ".doc": "docx",
        ".txt": "txt",
        ".md": "txt",
        ".png": "image",
        ".jpg": "image",
        ".jpeg": "image",
        ".webp": "image",
        ".tiff": "image",
        ".tif": "image",
    }.get(suffix, "other")


def _extract_pdf(path: Path) -> str:
    import pdfplumber
    texts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                texts.append(text)
    return "\n\n".join(texts)


def _extract_docx(path: Path) -> str:
    from docx import Document
    doc = Document(str(path))
    parts = []
    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text)
    # Also extract table content
    for table in doc.tables:
        for row in table.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
            if row_text:
                parts.append(row_text)
    return "\n".join(parts)


def _extract_image(path: Path) -> str:
    """OCR via pytesseract. Returns empty string if not installed."""
    try:
        import pytesseract
        from PIL import Image
        img = Image.open(path)
        return pytesseract.image_to_string(img)
    except ImportError:
        logger.debug("pytesseract not installed; skipping OCR for %s", path.name)
        return ""
