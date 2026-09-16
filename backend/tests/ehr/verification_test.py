"""ehr/verification: the re-read must match before anyone trusts the booking."""

import uuid

from app.domain.appointment.models import Appointment
from app.integration.integration_service import IntegrationService
from app.mcp_server import server
from app.reliability.models import IntegrationVerification
from app.reliability.verification.service import verify_external_appointment
from tests.test_mcp_agent import patient_ctx, seed_setup, slot_iso


def test_re_read_matches_the_booked_slot(client, db, ehr_stub):
    setup = seed_setup(client, tag="ehrverify")
    ctx = patient_ctx(setup)
    start, end = slot_iso()
    out = server.execute_tool(
        "create_appointment",
        {
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": "ehr-verify-1",
        },
        ctx,
        db,
    )
    assert out["outcome"] == "confirmed", out
    appt = db.get(Appointment, uuid.UUID(out["appointment_id"]))
    integration = IntegrationService(session=db, connector=ehr_stub)

    result = verify_external_appointment(db, appt, integration)
    assert result.outcome.value == "matched"
    rows = (
        db.query(IntegrationVerification)
        .filter(IntegrationVerification.appointment_id == appt.id)
        .all()
    )
    # One row from the booking pipeline itself, one from this re-read.
    assert len(rows) == 2
    assert all(row.verified_bool is True for row in rows)
