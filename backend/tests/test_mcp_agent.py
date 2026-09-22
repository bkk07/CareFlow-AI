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


def seed_setup(client, tag="mcp", platform=None):
    hosp = approved_hospital(client, tag=tag, platform=platform)
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


def slot_iso(day=MONDAY, hour=9, minutes=0):
    start = datetime.fromisoformat(f"{day}T{hour:02d}:{minutes:02d}:00+00:00")
    return start.isoformat(), (start + timedelta(minutes=30)).isoformat()


# -- registry / middleware -----------------------------------------------------


def test_registry_lists_eighteen_tools(client, tool_factory):
    setup = seed_setup(client)
    resp = client.get("/mcp/tools", headers=setup["patient"]["headers"])
    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()["tools"]}
    assert names == set(server._TOOLS.keys())
    assert len(names) == 20
    assert "get_day_schedule" in names
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
                "dedupe_key": "role-denied-1",
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
    assert len(result["doctors"]) == 1
    card = result["doctors"][0]
    for key, value in {
        "id": setup["doctor"]["id"],
        "name": "Dr. chatcards",
        "photo_url": None,
        "hospital_name": "Hospital chatcards",
        "hospital_city": None,
        "specialty": "Cardiology chatcards",
        "distance_km": None,
    }.items():
        assert card[key] == value, key
    # Concierge enrichment is additive only (backward compatible).
    assert isinstance(card.get("experience_years"), int)
    assert isinstance(card.get("consultation_types"), list)
    assert isinstance(card.get("available_durations"), list)
    assert isinstance(card.get("why_match"), list)
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


def test_greeting_turn_shows_no_stale_cards(client, db, tool_factory):
    """A plain greeting on a conversation with prior offers shows no cards.

    Regression: the turn payload used to dump the whole persisted
    offered_doctors/offered_slots, so stale doctor cards appeared under
    unrelated replies like "Hii".
    """
    setup = seed_setup(client, tag="stalehi")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    cid = "conv-stalehi"
    clear_ai_context(cid)
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. stalehi"}]
    prior.offered_slots = [{"start": start, "end": end}]
    save_ai_context(prior)

    def _boom(messages, specs):
        raise AssertionError("model must not be called for a greeting")

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Hii",
        complete=_boom,
    )
    assert result["reply"].startswith("Hi")
    assert result["doctors"] == []
    assert result["slots"] == []
    # Memory itself is kept so a follow-up "yes, book that one" still resolves.
    kept = get_ai_context(cid)
    assert kept.offered_doctors == [
        {"id": setup["doctor"]["id"], "name": "Dr. stalehi"}
    ]
    assert kept.offered_slots == [{"start": start, "end": end}]


def test_greeting_short_circuits_without_model_or_tools(client, db, tool_factory):
    """A bare 'Hii' is answered in code: no model call, no tools, no cards.

    Regression: stale context once made the model invent appointments and
    re-attach old doctor cards under plain greetings.
    """
    setup = seed_setup(client, tag="helloshort")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    cid = "conv-helloshort"
    clear_ai_context(cid)
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. helloshort"}]
    prior.offered_slots = [{"start": start, "end": end}]
    save_ai_context(prior)

    def _boom(messages, specs):
        raise AssertionError("model must not be called for a greeting")

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Hii",
        complete=_boom,
    )
    assert result["reply"].startswith("Hi")
    assert result["iterations"] == 0
    assert result["escalated"] is False
    assert result["doctors"] == []
    assert result["slots"] == []
    assert db.query(CapabilityExecution).count() == 0

    thanks = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-helloshort-thanks",
        user_message="thanks!",
        complete=_boom,
    )
    assert thanks["reply"].startswith("You're most welcome")

    bye = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-helloshort-bye",
        user_message="bye",
        complete=_boom,
    )
    assert bye["reply"].startswith("Take care")


def test_greeting_with_care_request_passes_through(client, db, tool_factory):
    """'Hi, I need a cardiologist' is not bare small talk: it reaches the model."""
    setup = seed_setup(client, tag="hipass")
    ctx = patient_ctx(setup)
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-hipass",
        user_message="Hi, I need a cardiologist",
        complete=scripted({"content": "Sure — which city?", "tool_calls": []}),
    )
    assert result["reply"] == "Sure — which city?"
    assert result["iterations"] == 1


def _seed_many_doctors(client, hosp, tag, count):
    """Extra active doctors sharing one specialty, for paging tests."""
    from tests.test_patient import seed_refs

    hid = hosp["id"]
    spec = client.post(
        f"/hospitals/{hid}/specialties",
        json={"name": f"Skin {tag}"},
        headers=hosp["owner"],
    ).json()
    dept = client.post(
        f"/hospitals/{hid}/departments",
        json={"name": f"Derma {tag}"},
        headers=hosp["owner"],
    ).json()
    ids = []
    for i in range(count):
        doctor = client.post(
            f"/hospitals/{hid}/doctors",
            json={
                "name": f"Dr. Page{i:02d} {tag}",
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
        ids.append(doctor["id"])
    return spec, ids


def test_search_doctors_paginates_with_total(client, tool_factory):
    setup = seed_setup(client, tag="page")
    _seed_many_doctors(client, setup["hosp"], "page", 7)
    h = setup["patient"]["headers"]
    first = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {"specialty": "Skin page", "limit": 5, "offset": 0}},
        headers=h,
    )
    assert first.status_code == 200, first.text
    body = first.json()["result"]
    assert body["total"] == 7
    assert len(body["doctors"]) == 5
    second = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {"specialty": "Skin page", "limit": 5, "offset": 5}},
        headers=h,
    )
    body2 = second.json()["result"]
    assert body2["total"] == 7
    assert len(body2["doctors"]) == 2
    assert {d["id"] for d in body["doctors"]} != {d["id"] for d in body2["doctors"]}


