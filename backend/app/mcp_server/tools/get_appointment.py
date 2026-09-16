"""get_appointment — read one booking within scope."""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment import service
from app.domain.appointment.models import AppointmentHistory
from app.domain.auth.models import Role
from app.domain.appointment.router import _check_appointment_access
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "get_appointment"


class GetAppointmentIn(BaseModel):
    appointment_id: uuid.UUID


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: GetAppointmentIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Return booking detail plus its state-transition history."""
    del integration
    appointment = service.get_appointment_or_404(db, input.appointment_id)
    _check_appointment_access(ctx, appointment)
    history = (
        db.query(AppointmentHistory)
        .filter(AppointmentHistory.appointment_id == appointment.id)
        .order_by(AppointmentHistory.created_at)
        .all()
    )
    return {
        "id": str(appointment.id),
        "hospital_id": str(appointment.hospital_id),
        "patient_id": str(appointment.patient_id),
        "doctor_id": str(appointment.doctor_id),
        "appointment_type_id": str(appointment.appointment_type_id),
        "slot_start": appointment.slot_start.isoformat(),
        "slot_end": appointment.slot_end.isoformat(),
        "state": appointment.state.value,
        "external_id": appointment.external_id,
        "idempotency_key": appointment.idempotency_key,
        "history": [
            {"from_state": h.from_state, "to_state": h.to_state, "reason": h.reason}
            for h in history
        ],
    }
