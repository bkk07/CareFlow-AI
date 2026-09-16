"""Phase 10 tests: event bus, Celery handlers, notifications, sweeps."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.domain.appointment.router import get_integration_service
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.main import app
from app.notification.models import Notification, NotificationStatus
from app.notification.service import deliver_email
from app.workflow import event_bus
from app.workflow.celery_app import celery_app
from app.workflow.models import ExecutionStatus, WorkflowExecution
from app.workflow.tasks import _base as task_base
from app.workflow.tasks._base import handle_event
from tests.test_mcp_agent import FakeConnector, scripted, seed_setup

MONDAY = "2026-10-05"


@pytest.fixture()
def fake_connector():
    return FakeConnector()


@pytest.fixture()
def eager_tasks(db, fake_connector):
    """Eager Celery on the test session with a stubbed vendor connector."""
    from app.mcp_server.tools import _base as tool_base

    old_eager = celery_app.conf.task_always_eager
    celery_app.conf.task_always_eager = True
    task_base.set_session_factory(lambda: db)
    stub = lambda session: IntegrationService(  # noqa: E731
        session=session, connector=fake_connector
    )
    task_base.set_integration_factory(stub)
    tool_base.set_integration_factory(stub)

    def _rest_override():
        return IntegrationService(session=db, connector=fake_connector)

    app.dependency_overrides[get_integration_service] = _rest_override
    yield fake_connector
    app.dependency_overrides.clear()
    celery_app.conf.task_always_eager = old_eager
    task_base.set_session_factory(None)
    task_base.set_integration_factory(None)
    tool_base.set_integration_factory(None)


def slot_iso(day=MONDAY, hour=9):
    start = datetime.fromisoformat(f"{day}T{hour:02d}:00:00+00:00")
    return start.isoformat(), (start + timedelta(minutes=30)).isoformat()


def book(client, setup, key="wf-book-1", hour=9):
    start, end = slot_iso(hour=hour)
    return client.post(
        "/appointments",
        json={
            "patient_id": setup["patient"]["id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": key,
        },
        headers=setup["patient"]["headers"],
    )


def executions(db, event_type):
    return (
        db.query(WorkflowExecution)
        .filter(WorkflowExecution.event_type == event_type)
        .all()
    )


def test_booking_emits_completed_execution_and_in_app(client, db, eager_tasks):
    setup = seed_setup(client, tag="wfbook")
    resp = book(client, setup)
    assert resp.status_code == 201, resp.text

    rows = executions(db, "appointment.booked")
    assert len(rows) == 1
    assert rows[0].status == ExecutionStatus.completed
    assert rows[0].attempt == 1
    assert any("confirmation created" in h["event"] for h in rows[0].execution_history)

    inbox = client.get("/notifications", headers=setup["patient"]["headers"]).json()
    assert len(inbox) == 1
    assert inbox[0]["type"] == "booking_confirmation"
    assert inbox[0]["status"] == "sent"


def test_redelivery_never_double_notifies(client, db, eager_tasks):
    setup = seed_setup(client, tag="wfonce")
    appt_id = book(client, setup, key="wf-once-1").json()["id"]
    first = executions(db, "appointment.booked")
    assert len(first) == 1

    # A killed-and-redelivered worker replays the same execution...
    replay = handle_event(str(first[0].id))
    assert replay.get("duplicate") is True
    # ...and a duplicate event carries the same dedupe key.
    event_bus.publish_event(db, "appointment.booked", {"appointment_id": appt_id})
    assert (
        db.query(Notification)
        .filter(Notification.type == "booking_confirmation")
        .count()
        == 1
    )


def test_unknown_event_fails_visibly(db, eager_tasks):
    execution = event_bus.publish_event(db, "nope.unknown", {})
    assert execution.status == ExecutionStatus.failed
    assert any("no handler" in h["event"] for h in execution.execution_history)


def test_email_failure_lands_on_the_row(client, db, eager_tasks, monkeypatch):
    from app.core.config import settings

    setup = seed_setup(client, tag="wffail")
    monkeypatch.setattr(settings, "smtp_port", 9)  # discard port: refused fast
    row, created = deliver_email(
        db,
        recipient_user_id=uuid.UUID(setup["patient"]["id"]),
        recipient_address="patient@example.com",
        subject="Hello",
        body="world",
        type="manual",
        dedupe_key="wf-email-fail-1",
    )
    assert created is True
    assert row.status == NotificationStatus.failed
    assert row.error


def test_reschedule_and_cancel_notify(client, db, eager_tasks):
    setup = seed_setup(client, tag="wfmove")
    appt_id = book(client, setup, key="wf-move-1").json()["id"]
    h = setup["patient"]["headers"]
    start2, end2 = slot_iso(hour=10)
    assert (
        client.post(
            f"/appointments/{appt_id}/reschedule",
            json={"slot_start": start2, "slot_end": end2},
            headers=h,
        ).status_code
        == 200
    )
    assert (
        client.post(f"/appointments/{appt_id}/cancel", json={}, headers=h).status_code
        == 200
    )
    types = {n["type"] for n in client.get("/notifications", headers=h).json()}
    assert {"booking_confirmation", "reschedule", "cancellation"} <= types


def test_chat_booking_notifies(client, db, eager_tasks):
    from app.ai.agent import orchestrator
    from app.core.deps import RequestContext

    setup = seed_setup(client, tag="wfchat")
    start, end = slot_iso()
    ctx = RequestContext(
        user_id=uuid.UUID(setup["patient"]["id"]),
        role=Role.patient,
        hospital_id=None,
    )
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "create_appointment",
                    "arguments": {
                        "doctor_id": setup["doctor"]["id"],
                        "appointment_type_id": setup["type"]["id"],
                        "slot_start": start,
                        "slot_end": end,
                        "idempotency_key": "wf-chat-1",
                    },
                }
            ],
        },
        {"content": "Booked.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-wfchat",
        user_message="Book Monday morning please",
        complete=complete,
    )
    assert result["reply"] == "Booked."
    inbox = client.get(
        "/notifications", headers=setup["patient"]["headers"]
    ).json()
    assert [n["type"] for n in inbox] == ["booking_confirmation"]


def test_reminder_sweep_notifies_once(client, db, eager_tasks):
    from app.domain.appointment.models import Appointment

    setup = seed_setup(client, tag="wfremind")
    appt_id = book(client, setup, key="wf-remind-1").json()["id"]
    appt = db.get(Appointment, uuid.UUID(appt_id))
    appt.slot_start = datetime.now(timezone.utc) + timedelta(hours=24)
    db.commit()

    event_bus.publish_event(db, "reminder.sweep", {})
    event_bus.publish_event(db, "reminder.sweep", {})
    reminders = (
        db.query(Notification).filter(Notification.type == "reminder").all()
    )
    assert len(reminders) == 1
    assert reminders[0].status == NotificationStatus.sent


def test_recovery_sweep_auto_resolves_when_vendor_heals(
    client, db, eager_tasks, fake_connector
):
    from app.domain.appointment.models import Appointment
    from app.integration.connector_interface import EHRTimeoutError
    from app.reliability.models import ReconciliationRecord

    setup = seed_setup(client, tag="wfsweep")
    fake_connector.fail_create = True
    fake_connector.create_error = EHRTimeoutError
    parked = book(client, setup, key="wf-sweep-1")
    assert parked.status_code == 202, parked.text
    appt_id = parked.json()["id"]

    # Vendor still dark: the sweep spends nothing past the budget.
    event_bus.publish_event(db, "reconciliation.sweep", {})
    record = (
        db.query(ReconciliationRecord)
        .filter(ReconciliationRecord.appointment_id == uuid.UUID(appt_id))
        .one()
    )
    assert record.resolution_status.value == "open"

    # Vendor heals: the next sweep converges and auto-resolves.
    fake_connector.fail_create = False
    event_bus.publish_event(db, "reconciliation.sweep", {})
    db.refresh(record)
    assert record.resolution_status.value == "resolved"
    assert db.get(Appointment, uuid.UUID(appt_id)).state.value == "confirmed"


def test_mcp_tools_are_live(client, db, eager_tasks):
    setup = seed_setup(client, tag="wftools")
    owner, patient_h = setup["hosp"]["owner"], setup["patient"]["headers"]

    sent = client.post(
        "/mcp/call",
        json={
            "tool": "send_notification",
            "input": {
                "recipient_user_id": setup["patient"]["id"],
                "channel": "in_app",
                "message": "Your lab is ready",
                "dedupe_key": "wf-tool-manual-1",
            },
        },
        headers=owner,
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["result"]["status"] == "sent"

    bogus = client.post(
        "/mcp/call",
        json={
            "tool": "start_workflow",
            "input": {
                "event_type": "appointment.booked",
                "payload": {"appointment_id": str(uuid.uuid4())},
            },
        },
        headers=owner,
    )
    assert bogus.status_code == 200, bogus.text
    execution = db.get(
        WorkflowExecution, uuid.UUID(bogus.json()["result"]["execution_id"])
    )
    assert execution.status == ExecutionStatus.completed
    assert any("gone" in h["event"] for h in execution.execution_history)

    unknown = client.post(
        "/mcp/call",
        json={"tool": "start_workflow", "input": {"event_type": "nope.x"}},
        headers=owner,
    )
    assert unknown.status_code == 422

    inbox = client.get("/notifications", headers=patient_h).json()
    assert any(n["body"] == "Your lab is ready" for n in inbox)