def test_chat_explore_more_offers_next_page(client, db, tool_factory):
    """First search shows 5 + has_more; the offset-5 turn shows the rest."""
    setup = seed_setup(client, tag="more")
    _seed_many_doctors(client, setup["hosp"], "more", 7)
    ctx = patient_ctx(setup)
    cid = "conv-more"
    clear_ai_context(cid)
    turn1 = scripted(
        {
            "content": None,
            "tool_calls": [
                {"id": "c1", "name": "search_doctors", "arguments": {"specialty": "Skin more", "limit": 5, "offset": 0}}
            ],
        },
        {"content": "Here are a few good options near you.", "tool_calls": []},
    )
    r1 = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="I need a dermatologist", complete=turn1,
    )
    assert len(r1["doctors"]) == 5
    assert r1["doctors_total"] == 7
    assert r1["has_more_doctors"] is True
    assert r1["booking_stage"] == "browse"

    turn2 = scripted(
        {
            "content": None,
            "tool_calls": [
                {"id": "c2", "name": "search_doctors", "arguments": {"specialty": "Skin more", "limit": 5, "offset": 5}}
            ],
        },
        {"content": "Here are a few more.", "tool_calls": []},
    )
    r2 = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Show me more doctors", complete=turn2,
    )
    assert len(r2["doctors"]) == 2
    assert r2["doctors_total"] == 7
    assert r2["has_more_doctors"] is False
    # Memory accumulated both pages for "that one" resolution.
    assert len(get_ai_context(cid).offered_doctors) == 7


def test_chat_doctor_pick_moves_stage_to_date(client, db, tool_factory):
    """Naming an offered doctor records the pick; stage becomes pick_date."""
    setup = seed_setup(client, tag="pick")
    ctx = patient_ctx(setup)
    cid = "conv-pick"
    clear_ai_context(cid)
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. pick"}]
    prior.offered_doctor_page = [setup["doctor"]["id"]]
    save_ai_context(prior)
    result = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="I'll go with the first one",
        complete=scripted({"content": "Great choice — which day suits you?", "tool_calls": []}),
    )
    assert result["booking_stage"] == "pick_date"
    # Nothing searched this turn, but the chosen doctor's profile card
    # stays visible so the patient sees WHO the date step is about.
    assert [d["id"] for d in result["doctors"]] == [setup["doctor"]["id"]]
    assert result["has_more_doctors"] is False
    assert get_ai_context(cid).selected_doctor_id == setup["doctor"]["id"]


def test_detect_doctor_selection_handles_typos():
    """Misspelled names still resolve ("Badaru Kiran" ~ "Bandaru Kiran")."""
    from app.ai.agent.orchestrator import detect_doctor_selection
    from app.ai.context.ai_context import AIContext

    def _ctx(names):
        return AIContext(
            conversation_id="x",
            offered_doctors=[{"id": f"id-{i}", "name": n} for i, n in enumerate(names)],
            offered_doctor_page=[f"id-{i}" for i in range(len(names))],
        )

    ctx = _ctx(["Bandaru Kiran", "Dr. Vikram Menon", "Dr. E2E"])
    assert detect_doctor_selection(ctx, "Badaru Kiran") == "id-0"
    assert detect_doctor_selection(ctx, "Kiran") == "id-0"
    assert detect_doctor_selection(ctx, "Vikram Menon") == "id-1"
    assert detect_doctor_selection(ctx, "the second one") == "id-1"
    assert detect_doctor_selection(ctx, "I need a cardiologist") is None
    assert detect_doctor_selection(ctx, "Hi") is None
    # Shared token across two doctors -> ambiguous -> None.
    dup = _ctx(["Rao Menon", "Rao Iyer"])
    assert detect_doctor_selection(dup, "Rao") is None
    assert detect_doctor_selection(dup, "Rao Menon") == "id-0"


def test_typo_pick_shows_matching_profile_card(client, db, tool_factory):
    """The card under a typo'd pick is the picked doctor, not a stale one."""
    setup = seed_setup(client, tag="typo")
    ctx = patient_ctx(setup)
    cid = "conv-typo"
    clear_ai_context(cid)
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Bandaru Typo"}]
    prior.offered_doctor_page = [setup["doctor"]["id"]]
    prior.selected_doctor_id = "00000000-0000-0000-0000-000000000000"
    save_ai_context(prior)
    result = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Badaru Typo",
        complete=scripted({"content": "Great choice — which day suits you?", "tool_calls": []}),
    )
    assert [d["id"] for d in result["doctors"]] == [setup["doctor"]["id"]]
    assert get_ai_context(cid).selected_doctor_id == setup["doctor"]["id"]


def test_fresh_search_resets_stale_selection(client, db, tool_factory):
    """A new search clears a previously picked doctor (new choice, new flow)."""
    setup = seed_setup(client, tag="reset")
    ctx = patient_ctx(setup)
    cid = "conv-reset"
    clear_ai_context(cid)
    prior = get_ai_context(cid)
    prior.selected_doctor_id = setup["doctor"]["id"]
    prior.selected_appointment_type_id = setup["type"]["id"]
    prior.visit_types_seen = True
    prior.visit_type_name = "Consult"
    prior.selected_consultation_mode = "video"
    save_ai_context(prior)
    result = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Actually find me a dermatologist",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {"id": "c1", "name": "search_doctors", "arguments": {"specialty": "Dermatology", "limit": 5, "offset": 0}}
                ],
            },
            {"content": "Here are dermatologists.", "tool_calls": []},
        ),
    )
    kept = get_ai_context(cid)
    assert kept.selected_doctor_id is None
    # Type/mode/day records survive a search (same-turn checks need them)
    # and reset when a booking completes instead — the next flow re-picks.
    assert kept.selected_appointment_type_id == setup["type"]["id"]
    assert kept.visit_type_name == "Consult"
    assert kept.visit_types_seen is True
    assert kept.selected_consultation_mode == "video"
    assert result["booking_stage"] == "browse"


