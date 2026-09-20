"""reschedule_appointment — move a live booking to a new slot."""

import uuid
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment import service
from app.domain.appointment.router import _check_appointment_access
from app.domain.appointment.state_machine import InvalidTransition
from app.domain.auth.models import Role
from app.domain.hospital.service import get_hospital_or_404
from app.integration.integration_service import IntegrationService
from app.mcp_server.errors import CapabilityValidationError
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "reschedule_appointment"


class RescheduleAppointmentIn(BaseModel):
    appointment_id: uuid.UUID
    slot_start: datetime
    slot_end: datetime
    reason: str | None = None
    idempotency_key: str


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=True,
    allowed_roles=[Role.patient, Role.hospital_admin],
)
def run(
    input: RescheduleAppointmentIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Move a booking; the old slot is kept until the vendor confirms."""
    appointment = service.get_appointment_or_404(db, input.appointment_id)
    _check_appointment_access(ctx, appointment)
    hospital = get_hospital_or_404(db, appointment.hospital_id)
    try:
        updated = service.reschedule_appointment(
            db,
            appointment=appointment,
            hospital=hospital,
            new_start=input.slot_start,
            new_end=input.slot_end,
            actor_user_id=ctx.user_id,
            integration=integration,
            reason=input.reason,
            idempotency_key=input.idempotency_key.strip(),
        )
    except InvalidTransition as exc:
        raise CapabilityValidationError(str(exc)) from exc
    return {
        "appointment_id": str(updated.id),
        "state": updated.state.value,
        "slot_start": updated.slot_start.isoformat(),
        "slot_end": updated.slot_end.isoformat(),
    }
