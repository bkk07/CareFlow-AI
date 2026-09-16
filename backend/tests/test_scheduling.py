"""Scheduling API + service tests, including the reservation race."""

import threading
import uuid
from datetime import date, datetime, time, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.domain.doctor.models import Doctor, DoctorStatus
from app.domain.scheduling import service
from app.domain.scheduling.models import BlockedReason, BlockedSlot
from tests.conftest import approved_hospital

MONDAY = "2026-09-14"  # a Monday
TUESDAY = "2026-09-15"

assert date.fromisoformat(MONDAY).weekday() == 0


def active_doctor(client, hosp, tag="sched"):
    """Seed specialty + department + universal type, create and activate."""
    hid = hosp["id"]
    spec = client.post(
        f"/hospitals/{hid}/specialties",
        json={"name": f"Cardiology {tag}"},
        headers=hosp["owner"],
    ).json()
    dept = client.post(
        f"/hospitals/{hid}/departments",
        json={"name": f"Heart {tag}"},
        headers=hosp["owner"],
    ).json()
    appt_type = client.post(
        f"/hospitals/{hid}/appointment-types",
        json={"name": f"Consult {tag}", "duration_minutes": 30},
        headers=hosp["owner"],
    ).json()
    doctor = client.post(
        f"/hospitals/{hid}/doctors",
        json={
            "name": f"Dr. {tag}",
            "specialty_id": spec["id"],
            "department_id": dept["id"],
        },
        headers=hosp["owner"],
    ).json()
    activated = client.post(
        f"/hospitals/{hid}/doctors/{doctor['id']}/activate",
        headers=hosp["owner"],
    )
    assert activated.status_code == 200, activated.text
    return doctor, appt_type


def get_slots(client, hosp, doctor_id, type_id, day_from=MONDAY, day_to=None):
    params = {
        "date_from": day_from,
        "date_to": day_to or day_from,
        "appointment_type_id": type_id,
    }
    return client.get(
        f"/hospitals/{hosp['id']}/doctors/{doctor_id}/slots",
        params=params,
        headers=hosp["owner"],
    )


def test_no_rules_means_no_slots(client):
    hosp = approved_hospital(client, tag="norules")
    hid = hosp["id"]
    spec = client.post(
        f"/hospitals/{hid}/specialties",
        json={"name": "Cardiology"},
        headers=hosp["owner"],
    ).json()
    dept = client.post(
        f"/hospitals/{hid}/departments",
        json={"name": "Heart"},
        headers=hosp["owner"],
    ).json()
    appt_type = client.post(
        f"/hospitals/{hid}/appointment-types",
        json={"name": "Consult", "duration_minutes": 30},
        headers=hosp["owner"],
    ).json()
    doctor = client.post(
        f"/hospitals/{hid}/doctors",
        json={
            "name": "Dr. No Hours",
            "specialty_id": spec["id"],
            "department_id": dept["id"],
        },
        headers=hosp["owner"],
    ).json()
    client.post(
        f"/hospitals/{hid}/doctors/{doctor['id']}/activate",
        headers=hosp["owner"],
    )
    resp = get_slots(client, hosp, doctor["id"], appt_type["id"])
    assert resp.status_code == 200
    assert resp.json() == []


def test_weekly_rule_yields_expected_slots(client):
    hosp = approved_hospital(client, tag="weekly")
    doctor, appt_type = active_doctor(client, hosp, tag="weekly")
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

    monday = get_slots(client, hosp, doctor["id"], appt_type["id"])
    assert monday.status_code == 200
    slots = monday.json()
    assert len(slots) == 16  # 8h × 30min
    assert slots[0]["start"] == "2026-09-14T09:00:00Z"
    assert slots[-1]["end"] == "2026-09-14T17:00:00Z"

    tuesday = get_slots(
        client, hosp, doctor["id"], appt_type["id"],
        day_from=TUESDAY, day_to=TUESDAY,
    )
    assert tuesday.json() == []


