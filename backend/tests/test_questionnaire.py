"""Phase 11 tests: authoring, resolution, validation, flags, chat completion."""

import uuid
from datetime import datetime, timedelta

import pytest

from app.domain.appointment.router import get_integration_service
from app.domain.auth.models import Role
from app.domain.questionnaire.models import QuestionnaireScope
from app.integration.integration_service import IntegrationService
from app.main import app
from app.mcp_server.models import Escalation
from tests.test_mcp_agent import FakeConnector, scripted, seed_setup

MONDAY = "2026-10-05"


@pytest.fixture()
def fake_connector():
    return FakeConnector()


@pytest.fixture()
def stub_integration(db, fake_connector):
    def _override():
        return IntegrationService(session=db, connector=fake_connector)

    app.dependency_overrides[get_integration_service] = _override
    yield fake_connector
    app.dependency_overrides.clear()


@pytest.fixture()
def tool_factory(db, fake_connector):
    from app.mcp_server.tools import _base as tool_base

    stub = lambda session: IntegrationService(  # noqa: E731
        session=session, connector=fake_connector
    )
    tool_base.set_integration_factory(stub)
    yield fake_connector
    tool_base.set_integration_factory(None)


def make_questionnaire(client, setup, scope="appointment_type", ref="type", name="Intake"):
    ref_id = {"type": setup["type"]["id"], None: None}.get(ref, ref)
    if scope == "hospital":
        ref_id = None
    resp = client.post(
        f"/hospitals/{setup['hid']}/questionnaires",
        json={"name": name, "scope": scope, "scope_ref_id": ref_id},
        headers=setup["hosp"]["owner"],
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def add_question(client, setup, qid, **kwargs):
    body = {
        "order": 0,
        "type": "short_text",
        "prompt": "How are you?",
        "required": True,
    }
    body.update(kwargs)
    resp = client.post(
        f"/hospitals/{setup['hid']}/questionnaires/{qid}/questions",
        json=body,
        headers=setup["hosp"]["owner"],
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def setup_with_form(client, tag="qform"):
    setup = seed_setup(client, tag=tag)
    form = make_questionnaire(client, setup)
    q1 = add_question(client, setup, form["id"], order=0, prompt="Allergies?")
    q2 = add_question(
        client,
        setup,
        form["id"],
        order=1,
        type="yes_no",
        prompt="Fasting?",
        required=False,
    )
    return setup, form, [q1, q2]


def slot_iso(day=MONDAY, hour=9):
    start = datetime.fromisoformat(f"{day}T{hour:02d}:00:00+00:00")
    return start.isoformat(), (start + timedelta(minutes=30)).isoformat()


def book(client, setup, key):
    start, end = slot_iso()
    resp = client.post(
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
    assert resp.status_code == 201, resp.text
    return resp.json()


# -- authoring -----------------------------------------------------------------


def test_admin_crud_and_choice_validation(client):
    setup = seed_setup(client, tag="qadmin")
    hid, owner = setup["hid"], setup["hosp"]["owner"]
    listed = client.get(
        f"/hospitals/{hid}/questionnaires", headers=owner
    ).json()
    assert listed == []

    form = make_questionnaire(client, setup, scope="hospital", ref=None)
    assert form["scope"] == "hospital"

    bad_scope = client.post(
        f"/hospitals/{hid}/questionnaires",
        json={"name": "Bad", "scope": "doctor", "scope_ref_id": None},
        headers=owner,
    )
    assert bad_scope.status_code == 422

    bad_choice = client.post(
        f"/hospitals/{hid}/questionnaires/{form['id']}/questions",
        json={"order": 0, "type": "choice", "prompt": "Pick one"},
        headers=owner,
    )
    assert bad_choice.status_code == 422

    good = add_question(
        client,
        setup,
        form["id"],
        type="choice",
        prompt="Pick one",
        options=["a", "b"],
    )
    assert good["options"] == ["a", "b"]
    detail = client.get(
        f"/hospitals/{hid}/questionnaires/{form['id']}", headers=owner
    ).json()
    assert [q["prompt"] for q in detail["questions"]] == ["Pick one"]


def test_patient_cannot_author(client):
    setup = seed_setup(client, tag="qauthz")
    resp = client.post(
        f"/hospitals/{setup['hid']}/questionnaires",
        json={"name": "Sneaky", "scope": "hospital"},
        headers=setup["patient"]["headers"],
    )
    assert resp.status_code == 403


# -- resolution ------------------------------------------------------------------


def test_resolution_prefers_most_specific_scope(client, stub_integration):
    setup, form, _ = setup_with_form(client, tag="qresolve")
    appt = book(client, setup, "q-resolve-1")
    h = setup["patient"]["headers"]

    got = client.get(
        f"/appointments/{appt['id']}/questionnaire", headers=h
    ).json()
    assert got["questionnaire"]["id"] == form["id"]

    doctor_form = make_questionnaire(
        client, setup, scope="doctor", ref=setup["doctor"]["id"], name="Doctor form"
    )
    got2 = client.get(
        f"/appointments/{appt['id']}/questionnaire", headers=h
    ).json()
    assert got2["questionnaire"]["id"] == doctor_form["id"]

    hospital_form = make_questionnaire(
        client, setup, scope="hospital", ref=None, name="Generic"
    )
    del hospital_form
    got3 = client.get(
        f"/appointments/{appt['id']}/questionnaire", headers=h
    ).json()
    assert got3["questionnaire"]["id"] == doctor_form["id"]


def test_no_questionnaire_returns_null(client, stub_integration):
    setup = seed_setup(client, tag="qnone")
    appt = book(client, setup, "q-none-1")
    got = client.get(
        f"/appointments/{appt['id']}/questionnaire",
        headers=setup["patient"]["headers"],
    ).json()
    assert got is None
    submit = client.post(
        f"/appointments/{appt['id']}/questionnaire/responses",
        json={"answers": {}},
        headers=setup["patient"]["headers"],
    )
    assert submit.status_code == 422


def test_other_patient_cannot_fetch(client, stub_integration):
    setup, _, _ = setup_with_form(client, tag="qscope")
    appt = book(client, setup, "q-scope-1")

    from tests.test_mcp_agent import register_patient

    stranger = register_patient(client, "qstranger")
    denied = client.get(
        f"/appointments/{appt['id']}/questionnaire", headers=stranger["headers"]
    )
    assert denied.status_code == 403


# -- answering -------------------------------------------------------------------


def test_partial_submit_saves_draft_and_complete_finishes(client, db, stub_integration):
    setup, _, (q1, q2) = setup_with_form(client, tag="qdraft")
    appt = book(client, setup, "q-draft-1")
    h = setup["patient"]["headers"]
    url = f"/appointments/{appt['id']}/questionnaire/responses"

    draft = client.post(url, json={"answers": {}}, headers=h).json()
    assert draft["completed"] is False
    assert draft["completed_at"] is None

    done = client.post(
        url,
        json={"answers": {q1["id"]: "none", q2["id"]: True}},
        headers=h,
    ).json()
    assert done["completed"] is True
    assert done["completed_at"] is not None
    assert done["flagged"] is False


def test_answer_validation_rejects_bad_values(client, stub_integration):
    setup = seed_setup(client, tag="qvalid")
    form = make_questionnaire(client, setup)
    choice = add_question(
        client, setup, form["id"], type="choice", prompt="Pick", options=["x", "y"]
    )
    num = add_question(
        client, setup, form["id"], type="numeric", prompt="Age?", order=1
    )
    appt = book(client, setup, "q-valid-1")
    url = f"/appointments/{appt['id']}/questionnaire/responses"
    h = setup["patient"]["headers"]

    bad = client.post(
        url, json={"answers": {choice["id"]: "z", num["id"]: "old"}}, headers=h
    )
    assert bad.status_code == 422
    assert "Pick" in bad.text and "Age?" in bad.text

    unknown = client.post(
        url, json={"answers": {"00000000-0000-0000-0000-000000000000": "x"}}, headers=h
    )
    assert unknown.status_code == 422


def test_flag_phrase_opens_escalation(client, db, stub_integration):
    setup, _, (q1, _) = setup_with_form(client, tag="qflag")
    appt = book(client, setup, "q-flag-1")
    resp = client.post(
        f"/appointments/{appt['id']}/questionnaire/responses",
        json={"answers": {q1["id"]: "I have crushing chest pain since morning"}},
        headers=setup["patient"]["headers"],
    ).json()
    assert resp["completed"] is True
    assert resp["flagged"] is True
    assert resp["escalation_id"] is not None
    row = db.get(Escalation, uuid.UUID(resp["escalation_id"]))
    assert row.appointment_id == uuid.UUID(appt["id"])
    assert "chest pain" in row.reason


def test_doctor_can_view_response(client, stub_integration):
    setup, _, (q1, q2) = setup_with_form(client, tag="qdocview")
    appt = book(client, setup, "q-doc-1")
    h = setup["patient"]["headers"]
    client.post(
        f"/appointments/{appt['id']}/questionnaire/responses",
        json={"answers": {q1["id"]: "none"}},
        headers=h,
    )

    # A doctor of the same hospital reads the response (dashboard stub).
    uid = uuid.uuid4().hex[:6]
    email = f"doc-{uid}@example.com"
    assert (
        client.post(
            "/auth/register",
            json={
                "email": email,
                "password": "correct-horse-42",
                "role": "doctor",
                "hospital_id": setup["hid"],
            },
        ).status_code
        == 201
    )
    tokens = client.post(
        "/auth/login", json={"email": email, "password": "correct-horse-42"}
    ).json()
    doc_h = {"Authorization": f"Bearer {tokens['access_token']}"}
    seen = client.get(
        f"/appointments/{appt['id']}/questionnaire/responses", headers=doc_h
    )
    assert seen.status_code == 200, seen.text
    assert seen.json()[0]["answers"] == {q1["id"]: "none"}

    # A stranger patient still cannot.
    from tests.test_mcp_agent import register_patient

    stranger = register_patient(client, "qdocstranger")
    assert (
        client.get(
            f"/appointments/{appt['id']}/questionnaire/responses",
            headers=stranger["headers"],
        ).status_code
        == 403
    )


# -- agent path --------------------------------------------------------------------


def test_chat_completes_questionnaire_conversationally(
    client, db, stub_integration, tool_factory
):
    from app.ai.agent import orchestrator
    from app.core.deps import RequestContext

    setup, _, (q1, q2) = setup_with_form(client, tag="qchat")
    appt = book(client, setup, "q-chat-1")
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
                    "name": "get_questionnaire",
                    "arguments": {"appointment_id": appt["id"]},
                }
            ],
        },
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c2",
                    "name": "submit_questionnaire",
                    "arguments": {
                        "appointment_id": appt["id"],
                        "answers": {q1["id"]: "none", q2["id"]: False},
                    },
                }
            ],
        },
        {"content": "Intake complete, see you Monday.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-qchat",
        user_message="Here are my intake answers: no allergies, not fasting",
        complete=complete,
    )
    assert result["reply"] == "Intake complete, see you Monday."
    saved = client.get(
        f"/appointments/{appt['id']}/questionnaire/responses",
        headers=setup["patient"]["headers"],
    ).json()
    assert len(saved) == 1
    assert saved[0]["completed"] is True
    assert saved[0]["answers"] == {q1["id"]: "none", q2["id"]: False}


def test_agent_guard_is_in_the_prompt():
    from app.ai.agent.orchestrator import SYSTEM_PROMPT
    from app.mcp_server import server

    assert "ONLY the fetched questions" in SYSTEM_PROMPT
    # The model reads the full tool description — the guard must be in it.
    desc = server._TOOLS["get_questionnaire"]["description"]
    assert "ONLY these questions" in desc
