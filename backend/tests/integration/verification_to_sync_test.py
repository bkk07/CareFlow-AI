"""integration/verification_to_sync: divergence is detected, live care untouched."""

from datetime import timedelta

from app.domain.appointment.models import Appointment, AppointmentState
from app.integration.connector_interface import ExternalAppointment
from app.integration.integration_service import IntegrationService
from app.reliability.synchronization.service import adopt_external, diff_appointment
from tests.test_mcp_agent import seed_setup, slot_iso
import uuid


def test_divergent_vendor_record_is_flagged_not_followed(client, db, ehr_stub):
    setup = seed_setup(client, tag="i2sync")
    start, end = slot_iso()
    resp = client.post(
        "/appointments",
        json={
            "patient_id": setup["patient"]["id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": "i2sync-k1",
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    appt = db.get(Appointment, uuid.UUID(resp.json()["id"]))
    assert appt.state == AppointmentState.confirmed

    moved_start = appt.slot_start + timedelta(hours=1)
    moved = ExternalAppointment(
        external_id=appt.external_id,
        status="scheduled",
        start=moved_start,
        end=moved_start + timedelta(minutes=30),
    )
    assert "slot_start" in diff_appointment(db, appt, moved)

    updated, mismatches = adopt_external(
        db, appt, moved, actor_user_id=uuid.UUID(setup["patient"]["id"])
    )
    db.commit()
    assert mismatches, "the vendor move must be reported"
    assert updated.state == AppointmentState.confirmed
    assert updated.slot_start == appt.slot_start