def test_blocked_slot_subtraction_and_naive_rejected(client):
    hosp = approved_hospital(client, tag="blocked")
    doctor, appt_type = active_doctor(client, hosp, tag="blocked")
    did = doctor["id"]
    client.post(
        f"/hospitals/{hosp['id']}/doctors/{did}/availability-rules",
        json={
            "day_of_week": 0,
            "start_time": "09:00:00",
            "end_time": "12:00:00",
            "recurrence": "weekly",
        },
        headers=hosp["owner"],
    )
    before = get_slots(client, hosp, did, appt_type["id"]).json()
    assert len(before) == 6

    # Naive datetimes are rejected: UTC must be explicit.
    naive = client.post(
        f"/hospitals/{hosp['id']}/doctors/{did}/blocked-slots",
        json={
            "start_datetime": "2026-09-14T10:00:00",
            "end_datetime": "2026-09-14T11:00:00",
        },
        headers=hosp["owner"],
    )
    assert naive.status_code == 422

    block = client.post(
        f"/hospitals/{hosp['id']}/doctors/{did}/blocked-slots",
        json={
            "start_datetime": "2026-09-14T10:00:00Z",
            "end_datetime": "2026-09-14T11:00:00Z",
            "reason": "leave",
        },
        headers=hosp["owner"],
    )
    assert block.status_code == 201, block.text
    after = get_slots(client, hosp, did, appt_type["id"]).json()
    assert len(after) == 4
    assert all(
        s["end"] <= "2026-09-14T10:00:00Z"
        or s["start"] >= "2026-09-14T11:00:00Z"
        for s in after
    )

    listed = client.get(
        f"/hospitals/{hosp['id']}/doctors/{did}/blocked-slots",
        headers=hosp["owner"],
    ).json()
    assert len(listed) == 1
    assert (
        client.delete(
            f"/hospitals/{hosp['id']}/doctors/{did}/blocked-slots/{listed[0]['id']}",
            headers=hosp["owner"],
        ).status_code
        == 204
    )
    assert len(get_slots(client, hosp, did, appt_type["id"]).json()) == 6


def test_rule_validation(client):
    hosp = approved_hospital(client, tag="ruleval")
    doctor, _ = active_doctor(client, hosp, tag="ruleval")
    base = f"/hospitals/{hosp['id']}/doctors/{doctor['id']}/availability-rules"

    inverted = client.post(
        base,
        json={
            "day_of_week": 0,
            "start_time": "17:00:00",
            "end_time": "09:00:00",
            "recurrence": "weekly",
        },
        headers=hosp["owner"],
    )
    assert inverted.status_code == 422

    missing_dow = client.post(
        base,
        json={"start_time": "09:00:00", "end_time": "17:00:00"},
        headers=hosp["owner"],
    )
    assert missing_dow.status_code == 422

    bad_dow = client.post(
        base,
        json={
            "day_of_week": 7,
            "start_time": "09:00:00",
            "end_time": "17:00:00",
        },
        headers=hosp["owner"],
    )
    assert bad_dow.status_code == 422


def test_changing_working_hours_updates_slots(client):
    hosp = approved_hospital(client, tag="hours")
    doctor, appt_type = active_doctor(client, hosp, tag="hours")
    base = f"/hospitals/{hosp['id']}/doctors/{doctor['id']}/availability-rules"

    rule = client.post(
        base,
        json={
            "day_of_week": 0,
            "start_time": "09:00:00",
            "end_time": "17:00:00",
            "recurrence": "weekly",
        },
        headers=hosp["owner"],
    ).json()
    assert len(get_slots(client, hosp, doctor["id"], appt_type["id"]).json()) == 16

    assert (
        client.delete(f"{base}/{rule['id']}", headers=hosp["owner"]).status_code
        == 204
    )
    client.post(
        base,
        json={
            "day_of_week": 0,
            "start_time": "10:00:00",
            "end_time": "12:00:00",
            "recurrence": "weekly",
        },
        headers=hosp["owner"],
    )
    slots = get_slots(client, hosp, doctor["id"], appt_type["id"]).json()
    assert len(slots) == 4
    assert slots[0]["start"] == "2026-09-14T10:00:00Z"


