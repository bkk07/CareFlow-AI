"""ehr/duplicate: the idempotency-key lookup finds the first write."""

import uuid
from datetime import datetime

from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.integration.integration_service import IntegrationService
from tests.test_mcp_agent import seed_setup, slot_iso


def test_key_lookup_locates_the_original_record(client, db, ehr_stub):
    setup = seed_setup(client, tag="ehrdup")
    integration = IntegrationService(session=db, connector=ehr_stub)
    hospital = db.get(Hospital, uuid.UUID(setup["hid"]))
    patient = db.get(User, uuid.UUID(setup["patient"]["id"]))
    doctor = db.get(Doctor, uuid.UUID(setup["doctor"]["id"]))
    start, end = slot_iso()
    created = integration.create_appointment(
        hospital=hospital,
        patient=patient,
        doctor=doctor,
        start=datetime.fromisoformat(start),
        end=datetime.fromisoformat(end),
        idempotency_key="ehr-dup-1",
    )
    found = integration.find_appointment_by_idempotency_key("ehr-dup-1")
    assert found is not None
    assert found.external_id == created.external_id
    assert ehr_stub.creates == 1
    assert integration.find_appointment_by_idempotency_key("ehr-dup-9") is None
