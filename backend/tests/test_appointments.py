"""Appointment Core tests: booking flow, idempotency, state machine, gates."""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.db import get_db
from app.domain.appointment.models import Appointment, AppointmentHistory, AppointmentState
from app.domain.appointment.router import get_integration_service
from app.domain.appointment.state_machine import (
    ALLOWED_TRANSITIONS,
    InvalidTransition,
    transition,
)
from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.domain.hospital_config.models import AppointmentType
from app.integration.connector_interface import (
    EHRConnectorError,
    EHRNotFoundError,
    EHRValidationError,
    ExternalAppointment,
)
from app.integration.integration_service import IntegrationService
from app.main import app
from tests.conftest import approved_hospital

MONDAY = "2026-10-05"  # a Monday
TUESDAY = "2026-10-06"

assert date.fromisoformat(MONDAY).weekday() == 0


def slot_utc(day=MONDAY, hour=9, minutes=30):
    start = datetime.fromisoformat(f"{day}T{hour:02d}:00:00+00:00")
    return start, start + timedelta(minutes=minutes)


def iso(dt):
    return dt.isoformat()


class FakeConnector:
    """Deterministic stand-in for the vendor connector.

    Keeps vendor-side records so the trust-but-verify reads see what a
    real vendor would: creates/updates/cancels mutate the record, reads
    return it, unknown ids 404 like the vendor.
    """

    def __init__(self) -> None:
        self.fail_create = False
        self.fail_update = False
        self.fail_cancel = False
        self.fail_get = False
        self.create_error: type[EHRConnectorError] = EHRConnectorError
        self.creates = 0
        self._records: dict[str, dict] = {}

    def ensure_patient(self, **kwargs):
        return {"id": "ext-patient-1"}

    def ensure_provider(self, **kwargs):
        return {"id": "ext-provider-1"}

    def ensure_facility(self, **kwargs):
        return {"id": "ext-facility-1"}

    def create_appointment(self, request):
        if self.fail_create:
            raise self.create_error("vendor down")
        self.creates += 1
        external_id = f"vendor-{request.idempotency_key}"
        self._records[external_id] = {
            "status": "scheduled",
            "start": request.start,
            "end": request.end,
        }
        return ExternalAppointment(
            external_id=external_id,
            status="scheduled",
            start=request.start,
            end=request.end,
        )

    def update_appointment(self, external_id, request):
        if self.fail_update:
            raise EHRConnectorError("vendor down")
        record = self._records.get(external_id)
        if record is None:
            raise EHRNotFoundError("no such vendor record")
        record.update(
            {"status": "scheduled", "start": request.start, "end": request.end}
        )
        return ExternalAppointment(
            external_id=external_id,
            status="scheduled",
            start=request.start,
            end=request.end,
        )

    def cancel_appointment(self, external_id):
        if self.fail_cancel:
            raise EHRConnectorError("vendor down")
        record = self._records.get(external_id)
        if record is None:
            raise EHRNotFoundError("no such vendor record")
        record["status"] = "cancelled"
        return ExternalAppointment(
            external_id=external_id,
            status="cancelled",
            start=record["start"],
            end=record["end"],
        )

    def get_appointment(self, external_id):
        if self.fail_get:
            raise EHRConnectorError("vendor dark")
        record = self._records.get(external_id)
        if record is None:
            raise EHRNotFoundError("no such vendor record")
        return ExternalAppointment(
            external_id=external_id,
            status=record["status"],
            start=record["start"],
            end=record["end"],
        )

    def find_appointment_by_idempotency_key(self, idempotency_key):
        external_id = f"vendor-{idempotency_key}"
        record = self._records.get(external_id)
        if record is None:
            return None
        return ExternalAppointment(
            external_id=external_id,
            status=record["status"],
            start=record["start"],
            end=record["end"],
        )


@pytest.fixture()
def fake_connector():
    return FakeConnector()


@pytest.fixture()
def stub_integration(db, fake_connector):
    def _override():
        return IntegrationService(session=db, connector=fake_connector)

    app.dependency_overrides[get_integration_service] = _override
    yield fake_connector