def test_completed_booking_resets_picks_for_next_flow(client, db, tool_factory):
    """After a successful booking, type/mode/day must be picked again."""
    setup = seed_setup(client, tag="flowreset")
    start, end = slot_iso(hour=3, minutes=30)
    ctx = patient_ctx(setup)
    cid = "conv-flowreset"
    clear_ai_context(cid)
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. flowreset"}]
    prior.offered_slots = [{"start": start, "end": end}]
    prior.visit_types_seen = True
    prior.selected_appointment_type_id = setup["type"]["id"]
    prior.visit_type_name = "Consult"
    prior.selected_consultation_mode = "video"
    prior.selected_date = MONDAY
    save_ai_context(prior)
    result = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Yes, book it for Monday over video",
        complete=scripted(
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
                            "idempotency_key": "flowreset-1",
                        },
                    }
                ],
            },
            {"content": "Booked.", "tool_calls": []},
        ),
    )
    assert result["reply"] == "Booked."
    fresh = get_ai_context(cid)
    assert fresh.last_appointment_id
    assert fresh.flow_open is False
    assert fresh.visit_types_seen is False
    assert fresh.visit_type_name is None
    assert fresh.selected_appointment_type_id is None
    assert fresh.selected_consultation_mode is None
    assert fresh.selected_date is None


def test_guided_walkthrough_shows_only_next_step(client, db, tool_factory):
    """End-to-end §24 flow: each turn renders ONLY its step's widgets.

    search -> cards only; pick -> single card once; date -> schedule only;
    types -> select+modes only; mode+type pick -> nothing new; time check
    -> slots only; yes -> booked with mode. A later unrelated turn shows
    no doctor cards at all.
    """
    setup = seed_setup(client, tag="walk")
    start, end = slot_iso(hour=3, minutes=30)
    ctx = patient_ctx(setup)
    cid = "conv-walk"
    clear_ai_context(cid)
    doctor_name = "Dr. walk"
    type_name = "Consult walk"

    t1 = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="I need a cardiologist",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {"id": "c1", "name": "search_doctors", "arguments": {"specialty": "Cardiology walk", "limit": 5, "offset": 0}}
                ],
            },
            {"content": "Here are a few good options near you.", "tool_calls": []},
        ),
    )
    assert [d["id"] for d in t1["doctors"]] == [setup["doctor"]["id"]]
    assert t1["slots"] == [] and t1["appointment_types"] == []
    assert t1["day_schedule"] is None and t1["booking_stage"] == "browse"

    t2 = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message=doctor_name,
        complete=scripted({"content": "Great choice — which day suits you?", "tool_calls": []}),
    )
    assert [d["id"] for d in t2["doctors"]] == [setup["doctor"]["id"]]
    assert t2["booking_stage"] == "pick_date"
    assert t2["slots"] == [] and t2["appointment_types"] == []

    t3 = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Monday",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {"id": "c2", "name": "get_day_schedule", "arguments": {"doctor_id": setup["doctor"]["id"], "date": MONDAY}}
                ],
            },
            {"content": "Monday looks open — what type of visit?", "tool_calls": []},
        ),
    )
    assert t3["doctors"] == []  # chosen card NOT repeated
    assert t3["day_schedule"]["date"] == MONDAY
    assert t3["booking_stage"] == "pick_time"

    t4 = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Show me the visit types",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {"id": "c3", "name": "list_appointment_types", "arguments": {"hospital_id": setup["hid"]}}
                ],
            },
            {"content": "Pick a type — video, phone, or in-person?", "tool_calls": []},
        ),
    )
    assert t4["doctors"] == []
    assert len(t4["appointment_types"]) == 1
    assert set(t4["consultation_modes"]) == {"video", "phone", "in_person"}
    assert t4["booking_stage"] == "pick_type"

    t5 = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message=f"{type_name} over video please",
        complete=scripted({"content": "Got it — what start time?", "tool_calls": []}),
    )
    # Nothing new to show: no re-blast of cards, types, modes, or schedule.
    assert t5["doctors"] == [] and t5["slots"] == []
    assert t5["appointment_types"] == [] and t5["consultation_modes"] == []
    assert t5["day_schedule"] is None
    kept = get_ai_context(cid)
    assert kept.selected_appointment_type_id == setup["type"]["id"]
    assert kept.selected_consultation_mode == "video"

    t6 = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Monday at 9:00 AM",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {
                        "id": "c4",
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
            {"content": "9:00–9:30 AM is available. Shall I book it?", "tool_calls": []},
        ),
    )
    assert len(t6["slots"]) == 10  # response caps the 16 real slots at 10
    assert t6["slots"][0]["start"] == start
    assert t6["doctors"] == [] and t6["appointment_types"] == []

    t7 = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Yes, book it",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {
                        "id": "c5",
                        "name": "create_appointment",
                        "arguments": {
                            "doctor_id": setup["doctor"]["id"],
                            "appointment_type_id": setup["type"]["id"],
                            "slot_start": start,
                            "slot_end": end,
                            "idempotency_key": "walk-1",
                        },
                    }
                ],
            },
            {"content": "Your appointment is confirmed.", "tool_calls": []},
        ),
    )
    assert t7["pending_booking"] is None
    appt = db.query(Appointment).filter(Appointment.idempotency_key == "walk-1").one()
    assert appt.consultation_mode == "video"
    assert t7["doctors"] == []  # booked turn shows no cards either

    # A later unrelated question re-renders nothing from the flow: the
    # completed booking closed it, so the stage is back to browse.
    t8 = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="What are the hospital visiting hours?",
        complete=scripted({"content": "9 AM to 6 PM daily.", "tool_calls": []}),
    )
    assert t8["booking_stage"] == "browse"
    assert t8["doctors"] == [] and t8["slots"] == []
    assert t8["appointment_types"] == [] and t8["consultation_modes"] == []
    assert t8["day_schedule"] is None and t8["pending_booking"] is None


