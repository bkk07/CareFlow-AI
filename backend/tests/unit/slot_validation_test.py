"""unit/slot_validation: only real, free, discrete slots can be booked."""

from datetime import datetime, timedelta

from tests.test_mcp_agent import seed_setup

MONDAY = "2026-10-05"
TUESDAY = "2026-10-06"


def iso(day, hour, minute=0):
    start = datetime.fromisoformat(f"{day}T{hour:02d}:{minute:02d}:00+00:00")
    return start.isoformat(), (start + timedelta(minutes=30)).isoformat()


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


def test_double_booking_same_slot_conflicts(client, ehr_stub):
    setup = seed_setup(client, tag="uvaldbl")
    start, end = iso(MONDAY, 9)
    assert book(client, setup, start, end, "uval-k1").status_code == 201
    clash = book(client, setup, start, end, "uval-k2")
    assert clash.status_code == 409, clash.text


def test_partial_overlap_is_not_a_discrete_slot(client, ehr_stub):
    setup = seed_setup(client, tag="uvaloverlap")
    start, end = iso(MONDAY, 9)
    assert book(client, setup, start, end, "uval-k1").status_code == 201
    shifted = (
        datetime.fromisoformat(start) + timedelta(minutes=15)
    ).isoformat(), (
        datetime.fromisoformat(end) + timedelta(minutes=15)
    ).isoformat()
    overlap = book(client, setup, shifted[0], shifted[1], "uval-k2")
    assert overlap.status_code == 409, overlap.text


def test_booking_outside_working_hours_rejected(client, ehr_stub):
    setup = seed_setup(client, tag="uvalhours")
    start, end = iso(TUESDAY, 9)
    resp = book(client, setup, start, end, "uval-k1")
    assert resp.status_code == 409, resp.text
