"""Regression: a confirmed (live) booking blocks its slot.

Listing must hide the taken slot and re-booking the exact slot must be
rejected with 409 — on both the admin slots endpoint and the booking API.
"""

from tests.conftest import approved_hospital
from tests.test_scheduling import active_doctor, get_slots

MONDAY = "2026-09-14"

PASSWORD = "correct-horse-42"


def _patient_headers(client, tag="dblbook"):
    email = f"{tag}@example.com"
    reg = client.post(
        "/auth/register",
        json={"email": email, "password": PASSWORD, "role": "patient"},
    )
    assert reg.status_code == 201, reg.text
    tokens = client.post(
        "/auth/login", json={"email": email, "password": PASSWORD}
    ).json()
    return reg.json()["id"], {"Authorization": f"Bearer {tokens['access_token']}"}


def test_confirmed_booking_blocks_slot_from_listing_and_rebooking(client):
    hosp = approved_hospital(client, tag="dblbook")
    doctor, appt_type = active_doctor(client, hosp, tag="dblbook")
    rule = client.post(
        f"/hospitals/{hosp['id']}/doctors/{doctor['id']}/availability-rules",
        json={
            "day_of_week": 0,
            "start_time": "09:00:00",
            "end_time": "17:00:00",
            "recurrence": "weekly",
        },
        headers=hosp["owner"],
    )
    assert rule.status_code == 201, rule.text
    patient_id, ph = _patient_headers(client)

    before = get_slots(client, hosp, doctor["id"], appt_type["id"]).json()
    assert len(before) > 0
    slot = before[0]

    book = client.post(
        "/appointments",
        json={
            "patient_id": patient_id,
            "doctor_id": doctor["id"],
            "appointment_type_id": appt_type["id"],
            "slot_start": slot["start"],
            "slot_end": slot["end"],
            "idempotency_key": "dbl-1",
        },
        headers=ph,
    )
    assert book.status_code in (201, 202), book.text
    # Both outcomes still hold the slot (confirmed / reconciliation_required
    # are live states; without the stub vendor it may park).
    assert book.json()["state"] in (
        "confirmed",
        "pending",
        "sync_pending",
        "reconciliation_required",
        "requested",
        "rescheduled",
    )

    after = get_slots(client, hosp, doctor["id"], appt_type["id"]).json()
    assert slot["start"] not in [s["start"] for s in after]

    again = client.post(
        "/appointments",
        json={
            "patient_id": patient_id,
            "doctor_id": doctor["id"],
            "appointment_type_id": appt_type["id"],
            "slot_start": slot["start"],
            "slot_end": slot["end"],
            "idempotency_key": "dbl-2",
        },
        headers=ph,
    )
    assert again.status_code == 409, again.text
