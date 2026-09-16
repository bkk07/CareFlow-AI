"""ehr/timeout: a hung vendor raises; callers decide the recovery."""

import uuid
from datetime import datetime

import pytest

from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.integration.connector_interface import EHRTimeoutError
from app.integration.integration_service import IntegrationService
from tests.test_mcp_agent import seed_setup, slot_iso


def test_vendor_timeout_propagates_to_caller(client, db, ehr_stub):
    setup = seed_setup(client, tag="ehrtimeout")
    integration = IntegrationService(session=db, connector=ehr_stub)
    hospital = db.get(Hospital, uuid.UUID(setup["hid"]))
    patient = db.get(User, uuid.UUID(setup["patient"]["id"]))
    doctor = db.get(Doctor, uuid.UUID(setup["doctor"]["id"]))
    start, end = slot_iso()
    ehr_stub.fail_create = True
    ehr_stub.create_error = EHRTimeoutError
    try:
        with pytest.raises(EHRTimeoutError):
            integration.create_appointment(
                hospital=hospital,
                patient=patient,
                doctor=doctor,
                start=datetime.fromisoformat(start),
                end=datetime.fromisoformat(end),
                idempotency_key="ehr-timeout-1",
            )
    finally:
        ehr_stub.fail_create = False
    assert ehr_stub.find_appointment_by_idempotency_key("ehr-timeout-1") is None
