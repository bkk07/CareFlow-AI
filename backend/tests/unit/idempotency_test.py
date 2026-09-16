"""unit/idempotency: replays return the same booking, never a second one."""

from app.domain.appointment.models import Appointment
from tests.test_mcp_agent import seed_setup, slot_iso


def book(client, setup, start, end, key):
    return client.post(
        "/appointments",
        json={
            "patient_id": setup["patient"]["id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": key,
        },
        headers=setup["patient"]["headers"],
    )


def test_replay_returns_same_appointment_without_duplicating(client, db, ehr_stub):
    setup = seed_setup(client, tag="uidem")
    start, end = slot_iso()
    first = book(client, setup, start, end, "uidem-k1")
    assert first.status_code == 201, first.text

    other_start, other_end = slot_iso(hour=11)
    replay = book(client, setup, other_start, other_end, "uidem-k1")
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] == first.json()["id"]
    assert replay.json()["slot_start"].startswith("2026-10-05T09:00")
    assert ehr_stub.creates == 1
    assert (
        db.query(Appointment)
        .filter(Appointment.idempotency_key == "uidem-k1")
        .count()
        == 1
    )
