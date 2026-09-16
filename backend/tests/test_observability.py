"""Phase 15 tests: one correlation id end to end, trace view, metrics."""

import uuid

import pytest

from app.ai import router as chat_router
from app.core.audit import AuditEvent
from app.domain.appointment.models import Appointment
from app.domain.auth.models import Role
from app.core.deps import RequestContext
from app.core.db import get_db  # noqa: F401 — ensure app import order
from app.integration.integration_service import IntegrationService
from app.mcp_server import server
from app.mcp_server.models import CapabilityExecution
from app.mcp_server.tools._base import set_integration_factory
from app.notification.models import Notification
from app.notification.service import create_in_app
from app.observability.correlation import for_conversation
from tests.test_mcp_agent import (
    FakeConnector,
    patient_ctx,
    register_patient,
    seed_setup,
    slot_iso,
)


@pytest.fixture()
def tool_factory(db):
    connector = FakeConnector()
    set_integration_factory(
        lambda session: IntegrationService(session=session, connector=connector)
    )
    yield connector
    set_integration_factory(None)


def _cid() -> uuid.UUID:
    return uuid.uuid4()


# -- middleware ---------------------------------------------------------------


def test_middleware_echoes_valid_correlation_id(client):
    cid = str(_cid())
    resp = client.get("/health", headers={"X-Correlation-ID": cid})
    assert resp.status_code == 200
    assert resp.headers["X-Correlation-ID"] == cid


def test_middleware_generates_when_missing_or_bad(client):
    first = client.get("/health")
    assert uuid.UUID(first.headers["X-Correlation-ID"])
    second = client.get("/health", headers={"X-Correlation-ID": "not-a-uuid"})
    parsed = uuid.UUID(second.headers["X-Correlation-ID"])
    assert str(parsed) != "not-a-uuid"
    assert first.headers["X-Correlation-ID"] != second.headers["X-Correlation-ID"]


# -- propagation --------------------------------------------------------------


def _book(client, db, setup, ctx, key):
    start, end = slot_iso()
    return server.execute_tool(
        "create_appointment",
        {
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": key,
        },
        ctx,
        db,
    )


def test_http_tool_call_uses_header_correlation(client, db):
    setup = seed_setup(client, tag="obscorr")
    cid = str(_cid())
    resp = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {"specialty": "Cardiology obscorr"}},
        headers={**setup["patient"]["headers"], "X-Correlation-ID": cid},
    )
    assert resp.status_code == 200, resp.text
    rows = db.query(CapabilityExecution).all()
    assert len(rows) == 1
    assert str(rows[0].correlation_id) == cid


def test_booking_chain_shares_one_correlation(client, db, tool_factory):
    from app.reliability.models import IntegrationOperation

    setup = seed_setup(client, tag="obchain")
    ctx = patient_ctx(setup)
    cid = _cid()
    ctx.correlation_id = cid
    out = _book(client, db, setup, ctx, "ob-chain-1")
    assert out["outcome"] == "confirmed", out

    executions = db.query(CapabilityExecution).all()
    assert executions, "tool wrapper must audit the call"
    assert {str(row.correlation_id) for row in executions} == {str(cid)}

    appt = (
        db.query(Appointment)
        .filter(Appointment.idempotency_key == "ob-chain-1")
        .one()
    )
    assert appt.correlation_id == cid

    ops = (
        db.query(IntegrationOperation)
        .filter(IntegrationOperation.appointment_id == appt.id)
        .all()
    )
    assert ops, "EHR op must exist for a confirmed booking"
    assert {op.correlation_id for op in ops} == {cid}


def test_start_workflow_keeps_turn_correlation(client, db):
    setup = seed_setup(client, tag="obwf")
    cid = _cid()
    ctx = RequestContext(
        user_id=uuid.uuid4(),
        role=Role.hospital_admin,
        hospital_id=uuid.UUID(setup["hid"]),
        correlation_id=cid,
    )
    out = server.execute_tool(
        "start_workflow",
        {"event_type": "appointment.booked", "payload": {}},
        ctx,
        db,
    )
    from app.workflow.models import WorkflowExecution

    execution = db.get(WorkflowExecution, uuid.UUID(out["execution_id"]))
    assert execution is not None
    assert execution.correlation_id == cid


def test_chat_turn_span_carries_request_correlation(client, db, monkeypatch):
    setup = seed_setup(client, tag="obspan")
    monkeypatch.setattr(
        chat_router,
        "run_conversation",
        lambda **kwargs: {
            "conversation_id": "conv-obspan",
            "reply": "canned",
            "iterations": 1,
            "escalated": False,
            "stopped": False,
        },
    )
    cid = str(_cid())
    resp = client.post(
        "/chat",
        json={"message": "hello"},
        headers={**setup["patient"]["headers"], "X-Correlation-ID": cid},
    )
    assert resp.status_code == 200, resp.text
    spans = (
        db.query(AuditEvent)
        .filter(AuditEvent.action == "observability.span")
        .all()
    )
    assert len(spans) == 1
    assert str(spans[0].correlation_id) == cid
    assert spans[0].meta["span"] == "chat.turn"
    assert spans[0].meta["iterations"] == 1
    assert float(spans[0].meta["duration_ms"]) >= 0


