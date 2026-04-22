"""
agents/canvas/context.py — Build a structured textual representation of one
or more canvas sessions, suitable for inclusion in an LLM prompt or for
indexing into RAG.

Two modes:
  - "full"     : every text-bearing element on the canvas
  - "summary"  : titles + first ~120 chars per card group
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Iterable, Literal


CARD_ROOTS = {
    "sticky_note": "便签",
    "user_story": "用户故事",
    "ai_card": "AI 卡片",
    "prd_card": "PRD 章节",
    "file_card": "文件卡",
    "frame": "分区",
    "mm_root": "思维导图根",
    "mm_node": "思维导图节点",
}

# Elements containing the "body" text we should pull out.
BODY_TYPES = {
    "sticky_note": ("sticky_note_text",),
    "user_story": ("user_story_body",),
    "ai_card": ("ai_card_body",),
    "prd_card": ("prd_card_body",),
    "file_card": ("file_card_label",),
    "frame": (),
    "mm_root": (),
    "mm_node": (),
}


@dataclass
class CanvasCard:
    card_id: str             # group_id (or frame.id)
    node_type: str
    title: str
    body: str
    references: list[str] = field(default_factory=list)


@dataclass
class CanvasSessionContext:
    session_id: str
    title: str
    cards: list[CanvasCard]


def _text_of(el: dict) -> str:
    return (el.get("text") or el.get("originalText") or "").strip()


def _ref_card(elements: list[dict], el: dict) -> str | None:
    cd = el.get("customData") or {}
    nt = cd.get("nodeType")
    if nt not in CARD_ROOTS:
        return None
    if nt == "frame":
        return el["id"]
    gids = el.get("groupIds") or []
    return gids[0] if gids else None


def parse_canvas_elements(
    elements_json: str,
    session_id: str,
    session_title: str,
) -> CanvasSessionContext:
    try:
        elems: list[dict] = json.loads(elements_json or "[]")
    except Exception:
        elems = []

    # Index by group id
    cards_by_id: dict[str, CanvasCard] = {}

    # First pass: find all card roots
    for el in elems:
        if el.get("isDeleted"):
            continue
        cd = el.get("customData") or {}
        nt = cd.get("nodeType")
        if nt not in CARD_ROOTS:
            continue
        cid = el["id"] if nt == "frame" else (el.get("groupIds") or [el["id"]])[0]
        title = el.get("name") or CARD_ROOTS[nt]
        cards_by_id.setdefault(
            cid, CanvasCard(card_id=cid, node_type=nt, title=title, body="", references=[])
        )

    # Second pass: collect bodies and link references via customData.aiContent.sources
    for el in elems:
        if el.get("isDeleted"):
            continue
        cd = el.get("customData") or {}
        nt = cd.get("nodeType")
        # text bodies
        for root_type, body_types in BODY_TYPES.items():
            if nt in body_types:
                # Find owning group
                gids = el.get("groupIds") or []
                cid = gids[0] if gids else cd.get("parentId")
                if cid and cid in cards_by_id:
                    body_text = _text_of(el)
                    if body_text:
                        cards_by_id[cid].body = (
                            cards_by_id[cid].body + "\n" + body_text if cards_by_id[cid].body else body_text
                        )
                break

        # Standalone text labels for unrecognised types (e.g. mm_node text)
        if el.get("type") == "text" and nt not in sum(BODY_TYPES.values(), ()):
            gids = el.get("groupIds") or []
            cid = gids[0] if gids else None
            if cid and cid in cards_by_id and not cards_by_id[cid].body:
                cards_by_id[cid].body = _text_of(el)

        # AI card sources → references
        if nt == "ai_card":
            ai_content = cd.get("aiContent") or {}
            sources = ai_content.get("sources") or []
            cid = (el.get("groupIds") or [el["id"]])[0]
            if cid in cards_by_id:
                cards_by_id[cid].references.extend(
                    f"{s.get('type', '?')}:{s.get('id', '?')}" for s in sources if isinstance(s, dict)
                )

    return CanvasSessionContext(
        session_id=session_id,
        title=session_title,
        cards=list(cards_by_id.values()),
    )


def render_session(
    sess: CanvasSessionContext,
    mode: Literal["full", "summary"] = "full",
) -> str:
    if not sess.cards:
        return f"## 画布「{sess.title}」(空)"
    lines = [f"## 画布「{sess.title}」"]
    for card in sess.cards:
        label = CARD_ROOTS.get(card.node_type, card.node_type)
        body = card.body
        if mode == "summary" and len(body) > 120:
            body = body[:120].rstrip() + "…"
        head = f"- [{label}] {card.title}".rstrip()
        lines.append(head)
        if body:
            for ln in body.splitlines():
                lines.append(f"    {ln}")
        if card.references:
            lines.append(f"    引用: {', '.join(card.references)}")
    return "\n".join(lines)


def build_canvas_context(
    sessions: Iterable[tuple[str, str, str]],  # (session_id, title, elements_json)
    mode: Literal["full", "summary"] = "full",
) -> str:
    """Combine multiple sessions into a single text block for the LLM."""
    blocks: list[str] = []
    for sid, title, elems_json in sessions:
        ctx = parse_canvas_elements(elems_json, sid, title)
        blocks.append(render_session(ctx, mode=mode))
    return "\n\n".join(blocks)


def estimate_tokens(text: str) -> int:
    """Rough char→token heuristic (mixed CJK/latin)."""
    return max(1, int(len(text) / 2.5))
