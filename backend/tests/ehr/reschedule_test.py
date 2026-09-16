"""ehr/reschedule: the vendor moves the record we point at."""

import uuid
from datetime import datetime, timedelta

from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.integration.integration_service import IntegrationService
from tests.test_mcp_agent import seed_setup, slot_iso


def test_vendor_update_moves_start_and_end(client, db, ehr_stub):
    setup = seed_setup(client, tag="ehrresched")
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
        idempotency_key="ehr-resched-1",
    )
    new_start = datetime.fromisoformat(start) + timedelta(hours=1)
    new_end = datetime.fromisoformat(end) + timedelta(hours=1)
    moved = integration.update_appointment(created.external_id, new_start, new_end)
    assert moved.external_id == created.external_id
    assert moved.start == new_start
    assert moved.end == new_end
    assert integration.get_appointment(created.external_id).start == new_start