# -- trace view ---------------------------------------------------------------


def test_trace_view_shows_full_chain(client, db, tool_factory):
    setup = seed_setup(client, tag="obtrace")
    ctx = patient_ctx(setup)
    cid = _cid()
    ctx.correlation_id = cid
    out = _book(client, db, setup, ctx, "ob-trace-1")
    assert out["outcome"] == "confirmed", out

    view = client.get(
        f"/observability/trace/{cid}", headers=setup["patient"]["headers"]
    )
    assert view.status_code == 200, view.text
    body = view.json()
    assert body["correlation_id"] == str(cid)
    assert {"ai_decision", "scheduling", "ehr"} <= set(body["layers"])
    assert len(body["items"]) >= 3
    stamps = [item["at"] for item in body["items"]]
    assert stamps == sorted(stamps), "timeline must be time-ordered"

    appt_id = out["appointment_id"]
    via_booking = client.get(
        f"/observability/trace/{uuid.uuid4()}?appointment_id={appt_id}",
        headers=setup["patient"]["headers"],
    )
    assert via_booking.status_code == 200, via_booking.text
    assert via_booking.json()["correlation_id"] == str(cid)


def test_trace_unknown_id_is_404(client):
    setup = seed_setup(client, tag="ob404")
    resp = client.get(
        f"/observability/trace/{uuid.uuid4()}",
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 404


# -- metrics ------------------------------------------------------------------


def test_metrics_reports_booking_rate_and_latency(client, db, tool_factory):
    setup = seed_setup(client, tag="obmetrics")
    ctx = patient_ctx(setup)
    ctx.correlation_id = _cid()
    out = _book(client, db, setup, ctx, "ob-metrics-1")
    assert out["outcome"] == "confirmed", out

    resp = client.get("/observability/metrics", headers=setup["patient"]["headers"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["booking"]["success_rate"] == 1.0
    assert body["booking"]["by_state"]["confirmed"] == 1
    assert body["reconciliation"]["total"] == 0
    assert body["workflow"]["open_escalations"] == 0
    assert "per_tool" in body["ai_latency"]
    assert body["ai_latency"]["per_tool"]["create_appointment"]["calls"] == 1


# -- notifications ------------------------------------------------------------


def test_notifications_carry_the_causing_correlation(client, db, tool_factory):
    setup = seed_setup(client, tag="obnotif")
    patient = setup["patient"]
    cid = str(_cid())
    patient_headers = dict(patient["headers"])
    admin = setup["hosp"]["owner"]

    resp = client.post(
        "/mcp/call",
        json={
            "tool": "send_notification",
            "input": {
                "recipient_user_id": patient["id"],
                "channel": "in_app",
                "message": "correlated hello",
                "dedupe_key": "ob-notif-1",
            },
        },
        headers={**admin, "X-Correlation-ID": cid},
    )
    assert resp.status_code == 200, resp.text
    row = (
        db.query(Notification)
        .filter(Notification.dedupe_key == "ob-notif-1")
        .one()
    )
    assert str(row.correlation_id) == cid

    ambient, created = create_in_app(
        db,
        recipient_user_id=uuid.UUID(patient["id"]),
        type="ambient",
        detail="no explicit id",
        dedupe_key="ob-notif-2",
    )
    assert created is True
    assert ambient.correlation_id is not None


# -- telephony ----------------------------------------------------------------


def test_call_conversation_maps_to_stable_correlation(client, db, monkeypatch):
    from app.core.config import settings

    assert for_conversation("abc") == for_conversation("abc")
    assert for_conversation("abc") != for_conversation("other")

    monkeypatch.setattr(
        settings, "telephony_stream_url", "wss://voice.example.invalid/media"
    )
    setup = seed_setup(client, tag="obtel")
    patient = register_patient(client, "obtel")
    phone = "+1-555-0177"
    put = client.put(
        "/patients/me/contact",
        json={"phone": phone, "full_name": "Trace Caller"},
        headers=patient["headers"],
    )
    assert put.status_code == 200, put.text

    inbound = client.post(
        "/voice/telephony/inbound",
        data={"From": phone, "To": "+1-555-0000", "CallSid": "CAtrace1"},
    )
    assert inbound.status_code == 200, inbound.text
    twiml = inbound.text
    conversation_id = twiml.split("conversation_id' value=\"")[1].split('"')[0]
    expected = for_conversation(conversation_id)

    rows = (
        db.query(AuditEvent)
        .filter(AuditEvent.action == "telephony.inbound")
        .all()
    )
    assert len(rows) == 1
    assert rows[0].correlation_id == expected

    view = client.get(
        f"/observability/trace/{expected}", headers=setup["patient"]["headers"]
    )
    assert view.status_code == 200, view.text
    assert "conversation" in view.json()["layers"]
