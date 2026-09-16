"""integration/workflow_to_notification: the handler confirms, exactly once."""

import uuid

from app.domain.appointment.models import Appointment
from app.notification.models import Notification
from app.workflow.models import WorkflowExecution
from app.workflow.tasks._base import HANDLERS
from tests.test_mcp_agent import seed_setup, slot_iso


def test_booked_handler_notifies_with_execution_correlation(client, db, ehr_stub):
    setup = seed_setup(client, tag="i2notif")
    start, end = slot_iso()
    resp = client.post(
        "/appointments",
        json={
            "patient_id": setup["patient"]["id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": "i2notif-k1",
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    appt = db.get(Appointment, uuid.UUID(resp.json()["id"]))
    execution = (
        db.query(WorkflowExecution)
        .filter(WorkflowExecution.event_type == "appointment.booked")
        .one()
    )
    handler = HANDLERS["appointment.booked"]

    handler(db, execution, {"appointment_id": str(appt.id)})
    row = (
        db.query(Notification)
        .filter(Notification.dedupe_key == f"booked:{appt.id}:in_app")
        .one()
    )
    assert row.type == "booking_confirmation"
    assert row.status.value == "sent"
    assert row.correlation_id == execution.correlation_id

    # Redelivery is a no-op: the handler stays idempotent.
    handler(db, execution, {"appointment_id": str(appt.id)})
    assert (
        db.query(Notification)
        .filter(Notification.dedupe_key == f"booked:{appt.id}:in_app")
        .count()
        == 1
    )
