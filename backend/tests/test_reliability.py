"""Reliability tests: classification, unknown-outcome recovery, ops queue.

Fault-mode tests run service-level (direct service calls with the
in-process vendor transport); endpoint tests use the stub connector.
Fault mode is process-global, so every fault test resets it.
"""

import uuid
from datetime import timedelta

import pytest

from app.domain.appointment.models import (
    Appointment,
    AppointmentHistory,
    AppointmentState,
)
from app.domain.appointment.router import get_integration_service
from app.domain.appointment.state_machine import InvalidTransition, transition
from app.domain.appointment import service as appt_service
from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.domain.hospital_config.models import AppointmentType
from app.integration.connector_interface import (
    EHRConnectorError,
    EHRNetworkError,
    EHRServerError,
    EHRTimeoutError,
    EHRValidationError,
    ExternalAppointment,
)
from app.integration.integration_service import IntegrationService
from app.main import app
from app.reliability.failure_classifier import (
    MAX_RETRIES,
    FailureClass,
    classify,
    retry_allowed,
    retry_delay_s,
)
from app.reliability.models import (
    IntegrationOperation,
    OperationType,
    ReconciliationRecord,
    ResolutionStatus,
)
from app.reliability.reconciliation import service as reconcile_service
from tests.test_appointments import (
    FakeConnector,
    available_starts,
    book,
    iso,
    seed_setup,
    slot_utc,
)


@pytest.fixture()
def fault_mode(client):
    yield
    client.post("/mock-ehr/_debug/fault-mode", json={"mode": "none"})


@pytest.fixture()
def stubbed(client, db):
    fake = FakeConnector()

    def _override():
        return IntegrationService(session=db, connector=fake)

    app.dependency_overrides[get_integration_service] = _override
    yield fake


def real_integration(client, db):
    from app.integration.mock_ehr.connector import MockEHRConnector
    from app.integration.mock_ehr.transport import TestClientVendorTransport

    return IntegrationService(
        session=db,
        connector=MockEHRConnector(transport=TestClientVendorTransport(client)),
    )


def seed_rows(client, db, tag):
    setup = seed_setup(client, tag)
    hospital = (
        db.query(Hospital).filter(Hospital.id == uuid.UUID(setup["hosp"]["id"])).one()
    )
    patient = db.query(User).filter(User.email == setup["email"]).one()
    admin = (
        db.query(User).filter(User.email == setup["hosp"]["admin_email"]).one()
    )
    doctor = (
        db.query(Doctor).filter(Doctor.id == uuid.UUID(setup["doctor"]["id"])).one()
    )
    appt_type = (
        db.query(AppointmentType)
        .filter(AppointmentType.id == uuid.UUID(setup["appt_type"]["id"]))
        .one()
    )
    return setup, hospital, patient, admin, doctor, appt_type


def create_direct(db, hospital, patient, doctor, appt_type, admin, integration,
                  start, end, key):
    return appt_service.create_appointment(
        db,
        hospital=hospital,
        patient=patient,
        doctor=doctor,
        appointment_type=appt_type,
        slot_start=start,
        slot_end=end,
        idempotency_key=key,
        actor_user_id=admin.id,
        integration=integration,
    )


def open_records(db, **filters):
    query = db.query(ReconciliationRecord)
    if "resolution" in filters:
        query = query.filter(
            ReconciliationRecord.resolution_status == filters["resolution"]
        )
    return query.all()


def create_ops(db, appointment_id):
    return (
        db.query(IntegrationOperation)
        .filter(
            IntegrationOperation.appointment_id == appointment_id,
            IntegrationOperation.operation_type == OperationType.create,
        )
        .order_by(IntegrationOperation.attempt_number)
        .all()
    )


# --- classification ----------------------------------------------------------


