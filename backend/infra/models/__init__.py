"""ORM models package — imports all models so SQLAlchemy registers them."""
from infra.models.project import Project
from infra.models.canvas_session import CanvasSession
from infra.models.chat_session import ChatSession
from infra.models.canvas import Canvas
from infra.models.canvas_snapshot import CanvasSnapshot
from infra.models.resource_block import ResourceBlock, RESOURCE_KINDS, ORIGIN_TYPES
from infra.models.chat_message import ChatMessage
from infra.models.rag_index import RAGIndex
from infra.models.ppt_template import PPTTemplate
from infra.models.reference import Reference, REF_TYPES, REF_RELATIONS

__all__ = [
    "Project",
    "CanvasSession",
    "ChatSession",
    "Canvas",
    "CanvasSnapshot",
    "ResourceBlock",
    "RESOURCE_KINDS",
    "ORIGIN_TYPES",
    "ChatMessage",
    "RAGIndex",
    "PPTTemplate",
    "Reference",
    "REF_TYPES",
    "REF_RELATIONS",
]
