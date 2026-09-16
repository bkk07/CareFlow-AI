"""start_workflow — Phase 10 placeholder (registered, not yet live)."""

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.errors import ToolUnavailableError
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "start_workflow"


class StartWorkflowIn(BaseModel):
    event_type: str
    payload: dict = {}


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=False,
    allowed_roles=[Role.hospital_admin, Role.platform_admin],
)
def run(
    input: StartWorkflowIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Publish a workflow event for async handling."""
    del input, ctx, db, integration
    raise ToolUnavailableError(
        "The workflow engine arrives in Phase 10; no event was published"
    )
