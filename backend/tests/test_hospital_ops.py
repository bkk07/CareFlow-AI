"""Hospital operator console tests: profile edit, staff, questionnaire
toggle, workflows list, escalations queue, operations log + retry."""

import uuid
from datetime import datetime, timedelta

import pytest

from app.domain.appointment.router import get_integration_service
from app.integration.integration_service import IntegrationService
from app.main import app
from tests.test_mcp_agent import FakeConnector, seed_setup

MONDAY = "2026-10-05"


@pytest.fixture()
def stub_integration(db):
    fake = FakeConnector()

    def _override():
        return IntegrationService(session=db, connector=fake)

    app.dependency_overrides[get_integration_service] = _override
    yield fake
    app.dependency_overrides.clear()


def slot_iso(hour=9):
    start = datetime.fromisoformat(f"{MONDAY}T{hour:02d}:00:00+00:00")
    return start.isoformat(), (start + timedelta(minutes=30)).isoformat()


def book(client, setup, key, hour=9):
    start, end = slot_iso(hour=hour)
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
    assert resp.status_code in (200, 201, 202), resp.text
    return resp.json()


def test_hospital_profile_update(client):
    setup = seed_setup(client, tag="hosprof")
    hid, owner = setup["hid"], setup["hosp"]["owner"]

    updated = client.put(
        f"/hospitals/{hid}",
        json={"name": "Renamed General", "contact_phone": "+1-555-9999"},
        headers=owner,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Renamed General"

    seen = client.get(f"/hospitals/{hid}", headers=owner).json()
    assert seen["name"] == "Renamed General"
    assert seen["contact_phone"] == "+1-555-9999"

    # Lifecycle state is not editable here.
    assert (
        client.put(f"/hospitals/{hid}", json={"status": "suspended"}, headers=owner).status_code
        == 422
    )

    other = seed_setup(client, tag="hosprof2")
    assert (
        client.put(f"/hospitals/{hid}", json={"name": "X"}, headers=other["hosp"]["owner"]).status_code
        == 403
    )
    assert (
        client.put(
            f"/hospitals/{hid}", json={"name": "X"}, headers=setup["patient"]["headers"]
        ).status_code
        == 403
    )


def test_staff_invite_list_deactivate(client):
    setup = seed_setup(client, tag="staff")
    hid, owner = setup["hid"], setup["hosp"]["owner"]

    invited = client.post(
        f"/hospitals/{hid}/staff",
        json={
            "email": "ops-assist@example.com",
            "password": "correct-horse-42",
            "role": "hospital_admin",
        },
        headers=owner,
    )
    assert invited.status_code == 201, invited.text

    roster = client.get(f"/hospitals/{hid}/staff", headers=owner).json()
    emails = {u["email"] for u in roster}
    assert "ops-assist@example.com" in emails
    assert setup["hosp"]["admin_email"] in emails

    dup = client.post(
        f"/hospitals/{hid}/staff",
        json={
            "email": "ops-assist@example.com",
            "password": "correct-horse-42",
            "role": "hospital_admin",
        },
        headers=owner,
    )
    assert dup.status_code == 409

    # Privilege containment: only hospital_admin can be granted.
    assert (
        client.post(
            f"/hospitals/{hid}/staff",
            json={
                "email": "root2@example.com",
                "password": "correct-horse-42",
                "role": "platform_admin",
            },
            headers=owner,
        ).status_code
        == 422
    )

    # Deactivate → login stops working, row stays visible as inactive.
    assert (
        client.delete(
            f"/hospitals/{hid}/staff/{invited.json()['id']}", headers=owner
        ).status_code
        == 204
    )
    roster = client.get(f"/hospitals/{hid}/staff", headers=owner).json()
    assert next(u for u in roster if u["email"] == "ops-assist@example.com")["is_active"] is False
    assert (
        client.post(
            "/auth/login",
            json={"email": "ops-assist@example.com", "password": "correct-horse-42"},
        ).status_code
        == 403
    )

    # Cannot deactivate yourself; patients are locked out entirely.
    me = client.get("/auth/me", headers=owner).json()
    assert (
        client.delete(f"/hospitals/{hid}/staff/{me['id']}", headers=owner).status_code == 422
    )
    assert client.get(f"/hospitals/{hid}/staff", headers=setup["patient"]["headers"]).status_code == 403


def test_questionnaire_update_toggle(client):
    from tests.test_questionnaire import add_question, make_questionnaire

    setup = seed_setup(client, tag="qupd")
    owner = setup["hosp"]["owner"]
    form = make_questionnaire(client, setup)
    add_question(client, setup, form["id"], order=0, prompt="Allergies?")

    updated = client.put(
        f"/hospitals/{setup['hid']}/questionnaires/{form['id']}",
        json={"is_active": False},
        headers=owner,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["is_active"] is False

    detail = client.get(
        f"/hospitals/{setup['hid']}/questionnaires/{form['id']}", headers=owner
    ).json()
    assert detail["questionnaire"]["is_active"] is False

    other = seed_setup(client, tag="qupd2")
    assert (
        client.put(
            f"/hospitals/{other['hid']}/questionnaires/{form['id']}",
            json={"is_active": True},
            headers=other["hosp"]["owner"],
        ).status_code
        == 404
    )


def test_workflows_list_scoped(client, stub_integration):
    setup = seed_setup(client, tag="wflist")
    owner = setup["hosp"]["owner"]
    appt = book(client, setup, "wf-list-1")

    started = client.post(
        "/mcp/call",
        json={
            "tool": "start_workflow",
            "input": {
                "event_type": "appointment.booked",
                "payload": {"appointment_id": appt["id"]},
            },
        },
        headers=owner,
    )
    assert started.status_code == 200, started.text

    rows = client.get("/workflows", headers=owner).json()
    assert any(r["appointment_id"] == appt["id"] for r in rows)
    row = next(r for r in rows if r["appointment_id"] == appt["id"])
    assert row["event_type"] == "appointment.booked"
    assert isinstance(row["execution_history"], list)

    other = seed_setup(client, tag="wflist2")
    foreign = client.get("/workflows", headers=other["hosp"]["owner"]).json()
    assert all(r["appointment_id"] != appt["id"] for r in foreign)

    assert client.get("/workflows").status_code == 401


def test_escalations_list_resolve(client, stub_integration):
    setup = seed_setup(client, tag="esclist")
    owner = setup["hosp"]["owner"]
    appt = book(client, setup, "esc-list-1")

    # Patient-created escalation carries no hospital id; the console
    # resolves scope through the linked appointment.
    opened = client.post(
        "/mcp/call",
        json={
            "tool": "transfer_to_human",
            "input": {
                "conversation_id": "conv-esc-1",
                "reason": "Patient asked for a human nurse review",
                "appointment_id": appt["id"],
            },
        },
        headers=setup["patient"]["headers"],
    )
    assert opened.status_code == 200, opened.text

    queue = client.get("/escalations", headers=owner).json()
    assert len(queue) == 1
    assert queue[0]["reason"] == "Patient asked for a human nurse review"

    other = seed_setup(client, tag="esclist2")
    assert client.get("/escalations", headers=other["hosp"]["owner"]).json() == []

    resolved = client.post(f"/escalations/{queue[0]['id']}/resolve", headers=owner)
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"
    assert (
        client.post(f"/escalations/{queue[0]['id']}/resolve", headers=owner).status_code == 422
    )


def test_operations_list_and_retry(client, stub_integration):
    setup = seed_setup(client, tag="opslist")
    owner = setup["hosp"]["owner"]
    appt = book(client, setup, "ops-list-1")

    ops = client.get("/operations", headers=owner)
    assert ops.status_code == 200, ops.text
    rows = ops.json()
    assert len(rows) >= 1
    assert {r["appointment_id"] for r in rows} >= {appt["id"]}

    succeeded = client.get("/operations?status=succeeded", headers=owner).json()
    assert len(succeeded) >= 1
    assert {r["status"] for r in succeeded} == {"succeeded"}

    other = seed_setup(client, tag="opslist2")
    assert client.get("/operations", headers=other["hosp"]["owner"]).json() == []

    retried = client.post(f"/operations/{rows[0]['id']}/retry", headers=owner)
    assert retried.status_code == 200, retried.text
    assert retried.json()["appointment_id"] == appt["id"]

    assert client.get("/operations", headers=setup["patient"]["headers"]).status_code == 403
    assert (
        client.post(f"/operations/{uuid.uuid4()}/retry", headers=owner).status_code == 404
    )
