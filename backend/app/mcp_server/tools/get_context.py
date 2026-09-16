"""get_context — read the agent's working memory for a conversation."""

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.ai.context.ai_context import get_ai_context
from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "get_context"


class GetContextIn(BaseModel):
    conversation_id: str


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: GetContextIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Return the structured conversation context (selections, pending items)."""
    del ctx, db, integration
    context = get_ai_context(input.conversation_id.strip())
    return {"conversation_id": context.conversation_id, "context": context.to_dict()}