def seed_setup(client, tag="appt"):
    """Approved hospital + care team + Monday rule + patient login."""
    hosp = approved_hospital(client, tag=tag)
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
    rule = client.post(
        f"/hospitals/{hid}/doctors/{doctor['id']}/availability-rules",
        json={
            "day_of_week": 0,
            "start_time": "09:00:00",
            "end_time": "17:00:00",
            "recurrence": "weekly",
        },
        headers=hosp["owner"],
    )
    assert rule.status_code == 201, rule.text
    email = f"patient-{tag}-{uuid.uuid4().hex[:6]}@example.com"
    assert (
        client.post(
            "/auth/register",
            json={"email": email, "password": "correct-horse-42", "role": "patient"},
        ).status_code
        == 201
    )
    tokens = client.post(
        "/auth/login", json={"email": email, "password": "correct-horse-42"}
    ).json()
    patient = {"Authorization": f"Bearer {tokens['access_token']}"}
    me = client.get("/auth/me", headers=patient).json()
    return {
        "hosp": hosp,
        "doctor": doctor,
        "appt_type": appt_type,
        "email": email,
        "patient": patient,
        "patient_id": me["id"],
    }


def book(client, headers, setup, start, end, key):
    return client.post(
        "/appointments",
        json={
            "patient_id": setup["patient_id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["appt_type"]["id"],
            "slot_start": iso(start),
            "slot_end": iso(end),
            "idempotency_key": key,
        },
        headers=headers,
    )


def available_starts(client, setup, day=MONDAY):
    resp = client.get(
        f"/hospitals/{setup['hosp']['id']}/doctors/{setup['doctor']['id']}/slots",
        params={
            "date_from": day,
            "date_to": day,
            "appointment_type_id": setup["appt_type"]["id"],
        },
        headers=setup["hosp"]["owner"],
    )
    assert resp.status_code == 200, resp.text
    return [s["start"] for s in resp.json()]


def history_pairs(client, headers, appointment_id):
    detail = client.get(f"/appointments/{appointment_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    return {
        (h["from_state"], h["to_state"]) for h in detail.json()["history"]
    }


# --- happy path --------------------------------------------------------------


def test_book_reschedule_cancel_happy_path(client, db, stub_integration):
    setup = seed_setup(client, "happy")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)

    created = book(client, owner, setup, start, end, "happy-k1")
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["state"] == "confirmed"
    assert body["external_id"] == "vendor-happy-k1"
    assert body["slot_start"].startswith("2026-10-05T09:00")
    assert history_pairs(client, owner, body["id"]) == {("pending", "confirmed")}
    assert "2026-10-05T09:00:00Z" not in available_starts(client, setup)

    new_start, new_end = slot_utc(hour=10)
    moved = client.post(
        f"/appointments/{body['id']}/reschedule",
        json={"slot_start": iso(new_start), "slot_end": iso(new_end)},
        headers=owner,
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["state"] == "rescheduled"
    assert moved.json()["slot_start"].startswith("2026-10-05T10:00")
    assert history_pairs(client, owner, body["id"]) == {
        ("pending", "confirmed"),
        ("confirmed", "rescheduled"),
    }
    # Old slot released, new slot held.
    starts = available_starts(client, setup)
    assert "2026-10-05T09:00:00Z" in starts
    assert "2026-10-05T10:00:00Z" not in starts

    cancelled = client.post(
        f"/appointments/{body['id']}/cancel", json={}, headers=owner
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["state"] == "cancelled"
    assert "2026-10-05T10:00:00Z" in available_starts(client, setup)

    # A fresh booking can reuse the freed slot.
    again = book(client, owner, setup, new_start, new_end, "happy-k2")
    assert again.status_code == 201, again.text


def test_duplicate_idempotency_key_returns_same_appointment(
    client, db, stub_integration, fake_connector
):
    setup = seed_setup(client, "idem")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)

    first = book(client, owner, setup, start, end, "idem-k1")
    assert first.status_code == 201, first.text
    # Even a conflicting payload with the same key replays, never duplicates.
    other_start, other_end = slot_utc(hour=11)
    replay = book(client, owner, setup, other_start, other_end, "idem-k1")
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] == first.json()["id"]
    assert replay.json()["slot_start"].startswith("2026-10-05T09:00")
    assert fake_connector.creates == 1
    count = (
        db.query(Appointment)
        .filter(Appointment.idempotency_key == "idem-k1")
        .count()
    )
    assert count == 1


