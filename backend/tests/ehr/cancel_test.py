"""ehr/cancel: the vendor record flips to cancelled."""

import uuid
from datetime import datetime

from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.integration.integration_service import IntegrationService
from tests.test_mcp_agent import seed_setup, slot_iso


def test_vendor_cancel_marks_record_cancelled(client, db, ehr_stub):
    setup = seed_setup(client, tag="ehrcancel")
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
        idempotency_key="ehr-cancel-1",
    )
    cancelled = integration.cancel_appointment(created.external_id)
    assert cancelled.status == "cancelled"
    assert integration.get_appointment(created.external_id).status == "cancelled"
