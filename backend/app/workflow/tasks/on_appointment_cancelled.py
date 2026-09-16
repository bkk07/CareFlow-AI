"""on_appointment_cancelled — tell the patient their booking ended."""

import uuid

from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment
from app.notification.service import create_in_app
from app.workflow.models import WorkflowExecution
from app.workflow.tasks._base import handler, note


@handler("appointment.cancelled")
def on_appointment_cancelled(
    session: Session, execution: WorkflowExecution, payload: dict
) -> None:
    appointment = session.get(Appointment, uuid.UUID(str(payload["appointment_id"])))
    if appointment is None:
        note(execution, "appointment gone; nothing to notify")
        return
    row, created = create_in_app(
        session,
        recipient_user_id=appointment.patient_id,
        type="cancellation",
        detail="Your appointment has been cancelled. Reply to rebook.",
        dedupe_key=f"cancelled:{appointment.id}:in_app",
        correlation_id=execution.correlation_id,
    )
    note(
        execution,
        f"in-app cancellation {'created' if created else 'already sent'} "
        f"(notification {row.id})",
    )