def test_double_booking_same_slot_conflicts(client, db, stub_integration):
    setup = seed_setup(client, "dbl")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)

    assert book(client, owner, setup, start, end, "dbl-k1").status_code == 201
    clash = book(client, owner, setup, start, end, "dbl-k2")
    assert clash.status_code == 409, clash.text
    # Partial overlaps are not discrete slots either.
    overlap = book(
        client,
        owner,
        setup,
        start + timedelta(minutes=15),
        end + timedelta(minutes=15),
        "dbl-k3",
    )
    assert overlap.status_code == 409, overlap.text


def test_booking_outside_working_hours_rejected(client, db, stub_integration):
    setup = seed_setup(client, "hours")
    start, end = slot_utc(day=TUESDAY, hour=9)
    resp = book(client, setup["hosp"]["owner"], setup, start, end, "hours-k1")
    assert resp.status_code == 409, resp.text


# --- failure paths -----------------------------------------------------------


def test_vendor_validation_failure_marks_failed_and_frees_slot(
    client, db, stub_integration, fake_connector
):
    """A definitive vendor rejection fails fast: no retry, slot freed."""
    setup = seed_setup(client, "fail")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)

    fake_connector.fail_create = True
    fake_connector.create_error = EHRValidationError
    resp = book(client, owner, setup, start, end, "fail-k1")
    assert resp.status_code == 502, resp.text
    appointment_id = resp.json()["detail"]["appointment_id"]

    detail = client.get(f"/appointments/{appointment_id}", headers=owner)
    assert detail.json()["state"] == "failed"
    assert history_pairs(client, owner, appointment_id) == {("pending", "failed")}
    assert fake_connector.creates == 0
    # The held slot is released — the day's schedule is whole again.
    assert "2026-10-05T09:00:00Z" in available_starts(client, setup)

    fake_connector.fail_create = False
    retry = book(client, owner, setup, start, end, "fail-k2")
    assert retry.status_code == 201, retry.text


def test_failed_reschedule_keeps_original_booking(
    client, db, stub_integration, fake_connector
):
    setup = seed_setup(client, "rsfail")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)
    created = book(client, owner, setup, start, end, "rsfail-k1")
    appointment_id = created.json()["id"]

    fake_connector.fail_update = True
    new_start, new_end = slot_utc(hour=10)
    resp = client.post(
        f"/appointments/{appointment_id}/reschedule",
        json={"slot_start": iso(new_start), "slot_end": iso(new_end)},
        headers=owner,
    )
    # The vendor never moved: no 502, the original booking stands.
    assert resp.status_code == 200, resp.text

    detail = client.get(f"/appointments/{appointment_id}", headers=owner).json()
    assert detail["state"] == "confirmed"
    assert detail["slot_start"].startswith("2026-10-05T09:00")
    assert history_pairs(client, owner, appointment_id) == {("pending", "confirmed")}
    # Old slot still held, new slot attempt left nothing behind.
    starts = available_starts(client, setup)
    assert "2026-10-05T09:00:00Z" not in starts
    assert "2026-10-05T10:00:00Z" in starts


def test_terminal_states_reject_further_transitions(client, db, stub_integration):
    setup = seed_setup(client, "term")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)
    created = book(client, owner, setup, start, end, "term-k1")
    appointment_id = created.json()["id"]

    assert (
        client.post(f"/appointments/{appointment_id}/cancel", json={}, headers=owner)
    ).status_code == 200
    again = client.post(
        f"/appointments/{appointment_id}/cancel", json={}, headers=owner
    )
    assert again.status_code == 422, again.text
    new_start, new_end = slot_utc(hour=10)
    moved = client.post(
        f"/appointments/{appointment_id}/reschedule",
        json={"slot_start": iso(new_start), "slot_end": iso(new_end)},
        headers=owner,
    )
    assert moved.status_code == 422, moved.text


