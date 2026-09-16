"""create_appointment — book through the full Phase 7/8 pipeline."""

import uuid
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment import service
from app.domain.appointment.models import AppointmentState
from app.domain.appointment.router import _resolve_booking_scope
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.errors import CapabilityAuthError
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "create_appointment"


class CreateAppointmentIn(BaseModel):
    doctor_id: uuid.UUID
    appointment_type_id: uuid.UUID
    slot_start: datetime
    slot_end: datetime
    idempotency_key: str
    patient_id: uuid.UUID | None = None


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=True,
    allowed_roles=[Role.patient, Role.hospital_admin],
)
def run(
    input: CreateAppointmentIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Book a slot; reports confirmed / parked / failed, never duplicates."""
    hospital, doctor = _resolve_booking_scope(db, ctx, input.doctor_id)
    patient_id = input.patient_id or ctx.user_id
    if ctx.role == Role.patient and patient_id != ctx.user_id:
        raise CapabilityAuthError("Patients can only book for themselves")
    patient = service.get_scoped_patient(db, patient_id)
    appt_type = service.get_scoped_type(db, hospital, input.appointment_type_id)
    appointment, created = service.create_appointment(
        db,
        hospital=hospital,
        patient=patient,
        doctor=doctor,
        appointment_type=appt_type,
        slot_start=input.slot_start,
        slot_end=input.slot_end,
        idempotency_key=input.idempotency_key.strip(),
        actor_user_id=ctx.user_id,
        correlation_id=ctx.correlation_id,
        integration=integration,
    )
    if appointment.state == AppointmentState.failed:
        outcome = "failed"
    elif appointment.state in (
        AppointmentState.sync_pending,
        AppointmentState.reconciliation_required,
    ):
        outcome = "parked"
    else:
        outcome = appointment.state.value
    return {
        "appointment_id": str(appointment.id),
        "state": appointment.state.value,
        "outcome": outcome,
        "created": created,
        "external_id": appointment.external_id,
    }
