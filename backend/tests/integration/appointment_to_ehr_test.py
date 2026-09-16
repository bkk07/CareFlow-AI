"""integration/appointment_to_ehr: bookings persist a vendor record + op log."""

import uuid

from app.domain.appointment.models import Appointment
from app.reliability.models import IntegrationOperation, OperationStatus
from tests.test_mcp_agent import seed_setup, slot_iso


def test_booking_writes_vendor_record_and_operation(client, db, ehr_stub):
    setup = seed_setup(client, tag="i2ehr")
    start, end = slot_iso()
    resp = client.post(
        "/appointments",
        json={
            "patient_id": setup["patient"]["id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": "i2ehr-k1",
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    appt = db.get(Appointment, uuid.UUID(resp.json()["id"]))
    assert appt.external_id == "vendor-i2ehr-k1"
    assert ehr_stub.creates == 1

    ops = (
        db.query(IntegrationOperation)
        .filter(IntegrationOperation.appointment_id == appt.id)
        .order_by(IntegrationOperation.created_at)
        .all()
    )
    # The vendor write itself is evidenced by the stored external id; the
    # operation log holds the trust-but-verify re-read — both under the
    # booking's correlation.
    assert [op.operation_type.value for op in ops] == ["verify"]
    assert all(op.status == OperationStatus.succeeded for op in ops)
    assert {op.correlation_id for op in ops} == {appt.correlation_id}