def test_state_machine_rejects_invalid_transitions(db):
    assert set(ALLOWED_TRANSITIONS) == set(AppointmentState)
    appointment = Appointment(
        hospital_id=uuid.uuid4(),
        patient_id=uuid.uuid4(),
        doctor_id=uuid.uuid4(),
        appointment_type_id=uuid.uuid4(),
        slot_start=datetime(2026, 10, 5, 9, 0, tzinfo=timezone.utc),
        slot_end=datetime(2026, 10, 5, 9, 30, tzinfo=timezone.utc),
        state=AppointmentState.confirmed,
        idempotency_key=f"sm-{uuid.uuid4().hex}",
        correlation_id=uuid.uuid4(),
    )
    db.add(appointment)
    db.commit()
    with pytest.raises(InvalidTransition):
        transition(db, appointment, AppointmentState.pending, actor_system="test")
    with pytest.raises(InvalidTransition):
        transition(db, appointment, "not-a-state", actor_system="test")
    with pytest.raises(ValueError):
        transition(db, appointment, AppointmentState.cancelled)
    assert (
        db.query(AppointmentHistory)
        .filter(AppointmentHistory.appointment_id == appointment.id)
        .count()
        == 0
    )
    transition(
        db, appointment, AppointmentState.cancelled, actor_system="test", reason="r"
    )
    db.commit()
    assert appointment.state == AppointmentState.cancelled
    rows = (
        db.query(AppointmentHistory)
        .filter(AppointmentHistory.appointment_id == appointment.id)
        .all()
    )
    assert len(rows) == 1
    assert (rows[0].from_state, rows[0].to_state) == (
        AppointmentState.confirmed,
        AppointmentState.cancelled,
    )


# --- access control ----------------------------------------------------------


def test_patient_books_self_only_and_sees_only_own(client, db, stub_integration):
    setup = seed_setup(client, "pat")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)

    mine = book(client, setup["patient"], setup, start, end, "pat-k1")
    assert mine.status_code == 201, mine.text

    other_start, other_end = slot_utc(hour=10)
    forged = client.post(
        "/appointments",
        json={
            "patient_id": str(uuid.uuid4()),
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["appt_type"]["id"],
            "slot_start": iso(other_start),
            "slot_end": iso(other_end),
            "idempotency_key": "pat-k2",
        },
        headers=setup["patient"],
    )
    assert forged.status_code == 403, forged.text

    listing = client.get("/appointments", headers=setup["patient"])
    assert listing.status_code == 200
    assert [a["id"] for a in listing.json()] == [mine.json()["id"]]
    snooping = client.get(
        "/appointments", params={"patient_id": str(uuid.uuid4())},
        headers=setup["patient"],
    )
    assert snooping.status_code == 403, snooping.text

    # The admin sees every appointment at their hospital.
    admin_listing = client.get("/appointments", headers=owner)
    assert admin_listing.status_code == 200
    assert len(admin_listing.json()) == 1


def test_cross_hospital_booking_forbidden(client, db, stub_integration):
    first = seed_setup(client, "xa")
    second = seed_setup(client, "xb")
    start, end = slot_utc(hour=9)
    resp = client.post(
        "/appointments",
        json={
            "patient_id": second["patient_id"],
            "doctor_id": first["doctor"]["id"],
            "appointment_type_id": first["appt_type"]["id"],
            "slot_start": iso(start),
            "slot_end": iso(end),
            "idempotency_key": "xa-k1",
        },
        headers=second["hosp"]["owner"],
    )
    assert resp.status_code == 403, resp.text


