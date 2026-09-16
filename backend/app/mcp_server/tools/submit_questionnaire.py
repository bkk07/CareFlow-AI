"""submit_questionnaire — Phase 11 placeholder (registered, not yet live)."""

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.errors import ToolUnavailableError
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "submit_questionnaire"


class SubmitQuestionnaireIn(BaseModel):
    appointment_id: str
    answers: dict = {}


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin],
)
def run(
    input: SubmitQuestionnaireIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Store a patient's answers to the pre-visit question set."""
    del input, ctx, db, integration
    raise ToolUnavailableError(
        "Pre-visit questionnaires arrive in Phase 11; responses cannot be stored yet"
    )
