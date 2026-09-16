"""on_appointment_booked — confirm a fresh booking to the patient."""

import uuid

from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment
from app.notification.service import create_in_app
from app.workflow.models import WorkflowExecution
from app.workflow.tasks._base import handler, note


@handler("appointment.booked")
def on_appointment_booked(
    session: Session, execution: WorkflowExecution, payload: dict
) -> None:
    appointment = session.get(Appointment, uuid.UUID(str(payload["appointment_id"])))
    if appointment is None:
        note(execution, "appointment gone; nothing to notify")
        return
    slot = appointment.slot_start.isoformat()
    row, created = create_in_app(
        session,
        recipient_user_id=appointment.patient_id,
        type="booking_confirmation",
        detail=f"Your appointment is confirmed for {slot}.",
        dedupe_key=f"booked:{appointment.id}:in_app",
        correlation_id=execution.correlation_id,
    )
    note(
        execution,
        f"in-app confirmation {'created' if created else 'already sent'} "
        f"(notification {row.id})",
    )