def test_inactive_calendar_and_doctor_yield_no_slots(client):
    hosp = approved_hospital(client, tag="inactive")
    doctor, appt_type = active_doctor(client, hosp, tag="inactive")
    did = doctor["id"]
    client.post(
        f"/hospitals/{hosp['id']}/doctors/{did}/availability-rules",
        json={
            "day_of_week": 0,
            "start_time": "09:00:00",
            "end_time": "12:00:00",
            "recurrence": "weekly",
        },
        headers=hosp["owner"],
    )
    assert len(get_slots(client, hosp, did, appt_type["id"]).json()) == 6

    cal = client.put(
        f"/hospitals/{hosp['id']}/doctors/{did}/calendar",
        json={"is_active": False},
        headers=hosp["owner"],
    )
    assert cal.status_code == 200
    assert get_slots(client, hosp, did, appt_type["id"]).json() == []
    client.put(
        f"/hospitals/{hosp['id']}/doctors/{did}/calendar",
        json={"is_active": True},
        headers=hosp["owner"],
    )

    client.post(
        f"/hospitals/{hosp['id']}/doctors/{did}/deactivate",
        headers=hosp["owner"],
    )
    assert get_slots(client, hosp, did, appt_type["id"]).json() == []


def test_slots_reject_bad_range_and_foreign_type(client):
    hosp_a = approved_hospital(client, tag="rangea")
    hosp_b = approved_hospital(client, tag="rangeb")
    doctor_a, type_a = active_doctor(client, hosp_a, tag="rangea")
    _, type_b = active_doctor(client, hosp_b, tag="rangeb")

    bad_order = get_slots(
        client, hosp_a, doctor_a["id"], type_a["id"],
        day_from="2026-09-15", day_to="2026-09-14",
    )
    assert bad_order.status_code == 422

    huge = get_slots(
        client, hosp_a, doctor_a["id"], type_a["id"],
        day_from="2026-01-01", day_to="2026-12-31",
    )
    assert huge.status_code == 422

    # An appointment type from another hospital reads as not found.
    foreign = get_slots(client, hosp_a, doctor_a["id"], type_b["id"])
    assert foreign.status_code == 404


def _race_db(tmp_path):
    """Independent file DB so racing threads never share a connection."""
    path = tmp_path / "race.db"
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = factory()
    doctor = Doctor(
        hospital_id=uuid.uuid4(),
        name="Dr. Race",
        status=DoctorStatus.active,
    )
    session.add(doctor)
    session.commit()
    doctor_id = doctor.id
    session.close()
    return engine, factory, doctor_id


def test_concurrent_reservation_has_exactly_one_winner(tmp_path):
    engine, factory, doctor_id = _race_db(tmp_path)
    try:
        # Each round races for a fresh slot so rounds never interfere.
        for round_index in range(3):
            hour = 10 + round_index
            start = datetime(2026, 9, 14, hour, 0, tzinfo=timezone.utc)
            end = datetime(2026, 9, 14, hour, 30, tzinfo=timezone.utc)
            barrier = threading.Barrier(2)
            outcomes: list[str] = []

            def attempt():
                session = factory()
                try:
                    barrier.wait(timeout=10)
                    service.reserve_slot(session, doctor_id, start, end)
                    outcomes.append("won")
                except service.SlotConflictError:
                    outcomes.append("lost")
                finally:
                    session.close()

            threads = [threading.Thread(target=attempt) for _ in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)
            assert sorted(outcomes) == ["lost", "won"]
    finally:
        engine.dispose()


def test_reserve_rejects_overlapping_and_inverted(tmp_path):
    engine, factory, doctor_id = _race_db(tmp_path)
    try:
        session = factory()
        try:
            service.reserve_slot(
                session,
                doctor_id,
                datetime(2026, 9, 14, 10, 0, tzinfo=timezone.utc),
                datetime(2026, 9, 14, 10, 30, tzinfo=timezone.utc),
                BlockedReason.appointment,
            )
            with pytest.raises(service.SlotConflictError):
                service.reserve_slot(
                    session,
                    doctor_id,
                    datetime(2026, 9, 14, 10, 15, tzinfo=timezone.utc),
                    datetime(2026, 9, 14, 10, 45, tzinfo=timezone.utc),
                )
            with pytest.raises(service.SlotConflictError):
                service.reserve_slot(
                    session,
                    doctor_id,
                    datetime(2026, 9, 14, 10, 30, tzinfo=timezone.utc),
                    datetime(2026, 9, 14, 10, 0, tzinfo=timezone.utc),
                )
            # Touching boundaries do not overlap — reservable.
            service.reserve_slot(
                session,
                doctor_id,
                datetime(2026, 9, 14, 10, 30, tzinfo=timezone.utc),
                datetime(2026, 9, 14, 11, 0, tzinfo=timezone.utc),
            )
        finally:
            session.close()
    finally:
        engine.dispose()