def test_classify_maps_typed_errors_to_policy():
    assert classify(EHRTimeoutError("t")) == FailureClass.TRANSIENT_RETRYABLE
    assert classify(EHRNetworkError("n")) == FailureClass.TRANSIENT_RETRYABLE
    assert classify(EHRServerError("s")) == FailureClass.TRANSIENT_RETRYABLE
    assert (
        classify(EHRValidationError("v")) == FailureClass.NOT_RETRYABLE_VALIDATION
    )
    assert classify(EHRConnectorError("?")) == FailureClass.UNKNOWN
    assert classify(ValueError("boom")) == FailureClass.UNKNOWN
    assert retry_allowed(FailureClass.TRANSIENT_RETRYABLE)
    assert retry_allowed(FailureClass.RATE_LIMITED)
    assert not retry_allowed(FailureClass.NOT_RETRYABLE_VALIDATION)
    assert not retry_allowed(FailureClass.UNKNOWN)
    assert retry_delay_s(1, 1.0) == 1.0
    assert retry_delay_s(2, 1.0) == 2.0
    assert retry_delay_s(3, 0.5) == 2.0
    assert MAX_RETRIES == 2


# --- unknown-outcome recovery (real vendor, fault modes) ---------------------


def test_blackhole_create_confirms_without_duplicate(client, db, fault_mode):
    """Persisted-but-unanswered create: query finds it, confirms, no double."""
    client.post("/mock-ehr/_debug/fault-mode", json={"mode": "create_but_no_response"})
    setup, hospital, patient, admin, doctor, appt_type = seed_rows(
        client, db, "blackhole"
    )
    integration = real_integration(client, db)
    start, end = slot_utc(hour=9)

    appointment, created = create_direct(
        db, hospital, patient, doctor, appt_type, admin, integration,
        start, end, "blackhole-k1",
    )
    assert created
    assert appointment.state == AppointmentState.confirmed
    assert appointment.external_id is not None

    # Exactly one vendor record for the key â€” the retry never duplicated.
    first = integration.find_appointment_by_idempotency_key("blackhole-k1")
    assert first is not None and first.external_id == appointment.external_id
    ops = create_ops(db, appointment.id)
    assert [o.status.value for o in ops] == ["timed_out"]
    assert open_records(db) == []


def test_timeout_with_empty_vendor_parks_then_retry_confirms(
    client, db, fault_mode
):
    """Nothing persisted: budget exhausts to parked; operator retry confirms."""
    client.post("/mock-ehr/_debug/fault-mode", json={"mode": "timeout"})
    setup, hospital, patient, admin, doctor, appt_type = seed_rows(
        client, db, "darkvendor"
    )
    integration = real_integration(client, db)
    start, end = slot_utc(hour=9)

    appointment, _ = create_direct(
        db, hospital, patient, doctor, appt_type, admin, integration,
        start, end, "darkvendor-k1",
    )
    # Attempts bounded (no retry loop), parked with the slot still held.
    assert appointment.state == AppointmentState.reconciliation_required
    assert len(create_ops(db, appointment.id)) == MAX_RETRIES
    records = open_records(db, resolution=ResolutionStatus.open)
    assert len(records) == 1
    assert records[0].appointment_id == appointment.id

    # Vendor recovers; the operator re-drives to confirmed, no duplicate.
    client.post("/mock-ehr/_debug/fault-mode", json={"mode": "none"})
    recovered = reconcile_service.drive_recovery(
        db, appointment, integration, actor_user_id=admin.id, force=True
    )
    assert recovered.state == AppointmentState.confirmed
    found = integration.find_appointment_by_idempotency_key("darkvendor-k1")
    assert found is not None and found.external_id == recovered.external_id


def test_repeated_server_error_parks_without_retry_loop(client, db, fault_mode):
    client.post("/mock-ehr/_debug/fault-mode", json={"mode": "server_error"})
    setup, hospital, patient, admin, doctor, appt_type = seed_rows(
        client, db, "srv500"
    )
    integration = real_integration(client, db)
    start, end = slot_utc(hour=9)

    appointment, _ = create_direct(
        db, hospital, patient, doctor, appt_type, admin, integration,
        start, end, "srv500-k1",
    )
    assert appointment.state == AppointmentState.reconciliation_required
    assert len(create_ops(db, appointment.id)) == MAX_RETRIES
    assert len(open_records(db, resolution=ResolutionStatus.open)) == 1
    # History shows the parking path, never a loop back to pending.
    trail = [
        h.to_state
        for h in db.query(AppointmentHistory)
        .filter(AppointmentHistory.appointment_id == appointment.id)
        .order_by(AppointmentHistory.created_at)
        .all()
    ]
    assert AppointmentState.pending not in trail
    assert trail[-1] == AppointmentState.reconciliation_required


