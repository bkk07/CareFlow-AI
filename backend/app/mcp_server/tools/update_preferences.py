"""update_preferences — persist durable patient prefs to Postgres.

Per the architecture rule: durable preferences live in `UserPreferences`,
never in the ephemeral AIContext.
"""

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.domain.patient import service as patient_service
from app.domain.patient.schemas import PreferencesUpdateIn
from app.integration.integration_service import IntegrationService
from app.mcp_server.errors import CapabilityAuthError
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "update_preferences"


class UpdatePreferencesIn(BaseModel):
    preferred_doctor_id: str | None = None
    preferred_hospital_id: str | None = None
    preferred_appointment_type_id: str | None = None
    preferred_time_of_day: str | None = None
    preferred_consultation_mode: str | None = None


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=False,
    allowed_roles=[Role.patient],
)
def run(
    input: UpdatePreferencesIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Save the caller's own scheduling preferences."""
    del integration
    if ctx.role != Role.patient:
        raise CapabilityAuthError("Only patients may update preferences")
    body = PreferencesUpdateIn(
        **{k: v for k, v in input.model_dump().items() if v is not None}
    )
    prefs = patient_service.update_preferences(db, ctx.user_id, body)
    return {
        "patient_user_id": str(prefs.patient_user_id),
        "preferred_doctor_id": str(prefs.preferred_doctor_id)
        if prefs.preferred_doctor_id
        else None,
        "preferred_hospital_id": str(prefs.preferred_hospital_id)
        if prefs.preferred_hospital_id
        else None,
    }
