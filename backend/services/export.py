"""
services/export.py — Export PRD HTML to DOCX and PDF.

All functions are synchronous and pure (input → bytes).
PDF export requires LibreOffice to be installed.
"""
from __future__ import annotations

import io
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from docx import Document
from docx.shared import Pt
from html.parser import HTMLParser

logger = logging.getLogger(__name__)


# ── DOCX export ───────────────────────────────────────────────────────────────

class _HTMLToDocx(HTMLParser):
    """
    Minimal stateful HTML-to-DOCX converter.
    Handles: h1-h4, p, ul/ol+li, table+tr+td/th, strong, em.
    """

    def __init__(self, doc: Document):
        super().__init__()
        self.doc = doc
        self._current_para = None
        self._in_li = False
        self._list_style = "List Bullet"
        self._in_table = False
        self._table = None
        self._row = None
        self._cell = None
        self._cell_text = ""
        self._bold = False
        self._italic = False
        self._tag_stack: list[str] = []

    def handle_starttag(self, tag, attrs):
        self._tag_stack.append(tag)
        if tag in ("h1", "h2", "h3", "h4"):
            level = int(tag[1])
            self._current_para = self.doc.add_heading("", level=level)
        elif tag == "p":
            self._current_para = self.doc.add_paragraph()
        elif tag == "ul":
            self._list_style = "List Bullet"
        elif tag == "ol":
            self._list_style = "List Number"
        elif tag == "li":
            self._in_li = True
            self._current_para = self.doc.add_paragraph(style=self._list_style)
        elif tag == "table":
            self._in_table = True
            self._table = self.doc.add_table(rows=0, cols=1, style="Table Grid")
        elif tag == "tr":
            self._row = self._table.add_row() if self._table else None
            self._col_idx = 0
        elif tag in ("td", "th"):
            self._cell_text = ""
        elif tag == "strong":
            self._bold = True
        elif tag == "em":
            self._italic = True

    def handle_endtag(self, tag):
        if self._tag_stack and self._tag_stack[-1] == tag:
            self._tag_stack.pop()
        if tag == "li":
            self._in_li = False
        elif tag == "table":
            self._in_table = False
            self._table = None
        elif tag in ("td", "th"):
            if self._row and self._col_idx < len(self._row.cells):
                self._row.cells[self._col_idx].text = self._cell_text
            self._col_idx = getattr(self, "_col_idx", 0) + 1
        elif tag == "strong":
            self._bold = False
        elif tag == "em":
            self._italic = False

    def handle_data(self, data):
        text = data.strip()
        if not text:
            return
        if self._in_table:
            self._cell_text += text
        elif self._current_para is not None:
            run = self._current_para.add_run(text)
            run.bold = self._bold
            run.italic = self._italic


def html_to_docx(html: str) -> bytes:
    """Convert PRD HTML to DOCX bytes."""
    doc = Document()
    parser = _HTMLToDocx(doc)
    parser.feed(html)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ── PDF export ────────────────────────────────────────────────────────────────

def docx_to_pdf(docx_bytes: bytes) -> bytes:
    """
    Convert DOCX bytes to PDF via LibreOffice headless.
    Raises RuntimeError if LibreOffice is not installed.
    """
    lo = shutil.which("libreoffice") or shutil.which("soffice")
    if not lo:
        raise RuntimeError(
            "LibreOffice is not installed. "
            "Install it with: brew install libreoffice (macOS) or apt install libreoffice (Linux)"
        )

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        docx_file = tmp_path / "prd.docx"
        docx_file.write_bytes(docx_bytes)

        result = subprocess.run(
            [lo, "--headless", "--convert-to", "pdf", "--outdir", str(tmp_path), str(docx_file)],
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0:
            raise RuntimeError(f"LibreOffice conversion failed: {result.stderr}")

        pdf_file = tmp_path / "prd.pdf"
        if not pdf_file.exists():
            raise RuntimeError("LibreOffice did not produce a PDF file")

        return pdf_file.read_bytes()


def html_to_pdf(html: str) -> bytes:
    """Convenience: HTML → DOCX → PDF."""
    return docx_to_pdf(html_to_docx(html))


# ── Markdown export ───────────────────────────────────────────────────────────

def markdown_to_html(md: str) -> str:
    """Render Markdown source to HTML using the `markdown` library.

    Enables fenced code, tables, GFM-style features. Math/Mermaid blocks fall
    through as ``<pre><code class="language-...">`` which the DOCX converter
    treats as literal text — good enough for export fidelity.
    """
    try:
        import markdown as _md
    except ImportError:  # pragma: no cover
        # Naive fallback so callers don't crash before deps are installed
        return f"<pre>{md}</pre>"
    return _md.markdown(
        md or "",
        extensions=["fenced_code", "tables", "toc", "sane_lists"],
        output_format="html5",
    )


def markdown_to_docx(md: str) -> bytes:
    """Markdown -> HTML -> DOCX bytes."""
    return html_to_docx(markdown_to_html(md))


def markdown_to_pdf(md: str) -> bytes:
    """Markdown -> HTML -> DOCX -> PDF bytes (LibreOffice required)."""
    return docx_to_pdf(markdown_to_docx(md))
