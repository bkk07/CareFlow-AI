"""send_reminder — hourly sweep for appointments ~24h out.

Beat publishes `reminder.sweep`; this handler notifies every live
booking whose slot starts in 23–25h and has no reminder yet. The
dedupe key makes overlapping sweeps and redeliveries harmless.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment, AppointmentState
from app.notification.service import create_in_app
from app.workflow.models import WorkflowExecution
from app.workflow.tasks._base import handler, note

REMIND_FROM_H = 23
REMIND_TO_H = 25


@handler("reminder.sweep")
def send_reminder(
    session: Session, execution: WorkflowExecution, payload: dict
) -> None:
    del payload
    now = datetime.now(timezone.utc)
    low, high = now + timedelta(hours=REMIND_FROM_H), now + timedelta(
        hours=REMIND_TO_H
    )
    upcoming = (
        session.query(Appointment)
        .filter(
            Appointment.state.in_(
                [AppointmentState.confirmed, AppointmentState.rescheduled]
            ),
            Appointment.slot_start >= low,
            Appointment.slot_start <= high,
        )
        .all()
    )
    sent = 0
    for appointment in upcoming:
        _, created = create_in_app(
            session,
            recipient_user_id=appointment.patient_id,
            type="reminder",
            detail=(
                "Reminder: your appointment is at "
                f"{appointment.slot_start.isoformat()}."
            ),
            dedupe_key=f"reminder:{appointment.id}:in_app",
            correlation_id=execution.correlation_id,
        )
        sent += 1 if created else 0
    note(execution, f"reminder sweep: {len(upcoming)} upcoming, {sent} sent")