def test_doctor_change_drops_old_availability(client, db, tool_factory):
    """Naming a different doctor clears the previous doctor's slots."""
    setup = seed_setup(client, tag="switch")
    _seed_many_doctors(client, setup["hosp"], "switch", 1)
    ctx = patient_ctx(setup)
    cid = "conv-switch"
    clear_ai_context(cid)
    prior = get_ai_context(cid)
    prior.offered_doctors = [
        {"id": setup["doctor"]["id"], "name": "Dr. switch"},
    ]
    prior.offered_slots = [{"start": "2026-10-05T03:30:00+00:00", "end": "2026-10-05T04:00:00+00:00"}]
    prior.selected_doctor_id = setup["doctor"]["id"]
    save_ai_context(prior)
    others = [d for d in get_ai_context(cid).offered_doctors]
    assert len(others) == 1
    # Simulate a second offered doctor, then switch to them by ordinal.
    from tests.test_mcp_agent import seed_setup as _s  # noqa: F401  (self-module, no-op guard)

    prior2 = get_ai_context(cid)
    second_id = "11111111-2222-3333-4444-555555555555"
    prior2.offered_doctors.append({"id": second_id, "name": "Dr. Second Switch"})
    prior2.offered_doctor_page = [setup["doctor"]["id"], second_id]
    save_ai_context(prior2)
    result = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Actually the second one",
        complete=scripted({"content": "Switched — which day?", "tool_calls": []}),
    )
    kept = get_ai_context(cid)
    assert kept.selected_doctor_id == second_id
    assert kept.offered_slots == []
    assert result["booking_stage"] == "pick_date"


def test_chat_type_and_schedule_payloads_and_stage(client, db, tool_factory):
    """list_appointment_types / get_day_schedule ride the turn payload."""
    setup = seed_setup(client, tag="stage")
    ctx = patient_ctx(setup)
    type_id = setup["type"]["id"]
    turn = scripted(
        {
            "content": None,
            "tool_calls": [
                {"id": "c1", "name": "list_appointment_types", "arguments": {"hospital_id": setup["hid"]}}
            ],
        },
        {
            "content": None,
            "tool_calls": [
                {"id": "c2", "name": "get_day_schedule", "arguments": {"doctor_id": setup["doctor"]["id"], "date": MONDAY}}
            ],
        },
        {"content": "Monday looks good — what time?", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id="conv-stage",
        user_message="Monday works for me", complete=turn,
    )
    assert result["booking_stage"] == "pick_time"
    assert {"id": type_id} == {"id": result["appointment_types"][0]["id"]}
    assert result["appointment_types"][0]["duration_minutes"] == 30
    sched = result["day_schedule"]
    assert sched["date"] == MONDAY
    assert len(sched["working_hours"]) > 0
    assert "busy" in sched
    from app.ai.router import ChatOut

    ChatOut(**result)


def test_chat_create_refused_until_visit_type_picked(client, db, tool_factory):
    """Booking/availability wait for the visit-type step — never a guessed duration."""
    setup = seed_setup(client, tag="typegate")
    start, end = slot_iso(hour=3, minutes=30)
    ctx = patient_ctx(setup)
    cid = "conv-typegate"
    clear_ai_context(cid)
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. typegate"}]
    prior.offered_slots = [{"start": start, "end": end}]
    save_ai_context(prior)

    refused = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Yes, book it",
        complete=scripted(
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
                            "idempotency_key": "typegate-1",
                        },
                    }
                ],
            },
            {"content": "Is this a routine check-up or something specific?", "tool_calls": []},
        ),
    )
    assert "routine check-up" in refused["reply"]
    assert db.query(Appointment).count() == 0
    assert get_ai_context(cid).awaiting_confirmation is False

    # The patient picks the shown type by name: recorded deterministically.
    listed = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Show me the visit types",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {"id": "c2", "name": "list_appointment_types", "arguments": {"hospital_id": setup["hid"]}}
                ],
            },
            {"content": "We have these visit types — which one?", "tool_calls": []},
        ),
    )
    assert len(listed["appointment_types"]) == 1
    assert listed["booking_stage"] == "pick_type"
    picked = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Consult",
        complete=scripted({"content": "Got it — Consult it is.", "tool_calls": []}),
    )
    kept = get_ai_context(cid)
    assert kept.selected_appointment_type_id == setup["type"]["id"]
    assert kept.visit_type_name == listed["appointment_types"][0]["name"]
    assert picked["booking_stage"] == "browse"

    booked = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Yes, book it for Monday over video",
        complete=scripted(
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
                            "idempotency_key": "typegate-1",
                        },
                    }
                ],
            },
            {"content": "Booked.", "tool_calls": []},
        ),
    )
    assert booked["reply"] == "Booked."
    assert db.query(Appointment).filter(Appointment.idempotency_key == "typegate-1").count() == 1


def test_detect_consultation_mode_picks_earliest():
    from app.ai.agent.orchestrator import detect_consultation_mode

    assert detect_consultation_mode("Video visit please") == "video"
    assert detect_consultation_mode("a phone call is fine") == "phone"
    assert detect_consultation_mode("normal in-person visit") == "in_person"
    assert detect_consultation_mode("meet at the clinic") == "in_person"
    assert detect_consultation_mode("video or phone") == "video"
    assert detect_consultation_mode("I want something nearby") is None
    assert detect_consultation_mode("") is None


def test_chat_consultation_mode_flows_to_booking(client, db, tool_factory):
    """Mode chips ride the types turn; the pick lands on the booking."""
    setup = seed_setup(client, tag="consmode")
    start, end = slot_iso(hour=3, minutes=30)
    ctx = patient_ctx(setup)
    cid = "conv-consmode"
    clear_ai_context(cid)
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. consmode"}]
    prior.offered_doctor_page = [setup["doctor"]["id"]]
    prior.selected_doctor_id = setup["doctor"]["id"]
    save_ai_context(prior)

    listed = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Show me the visit types",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {"id": "c1", "name": "list_appointment_types", "arguments": {"hospital_id": setup["hid"]}}
                ],
            },
            {"content": "Pick a type — and video, phone, or in-person?", "tool_calls": []},
        ),
    )
    assert set(listed["consultation_modes"]) == {"video", "phone", "in_person"}
    from app.ai.router import ChatOut

    ChatOut(**listed)

    # Standalone type + mode message is recorded deterministically.
    orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Consult over video please",
        complete=scripted({"content": "Video it is.", "tool_calls": []}),
    )
    assert get_ai_context(cid).selected_consultation_mode == "video"

    # An unconfirmed booking attempt carries the mode into the proposal.
    attempt = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Book Monday morning",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {
                        "id": "c2",
                        "name": "create_appointment",
                        "arguments": {
                            "doctor_id": setup["doctor"]["id"],
                            "appointment_type_id": setup["type"]["id"],
                            "slot_start": start,
                            "slot_end": end,
                            "idempotency_key": "consmode-1",
                            "consultation_mode": "video",
                        },
                    }
                ],
            },
            {"content": "Shall I book Monday 9 AM over video?", "tool_calls": []},
        ),
    )
    pending = get_ai_context(cid).pending_booking or {}
    assert pending.get("consultation_mode") == "video"
    assert (attempt["pending_booking"] or {}).get("consultation_mode") == "video"


