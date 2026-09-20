"""get_day_schedule — a doctor's working day for the patient timeline UI.

Returns merged working windows plus anonymized busy intervals (admin
blocks + live bookings, start/end only — never patient details) for one
calendar date, so the patient app can render the day as a single timeline
with taken periods as colored blocks and let the patient pick any free
start time. The booking API still re-validates the exact range server-side.
"""

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
from app.mcp_server.tools import _time as time_fmt
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "get_day_schedule"


class GetDayScheduleIn(BaseModel):
    doctor_id: uuid.UUID
    date: date


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: GetDayScheduleIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Working hours + anonymous busy blocks for one doctor-day.

    Windows carry ready-made IST display strings: reason about AND speak
    those, never the raw UTC ISO ("03:30+00:00" is 9:00 AM IST, not
    3:30 AM).
    """
    del ctx, integration
    doctor = db.get(Doctor, input.doctor_id)
    if doctor is None:
        raise CapabilityValidationError("Doctor not found")
    if doctor.status != DoctorStatus.active:
        raise CapabilityValidationError("Doctor is not currently seeing patients")
    hospital = get_hospital_or_404(db, doctor.hospital_id)
    assert_hospital_approved(hospital)
    windows, busy = scheduling_service.get_day_schedule(
        db,
        doctor.id,
        input.date,
        booked=appointment_service.live_intervals_for_doctor(db, doctor.id),
    )
    return {
        "doctor_id": str(doctor.id),
        "date": input.date.isoformat(),
        "working_hours": [
            {
                "start": w.start.isoformat(),
                "end": w.end.isoformat(),
                "start_ist": time_fmt.ist_time_label(w.start.isoformat()),
                "end_ist": time_fmt.ist_time_label(w.end.isoformat()),
            }
            for w in windows
        ],
        "busy": [
            {
                "start": b.start.isoformat(),
                "end": b.end.isoformat(),
                "start_ist": time_fmt.ist_time_label(b.start.isoformat()),
                "end_ist": time_fmt.ist_time_label(b.end.isoformat()),
            }
            for b in busy
        ],
    }
