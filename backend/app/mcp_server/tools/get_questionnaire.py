"""get_questionnaire — Phase 11 placeholder (registered, not yet live)."""

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.errors import ToolUnavailableError
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "get_questionnaire"


class GetQuestionnaireIn(BaseModel):
    appointment_id: str


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: GetQuestionnaireIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Fetch the configured pre-visit questions for an appointment."""
    del input, ctx, db, integration
    raise ToolUnavailableError(
        "Pre-visit questionnaires arrive in Phase 11; no question set exists yet"
    )