def test_detect_date_iso_covers_common_phrasings():
    from datetime import date as _date

    from app.ai.agent.orchestrator import detect_date_iso

    monday = _date(2026, 10, 5)  # a Monday
    assert detect_date_iso("book a meeting tomorrow", monday) == "2026-10-06"
    assert detect_date_iso("today please", monday) == "2026-10-05"
    assert detect_date_iso("day after tomorrow", monday) == "2026-10-07"
    assert detect_date_iso("Monday", monday) == "2026-10-05"
    assert detect_date_iso("see you Friday", monday) == "2026-10-09"
    assert detect_date_iso("next Fri", monday) == "2026-10-09"
    assert detect_date_iso("Nov 2", monday) == "2026-11-02"
    assert detect_date_iso("2nd Nov", monday) == "2026-11-02"
    assert detect_date_iso("2026-11-02", monday) == "2026-11-02"
    # Already passed this year -> next year.
    assert detect_date_iso("Sep 21", monday) == "2027-09-21"
    assert detect_date_iso("Jan 5", _date(2026, 10, 5)) == "2027-01-05"
    # Explicit beats weekday beats relative.
    assert detect_date_iso("can't do tomorrow, Friday works", monday) == "2026-10-09"
    # No day given.
    assert detect_date_iso("I need a cardiologist", monday) is None
    assert detect_date_iso("Hi", monday) is None
    assert detect_date_iso("", monday) is None


def test_chat_known_date_skips_reask_and_keeps_profile(client, db, tool_factory):
    """'Book a meeting tomorrow' uses tomorrow directly — no date re-ask.

    The chosen doctor was picked on an earlier turn, so no profile card
    is re-blasted here — only the fresh day schedule renders.
    """
    from datetime import datetime as _dt
    from datetime import timezone as _tz

    setup = seed_setup(client, tag="knowndate")
    ctx = patient_ctx(setup)
    cid = "conv-knowndate"
    clear_ai_context(cid)
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. knowndate"}]
    prior.offered_doctor_page = [setup["doctor"]["id"]]
    prior.selected_doctor_id = setup["doctor"]["id"]
    prior.visit_types_seen = True
    save_ai_context(prior)
    tomorrow = (_dt.now(_tz.utc).date() + timedelta(days=1)).isoformat()
    turn = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "get_day_schedule",
                    "arguments": {"doctor_id": setup["doctor"]["id"], "date": tomorrow},
                }
            ],
        },
        {"content": "Tomorrow looks open — what time suits you?", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Book a meeting tomorrow", complete=turn,
    )
    # Date recorded deterministically and used straight away.
    assert get_ai_context(cid).selected_date == tomorrow
    assert result["day_schedule"]["date"] == tomorrow
    assert result["booking_stage"] == "pick_time"
    # Nothing newly picked this turn, so no card re-blast — only the
    # fresh day schedule renders.
    assert result["doctors"] == []


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
    # Rules are IST wall time: 09:00 IST == 03:30 UTC.
    assert slots[0]["start"] == day + "T03:30:00+00:00"
    # IST display strings so the model never reads UTC aloud as local.
    assert slots[0]["start_ist"] == "9:00 AM"
    assert slots[0]["end_ist"] == "9:30 AM"
    assert slots[0]["day_ist"] == "Mon, Oct 5"


