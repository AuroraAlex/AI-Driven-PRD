"""
services/ppt_renderer.py — Render AI-generated slide JSON onto a .pptx template.

Pure function: takes SlideDeck + template path → bytes (pptx content).
No state, no DB access, no LLM calls.
"""
from __future__ import annotations

import io
import logging
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

from agents.prd.agent import SlideDeck, SlideItem

logger = logging.getLogger(__name__)

# Layout index constants (PowerPoint default layout indices)
_LAYOUT_TITLE = 0         # "Title Slide"
_LAYOUT_CONTENT = 1       # "Title and Content"
_LAYOUT_TWO_COL = 3       # "Two Content"
_LAYOUT_BLANK = 6         # "Blank"


def render(deck: SlideDeck, template_path: str | Path | None = None) -> bytes:
    """
    Render a SlideDeck onto a .pptx template.

    Args:
        deck:           SlideDeck model produced by PRDAgent.
        template_path:  Path to .pptx template. Uses blank presentation if None.

    Returns:
        Raw .pptx bytes suitable for FileResponse.
    """
    if template_path and Path(template_path).exists():
        prs = Presentation(str(template_path))
    else:
        prs = Presentation()

    for slide_item in deck.slides:
        _add_slide(prs, slide_item)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _add_slide(prs: Presentation, item: SlideItem) -> None:
    layout_idx = _resolve_layout(prs, item.layout)
    layout = prs.slide_layouts[layout_idx]
    slide = prs.slides.add_slide(layout)

    # Set title
    if slide.shapes.title and item.title:
        slide.shapes.title.text = item.title

    # Set body / bullets
    body_placeholder = _find_body(slide)
    if body_placeholder and item.bullets:
        tf = body_placeholder.text_frame
        tf.clear()
        for i, bullet in enumerate(item.bullets):
            if i == 0:
                tf.text = bullet
            else:
                para = tf.add_paragraph()
                para.text = bullet
                para.level = 1

    # Speaker notes
    if item.speaker_notes:
        notes_slide = slide.notes_slide
        notes_slide.notes_text_frame.text = item.speaker_notes


def _resolve_layout(prs: Presentation, layout_name: str) -> int:
    """Map layout name to a safe index within the available slide layouts."""
    mapping = {
        "title": _LAYOUT_TITLE,
        "content": _LAYOUT_CONTENT,
        "two-col": _LAYOUT_TWO_COL,
        "quote": _LAYOUT_CONTENT,   # fallback to content
        "blank": _LAYOUT_BLANK,
    }
    idx = mapping.get(layout_name, _LAYOUT_CONTENT)
    max_idx = len(prs.slide_layouts) - 1
    return min(idx, max_idx)


def _find_body(slide) -> object | None:
    """Find the first non-title content placeholder."""
    for ph in slide.placeholders:
        if ph.placeholder_format.idx != 0:  # 0 is title
            return ph
    return None
