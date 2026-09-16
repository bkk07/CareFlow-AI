"""verify_external_appointment — re-read the vendor record and compare."""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment import service
from app.domain.appointment.router import _check_appointment_access
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool
from app.reliability.verification import service as verify_service

TOOL_NAME = "verify_external_appointment"


class VerifyExternalAppointmentIn(BaseModel):
    appointment_id: uuid.UUID


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: VerifyExternalAppointmentIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Corroborate one booking against the vendor; reports match/mismatch/unknown."""
    appointment = service.get_appointment_or_404(db, input.appointment_id)
    _check_appointment_access(ctx, appointment)
    result = verify_service.verify_external_appointment(db, appointment, integration)
    db.commit()
    return {
        "appointment_id": str(appointment.id),
        "outcome": result.outcome.value,
        "mismatches": result.mismatches,
    }