def test_ist_labels_cover_midnight_crossover():
    from app.mcp_server.tools import _time as time_fmt

    assert time_fmt.ist_time_label("2026-09-24T03:30:00+00:00") == "9:00 AM"
    assert time_fmt.ist_time_label("2026-09-24T18:00:00+00:00") == "11:30 PM"
    assert time_fmt.ist_day_label("2026-09-24T03:30:00+00:00") == "Thu, Sep 24"
    assert time_fmt.ist_time_label("not-a-date") is None
    assert time_fmt.ist_day_label(None) is None


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
    """Two-turn booking: turn 1 finds + proposes, turn 2 confirms + books.

    The P0 confirm gate forbids one-shot booking — create_appointment only
    runs after the patient explicitly confirms a previously offered slot.
    """
    setup = seed_setup(client, tag="chatbook")
    # First offered slot (rules are IST: 09:00 IST == 03:30 UTC), so the
    # confirm gate recognises it (only the first 10 slots are remembered).
    start, end = slot_iso(hour=3, minutes=30)
    ctx = patient_ctx(setup)
    # Scripted flow jumps past the early steps: simulate them as done on
    # an earlier turn (type + mode picked, day known) so the availability
    # check is allowed through.
    _book_seen = get_ai_context("conv-chatbook")
    _book_seen.visit_types_seen = True
    _book_seen.selected_appointment_type_id = setup["type"]["id"]
    _book_seen.selected_consultation_mode = "in_person"
    _book_seen.selected_date = MONDAY
    save_ai_context(_book_seen)
    turn1 = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "search_doctors",
                    "arguments": {"specialty": f"Cardiology chatbook"},
                }
            ],
        },        {
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
            "content": "Dr. chatbook has Monday 3:30 open. Shall I book this? Reply yes to confirm.",
            "tool_calls": [],
        },
    )
    result1 = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-chatbook",
        user_message="I need a cardiologist this week",
        complete=turn1,
    )
    assert "Shall I book" in result1["reply"]
    assert (
        db.query(Appointment).filter(Appointment.idempotency_key == "chat-book-1").count()
        == 0
    )
    remembered = get_ai_context("conv-chatbook")
    assert len(remembered.offered_slots) > 0

    turn2 = scripted(
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
        {"content": "Booked with Dr. chatbook for Monday 3:30.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-chatbook",
        user_message="Yes, book it",
        complete=turn2,
    )
    assert result["reply"].startswith("Booked")
    assert result["iterations"] == 2
    assert result["escalated"] is False
    appt = (
        db.query(Appointment)
        .filter(Appointment.idempotency_key == "chat-book-1")
        .one()
    )
    assert appt.state.value == "confirmed"
    remembered = get_ai_context("conv-chatbook")
    assert remembered.last_appointment_id == str(appt.id)
    assert remembered.awaiting_confirmation is False
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


def test_chat_scheduling_intent_with_symptom_proposes_confirmation(client, db, tool_factory):
    """Mixed clinical + scheduling message is not declined, but a fresh
    booking request without a prior offer must propose first, not book."""
    setup = seed_setup(client, tag="mixedmsg")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    # Scripted flow jumps past the early steps: simulate them as done so
    # the confirm gate (not the completeness gates) engages on the attempt.
    _mixed_seen = get_ai_context("conv-mixed")
    _mixed_seen.visit_types_seen = True
    _mixed_seen.selected_appointment_type_id = setup["type"]["id"]
    _mixed_seen.selected_consultation_mode = "in_person"
    _mixed_seen.selected_date = MONDAY
    save_ai_context(_mixed_seen)
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
        {
            "content": "Dr. mixedmsg has Monday 9:00 open. Shall I book this? Reply yes to confirm.",
            "tool_calls": [],
        },
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-mixed",
        user_message="My chest has been hurting; I need to book a cardiologist",
        complete=complete,
    )
    # Not declined (scheduling intent present) and not booked (no prior
    # offer + no explicit confirmation): the model must propose first.
    assert result["reply"] != orchestrator.CLINICAL_DECLINE
    assert "Shall I book" in result["reply"]
    assert (
        db.query(Appointment).filter(Appointment.idempotency_key == "mixed-1").count()
        == 0
    )
    pending = get_ai_context("conv-mixed")
    assert pending.awaiting_confirmation is True
    assert pending.pending_clarification == "booking_confirmation"


def test_chat_one_shot_booking_is_refused_without_confirmation(client, db, tool_factory):
    """A single-turn search + book attempt is stopped at create: the gate
    refuses, records the pending proposal, and books nothing."""
    setup = seed_setup(client, tag="oneshot")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    # Scripted flow jumps past the early steps: simulate them as done so
    # the confirm gate (not the completeness gates) engages on the attempt.
    _one_seen = get_ai_context("conv-oneshot")
    _one_seen.visit_types_seen = True
    _one_seen.selected_appointment_type_id = setup["type"]["id"]
    _one_seen.selected_consultation_mode = "in_person"
    save_ai_context(_one_seen)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "search_doctors",
                    "arguments": {"specialty": f"Cardiology oneshot"},
                }
            ],
        },
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c2",
                    "name": "create_appointment",
                    "arguments": {
                        "doctor_id": setup["doctor"]["id"],
                        "appointment_type_id": setup["type"]["id"],
                        "slot_start": start,
                        "slot_end": end,
                        "idempotency_key": "oneshot-1",
                    },
                }
            ],
        },
        {
            "content": "Dr. oneshot has Monday 9:00 open. Shall I book this? Reply yes to confirm.",
            "tool_calls": [],
        },
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-oneshot",
        user_message="Find me a cardiologist and book Monday morning",
        complete=complete,
    )
    assert "Shall I book" in result["reply"]
    assert (
        db.query(Appointment).filter(Appointment.idempotency_key == "oneshot-1").count()
        == 0
    )
    pending = get_ai_context("conv-oneshot")
    assert pending.awaiting_confirmation is True
    assert pending.pending_booking is not None
    assert pending.pending_booking["doctor_id"] == setup["doctor"]["id"]


def test_chat_missing_idempotency_key_is_minted_by_server(client, db, tool_factory):
    """Assistant path never fails for a missing key: the gate mints one."""
    setup = seed_setup(client, tag="mintkey")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    clear_ai_context("conv-mintkey")
    context = get_ai_context("conv-mintkey")
    context.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. mintkey"}]
    context.offered_slots = [{"start": start, "end": end}]
    # The scripted confirmation jumps past the early steps: simulate them.
    context.visit_types_seen = True
    context.selected_appointment_type_id = setup["type"]["id"]
    context.selected_consultation_mode = "in_person"
    context.selected_date = start[:10]
    save_ai_context(context)
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
                        "idempotency_key": "   ",
                    },
                }
            ],
        },
        {"content": "Booked.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-mintkey",
        user_message="Yes, book it",
        complete=complete,
    )
    assert result["reply"] == "Booked."
    assert db.query(Appointment).count() == 1


