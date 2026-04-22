"""
agents/prd/agent.py — PRDAgent: generate and refine PRD documents.

Generates structured HTML documents from project context using a chosen template.
The HTML is then editable via TipTap in the frontend.

Standalone:
    python -m agents.prd --project-id proj_1 --template agile --model openai/gpt-4o
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import AsyncGenerator

from pydantic import BaseModel

from agents.base import AgentContext, AgentEvent, new_trace_id
from infra.llm import LLMClient

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent / "templates"


# ── Pydantic models for structured PPT slide output ──────────────────────────

class SlideItem(BaseModel):
    layout: str = "content"           # title | content | two-col | quote | blank
    title: str = ""
    bullets: list[str] = []
    speaker_notes: str = ""


class SlideDeck(BaseModel):
    slides: list[SlideItem]


# ── PRD generation prompt ─────────────────────────────────────────────────────

PRD_SYSTEM = """\
You are a senior product manager. Generate a complete, professional PRD document \
in Markdown format following the provided template structure.

Rules:
- Use proper Markdown: `#` for the document title, `##` for top-level sections, \
  `###` for subsections, paragraphs as plain text, `-` / `1.` for lists, \
  GitHub-flavored `| col | col |` tables, fenced ```mermaid``` blocks for diagrams, \
  and `$inline$` / `$$block$$` for math.
- Begin every top-level section with an HTML anchor comment `<!-- section: {{section_id}} -->` \
  on the line immediately above the `## Heading` so downstream tooling can locate it.
- Use the project context below to populate each section with real, specific content; \
  avoid placeholder text.
- Respond with ONLY Markdown source (no surrounding code fences, no HTML wrapper).

Template: {template_name}
Section structure:
{section_structure}
"""

PRD_USER = """\
Project context:
Canvas/Whiteboard content:
{canvas_text}

Uploaded documents summary:
{files_summary}

Knowledge graph context:
{rag_context}

Chat discussion summary:
{chat_summary}

Generate the full PRD Markdown document now.\
"""

PPT_SYSTEM = """\
You are a presentation designer. Convert the given PRD Markdown into a slide deck JSON.
Respond ONLY with valid JSON matching this schema:
{{
  "slides": [
    {{
      "layout": "title|content|two-col|quote",
      "title": "string",
      "bullets": ["string", ...],
      "speaker_notes": "string"
    }}
  ]
}}

Guidelines:
- First slide: layout="title" with product name and tagline
- One slide per major PRD section (max 5 bullets per slide)
- Last slide: layout="quote" with key takeaway
- speaker_notes: 1-2 sentences for the presenter
- Total slides: 8-15
"""


def _load_template(template_type: str) -> dict:
    path = TEMPLATES_DIR / f"{template_type}.json"
    if not path.exists():
        raise ValueError(f"Unknown template: {template_type}. Available: {[f.stem for f in TEMPLATES_DIR.glob('*.json')]}")
    return json.loads(path.read_text(encoding="utf-8"))


def _build_prd_messages(ctx: AgentContext, template: dict, rag_context: str = "") -> list[dict]:
    section_structure = "\n".join(
        f"  [{s['id']}] {s['title']}: {s.get('prompt_hint', '')}"
        for s in template["sections"]
    )

    files_summary = ""
    for f in ctx.attached_files:
        if f.extracted_text:
            excerpt = f.extracted_text[:800]
            files_summary += f"[{f.filename}]: {excerpt}\n\n"

    chat_summary = "\n".join(
        f"{m.role.upper()}: {m.content[:200]}"
        for m in ctx.chat_history[-10:]
    )

    system = PRD_SYSTEM.format(
        template_name=template["name"],
        section_structure=section_structure,
    )
    user = PRD_USER.format(
        canvas_text=ctx.canvas_text or "(empty)",
        files_summary=files_summary or "(none)",
        rag_context=rag_context or "(none)",
        chat_summary=chat_summary or "(none)",
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


class PRDAgent:
    agent_name = "prd"

    def __init__(self, llm: LLMClient) -> None:
        self.llm = llm

    async def run(
        self,
        ctx: AgentContext,
        *,
        dry_run: bool = False,
    ) -> AsyncGenerator[AgentEvent, None]:
        """Generate PRD HTML via streaming."""
        trace_id = new_trace_id()
        template_type = ctx.metadata.get("template_type", "agile")
        rag_context = ctx.metadata.get("rag_context", "")

        try:
            template = _load_template(template_type)
        except ValueError as exc:
            yield AgentEvent.make_error(self.agent_name, trace_id, str(exc), "INVALID_TEMPLATE")
            return

        messages = _build_prd_messages(ctx, template, rag_context)

        if dry_run:
            yield AgentEvent(
                type="done",
                agent=self.agent_name,
                data={"prompt": messages, "dry_run": True},
                trace_id=trace_id,
            )
            return

        try:
            async for token in self.llm.stream(messages, model=ctx.model, temperature=0.4, max_tokens=8192):
                yield AgentEvent(type="token", agent=self.agent_name, data=token, trace_id=trace_id)
        except Exception as exc:
            logger.exception("PRDAgent.run failed: %s", exc)
            yield AgentEvent.make_error(self.agent_name, trace_id, str(exc))
            return

        yield AgentEvent(type="done", agent=self.agent_name, data=None, trace_id=trace_id)

    async def generate_slide_json(
        self,
        prd_markdown: str,
        *,
        model: str | None = None,
    ) -> SlideDeck:
        """Convert PRD Markdown to a SlideDeck (used by ppt_renderer)."""
        messages = [
            {"role": "system", "content": PPT_SYSTEM},
            {"role": "user", "content": f"PRD Markdown:\n{prd_markdown[:12000]}"},
        ]
        return await self.llm.complete_json(messages, SlideDeck, model=model, temperature=0.3)


# ── CLI entrypoint ───────────────────────────────────────────────────────────

async def _cli_main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="PRDAgent CLI (debug)")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--template", default="agile", choices=["agile", "aspice", "ieee_srs", "custom"])
    parser.add_argument("--model", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from config import get_settings
    settings = get_settings()
    llm = LLMClient(settings)
    agent = PRDAgent(llm=llm)

    ctx = AgentContext(
        project_id=args.project_id,
        user_query="Generate PRD",
        model=args.model or settings.default_model,
        metadata={"template_type": args.template},
    )

    output = []
    async for event in agent.run(ctx, dry_run=args.dry_run):
        if event.type == "token":
            print(event.data, end="", flush=True)
            output.append(event.data)
        else:
            print(f"\n[{event.type}] {event.data}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(_cli_main())
