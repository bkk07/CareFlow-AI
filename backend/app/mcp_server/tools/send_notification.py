"""send_notification — Phase 10 placeholder (registered, not yet live)."""

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.errors import ToolUnavailableError
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "send_notification"


class SendNotificationIn(BaseModel):
    recipient_user_id: str
    channel: str = "in_app"
    message: str = ""


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=False,
    allowed_roles=[Role.hospital_admin, Role.platform_admin],
)
def run(
    input: SendNotificationIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Queue an email or in-app notification for a user."""
    del input, ctx, db, integration
    raise ToolUnavailableError(
        "Notifications arrive in Phase 10; nothing was queued"
    )