def test_suspended_hospital_blocks_new_bookings_but_not_cancels(
    client, db, stub_integration
):
    setup = seed_setup(client, "susp")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)
    created = book(client, owner, setup, start, end, "susp-k1")
    assert created.status_code == 201, created.text

    suspended = client.post(
        f"/platform/hospitals/{setup['hosp']['id']}/suspend",
        headers=setup["hosp"]["platform"],
    )
    assert suspended.status_code == 200, suspended.text

    other_start, other_end = slot_utc(hour=10)
    blocked = book(client, owner, setup, other_start, other_end, "susp-k2")
    assert blocked.status_code == 403, blocked.text
    moved = client.post(
        f"/appointments/{created.json()['id']}/reschedule",
        json={"slot_start": iso(other_start), "slot_end": iso(other_end)},
        headers=owner,
    )
    assert moved.status_code == 403, moved.text
    # Tearing down still works while suspended.
    cancelled = client.post(
        f"/appointments/{created.json()['id']}/cancel", json={}, headers=owner
    )
    assert cancelled.status_code == 200, cancelled.text


def test_unauthenticated_booking_rejected(client, db, stub_integration):
    setup = seed_setup(client, "anon")
    start, end = slot_utc(hour=9)
    resp = client.post(
        "/appointments",
        json={
            "patient_id": setup["patient_id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["appt_type"]["id"],
            "slot_start": iso(start),
            "slot_end": iso(end),
            "idempotency_key": "anon-k1",
        },
    )
    assert resp.status_code == 401, resp.text


# --- vendor round-trip (real mock EHR, service-level) ------------------------


def seed_rows(client, db, tag):
    from app.integration.mock_ehr.transport import TestClientVendorTransport
    from app.integration.mock_ehr.connector import MockEHRConnector

    setup = seed_setup(client, tag)
    hospital = db.query(Hospital).filter(Hospital.id == uuid.UUID(setup["hosp"]["id"])).one()
    patient = db.query(User).filter(User.email == setup["email"]).one()
    admin = (
        db.query(User)
        .filter(User.email == setup["hosp"]["admin_email"])
        .one()
    )
    doctor = db.query(Doctor).filter(Doctor.id == uuid.UUID(setup["doctor"]["id"])).one()
    appt_type = (
        db.query(AppointmentType)
        .filter(AppointmentType.id == uuid.UUID(setup["appt_type"]["id"]))
        .one()
    )
    connector = MockEHRConnector(transport=TestClientVendorTransport(client))
    integration = IntegrationService(session=db, connector=connector)
    return setup, hospital, patient, admin, doctor, appt_type, integration


def test_db_state_matches_vendor_state(client, db):
    from app.domain.appointment import service as appt_service

    client.post("/mock-ehr/_debug/fault-mode", json={"mode": "none"})
    try:
        setup, hospital, patient, admin, doctor, appt_type, integration = seed_rows(
            client, db, "roundtrip"
        )
        start, end = slot_utc(hour=9)
        appointment, created = appt_service.create_appointment(
            db,
            hospital=hospital,
            patient=patient,
            doctor=doctor,
            appointment_type=appt_type,
            slot_start=start,
            slot_end=end,
            idempotency_key="vendor-k1",
            actor_user_id=admin.id,
            integration=integration,
        )
        assert created and appointment.state == AppointmentState.confirmed

        vendor = integration.get_appointment(appointment.external_id)
        assert vendor.start == start
        assert vendor.end == end

        new_start, new_end = slot_utc(hour=10)
        moved = appt_service.reschedule_appointment(
            db,
            appointment=appointment,
            hospital=hospital,
            new_start=new_start,
            new_end=new_end,
            actor_user_id=admin.id,
            integration=integration,
        )
        assert moved.state == AppointmentState.rescheduled
        vendor_moved = integration.get_appointment(appointment.external_id)
        assert vendor_moved.start == new_start

        done = appt_service.cancel_appointment(
            db, appointment=moved, actor_user_id=admin.id, integration=integration
        )
        assert done.state == AppointmentState.cancelled
        assert integration.get_appointment(appointment.external_id).status == "cancelled"
    finally:
        client.post("/mock-ehr/_debug/fault-mode", json={"mode": "none"})