def test_divergent_vendor_record_is_not_trusted(client, db, fault_mode):
    """A 'successful' vendor answer that doesn't match parks, never confirms."""
    setup, hospital, patient, admin, doctor, appt_type = seed_rows(
        client, db, "diverge"
    )
    integration = real_integration(client, db)
    # Vendor already holds key K for 09:00 (different patient, direct insert).
    vendor_patient = integration.connector.ensure_patient(
        mrn="mrn-diverge", full_name="Someone Else"
    )
    vendor_provider = integration.connector.ensure_provider(
        provider_code="prov-diverge", full_name="Dr. Other"
    )
    early_start, early_end = slot_utc(hour=9)
    planted = integration.connector._send(
        "POST",
        "/mock-ehr/appointments",
        "appointment create",
        json={
            "patient_id": vendor_patient["id"],
            "provider_id": vendor_provider["id"],
            "facility_id": None,
            "start_datetime": early_start.isoformat(),
            "end_datetime": early_end.isoformat(),
            "idempotency_key": "diverge-k1",
        },
    )
    assert planted["idempotency_key"] == "diverge-k1"

    # Internal booking reuses key K for 10:00: vendor dedupes to the 09:00 row.
    start, end = slot_utc(hour=10)
    appointment, _ = create_direct(
        db, hospital, patient, doctor, appt_type, admin, integration,
        start, end, "diverge-k1",
    )
    assert appointment.state == AppointmentState.reconciliation_required
    assert appointment.external_id == str(planted["id"])
    records = open_records(db, resolution=ResolutionStatus.open)
    assert len(records) == 1
    assert "slot_start" in records[0].error
    # Still exactly one vendor row for the key â€” no duplicate was created.
    again = integration.find_appointment_by_idempotency_key("diverge-k1")
    assert again is not None and again.external_id == appointment.external_id


def test_validation_failure_fails_fast_with_single_attempt(client, db, stubbed):
    """Definitive rejection: one attempt, failed, no work item."""
    setup, hospital, patient, admin, doctor, appt_type = seed_rows(
        client, db, "valfast"
    )
    stubbed.fail_create = True
    stubbed.create_error = EHRValidationError
    integration = IntegrationService(session=db, connector=stubbed)
    start, end = slot_utc(hour=9)

    appointment, _ = create_direct(
        db, hospital, patient, doctor, appt_type, admin, integration,
        start, end, "valfast-k1",
    )
    assert appointment.state == AppointmentState.failed
    assert len(create_ops(db, appointment.id)) == 1
    assert open_records(db) == []
    # Slot freed with the failure.
    assert "2026-10-05T09:00:00Z" in available_starts(client, {
        "hosp": setup["hosp"], "doctor": setup["doctor"], "appt_type": setup["appt_type"],
    })

# --- operator endpoints (stub connector) -------------------------------------


def open_record_for(client, headers, appointment_id):
    records = client.get("/reconciliation/records", headers=headers).json()
    matches = [r for r in records if r["appointment_id"] == appointment_id]
    assert len(matches) == 1, records
    return matches[0]


def test_transient_booking_parks_with_202_and_holds_slot(
    client, db, stubbed
):
    setup = seed_setup(client, "park202")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)

    stubbed.fail_create = True  # transient 5xx -> budget, then park
    stubbed.create_error = EHRServerError
    resp = book(client, owner, setup, start, end, "park202-k1")
    assert resp.status_code == 202, resp.text
    appointment_id = resp.json()["id"]
    assert resp.json()["state"] == "reconciliation_required"

    record = open_record_for(client, owner, appointment_id)
    assert record["resolution_status"] == "open"
    assert record["attempts"] == MAX_RETRIES
    # Slot stays held while parked — the vendor may hold it too.
    assert "2026-10-05T09:00:00Z" not in available_starts(client, setup)


