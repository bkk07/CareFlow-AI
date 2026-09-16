"""ehr/unknown_outcome: timeouts park the booking for an operator."""

from app.domain.appointment.models import Appointment, AppointmentState
from app.integration.connector_interface import EHRTimeoutError
from app.mcp_server import server
from app.reliability.models import ReconciliationRecord, ResolutionStatus
from tests.test_mcp_agent import patient_ctx, seed_setup, slot_iso


def test_timeout_parks_booking_with_open_record(client, db, ehr_stub):
    setup = seed_setup(client, tag="ehrunknown")
    ctx = patient_ctx(setup)
    ehr_stub.fail_create = True
    ehr_stub.create_error = EHRTimeoutError
    try:
        start, end = slot_iso()
        out = server.execute_tool(
            "create_appointment",
            {
                "doctor_id": setup["doctor"]["id"],
                "appointment_type_id": setup["type"]["id"],
                "slot_start": start,
                "slot_end": end,
                "idempotency_key": "ehr-unknown-1",
            },
            ctx,
            db,
        )
    finally:
        ehr_stub.fail_create = False
    assert out["outcome"] == "parked", out
    assert out["state"] == AppointmentState.reconciliation_required.value
    appt = (
        db.query(Appointment)
        .filter(Appointment.idempotency_key == "ehr-unknown-1")
        .one()
    )
    records = (
        db.query(ReconciliationRecord)
        .filter(ReconciliationRecord.appointment_id == appt.id)
        .all()
    )
    assert len(records) == 1
    assert records[0].resolution_status == ResolutionStatus.open
