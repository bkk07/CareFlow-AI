"""check_availability — real open slots for a doctor + appointment type."""

import uuid
from datetime import date

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment import service as appointment_service
from app.domain.auth.models import Role
from app.domain.doctor.models import Doctor, DoctorStatus
from app.domain.hospital.service import assert_hospital_approved, get_hospital_or_404
from app.domain.scheduling import service as scheduling_service
from app.integration.integration_service import IntegrationService
from app.mcp_server.errors import CapabilityValidationError
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "check_availability"


class CheckAvailabilityIn(BaseModel):
    doctor_id: uuid.UUID
    appointment_type_id: uuid.UUID
    date_from: date
    date_to: date


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: CheckAvailabilityIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Compute bookable slots (rules minus blocks minus live bookings)."""
    del ctx, integration
    doctor = db.get(Doctor, input.doctor_id)
    if doctor is None:
        raise CapabilityValidationError("Doctor not found")
    if doctor.status != DoctorStatus.active:
        raise CapabilityValidationError("Doctor is not currently seeing patients")
    hospital = get_hospital_or_404(db, doctor.hospital_id)
    assert_hospital_approved(hospital)
    appt_type = appointment_service.get_scoped_type(
        db, hospital, input.appointment_type_id
    )
    offered = list(doctor.available_durations or [])
    if offered and appt_type.duration_minutes not in offered:
        raise CapabilityValidationError(
            f"Doctor does not offer {appt_type.duration_minutes}-minute visits"
        )
    calendar = scheduling_service.get_or_create_calendar(db, doctor.id)
    if not calendar.is_active:
        raise CapabilityValidationError(
            "Doctor is not currently accepting appointments (calendar paused)"
        )
    windows = scheduling_service.get_available_slots(
        doctor.id,
        appt_type.id,
        input.date_from,
        input.date_to,
        db,
        booked=appointment_service.live_intervals_for_doctor(db, doctor.id),
    )
    return {
        "doctor_id": str(doctor.id),
        "slots": [
            {"start": w.start.isoformat(), "end": w.end.isoformat()} for w in windows
        ],
    }