def test_retry_after_vendor_recovery_confirms_and_auto_resolves(
    client, db, stubbed
):
    setup = seed_setup(client, "opretry")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)

    stubbed.fail_create = True
    parked = book(client, owner, setup, start, end, "opretry-k1")
    assert parked.status_code == 202, parked.text
    appointment_id = parked.json()["id"]
    record = open_record_for(client, owner, appointment_id)

    stubbed.fail_create = False
    retried = client.post(
        f"/reconciliation/records/{record['id']}/retry", headers=owner
    )
    assert retried.status_code == 200, retried.text
    body = retried.json()
    assert body["resolution_status"] == "resolved"
    assert body["appointment"]["state"] == "confirmed"
    detail = client.get(f"/appointments/{appointment_id}", headers=owner).json()
    assert detail["state"] == "confirmed"
    pairs = {(h["from_state"], h["to_state"]) for h in detail["history"]}
    assert ("reconciliation_required", "confirmed") in pairs

    # Closed records reject further driving.
    again = client.post(
        f"/reconciliation/records/{record['id']}/retry", headers=owner
    )
    assert again.status_code == 422, again.text


def test_manual_resolve_and_escalate_need_notes(client, db, stubbed):
    setup = seed_setup(client, "manres")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)

    stubbed.fail_create = True
    parked = book(client, owner, setup, start, end, "manres-k1")
    record = open_record_for(client, owner, parked.json()["id"])

    no_note = client.post(
        f"/reconciliation/records/{record['id']}/resolve",
        json={"resolution": "escalated"},
        headers=owner,
    )
    assert no_note.status_code == 422, no_note.text
    bad_state = client.post(
        f"/reconciliation/records/{record['id']}/resolve",
        json={"resolution": "open", "note": "x"},
        headers=owner,
    )
    assert bad_state.status_code == 422, bad_state.text

    escalated = client.post(
        f"/reconciliation/records/{record['id']}/resolve",
        json={"resolution": "escalated", "note": "Vendor ticket #42"},
        headers=owner,
    )
    assert escalated.status_code == 200, escalated.text
    assert escalated.json()["resolution_status"] == "escalated"
    assert escalated.json()["resolved_at"] is not None

    # Escalated work closes by hand, never by retry.
    retry = client.post(
        f"/reconciliation/records/{record['id']}/retry", headers=owner
    )
    assert retry.status_code == 422, retry.text
    filtered = client.get(
        "/reconciliation/records",
        params={"resolution_status": "escalated"},
        headers=owner,
    )
    assert [r["id"] for r in filtered.json()] == [record["id"]]


def test_records_scoped_to_own_hospital_and_hidden_from_patients(
    client, db, stubbed
):
    first = seed_setup(client, "ra")
    second = seed_setup(client, "rb")
    start, end = slot_utc(hour=9)
    stubbed.fail_create = True
    parked = book(client, first["hosp"]["owner"], first, start, end, "ra-k1")
    record_id = open_record_for(
        client, first["hosp"]["owner"], parked.json()["id"]
    )["id"]

    assert (
        client.get("/reconciliation/records", headers=second["hosp"]["owner"]).json()
        == []
    )
    snoop = client.get(
        f"/reconciliation/records/{record_id}", headers=second["hosp"]["owner"]
    )
    assert snoop.status_code == 403, snoop.text
    denied = client.get("/reconciliation/records", headers=first["patient"])
    assert denied.status_code == 403, denied.text
    platform = client.get(
        "/reconciliation/records", headers=first["hosp"]["platform"]
    )
    assert [r["id"] for r in platform.json()] == [record_id]


