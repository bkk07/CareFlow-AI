"""Mock EHR + integration layer tests: round-trip, faults, mappings."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.integration.connector_interface import (
    EHRNetworkError,
    EHRServerError,
    EHRTimeoutError,
    EHRValidationError,
)
from app.integration.integration_service import IntegrationService
from app.integration.mapping.models import MappingEntityType
from app.integration.mapping.service import get_mapping
from app.integration.mock_ehr.connector import MockEHRConnector
from app.integration.mock_ehr.fault_injection import FaultMode
from tests.conftest import approved_hospital


@pytest.fixture()
def fault_none(client):
    client.post("/mock-ehr/_debug/fault-mode", json={"mode": "none"})
    yield
    client.post("/mock-ehr/_debug/fault-mode", json={"mode": "none"})


@pytest.fixture()
def connector(client):
    from app.integration.mock_ehr.transport import TestClientVendorTransport

    return MockEHRConnector(transport=TestClientVendorTransport(client))


def seed_care_team(client, tag):
    """Approved hospital + patient user + doctor record + hospital row."""
    hosp = approved_hospital(client, tag=tag)
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
    doctor = client.post(
        f"/hospitals/{hid}/doctors",
        json={
            "name": "Dr. Sync",
            "specialty_id": spec["id"],
            "department_id": dept["id"],
        },
        headers=hosp["owner"],
    ).json()
    email = f"sync-{tag}-{uuid.uuid4().hex[:6]}@example.com"
    client.post(
        "/auth/register",
        json={"email": email, "password": "correct-horse-42", "role": "patient"},
    )
    return hosp, email, doctor["id"]


def service_for(db, connector):
    return IntegrationService(session=db, connector=connector)


def slot():
    start = datetime(2026, 10, 5, 9, 0, tzinfo=timezone.utc)
    return start, start + timedelta(minutes=30)


def load_rows(db, hosp_id, patient_email, doctor_id):
    hospital = db.query(Hospital).filter(Hospital.id == uuid.UUID(hosp_id)).one()
    patient = db.query(User).filter(User.email == patient_email).one()
    doctor = db.query(Doctor).filter(Doctor.id == uuid.UUID(doctor_id)).one()
    return hospital, patient, doctor


# --- round-trip ------------------------------------------------------------------


def test_create_update_cancel_retrieve_round_trip(client, db, connector, fault_none):
    hosp, email, doctor_id = seed_care_team(client, "roundtrip")
    hospital, patient, doctor = load_rows(db, hosp["id"], email, doctor_id)
    svc = service_for(db, connector)
    start, end = slot()
    key = f"roundtrip-{uuid.uuid4().hex}"

    created = svc.create_appointment(
        hospital=hospital,
        patient=patient,
        doctor=doctor,
        start=start,
        end=end,
        idempotency_key=key,
        internal_appointment_id=uuid.uuid4(),
    )
    assert created.status == "scheduled"

    fetched = svc.get_appointment(created.external_id)
    assert fetched.external_id == created.external_id
    assert fetched.start == start

    moved_start = start + timedelta(days=1)
    moved_end = end + timedelta(days=1)
    updated = svc.update_appointment(created.external_id, moved_start, moved_end)
    assert updated.start == moved_start

    cancelled = svc.cancel_appointment(created.external_id)
    assert cancelled.status == "cancelled"
    assert svc.get_appointment(created.external_id).status == "cancelled"

    # Idempotent replay of the create returns the same vendor record.
    replay = svc.create_appointment(
        hospital=hospital,
        patient=patient,
        doctor=doctor,
        start=start,
        end=end,
        idempotency_key=key,
    )
    assert replay.external_id == created.external_id


def test_mappings_link_internal_to_external_ids(client, db, connector, fault_none):
    hosp, email, doctor_id = seed_care_team(client, "mappings")
    hospital, patient, doctor = load_rows(db, hosp["id"], email, doctor_id)
    svc = service_for(db, connector)
    start, end = slot()
    internal_id = uuid.uuid4()

    created = svc.create_appointment(
        hospital=hospital,
        patient=patient,
        doctor=doctor,
        start=start,
        end=end,
        idempotency_key=f"mappings-{uuid.uuid4().hex}",
        internal_appointment_id=internal_id,
    )
    hid = uuid.UUID(hosp["id"])
    patient_map = get_mapping(db, hid, MappingEntityType.patient, patient.id)
    doctor_map = get_mapping(db, hid, MappingEntityType.doctor, doctor.id)
    facility_map = get_mapping(db, hid, MappingEntityType.facility, hospital.id)
    appt_map = get_mapping(db, hid, MappingEntityType.appointment, internal_id)
    assert patient_map is not None and patient_map.external_id
    assert doctor_map is not None and doctor_map.external_id
    assert facility_map is not None and facility_map.external_id
    assert appt_map is not None
    assert appt_map.external_id == created.external_id


def test_lookup_creates_vendor_records_on_first_sync(client, db, connector, fault_none):
    hosp, email, doctor_id = seed_care_team(client, "firstsync")
    hospital, patient, doctor = load_rows(db, hosp["id"], email, doctor_id)
    svc = service_for(db, connector)

    patient_ext = svc.ensure_patient(hospital.id, patient)
    doctor_ext = svc.ensure_doctor(hospital.id, doctor)
    facility_ext = svc.ensure_facility(hospital)
    # Second sync reuses the same vendor rows — no duplicates minted.
    assert svc.ensure_patient(hospital.id, patient) == patient_ext
    assert svc.ensure_doctor(hospital.id, doctor) == doctor_ext
    assert svc.ensure_facility(hospital) == facility_ext


def test_create_rejects_unknown_refs_and_bad_range(connector, fault_none):
    from app.integration.connector_interface import CreateAppointmentRequest

    start = datetime(2026, 10, 5, 9, 0, tzinfo=timezone.utc)
    end = start + timedelta(minutes=30)
    with pytest.raises(EHRValidationError):
        connector.create_appointment(
            CreateAppointmentRequest(
                patient_external_id=str(uuid.uuid4()),
                provider_external_id=str(uuid.uuid4()),
                start=start,
                end=end,
                idempotency_key=f"badrefs-{uuid.uuid4().hex}",
            )
        )
    patient = connector.ensure_patient(mrn=f"mrn-{uuid.uuid4().hex}")
    provider = connector.ensure_provider(provider_code=f"prov-{uuid.uuid4().hex}")
    with pytest.raises(EHRValidationError):
        connector.create_appointment(
            CreateAppointmentRequest(
                patient_external_id=patient["id"],
                provider_external_id=provider["id"],
                start=end,
                end=start,
                idempotency_key=f"badrange-{uuid.uuid4().hex}",
            )
        )


# --- fault modes -------------------------------------------------------------------


def set_mode(client, mode):
    resp = client.post("/mock-ehr/_debug/fault-mode", json={"mode": mode})
    assert resp.status_code == 200, resp.text
    assert client.get("/mock-ehr/_debug/fault-mode").json()["mode"] == mode


def test_fault_timeout(client, db, connector, fault_none):
    hosp, email, doctor_id = seed_care_team(client, "timeout")
    hospital, patient, doctor = load_rows(db, hosp["id"], email, doctor_id)
    svc = service_for(db, connector)
    start, end = slot()
    set_mode(client, "timeout")
    try:
        with pytest.raises(EHRTimeoutError):
            svc.create_appointment(
                hospital=hospital,
                patient=patient,
                doctor=doctor,
                start=start,
                end=end,
                idempotency_key=f"timeout-{uuid.uuid4().hex}",
            )
        with pytest.raises(EHRTimeoutError):
            svc.get_appointment(str(uuid.uuid4()))
    finally:
        set_mode(client, "none")


def test_fault_network_error(client, db, connector, fault_none):
    hosp, email, doctor_id = seed_care_team(client, "network")
    hospital, patient, doctor = load_rows(db, hosp["id"], email, doctor_id)
    svc = service_for(db, connector)
    start, end = slot()
    set_mode(client, "network_error")
    try:
        with pytest.raises(EHRNetworkError):
            svc.create_appointment(
                hospital=hospital,
                patient=patient,
                doctor=doctor,
                start=start,
                end=end,
                idempotency_key=f"network-{uuid.uuid4().hex}",
            )
    finally:
        set_mode(client, "none")


def test_fault_server_error(client, db, connector, fault_none):
    hosp, email, doctor_id = seed_care_team(client, "servererr")
    hospital, patient, doctor = load_rows(db, hosp["id"], email, doctor_id)
    svc = service_for(db, connector)
    start, end = slot()
    set_mode(client, "server_error")
    try:
        with pytest.raises(EHRServerError):
            svc.create_appointment(
                hospital=hospital,
                patient=patient,
                doctor=doctor,
                start=start,
                end=end,
                idempotency_key=f"server-{uuid.uuid4().hex}",
            )
    finally:
        set_mode(client, "none")


def test_fault_slow_5s_still_succeeds(client, db, connector, fault_none):
    hosp, email, doctor_id = seed_care_team(client, "slow")
    hospital, patient, doctor = load_rows(db, hosp["id"], email, doctor_id)
    svc = service_for(db, connector)
    start, end = slot()
    set_mode(client, "slow_5s")
    try:
        created = svc.create_appointment(
            hospital=hospital,
            patient=patient,
            doctor=doctor,
            start=start,
            end=end,
            idempotency_key=f"slow-{uuid.uuid4().hex}",
        )
        assert created.status == "scheduled"
    finally:
        set_mode(client, "none")


def test_fault_create_but_no_response_persists_silently(
    client, db, connector, fault_none
):
    hosp, email, doctor_id = seed_care_team(client, "blackhole")
    hospital, patient, doctor = load_rows(db, hosp["id"], email, doctor_id)
    svc = service_for(db, connector)
    start, end = slot()
    key = f"blackhole-{uuid.uuid4().hex}"
    set_mode(client, "create_but_no_response")
    try:
        # The caller sees a timeout and cannot tell whether the vendor
        # committed — but the row IS there.
        with pytest.raises(EHRTimeoutError):
            svc.create_appointment(
                hospital=hospital,
                patient=patient,
                doctor=doctor,
                start=start,
                end=end,
                idempotency_key=key,
            )
        found = svc.find_appointment_by_idempotency_key(key)
        assert found is not None
        assert found.status == "scheduled"
        assert found.start == start
    finally:
        set_mode(client, "none")


def test_find_by_key_returns_none_when_absent(connector, fault_none):
    assert (
        connector.find_appointment_by_idempotency_key(f"absent-{uuid.uuid4().hex}")
        is None
    )


def test_fault_mode_enum_values():
    assert [m.value for m in FaultMode] == [
        "none",
        "timeout",
        "network_error",
        "slow_5s",
        "create_but_no_response",
        "server_error",
    ]