def test_chat_reschedule_requires_confirmation(client, db, tool_factory):
    """A move request proposes first; only 'yes' for an offered slot moves it."""
    setup = seed_setup(client, tag="rsconf")
    booked = book_via_tool(client, setup, key="rsconf-1").json()["result"]
    appt_id = booked["appointment_id"]
    start2, end2 = slot_iso(hour=10)
    ctx = patient_ctx(setup)
    turn1 = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "reschedule_appointment",
                    "arguments": {
                        "appointment_id": appt_id,
                        "slot_start": start2,
                        "slot_end": end2,
                    },
                }
            ],
        },
        {
            "content": "I can move it to Monday 10:00. Shall I? Reply yes to confirm.",
            "tool_calls": [],
        },
    )
    r1 = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-rsconf",
        user_message="Please move my appointment to Monday 10 AM",
        complete=turn1,
    )
    assert "Shall I" in r1["reply"]
    untouched = db.query(Appointment).filter(Appointment.id == uuid.UUID(appt_id)).one()
    assert untouched.slot_start.replace(tzinfo=None).isoformat() == "2026-10-05T09:00:00"
    pending = get_ai_context("conv-rsconf")
    assert pending.awaiting_confirmation is True
    assert pending.pending_booking is not None
    assert pending.pending_booking.get("kind") == "reschedule"

    turn2 = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c2",
                    "name": "reschedule_appointment",
                    "arguments": {
                        "appointment_id": appt_id,
                        "slot_start": start2,
                        "slot_end": end2,
                    },
                }
            ],
        },
        {"content": "Moved to Monday 10:00.", "tool_calls": []},
    )
    r2 = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-rsconf",
        user_message="Yes, move it",
        complete=turn2,
    )
    assert r2["reply"] == "Moved to Monday 10:00."
    moved = db.query(Appointment).filter(Appointment.id == uuid.UUID(appt_id)).one()
    assert moved.slot_start.replace(tzinfo=None).isoformat() == "2026-10-05T10:00:00"
    assert moved.state.value == "rescheduled"
    assert get_ai_context("conv-rsconf").awaiting_confirmation is False


def test_chat_cancel_requires_confirmation(client, db, tool_factory):
    """A cancel request proposes first; only 'yes' tears the booking down."""
    setup = seed_setup(client, tag="cxconf")
    booked = book_via_tool(client, setup, key="cxconf-1").json()["result"]
    appt_id = booked["appointment_id"]
    ctx = patient_ctx(setup)
    turn1 = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "cancel_appointment",
                    "arguments": {"appointment_id": appt_id},
                }
            ],
        },
        {
            "content": "Shall I cancel it? Reply yes to confirm.",
            "tool_calls": [],
        },
    )
    r1 = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-cxconf",
        user_message="Cancel my appointment",
        complete=turn1,
    )
    assert "Shall I cancel" in r1["reply"]
    live = db.query(Appointment).filter(Appointment.id == uuid.UUID(appt_id)).one()
    assert live.state.value == "confirmed"
    pending = get_ai_context("conv-cxconf")
    assert pending.awaiting_confirmation is True
    assert (pending.pending_booking or {}).get("kind") == "cancel"

    turn2 = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c2",
                    "name": "cancel_appointment",
                    "arguments": {"appointment_id": appt_id},
                }
            ],
        },
        {"content": "Cancelled.", "tool_calls": []},
    )
    r2 = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-cxconf",
        user_message="Yes, cancel it",
        complete=turn2,
    )
    assert r2["reply"] == "Cancelled."
    gone = db.query(Appointment).filter(Appointment.id == uuid.UUID(appt_id)).one()
    assert gone.state.value == "cancelled"


def test_chat_decline_clears_pending_proposal(client, db, tool_factory):
    """'No, never mind' drops the proposal so a later 'yes' books nothing."""
    setup = seed_setup(client, tag="decline")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    clear_ai_context("conv-decline")
    context = get_ai_context("conv-decline")
    context.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. decline"}]
    context.offered_slots = [{"start": start, "end": end}]
    context.pending_booking = {
        "kind": "create",
        "doctor_id": setup["doctor"]["id"],
        "appointment_type_id": setup["type"]["id"],
        "slot_start": start,
        "slot_end": end,
    }
    context.awaiting_confirmation = True
    context.pending_clarification = "booking_confirmation"
    save_ai_context(context)
    r = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-decline",
        user_message="No, never mind",
        complete=scripted({"content": "No problem — what would you like instead?", "tool_calls": []}),
    )
    assert "No problem" in r["reply"]
    cleared = get_ai_context("conv-decline")
    assert cleared.awaiting_confirmation is False
    assert cleared.pending_booking is None
    assert db.query(Appointment).count() == 0
    assert r["pending_booking"] is None


# -- P2: consultation mode, durations, calendar state --------------------------


def test_chat_booking_persists_consultation_mode(client, db, tool_factory):
    """A confirmed video booking stores its mode; the patient view shows it."""
    setup = seed_setup(client, tag="chatmode")
    hid = setup["hid"]
    did = setup["doctor"]["id"]
    upd = client.put(
        f"/hospitals/{hid}/doctors/{did}",
        json={"consultation_types": ["in_person", "video"]},
        headers=setup["hosp"]["owner"],
    )
    assert upd.status_code == 200, upd.text
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    clear_ai_context("conv-chatmode")
    context = get_ai_context("conv-chatmode")
    context.offered_doctors = [{"id": did, "name": "Dr. chatmode"}]
    context.offered_slots = [{"start": start, "end": end}]
    # The scripted confirmation jumps past the early steps: simulate them
    # (mode comes from the "video visit" message itself).
    context.visit_types_seen = True
    context.selected_appointment_type_id = setup["type"]["id"]
    context.selected_date = start[:10]
    save_ai_context(context)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "create_appointment",
                    "arguments": {
                        "doctor_id": did,
                        "appointment_type_id": setup["type"]["id"],
                        "slot_start": start,
                        "slot_end": end,
                        "idempotency_key": "chat-mode-1",
                        "consultation_mode": "video",
                    },
                }
            ],
        },
        {"content": "Booked video visit.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-chatmode",
        user_message="Yes, book it as a video visit",
        complete=complete,
    )
    assert result["reply"] == "Booked video visit."
    appt = (
        db.query(Appointment).filter(Appointment.idempotency_key == "chat-mode-1").one()
    )
    assert appt.consultation_mode == "video"
    detail = client.get(
        f"/appointments/{appt.id}", headers=setup["patient"]["headers"]
    ).json()
    assert detail["consultation_mode"] == "video"


