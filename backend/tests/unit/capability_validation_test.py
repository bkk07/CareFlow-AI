"""unit/capability_validation: unknown tools, bad input, wrong roles."""

import uuid

import pytest

from app.mcp_server import server
from app.mcp_server.errors import CapabilityAuthError
from app.mcp_server.models import CapabilityExecution
from tests.test_mcp_agent import patient_ctx, seed_setup, slot_iso


def test_unknown_tool_is_404(client, ehr_stub):
    setup = seed_setup(client, tag="uval404")
    resp = client.post(
        "/mcp/call",
        json={"tool": "prescribe_medication", "input": {}},
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 404


def test_blank_idempotency_key_is_422(client, db, ehr_stub):
    setup = seed_setup(client, tag="uval422")
    start, end = slot_iso()
    resp = client.post(
        "/mcp/call",
        json={
            "tool": "create_appointment",
            "input": {
                "doctor_id": setup["doctor"]["id"],
                "appointment_type_id": setup["type"]["id"],
                "slot_start": start,
                "slot_end": end,
                "idempotency_key": "   ",
            },
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 422


def test_patient_cannot_book_for_someone_else(client, db, ehr_stub):
    setup = seed_setup(client, tag="uvalscope")
    ctx = patient_ctx(setup)
    start, end = slot_iso()
    with pytest.raises(CapabilityAuthError):
        server.execute_tool(
            "create_appointment",
            {
                "doctor_id": setup["doctor"]["id"],
                "appointment_type_id": setup["type"]["id"],
                "slot_start": start,
                "slot_end": end,
                "idempotency_key": "uval-k9",
                "patient_id": str(uuid.uuid4()),
            },
            ctx,
            db,
        )
    # Denied calls are audited too.
    rows = db.query(CapabilityExecution).all()
    assert len(rows) == 1
    assert rows[0].status.value == "error"
