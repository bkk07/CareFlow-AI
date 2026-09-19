"""Phase 9 tests: MCP tools, agent loop, safety boundary, escalation."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.ai.agent import orchestrator
from app.ai.context.ai_context import clear_ai_context, get_ai_context, save_ai_context
from app.ai.mcp_client.client import AgentToolClient
from app.core.deps import RequestContext
from app.domain.appointment.models import Appointment
from app.domain.auth.models import Role, User
from app.integration.connector_interface import (
    EHRConnectorError,
    EHRTimeoutError,
    ExternalAppointment,
)
from app.integration.integration_service import IntegrationService
from app.main import app
from app.mcp_server import server
from app.mcp_server.models import CapabilityExecution, Escalation
from app.mcp_server.tools._base import set_integration_factory
from app.reliability.models import ReconciliationRecord
from tests.conftest import approved_hospital

MONDAY = "2026-10-05"  # a Monday


class FakeConnector:
    """Vendor stand-in with switchable faults (mirrors test_appointments)."""

    def __init__(self) -> None:
        self.fail_create = False
        self.create_error: type[EHRConnectorError] = EHRConnectorError
        self.creates = 0
        self._records: dict[str, dict] = {}

    def ensure_patient(self, **kwargs):
        return {"id": "ext-patient-1"}

    def ensure_provider(self, **kwargs):
        return {"id": "ext-provider-1"}

    def ensure_facility(self, **kwargs):
        return {"id": "ext-facility-1"}

    def create_appointment(self, request):
        if self.fail_create:
            raise self.create_error("vendor down")
        self.creates += 1
        external_id = f"vendor-{request.idempotency_key}"
        self._records[external_id] = {
            "status": "scheduled",
            "start": request.start,
            "end": request.end,
        }
        return ExternalAppointment(
            external_id=external_id,
            status="scheduled",
            start=request.start,
            end=request.end,
        )

    def update_appointment(self, external_id, request):
        record = self._records.get(external_id)
        if record is None:
            from app.integration.connector_interface import EHRNotFoundError

            raise EHRNotFoundError("no such vendor record")
        record.update(
            {"status": "scheduled", "start": request.start, "end": request.end}
        )
        return ExternalAppointment(
            external_id=external_id,
            status="scheduled",
            start=request.start,
            end=request.end,
        )

    def cancel_appointment(self, external_id):
        record = self._records.get(external_id)
        if record is None:
            from app.integration.connector_interface import EHRNotFoundError

            raise EHRNotFoundError("no such vendor record")
        record["status"] = "cancelled"
        return ExternalAppointment(
            external_id=external_id,
            status="cancelled",
            start=record["start"],
            end=record["end"],
        )

    def get_appointment(self, external_id):
        record = self._records.get(external_id)
        if record is None:
            from app.integration.connector_interface import EHRNotFoundError

            raise EHRNotFoundError("no such vendor record")
        return ExternalAppointment(
            external_id=external_id,
            status=record["status"],
            start=record["start"],
            end=record["end"],
        )

    def find_appointment_by_idempotency_key(self, idempotency_key):
        external_id = f"vendor-{idempotency_key}"
        record = self._records.get(external_id)
        if record is None:
            return None
        return ExternalAppointment(
            external_id=external_id,
            status=record["status"],
            start=record["start"],
            end=record["end"],
        )


@pytest.fixture()
def fake_connector():
    return FakeConnector()


@pytest.fixture()
def tool_factory(db, fake_connector):
    set_integration_factory(
        lambda session: IntegrationService(
            session=session, connector=fake_connector
        )
    )
    yield fake_connector
    set_integration_factory(None)


def register_patient(client, tag):
    uid = uuid.uuid4().hex[:6]
    email = f"chat-{tag}-{uid}@example.com"
    assert (
        client.post(
            "/auth/register",
            json={
                "email": email,
                "password": "correct-horse-42",
                "role": "patient",
            },
        ).status_code
        == 201
    )
    tokens = client.post(
        "/auth/login", json={"email": email, "password": "correct-horse-42"}
    ).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    me = client.get("/patients/me", headers=headers).json()
    return {"headers": headers, "id": me["id"]}


def seed_setup(client, tag="mcp"):
    hosp = approved_hospital(client, tag=tag)
    hid = hosp["id"]
    spec = client.post(
        f"/hospitals/{hid}/specialties",
        json={"name": f"Cardiology {tag}"},
        headers=hosp["owner"],
    ).json()
    dept = client.post(
        f"/hospitals/{hid}/departments",
        json={"name": f"Heart {tag}"},
        headers=hosp["owner"],
    ).json()
    appt_type = client.post(
        f"/hospitals/{hid}/appointment-types",
        json={"name": f"Consult {tag}", "duration_minutes": 30},
        headers=hosp["owner"],
    ).json()
    doctor = client.post(
        f"/hospitals/{hid}/doctors",
        json={
            "name": f"Dr. {tag}",
            "specialty_id": spec["id"],
            "department_id": dept["id"],
        },
        headers=hosp["owner"],
    ).json()
    assert (
        client.post(
            f"/hospitals/{hid}/doctors/{doctor['id']}/activate",
            headers=hosp["owner"],
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/hospitals/{hid}/doctors/{doctor['id']}/availability-rules",
            json={
                "day_of_week": 0,
                "start_time": "09:00:00",
                "end_time": "17:00:00",
                "recurrence": "weekly",
            },
            headers=hosp["owner"],
        ).status_code
        == 201
    )
    patient = register_patient(client, tag)
    return {
        "hosp": hosp,
        "hid": hid,
        "spec": spec,
        "type": appt_type,
        "doctor": doctor,
        "patient": patient,
    }


def patient_ctx(setup) -> RequestContext:
    return RequestContext(
        user_id=uuid.UUID(setup["patient"]["id"]),
        role=Role.patient,
        hospital_id=None,
    )


def slot_iso(day=MONDAY, hour=9):
    start = datetime.fromisoformat(f"{day}T{hour:02d}:00:00+00:00")
    return start.isoformat(), (start + timedelta(minutes=30)).isoformat()


# -- registry / middleware -----------------------------------------------------


def test_registry_lists_eighteen_tools(client, tool_factory):
    setup = seed_setup(client)
    resp = client.get("/mcp/tools", headers=setup["patient"]["headers"])
    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()["tools"]}
    assert names == set(server._TOOLS.keys())
    assert len(names) == 19
    assert "create_appointment" in names
    assert "transfer_to_human" in names
    assert "verify_caller_identity" in names
    assert "list_appointment_types" in names


def test_mcp_requires_auth(client, tool_factory):
    assert client.get("/mcp/tools").status_code == 401
    assert (
        client.post(
            "/mcp/call", json={"tool": "search_hospitals", "input": {}}
        ).status_code
        == 401
    )


def test_role_enforcement_and_error_audit(client, db, tool_factory):
    setup = seed_setup(client)
    resp = client.post(
        "/mcp/call",
        json={
            "tool": "send_notification",
            "input": {
                "recipient_user_id": setup["patient"]["id"],
                "channel": "in_app",
                "message": "hello",
            },
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 403
    rows = db.query(CapabilityExecution).all()
    assert len(rows) == 1
    assert rows[0].tool_name == "send_notification"
    assert rows[0].status.value == "error"
    assert rows[0].actor_user_id == uuid.UUID(setup["patient"]["id"])
    assert rows[0].latency_ms >= 0


def test_create_requires_idempotency_key(client, db, tool_factory):
    setup = seed_setup(client)
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


def test_unknown_tool_is_404(client, tool_factory):
    setup = seed_setup(client)
    resp = client.post(
        "/mcp/call",
        json={"tool": "prescribe_medication", "input": {}},
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 404


def test_successful_call_writes_success_audit(client, db, tool_factory):
    setup = seed_setup(client, tag="auditok")
    resp = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {"specialty": "Cardiology auditok"}},
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 200
    assert len(resp.json()["result"]["doctors"]) == 1
    rows = db.query(CapabilityExecution).all()
    assert len(rows) == 1
    assert rows[0].status.value == "success"
    assert rows[0].correlation_id is not None


# -- search scope --------------------------------------------------------------


def test_search_hospitals_shows_only_approved(client, tool_factory):
    setup = seed_setup(client, tag="hospvis")
    pending = client.post(
        "/hospitals",
        json={
            "name": "Pending Clinic",
            "address": "2 Side St",
            "contact_email": "p-pending@example.com",
            "contact_phone": "+1-555-0101",
            "admin_email": "a-pending@example.com",
            "admin_password": "correct-horse-42",
        },
    )
    assert pending.status_code == 201
    resp = client.post(
        "/mcp/call",
        json={"tool": "search_hospitals", "input": {}},
        headers=setup["patient"]["headers"],
    )
    names = [h["name"] for h in resp.json()["result"]["hospitals"]]
    assert f"Hospital hospvis" in names
    assert "Pending Clinic" not in names


def test_search_doctors_active_and_specialty(client, tool_factory):
    setup = seed_setup(client, tag="docvis")
    hid = setup["hid"]
    # Second doctor, never activated.
    spec2 = client.post(
        f"/hospitals/{hid}/specialties",
        json={"name": "Neurology docvis"},
        headers=setup["hosp"]["owner"],
    ).json()
    dept = client.post(
        f"/hospitals/{hid}/departments",
        json={"name": "Brain docvis"},
        headers=setup["hosp"]["owner"],
    ).json()
    client.post(
        f"/hospitals/{hid}/doctors",
        json={
            "name": "Dr. Inactive",
            "specialty_id": spec2["id"],
            "department_id": dept["id"],
        },
        headers=setup["hosp"]["owner"],
    )
    resp = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {"specialty": "Cardiology docvis"}},
        headers=setup["patient"]["headers"],
    )
    docs = resp.json()["result"]["doctors"]
    assert [d["name"] for d in docs] == [f"Dr. docvis"]
    resp_all = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {}},
        headers=setup["patient"]["headers"],
    )
    assert "Dr. Inactive" not in [
        d["name"] for d in resp_all.json()["result"]["doctors"]
    ]


def test_list_appointment_types_tool(client, tool_factory):
    setup = seed_setup(client, tag="listtypes")
    resp = client.post(
        "/mcp/call",
        json={
            "tool": "list_appointment_types",
            "input": {"hospital_id": setup["hid"]},
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 200, resp.text
    types = resp.json()["result"]["appointment_types"]
    assert types == [
        {
            "id": setup["type"]["id"],
            "name": f"Consult listtypes",
            "duration_minutes": 30,
        }
    ]


def test_chat_reply_carries_doctor_cards(client, db, tool_factory):
    setup = seed_setup(client, tag="chatcards")
    ctx = patient_ctx(setup)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "search_doctors",
                    "arguments": {"specialty": "Cardiology chatcards"},
                }
            ],
        },
        {"content": "Dr. chatcards is available this week.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-chatcards",
        user_message="Find me a cardiologist",
        complete=complete,
    )
    assert result["doctors"] == [
        {
            "id": setup["doctor"]["id"],
            "name": "Dr. chatcards",
            "photo_url": None,
            "hospital_name": "Hospital chatcards",
            "hospital_city": None,
            "specialty": "Cardiology chatcards",
        }
    ]
    # The HTTP chat contract accepts the enriched payload.
    from app.ai.router import ChatOut

    body = ChatOut(**result)
    assert body.doctors[0].id == setup["doctor"]["id"]
    http_resp = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {}},
        headers=setup["patient"]["headers"],
    )
    assert any(
        d["hospital_city"] is None
        for d in http_resp.json()["result"]["doctors"]
    )


def test_check_availability_returns_real_slots(client, tool_factory):
    setup = seed_setup(client, tag="slots")
    start, _ = slot_iso()
    day = start[:10]
    resp = client.post(
        "/mcp/call",
        json={
            "tool": "check_availability",
            "input": {
                "doctor_id": setup["doctor"]["id"],
                "appointment_type_id": setup["type"]["id"],
                "date_from": day,
                "date_to": day,
            },
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 200
    slots = resp.json()["result"]["slots"]
    assert len(slots) == 16  # 8h / 30min
    assert slots[0]["start"] == start


def test_lookup_patient_self_only(client, tool_factory):
    setup = seed_setup(client, tag="selfonly")
    other = register_patient(client, "otherone")
    me = client.post(
        "/mcp/call",
        json={"tool": "lookup_patient", "input": {}},
        headers=setup["patient"]["headers"],
    )
    assert me.json()["result"]["id"] == setup["patient"]["id"]
    denied = client.post(
        "/mcp/call",
        json={"tool": "lookup_patient", "input": {"patient_id": other["id"]}},
        headers=setup["patient"]["headers"],
    )
    assert denied.status_code == 403


# -- booking through tools -----------------------------------------------------


def book_via_tool(client, setup, key="tool-book-1"):
    start, end = slot_iso()
    return client.post(
        "/mcp/call",
        json={
            "tool": "create_appointment",
            "input": {
                "doctor_id": setup["doctor"]["id"],
                "appointment_type_id": setup["type"]["id"],
                "slot_start": start,
                "slot_end": end,
                "idempotency_key": key,
            },
        },
        headers=setup["patient"]["headers"],
    )


def test_create_verify_and_get_roundtrip(client, db, tool_factory):
    setup = seed_setup(client, tag="roundtrip")
    booked = book_via_tool(client, setup)
    assert booked.status_code == 200
    body = booked.json()["result"]
    assert body["outcome"] == "confirmed"
    assert body["created"] is True

    verify = client.post(
        "/mcp/call",
        json={
            "tool": "verify_external_appointment",
            "input": {"appointment_id": body["appointment_id"]},
        },
        headers=setup["patient"]["headers"],
    )
    assert verify.json()["result"]["outcome"] == "matched"

    got = client.post(
        "/mcp/call",
        json={
            "tool": "get_appointment",
            "input": {"appointment_id": body["appointment_id"]},
        },
        headers=setup["patient"]["headers"],
    )
    assert got.json()["result"]["state"] == "confirmed"


def test_tool_booking_is_idempotent(client, tool_factory, fake_connector):
    setup = seed_setup(client, tag="idemtool")
    first = book_via_tool(client, setup, key="same-key")
    second = book_via_tool(client, setup, key="same-key")
    assert first.json()["result"]["appointment_id"] == second.json()[
        "result"
    ]["appointment_id"]
    assert second.json()["result"]["created"] is False
    assert fake_connector.creates == 1


def test_phase11_tools_are_live_not_stubs(client, tool_factory):
    """Questionnaires went live in Phase 11 (tested in test_questionnaire)."""
    setup = seed_setup(client, tag="stubs")
    resp = client.post(
        "/mcp/call",
        json={
            "tool": "get_questionnaire",
            "input": {"appointment_id": str(uuid.uuid4())},
        },
        headers=setup["patient"]["headers"],
    )
    # Unknown appointment -> 404 from the shared lookup, never 501.
    assert resp.status_code == 404


def test_update_preferences_persists_to_postgres_model(client, db, tool_factory):
    setup = seed_setup(client, tag="prefs")
    resp = client.post(
        "/mcp/call",
        json={
            "tool": "update_preferences",
            "input": {
                "preferred_time_of_day": "morning",
                "preferred_consultation_mode": "video",
            },
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 200
    row = db.query(User).filter(User.id == uuid.UUID(setup["patient"]["id"])).one()
    assert row is not None
    ctx_row = client.get(
        "/patients/me/preferences", headers=setup["patient"]["headers"]
    ).json()
    assert ctx_row["preferred_time_of_day"] == "morning"
    assert ctx_row["preferred_consultation_mode"] == "video"


def test_transfer_to_human_persists_escalation(client, db, tool_factory):
    setup = seed_setup(client, tag="escalate")
    resp = client.post(
        "/mcp/call",
        json={
            "tool": "transfer_to_human",
            "input": {"conversation_id": "conv-1", "reason": "Patient asked to talk"},
        },
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()["result"]
    assert body["status"] == "open"
    row = db.query(Escalation).filter(Escalation.id == uuid.UUID(body["escalation_id"])).one()
    assert row.conversation_id == "conv-1"
    assert row.created_by_user_id == uuid.UUID(setup["patient"]["id"])


# -- orchestrator --------------------------------------------------------------


def scripted(*steps):
    """Fake `complete`: each call pops the next scripted LLM step."""
    queue = list(steps)

    def _complete(messages, specs):
        assert specs, "tools must be advertised to the model"
        assert queue, "model called more times than scripted"
        return queue.pop(0)

    _complete.messages_seen = []
    outer = _complete

    def wrapper(messages, specs):
        outer.messages_seen.append(messages)
        return outer(messages, specs)

    wrapper.messages_seen = outer.messages_seen
    return wrapper


def test_chat_books_cardiologist_end_to_end(client, db, tool_factory):
    setup = seed_setup(client, tag="chatbook")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "search_doctors",
                    "arguments": {"specialty": f"Cardiology chatbook"},
                }
            ],
        },
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c2",
                    "name": "check_availability",
                    "arguments": {
                        "doctor_id": setup["doctor"]["id"],
                        "appointment_type_id": setup["type"]["id"],
                        "date_from": MONDAY,
                        "date_to": MONDAY,
                    },
                }
            ],
        },
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c3",
                    "name": "create_appointment",
                    "arguments": {
                        "doctor_id": setup["doctor"]["id"],
                        "appointment_type_id": setup["type"]["id"],
                        "slot_start": start,
                        "slot_end": end,
                        "idempotency_key": "chat-book-1",
                    },
                }
            ],
        },
        {"content": "Booked with Dr. chatbook for Monday 9:00.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-chatbook",
        user_message="I need a cardiologist this week",
        complete=complete,
    )
    assert result["reply"].startswith("Booked")
    assert result["iterations"] == 4
    assert result["escalated"] is False
    appt = (
        db.query(Appointment)
        .filter(Appointment.idempotency_key == "chat-book-1")
        .one()
    )
    assert appt.state.value == "confirmed"
    remembered = get_ai_context("conv-chatbook")
    assert remembered.last_appointment_id == str(appt.id)
    assert db.query(CapabilityExecution).count() == 3


def test_chat_declines_clinical_question_without_tools(client, db, tool_factory):
    setup = seed_setup(client, tag="clinical")
    ctx = patient_ctx(setup)
    calls = []

    def _complete(messages, specs):
        calls.append((messages, specs))
        return {"content": "SHOULD NOT HAPPEN", "tool_calls": []}

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-clinical",
        user_message="What does this mean for my heart?",
        complete=_complete,
    )
    assert result["reply"] == orchestrator.CLINICAL_DECLINE
    assert result["iterations"] == 0
    assert calls == []
    assert db.query(CapabilityExecution).count() == 0


def test_chat_scheduling_intent_with_symptom_still_books(client, db, tool_factory):
    setup = seed_setup(client, tag="mixedmsg")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
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
                        "idempotency_key": "mixed-1",
                    },
                }
            ],
        },
        {"content": "Booked.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-mixed",
        user_message="My chest has been hurting; I need to book a cardiologist",
        complete=complete,
    )
    assert result["reply"] == "Booked."
    assert result["iterations"] == 2


def test_chat_max_iterations_guard(client, db, tool_factory):
    setup = seed_setup(client, tag="loopy")
    ctx = patient_ctx(setup)

    def stubborn(messages, specs):
        return {
            "content": None,
            "tool_calls": [
                {"id": "c", "name": "get_context", "arguments": {"conversation_id": "x"}}
            ],
        }

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-loopy",
        user_message="Book something whenever",
        complete=stubborn,
        max_iterations=3,
    )
    assert result["reply"] == orchestrator.LOOP_EXHAUSTED
    assert result["iterations"] == 3


def test_chat_vendor_fault_parks_via_reconciliation(client, db, tool_factory, fake_connector):
    setup = seed_setup(client, tag="chatfault")
    fake_connector.fail_create = True
    fake_connector.create_error = EHRTimeoutError
    start, end = slot_iso()
    ctx = patient_ctx(setup)
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
                        "idempotency_key": "chat-fault-1",
                    },
                }
            ],
        },
        {
            "content": "Your slot is held while we confirm with the clinic.",
            "tool_calls": [],
        },
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-chatfault",
        user_message="Book the Monday morning slot",
        complete=complete,
    )
    assert "held" in result["reply"]
    appt = (
        db.query(Appointment)
        .filter(Appointment.idempotency_key == "chat-fault-1")
        .one()
    )
    assert appt.state.value == "reconciliation_required"
    assert (
        db.query(ReconciliationRecord)
        .filter(ReconciliationRecord.appointment_id == appt.id)
        .count()
        == 1
    )


def test_chat_that_one_resolves_from_context(client, db, tool_factory):
    setup = seed_setup(client, tag="thatone")
    start, end = slot_iso()
    context = get_ai_context("conv-thatone")
    context.offered_slots = [{"start": start, "end": end}]
    context.selected_doctor_id = setup["doctor"]["id"]
    save_ai_context(context)
    ctx = patient_ctx(setup)
    seen: dict = {}

    def complete(messages, specs):
        seen["system"] = messages[0]["content"]
        return {
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
                        "idempotency_key": "that-one-1",
                    },
                }
            ],
        }

    second_messages = []

    def complete_twice(messages, specs):
        if "system" not in seen:
            return complete(messages, specs)
        second_messages.append(messages)
        return {"content": "Booked that one.", "tool_calls": []}

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-thatone",
        user_message="Yes, book that one",
        complete=complete_twice,
    )
    assert result["reply"] == "Booked that one."
    assert start in seen["system"]  # the model saw the offered slot
    appt = (
        db.query(Appointment).filter(Appointment.idempotency_key == "that-one-1").one()
    )
    assert appt.state.value == "confirmed"


def test_chat_escalation_marks_conversation(client, db, tool_factory):
    setup = seed_setup(client, tag="chatesc")
    ctx = patient_ctx(setup)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "transfer_to_human",
                    "arguments": {
                        "conversation_id": "conv-chatesc",
                        "reason": "Patient requested a human",
                    },
                }
            ],
        },
        {"content": "Connecting you with our care team.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-chatesc",
        user_message="Let me talk to a human please",
        complete=complete,
    )
    assert result["escalated"] is True
    assert db.query(Escalation).count() == 1


def test_agent_client_never_raises_on_tool_fault(db, tool_factory):
    setup_ctx = RequestContext(
        user_id=uuid.uuid4(), role=Role.patient, hospital_id=None
    )
    client = AgentToolClient(db, setup_ctx)
    outcome = client.call("get_appointment", {"appointment_id": str(uuid.uuid4())})
    assert outcome["ok"] is False
    assert "error" in outcome
    bad_args = client.call("search_doctors", {"hospital_id": "not-a-uuid"})
    assert bad_args["ok"] is False


def test_context_roundtrip_and_clear():
    context = get_ai_context("conv-rt")
    assert context.conversation_id == "conv-rt"
    assert context.offered_slots == []
    context.selected_doctor_id = "doc-1"
    context.remember_turn("user", "hello")
    save_ai_context(context)
    reloaded = get_ai_context("conv-rt")
    assert reloaded.selected_doctor_id == "doc-1"
    assert reloaded.history[-1] == {"role": "user", "text": "hello"}
    clear_ai_context("conv-rt")
    assert get_ai_context("conv-rt").history == []


def test_chat_endpoint_maps_missing_key_to_503(client, monkeypatch, tool_factory):
    from app.core.config import settings

    setup = seed_setup(client, tag="nokey")
    monkeypatch.setattr(settings, "llm_api_key", "")
    resp = client.post(
        "/chat",
        json={"message": "I need a cardiologist"},
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 503


def test_chat_endpoint_maps_model_failure_to_502(client, monkeypatch, tool_factory):
    import httpx

    import app.ai.router as chat_router

    setup = seed_setup(client, tag="badmodel")

    def _boom(**kwargs):
        raise httpx.ConnectError("model backend down")

    monkeypatch.setattr(chat_router, "run_conversation", _boom)
    resp = client.post(
        "/chat",
        json={"message": "I need a cardiologist"},
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 502


def test_tool_reschedule_cancel_and_sync_roundtrip(client, tool_factory):
    setup = seed_setup(client, tag="movecancel")
    booked = book_via_tool(client, setup, key="move-1").json()["result"]
    appt_id = booked["appointment_id"]
    h = setup["patient"]["headers"]
    start2, end2 = slot_iso(hour=10)

    moved = client.post(
        "/mcp/call",
        json={
            "tool": "reschedule_appointment",
            "input": {
                "appointment_id": appt_id,
                "slot_start": start2,
                "slot_end": end2,
            },
        },
        headers=h,
    )
    assert moved.status_code == 200
    assert moved.json()["result"]["state"] == "rescheduled"

    synced = client.post(
        "/mcp/call",
        json={"tool": "synchronize_state", "input": {"appointment_id": appt_id}},
        headers=h,
    )
    assert synced.status_code == 200
    assert synced.json()["result"]["synchronized"] is True

    cancelled = client.post(
        "/mcp/call",
        json={"tool": "cancel_appointment", "input": {"appointment_id": appt_id}},
        headers=h,
    )
    assert cancelled.json()["result"]["state"] == "cancelled"


def test_mcp_call_maps_bad_input_to_422(client, tool_factory):
    setup = seed_setup(client, tag="badinput")
    resp = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {"hospital_id": "not-a-uuid"}},
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 422


def test_mcp_call_maps_empty_conversation_to_422(client, tool_factory):
    setup = seed_setup(client, tag="emptyconv")
    resp = client.post(
        "/mcp/call",
        json={"tool": "get_context", "input": {"conversation_id": "  "}},
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 422


def test_cors_allows_hospital_admin_origin():
    from fastapi.testclient import TestClient

    probe = TestClient(app)
    resp = probe.options(
        "/health",
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.status_code == 200
    assert "access-control-allow-origin" in {k.lower() for k in resp.headers}
