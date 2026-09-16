"""on_appointment_rescheduled — tell the patient their new slot."""

import uuid

from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment
from app.notification.service import create_in_app
from app.workflow.models import WorkflowExecution
from app.workflow.tasks._base import handler, note


@handler("appointment.rescheduled")
def on_appointment_rescheduled(
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
        type="reschedule",
        detail=f"Your appointment moved to {slot}.",
        dedupe_key=f"rescheduled:{appointment.id}:{slot}:in_app",
        correlation_id=execution.correlation_id,
    )
    note(
        execution,
        f"in-app move notice {'created' if created else 'already sent'} "
        f"(notification {row.id})",
    )
