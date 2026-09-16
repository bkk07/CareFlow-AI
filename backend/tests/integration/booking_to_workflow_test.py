"""integration/booking_to_workflow: a confirmed booking notifies the engine."""

import uuid

from app.domain.appointment.models import Appointment
from app.workflow.models import WorkflowExecution
from tests.test_mcp_agent import seed_setup, slot_iso


def test_confirmed_booking_publishes_booked_event(client, db, ehr_stub):
    setup = seed_setup(client, tag="i2wf")
    start, end = slot_iso()
    resp = client.post(
        "/appointments",
        json={
            "patient_id": setup["patient"]["id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": "i2wf-k1",
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    appt = db.get(Appointment, uuid.UUID(resp.json()["id"]))

    rows = (
        db.query(WorkflowExecution)
        .filter(WorkflowExecution.event_type == "appointment.booked")
        .all()
    )
    assert len(rows) == 1
    assert rows[0].payload["appointment_id"] == str(appt.id)
    assert rows[0].correlation_id == appt.correlation_id
