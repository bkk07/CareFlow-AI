"""cancel_appointment — tear a booking down and release its slot."""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment import service
from app.domain.appointment.router import _check_appointment_access
from app.domain.appointment.state_machine import InvalidTransition
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.errors import CapabilityValidationError
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "cancel_appointment"


class CancelAppointmentIn(BaseModel):
    appointment_id: uuid.UUID
    reason: str | None = None
    idempotency_key: str


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=True,
    allowed_roles=[Role.patient, Role.hospital_admin],
)
def run(
    input: CancelAppointmentIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Cancel a booking; vendor divergence opens a record but never revives it."""
    appointment = service.get_appointment_or_404(db, input.appointment_id)
    _check_appointment_access(ctx, appointment)
    try:
        updated = service.cancel_appointment(
            db,
            appointment=appointment,
            actor_user_id=ctx.user_id,
            integration=integration,
            reason=input.reason,
            idempotency_key=input.idempotency_key.strip(),
        )
    except InvalidTransition as exc:
        raise CapabilityValidationError(str(exc)) from exc
    return {"appointment_id": str(updated.id), "state": updated.state.value}