def test_chat_booking_rejects_unoffered_mode(client, db, tool_factory):
    """A video-only doctor cannot be booked for an in-person visit."""
    setup = seed_setup(client, tag="badmode")
    hid = setup["hid"]
    did = setup["doctor"]["id"]
    assert (
        client.put(
            f"/hospitals/{hid}/doctors/{did}",
            json={"consultation_types": ["video"]},
            headers=setup["hosp"]["owner"],
        ).status_code
        == 200
    )
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    clear_ai_context("conv-badmode")
    context = get_ai_context("conv-badmode")
    context.offered_doctors = [{"id": did, "name": "Dr. badmode"}]
    context.offered_slots = [{"start": start, "end": end}]
    save_ai_context(context)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "create_appointment",
                    "arguments": {
                        "doctor_id": did,
                        "appointment_type_id": setup["type"]["id"],
                        "slot_start": start,
                        "slot_end": end,
                        "idempotency_key": "bad-mode-1",
                        "consultation_mode": "in_person",
                    },
                }
            ],
        },
        {"content": "That doctor only offers video visits.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-badmode",
        user_message="Yes, book it in person",
        complete=complete,
    )
    assert "only offers video" in result["reply"]
    assert db.query(Appointment).count() == 0


def test_booking_rejects_unoffered_duration(client, db, tool_factory):
    """A 30-minute-only doctor cannot be booked for a 45-minute type —
    at availability time and at booking time."""
    setup = seed_setup(client, tag="baddur")
    hid = setup["hid"]
    did = setup["doctor"]["id"]
    long_type = client.post(
        f"/hospitals/{hid}/appointment-types",
        json={"name": "Extended", "duration_minutes": 45},
        headers=setup["hosp"]["owner"],
    ).json()
    h = setup["patient"]["headers"]
    avail = client.post(
        "/mcp/call",
        json={
            "tool": "check_availability",
            "input": {
                "doctor_id": did,
                "appointment_type_id": long_type["id"],
                "date_from": MONDAY,
                "date_to": MONDAY,
            },
        },
        headers=h,
    )
    assert avail.status_code == 422
    assert "45-minute" in avail.text
    start, end = slot_iso()
    booked = client.post(
        "/mcp/call",
        json={
            "tool": "create_appointment",
            "input": {
                "doctor_id": did,
                "appointment_type_id": long_type["id"],
                "slot_start": start,
                "slot_end": end,
                "idempotency_key": "bad-dur-1",
            },
        },
        headers=h,
    )
    assert booked.status_code == 422
    assert "45-minute" in booked.text
    assert db.query(Appointment).count() == 0


def test_check_availability_paused_calendar_and_inactive_doctor(client, db, tool_factory):
    """Paused calendars and inactive doctors fail loudly instead of
    returning an empty slot list that looks like 'no availability'."""
    setup = seed_setup(client, tag="paused")
    hid = setup["hid"]
    did = setup["doctor"]["id"]
    h = setup["patient"]["headers"]

    def _check():
        return client.post(
            "/mcp/call",
            json={
                "tool": "check_availability",
                "input": {
                    "doctor_id": did,
                    "appointment_type_id": setup["type"]["id"],
                    "date_from": MONDAY,
                    "date_to": MONDAY,
                },
            },
            headers=h,
        )

    assert _check().status_code == 200
    assert (
        client.put(
            f"/hospitals/{hid}/doctors/{did}/calendar",
            json={"is_active": False},
            headers=setup["hosp"]["owner"],
        ).status_code
        == 200
    )
    paused = _check()
    assert paused.status_code == 422
    assert "paused" in paused.text
    assert (
        client.put(
            f"/hospitals/{hid}/doctors/{did}/calendar",
            json={"is_active": True},
            headers=setup["hosp"]["owner"],
        ).status_code
        == 200
    )
    assert _check().status_code == 200

    assert (
        client.post(
            f"/hospitals/{hid}/doctors/{did}/suspend",
            headers=setup["hosp"]["owner"],
        ).status_code
        == 200
    )
    suspended = _check()
    assert suspended.status_code == 422
    assert "not currently seeing patients" in suspended.text


def test_reserve_slot_rejects_paused_calendar(client, db, tool_factory):
    """The reservation backstop holds even if the calendar is paused
    between the availability check and the booking."""
    from datetime import datetime as _dt

    from app.domain.scheduling import service as scheduling_service
    from app.domain.scheduling.service import SlotConflictError

    setup = seed_setup(client, tag="reservehold")
    hid = setup["hid"]
    did = setup["doctor"]["id"]
    assert (
        client.put(
            f"/hospitals/{hid}/doctors/{did}/calendar",
            json={"is_active": False},
            headers=setup["hosp"]["owner"],
        ).status_code
        == 200
    )
    start = _dt.fromisoformat(f"{MONDAY}T09:00:00+00:00")
    end = _dt.fromisoformat(f"{MONDAY}T09:30:00+00:00")
    with pytest.raises(SlotConflictError):
        scheduling_service.reserve_slot(db, uuid.UUID(did), start, end)


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
    # Confirmation turn: the slot was offered on a previous turn.
    clear_ai_context("conv-chatfault")
    context = get_ai_context("conv-chatfault")
    context.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. chatfault"}]
    context.offered_slots = [{"start": start, "end": end}]
    # The scripted confirmation jumps past the early steps: simulate them
    # (day comes from the "Monday morning" message itself).
    context.visit_types_seen = True
    context.selected_appointment_type_id = setup["type"]["id"]
    context.selected_consultation_mode = "in_person"
    save_ai_context(context)
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
        user_message="Yes, book the Monday morning slot",
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
    # Fresh context (Redis persists across test runs): seed everything a
    # prior check_availability turn would have recorded.
    clear_ai_context("conv-thatone")
    context = get_ai_context("conv-thatone")
    context.offered_slots = [{"start": start, "end": end}]
    context.selected_doctor_id = setup["doctor"]["id"]
    context.selected_appointment_type_id = setup["type"]["id"]
    # The scripted confirmation jumps past the early steps: simulate them.
    context.visit_types_seen = True
    context.selected_consultation_mode = "in_person"
    context.selected_date = start[:10]
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
    monkeypatch.setattr(settings, "inception_api_key", "")
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
                "idempotency_key": "move-2",
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
        json={
            "tool": "cancel_appointment",
            "input": {"appointment_id": appt_id, "idempotency_key": "move-3"},
        },
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
