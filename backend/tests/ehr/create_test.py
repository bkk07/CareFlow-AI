"""ehr/create: the vendor persists the booking under our idempotency key."""

import uuid
from datetime import datetime

from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.integration.integration_service import IntegrationService
from app.integration.mapping.models import MappingEntityType
from app.integration.mapping.service import get_mapping
from tests.test_mcp_agent import seed_setup, slot_iso


def test_vendor_create_returns_scheduled_record(client, db, ehr_stub):
    setup = seed_setup(client, tag="ehrcreate")
    integration = IntegrationService(session=db, connector=ehr_stub)
    hospital = db.get(Hospital, uuid.UUID(setup["hid"]))
    patient = db.get(User, uuid.UUID(setup["patient"]["id"]))
    doctor = db.get(Doctor, uuid.UUID(setup["doctor"]["id"]))
    start, end = slot_iso()
    appt_id = uuid.uuid4()

    external = integration.create_appointment(
        hospital=hospital,
        patient=patient,
        doctor=doctor,
        start=datetime.fromisoformat(start),
        end=datetime.fromisoformat(end),
        idempotency_key="ehr-create-1",
        internal_appointment_id=appt_id,
    )
    assert external.status == "scheduled"
    assert external.external_id == "vendor-ehr-create-1"
    row = get_mapping(db, hospital.id, MappingEntityType.appointment, appt_id)
    assert row is not None
    assert row.external_id == "vendor-ehr-create-1"
