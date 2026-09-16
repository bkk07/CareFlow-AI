"""integration/ehr_to_verification: the vendor record is re-read, not trusted."""

import uuid

from app.domain.appointment.models import Appointment
from app.integration.integration_service import IntegrationService
from app.reliability.models import IntegrationVerification
from app.reliability.verification.service import verify_external_appointment
from tests.test_mcp_agent import seed_setup, slot_iso


def test_matching_vendor_record_verifies(client, db, ehr_stub):
    setup = seed_setup(client, tag="i2verify")
    start, end = slot_iso()
    resp = client.post(
        "/appointments",
        json={
            "patient_id": setup["patient"]["id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": "i2verify-k1",
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    appt = db.get(Appointment, uuid.UUID(resp.json()["id"]))
    integration = IntegrationService(session=db, connector=ehr_stub)

    result = verify_external_appointment(db, appt, integration)
    assert result.outcome.value == "matched"
    assert result.mismatches == []
    rows = (
        db.query(IntegrationVerification)
        .filter(IntegrationVerification.appointment_id == appt.id)
        .all()
    )
    # One row from the booking pipeline itself, one from this re-read.
    assert len(rows) == 2
    assert all(row.verified_bool is True for row in rows)
