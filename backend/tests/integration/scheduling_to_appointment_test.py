"""integration/scheduling_to_appointment: an open slot becomes a booking."""

import uuid

from app.domain.appointment.models import Appointment
from tests.test_mcp_agent import seed_setup, slot_iso


def test_open_slot_books_confirmed(client, db, ehr_stub):
    setup = seed_setup(client, tag="i2appt")
    slots = client.get(
        f"/hospitals/{setup['hosp']['id']}/doctors/{setup['doctor']['id']}/slots",
        params={
            "date_from": "2026-10-05",
            "date_to": "2026-10-05",
            "appointment_type_id": setup["type"]["id"],
        },
        headers=setup["hosp"]["owner"],
    ).json()
    assert slots, "seeded Monday rule must offer slots"

    start, end = slot_iso()
    resp = client.post(
        "/appointments",
        json={
            "patient_id": setup["patient"]["id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": "i2appt-k1",
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["state"] == "confirmed"
    appt = db.get(Appointment, uuid.UUID(resp.json()["id"]))
    assert appt is not None
    assert appt.external_id is not None
