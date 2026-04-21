"""
agents/chat/prompts.py — System prompt templates for ChatAgent.

Keeping prompts in a separate module enables:
  - Independent testing of prompt construction
  - Easy A/B testing by swapping this module
  - Localisation / prompt version control
"""
from agents.base import AgentContext


SYSTEM_BASE = """\
You are an expert product manager and software architect assistant helping \
the team build a Product Requirements Document (PRD).

Your role:
- Help clarify, structure, and refine product requirements
- Ask targeted questions to uncover edge cases and unknowns
- Suggest industry best practices (Agile, ASPICE, IEEE SRS as relevant)
- Be concise and actionable; avoid vague advice

You have access to the following context (may be empty):
{canvas_summary}
{files_summary}
{rag_summary}

Respond in the same language as the user's message.\
"""

CANVAS_SECTION = """\

=== Whiteboard / Canvas Content ===
{canvas_text}
=== End of Canvas ===\
"""

FILES_SECTION = """\

=== Uploaded Documents ===
{files_text}
=== End of Documents ===\
"""

RAG_SECTION = """\

=== Knowledge Graph Retrieval (mode: {rag_mode}) ===
{rag_context}
=== End of Retrieval ===\
"""


def build_system_prompt(ctx: AgentContext, rag_context: str = "") -> str:
    """
    Build the system prompt by injecting available context.
    Called by ChatAgent; can be unit-tested independently.
    """
    canvas_summary = CANVAS_SECTION.format(canvas_text=ctx.canvas_text) if ctx.canvas_text.strip() else ""

    files_parts = []
    for f in ctx.attached_files:
        if f.extracted_text:
            excerpt = f.extracted_text[:1500] + ("…" if len(f.extracted_text) > 1500 else "")
            files_parts.append(f"[{f.filename}]\n{excerpt}")
    files_summary = FILES_SECTION.format(files_text="\n\n".join(files_parts)) if files_parts else ""

    rag_summary = RAG_SECTION.format(rag_mode=ctx.rag_mode, rag_context=rag_context) if rag_context.strip() else ""

    return SYSTEM_BASE.format(
        canvas_summary=canvas_summary,
        files_summary=files_summary,
        rag_summary=rag_summary,
    )


def build_messages(ctx: AgentContext, rag_context: str = "") -> list[dict]:
    """Assemble the full messages list (system + history + current query)."""
    system_prompt = build_system_prompt(ctx, rag_context)
    messages: list[dict] = [{"role": "system", "content": system_prompt}]

    # Recent history (already ordered oldest → newest)
    for msg in ctx.chat_history[-20:]:
        messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": ctx.user_query})
    return messages