def test_late_vendor_move_finalizes_reschedule(client, db, stubbed):
    """Update timed out but the vendor applied it: adopt, release old slot."""
    setup = seed_setup(client, "latemove")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)
    created = book(client, owner, setup, start, end, "latemove-k1")
    assert created.status_code == 201, created.text
    appointment_id = created.json()["id"]
    external_id = created.json()["external_id"]

    # Vendor holds the NEW times although the update call "failed".
    new_start, new_end = slot_utc(hour=10)
    stubbed._records[external_id].update({"start": new_start, "end": new_end})
    stubbed.fail_update = True
    moved = client.post(
        f"/appointments/{appointment_id}/reschedule",
        json={"slot_start": iso(new_start), "slot_end": iso(new_end)},
        headers=owner,
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["state"] == "rescheduled"
    assert moved.json()["slot_start"].startswith("2026-10-05T10:00")
    starts = available_starts(client, setup)
    assert "2026-10-05T09:00:00Z" in starts
    assert "2026-10-05T10:00:00Z" not in starts


def test_late_vendor_cancel_finalizes_cancellation(client, db, stubbed):
    setup = seed_setup(client, "latecancel")
    owner = setup["hosp"]["owner"]
    start, end = slot_utc(hour=9)
    created = book(client, owner, setup, start, end, "latecancel-k1")
    appointment_id = created.json()["id"]
    external_id = created.json()["external_id"]

    stubbed._records[external_id]["status"] = "cancelled"
    stubbed.fail_cancel = True
    cancelled = client.post(
        f"/appointments/{appointment_id}/cancel", json={}, headers=owner
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["state"] == "cancelled"
    assert "2026-10-05T09:00:00Z" in available_starts(client, setup)


class LyingConnector(FakeConnector):
    """Vendor whose reads disagree with its writes (simulates a lying 200)."""

    def get_appointment(self, external_id):
        record = super().get_appointment(external_id)
        shift = timedelta(hours=1)
        return ExternalAppointment(
            external_id=record.external_id,
            status=record.status,
            start=record.start + shift,
            end=record.end + shift,
        )


def test_lying_success_parks_for_reconciliation(client, db):
    from app.main import app as _app

    lying = LyingConnector()

    def _override():
        return IntegrationService(session=db, connector=lying)

    _app.dependency_overrides[get_integration_service] = _override
    try:
        setup = seed_setup(client, "lying")
        owner = setup["hosp"]["owner"]
        start, end = slot_utc(hour=9)
        resp = book(client, owner, setup, start, end, "lying-k1")
        assert resp.status_code == 202, resp.text
        assert resp.json()["state"] == "reconciliation_required"
        record = open_record_for(client, owner, resp.json()["id"])
        assert "slot_start" in record["error"]
    finally:
        _app.dependency_overrides.pop(get_integration_service, None)


def test_rescheduled_bookings_can_park_and_resolve_back(db):
    appointment = Appointment(
        hospital_id=uuid.uuid4(),
        patient_id=uuid.uuid4(),
        doctor_id=uuid.uuid4(),
        appointment_type_id=uuid.uuid4(),
        slot_start=slot_utc(hour=9)[0],
        slot_end=slot_utc(hour=9)[1],
        state=AppointmentState.rescheduled,
        idempotency_key=f"map-{uuid.uuid4().hex}",
        correlation_id=uuid.uuid4(),
    )
    db.add(appointment)
    db.commit()
    transition(
        db, appointment, AppointmentState.reconciliation_required,
        actor_system="test",
    )
    transition(
        db, appointment, AppointmentState.rescheduled, actor_system="test"
    )
    db.commit()
    assert appointment.state == AppointmentState.rescheduled
    with pytest.raises(InvalidTransition):
        transition(db, appointment, "confirmed", actor_system="test")
    parked = Appointment(
        hospital_id=uuid.uuid4(),
        patient_id=uuid.uuid4(),
        doctor_id=uuid.uuid4(),
        appointment_type_id=uuid.uuid4(),
        slot_start=slot_utc(hour=9)[0],
        slot_end=slot_utc(hour=9)[1],
        state=AppointmentState.confirmed,
        idempotency_key=f"map-{uuid.uuid4().hex}",
        correlation_id=uuid.uuid4(),
    )
    db.add(parked)
    db.commit()
    with pytest.raises(InvalidTransition):
        transition(
            db, parked, AppointmentState.reconciliation_required,
            actor_system="test",
        )
