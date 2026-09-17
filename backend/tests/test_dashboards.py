"""Phase 13 tests: dashboards, scoping, HITL resolve-with-transition."""

import uuid
from datetime import datetime, timedelta

import pytest

from app.domain.appointment.router import get_integration_service
from app.integration.connector_interface import EHRTimeoutError
from app.integration.integration_service import IntegrationService
from app.main import app
from tests.test_mcp_agent import FakeConnector, seed_setup

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


def slot_iso(day=MONDAY, hour=9):
    start = datetime.fromisoformat(f"{day}T{hour:02d}:00:00+00:00")
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


def register_doctor_login(client, hid, tag):
    uid = uuid.uuid4().hex[:6]
    email = f"dr-{tag}-{uid}@example.com"
    assert (
        client.post(
            "/auth/register",
            json={
                "email": email,
                "password": "correct-horse-42",
                "role": "doctor",
                "hospital_id": hid,
            },
        ).status_code
        == 201
    )
    tokens = client.post(
        "/auth/login", json={"email": email, "password": "correct-horse-42"}
    ).json()
    me = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    ).json()
    return {"headers": {"Authorization": f"Bearer {tokens['access_token']}"}, "id": me["id"]}


def link_doctor(client, setup, user_id):
    resp = client.put(
        f"/hospitals/{setup['hid']}/doctors/{setup['doctor']['id']}",
        json={"user_id": user_id},
        headers=setup["hosp"]["owner"],
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# -- doctor self-service ---------------------------------------------------------


def test_doctor_me_link_and_scoping(client, stub_integration):
    setup = seed_setup(client, tag="docdash")
    login = register_doctor_login(client, setup["hid"], "docdash")

    orphan = client.get("/doctors/me", headers=login["headers"])
    assert orphan.status_code == 404

    bad_link = client.put(
        f"/hospitals/{setup['hid']}/doctors/{setup['doctor']['id']}",
        json={"user_id": setup["patient"]["id"]},
        headers=setup["hosp"]["owner"],
    )
    assert bad_link.status_code == 422

    linked = link_doctor(client, setup, login["id"])
    assert linked["user_id"] == login["id"]

    me = client.get("/doctors/me", headers=login["headers"]).json()
    assert me["id"] == setup["doctor"]["id"]

    denied = client.get("/doctors/me", headers=setup["patient"]["headers"])
    assert denied.status_code == 403


def test_doctor_today_upcoming_and_calendar(client, stub_integration):
    setup = seed_setup(client, tag="doccal")
    login = register_doctor_login(client, setup["hid"], "doccal")
    link_doctor(client, setup, login["id"])
    h = login["headers"]

    book(client, setup, "doc-cal-1", hour=9)
    today = client.get("/doctors/me/appointments?range=today", headers=h)
    # "Today" is relative to the wall clock; the outcome depends on the
    # run date, so only assert shape, not membership.
    assert today.status_code == 200
    assert isinstance(today.json(), list)

    upcoming = client.get("/doctors/me/appointments?range=upcoming", headers=h).json()
    states = {a["state"] for a in upcoming}
    assert states <= {"confirmed", "rescheduled", "pending", "sync_pending", "reconciliation_required"}

    bad_range = client.get("/doctors/me/appointments?range=whenever", headers=h)
    assert bad_range.status_code == 422

    calendar = client.get("/doctors/me/calendar", headers=h).json()
    assert set(calendar) == {"calendar", "rules", "blocks", "live_appointments"}
    assert len(calendar["rules"]) == 1
    assert len(calendar["live_appointments"]) >= 1


def test_doctor_questionnaire_view_scoped(client, stub_integration):
    setup, _, _ = setup_with_form(client, tag="docq")
    login = register_doctor_login(client, setup["hid"], "docq")
    link_doctor(client, setup, login["id"])

    stranger_setup = seed_setup(client, tag="docq2")
    stranger_login = register_doctor_login(client, stranger_setup["hid"], "docq2")
    link_doctor(client, stranger_setup, stranger_login["id"])

    appt = book(client, setup, "doc-q-1")
    own = client.get(
        f"/doctors/me/questionnaire-responses/{appt['id']}", headers=login["headers"]
    )
    assert own.status_code == 200

    cross = client.get(
        f"/doctors/me/questionnaire-responses/{appt['id']}",
        headers=stranger_login["headers"],
    )
    assert cross.status_code == 403


def test_doctor_manages_own_calendar_only(client, stub_integration):
    setup = seed_setup(client, tag="docedit")
    login = register_doctor_login(client, setup["hid"], "docedit")
    link_doctor(client, setup, login["id"])
    h = login["headers"]
    base = f"/hospitals/{setup['hid']}/doctors/{setup['doctor']['id']}"

    created = client.post(
        f"{base}/availability-rules",
        json={
            "day_of_week": 2,
            "start_time": "10:00:00",
            "end_time": "14:00:00",
            "recurrence": "weekly",
        },
        headers=h,
    )
    assert created.status_code == 201, created.text
    rules = client.get(f"{base}/availability-rules", headers=h).json()
    assert len(rules) == 2

    other = seed_setup(client, tag="docedit2")
    foreign = client.post(
        f"/hospitals/{other['hid']}/doctors/{other['doctor']['id']}/availability-rules",
        json={
            "day_of_week": 2,
            "start_time": "10:00:00",
            "end_time": "14:00:00",
            "recurrence": "weekly",
        },
        headers=h,
    )
    assert foreign.status_code == 403


def setup_with_form(client, tag):
    from tests.test_questionnaire import make_questionnaire, add_question

    setup = seed_setup(client, tag=tag)
    form = make_questionnaire(client, setup)
    add_question(client, setup, form["id"], order=0, prompt="Allergies?")
    return setup, form, None


# -- hospital dashboard ------------------------------------------------------------


def test_overview_counts(client, stub_integration, fake_connector):
    setup = seed_setup(client, tag="overview")
    owner = setup["hosp"]["owner"]
    book(client, setup, "ov-1", hour=9)

    fake_connector.fail_create = True
    fake_connector.create_error = EHRTimeoutError
    parked = book(client, setup, "ov-park-1", hour=10)
    assert parked["state"] == "reconciliation_required"
    fake_connector.fail_create = False

    overview = client.get(
        f"/hospitals/{setup['hid']}/overview", headers=owner
    ).json()
    assert overview["doctors_total"] == 1
    assert overview["doctors_active"] == 1
    assert overview["pending_reconciliations"] == 1
    assert overview["upcoming_appointments"] >= 1

    other = seed_setup(client, tag="overview2")
    others_view = client.get(
        f"/hospitals/{other['hid']}/overview", headers=owner
    )
    assert others_view.status_code in (403, 404)


def test_ai_activity_scoped_to_hospital(client, stub_integration, tool_factory):
    setup = seed_setup(client, tag="aiact")
    owner = setup["hosp"]["owner"]
    admin_call = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {}},
        headers=owner,
    )
    assert admin_call.status_code == 200
    patient_call = client.post(
        "/mcp/call",
        json={"tool": "search_hospitals", "input": {}},
        headers=setup["patient"]["headers"],
    )
    assert patient_call.status_code == 200

    activity = client.get(
        f"/hospitals/{setup['hid']}/ai-activity", headers=owner
    ).json()
    tools = {e["tool_name"] for e in activity["executions"]}
    assert "search_doctors" in tools
    assert "search_hospitals" not in tools

    filtered = client.get(
        f"/hospitals/{setup['hid']}/ai-activity?tool=search_doctors", headers=owner
    ).json()
    assert {e["tool_name"] for e in filtered["executions"]} == {"search_doctors"}


def test_integration_status_and_analytics_shapes(client, stub_integration):
    setup = seed_setup(client, tag="integ")
    owner = setup["hosp"]["owner"]
    book(client, setup, "integ-1", hour=9)

    status_body = client.get(
        f"/hospitals/{setup['hid']}/integration-status", headers=owner
    ).json()
    assert set(status_body) == {
        "hospital_id",
        "vendor_mappings",
        "open_reconciliations",
        "verifications_24h",
        "recent_operations",
    }
    assert status_body["vendor_mappings"] >= 3
    assert len(status_body["recent_operations"]) >= 1

    analytics = client.get(
        f"/hospitals/{setup['hid']}/analytics", headers=owner
    ).json()
    assert analytics["appointments_total"] >= 1
    assert analytics["appointments_by_state"].get("confirmed", 0) >= 1
    assert isinstance(analytics["bookings_per_day_30d"], dict)


# -- platform ----------------------------------------------------------------------


def test_platform_views_and_scoping(client, stub_integration):
    setup = seed_setup(client, tag="plat")
    other = seed_setup(client, tag="plat2")
    book(client, setup, "plat-1", hour=9)
    platform_h = setup["hosp"]["platform"]

    doctors = client.get("/platform/doctors", headers=platform_h).json()
    assert len(doctors) >= 2
    scoped = client.get(
        f"/platform/doctors?hospital_id={setup['hid']}", headers=platform_h
    ).json()
    assert {d["hospital_id"] for d in scoped} == {setup["hid"]}

    patients = client.get("/platform/patients", headers=platform_h).json()
    assert len(patients["patients"]) >= 2

    appts = client.get(
        f"/platform/appointments?state=confirmed", headers=platform_h
    ).json()
    assert len(appts) >= 1
    assert {a["state"] for a in appts} == {"confirmed"}

    audit = client.get("/platform/audit-events", headers=platform_h).json()
    assert len(audit["events"]) >= 1

    hospitals = client.get("/platform/hospitals", headers=platform_h).json()
    assert len(hospitals) >= 2

    denied = client.get("/platform/doctors", headers=setup["hosp"]["owner"])
    assert denied.status_code == 403
    del other


def test_platform_ai_evaluation_aggregates(client, stub_integration, tool_factory):
    setup = seed_setup(client, tag="aie")
    owner = setup["hosp"]["owner"]
    assert (
        client.post(
            "/mcp/call", json={"tool": "search_doctors", "input": {}}, headers=owner
        ).status_code
        == 200
    )
    assert (
        client.post(
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
        ).status_code
        == 403
    )
    evaluation = client.get("/platform/ai-evaluation", headers=setup["hosp"]["platform"]).json()
    assert evaluation["executions_total"] >= 2
    assert evaluation["errors_total"] >= 1
    by_tool = {t["tool_name"]: t for t in evaluation["by_tool"]}
    assert by_tool["search_doctors"]["calls"] >= 1
    assert by_tool["send_notification"]["errors"] >= 1
    assert evaluation["error_rate"] > 0


# -- platform aggregates -------------------------------------------------------------


def test_platform_overview_integrations_analytics(client, stub_integration):
    setup = seed_setup(client, tag="platagg")
    book(client, setup, "plat-agg-1", hour=9)
    platform_h = setup["hosp"]["platform"]
    assert (
        client.post(
            "/mcp/call", json={"tool": "search_doctors", "input": {}},
            headers=setup["hosp"]["owner"],
        ).status_code
        == 200
    )

    overview = client.get("/platform/overview", headers=platform_h)
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert body["hospitals_total"] >= 1
    assert body["doctors_total"] >= 1
    assert body["doctors_active"] >= 1
    assert body["patients_total"] >= 1
    assert body["appointments_today"] >= 0
    assert "pending_applications" in body
    assert "open_reconciliations" in body
    assert "open_escalations" in body

    integrations = client.get("/platform/integrations", headers=platform_h).json()
    assert len(integrations["integrations"]) >= 1
    entry = next(
        i for i in integrations["integrations"] if i["hospital_id"] == setup["hid"]
    )
    assert entry["hospital_name"]
    assert entry["operations_total"] >= 1
    assert entry["vendor_mappings"] >= 1

    analytics = client.get("/platform/analytics", headers=platform_h).json()
    assert analytics["appointments_total"] >= 1
    assert analytics["appointments_by_state"].get("confirmed", 0) >= 1
    assert isinstance(analytics["bookings_per_day_30d"], dict)
    assert analytics["ai_executions_total"] >= 1

    # Hospital admins are locked out of the platform surface.
    assert client.get("/platform/overview", headers=setup["hosp"]["owner"]).status_code == 403
    assert client.get("/platform/integrations", headers=setup["hosp"]["owner"]).status_code == 403
    assert client.get("/platform/analytics", headers=setup["hosp"]["owner"]).status_code == 403


# -- HITL resolve moves real state ---------------------------------------------------


def test_resolve_with_final_state_moves_booking(client, db, stub_integration, fake_connector):
    from app.domain.appointment.models import Appointment

    setup = seed_setup(client, tag="hitl")
    owner = setup["hosp"]["owner"]
    fake_connector.fail_create = True
    fake_connector.create_error = EHRTimeoutError
    parked = book(client, setup, "hitl-1", hour=9)
    assert parked["state"] == "reconciliation_required"
    fake_connector.fail_create = False

    records = client.get(
        "/reconciliation/records?resolution_status=open", headers=owner
    ).json()
    record_id = records[0]["id"]

    bad_combo = client.post(
        f"/reconciliation/records/{record_id}/resolve",
        json={
            "resolution": "escalated",
            "note": "needs eyes",
            "final_state": "cancelled",
        },
        headers=owner,
    )
    assert bad_combo.status_code == 422

    bad_transition = client.post(
        f"/reconciliation/records/{record_id}/resolve",
        json={
            "resolution": "resolved",
            "note": "forcing",
            "final_state": "pending",
        },
        headers=owner,
    )
    # reconciliation_required -> pending is not a legal edge.
    assert bad_transition.status_code == 422

    resolved = client.post(
        f"/reconciliation/records/{record_id}/resolve",
        json={
            "resolution": "resolved",
            "note": "vendor asked to cancel by phone",
            "final_state": "cancelled",
        },
        headers=owner,
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["resolution_status"] == "resolved"
    assert db.get(Appointment, uuid.UUID(parked["id"])).state.value == "cancelled"


# -- doctor 10/10: self-update, enriched reads, inbox ----------------------------


def test_doctor_self_update_profile(client, stub_integration):
    setup = seed_setup(client, tag="docself")
    login = register_doctor_login(client, setup["hid"], "docself")
    link_doctor(client, setup, login["id"])
    h = login["headers"]

    # Patient logins cannot touch the doctor self endpoint.
    assert (
        client.put("/doctors/me", json={"name": "X"}, headers=setup["patient"]["headers"]).status_code
        == 403
    )

    updated = client.put(
        "/doctors/me",
        json={
            "name": "Dr. Self Edit",
            "experience_years": 15,
            "languages": ["en", "es"],
            "consultation_types": ["in_person", "video"],
            "default_duration_minutes": 45,
        },
        headers=h,
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["name"] == "Dr. Self Edit"
    assert body["experience_years"] == 15
    assert body["languages"] == ["en", "es"]
    assert body["default_duration_minutes"] == 45

    # Admin-managed fields are not part of the self schema → 422, never applied.
    rejected = client.put(
        "/doctors/me", json={"status": "suspended"}, headers=h
    )
    assert rejected.status_code == 422
    me = client.get("/doctors/me", headers=h).json()
    assert me["status"] != "suspended"


def test_doctor_appointments_enriched_and_detail_scoped(client, stub_integration):
    setup = seed_setup(client, tag="docenr")
    login = register_doctor_login(client, setup["hid"], "docenr")
    link_doctor(client, setup, login["id"])
    h = login["headers"]

    appt = book(client, setup, "doc-enr-1", hour=9)

    upcoming = client.get("/doctors/me/appointments?range=upcoming", headers=h)
    assert upcoming.status_code == 200
    rows = upcoming.json()
    assert len(rows) >= 1
    row = next(r for r in rows if r["id"] == appt["id"])
    assert row["patient_id"] == setup["patient"]["id"]
    assert row["patient_name"]
    assert row["appointment_type_name"]
    assert row["slot_start"]

    # Raw detail read works for the owning doctor…
    detail = client.get(f"/appointments/{appt['id']}", headers=h)
    assert detail.status_code == 200, detail.text
    assert detail.json()["id"] == appt["id"]

    # …but not for a doctor of another hospital.
    stranger = seed_setup(client, tag="docenr2")
    stranger_login = register_doctor_login(client, stranger["hid"], "docenr2")
    link_doctor(client, stranger, stranger_login["id"])
    cross = client.get(f"/appointments/{appt['id']}", headers=stranger_login["headers"])
    assert cross.status_code == 403

    # …and not for a patient who does not own it.
    other_patient_headers = stranger["patient"]["headers"]
    denied = client.get(f"/appointments/{appt['id']}", headers=other_patient_headers)
    assert denied.status_code == 403


def test_doctor_notifications_inbox(client, stub_integration):
    setup = seed_setup(client, tag="docnot")
    login = register_doctor_login(client, setup["hid"], "docnot")
    link_doctor(client, setup, login["id"])

    # Empty inbox reads fine.
    empty = client.get("/notifications", headers=login["headers"])
    assert empty.status_code == 200
    assert empty.json() == []

    # Hospital admin pushes an in-app note to the doctor login.
    sent = client.post(
        "/mcp/call",
        json={
            "tool": "send_notification",
            "input": {
                "recipient_user_id": login["id"],
                "channel": "in_app",
                "message": "New booking: 9 AM follow-up",
            },
        },
        headers=setup["hosp"]["owner"],
    )
    assert sent.status_code == 200, sent.text

    inbox = client.get("/notifications", headers=login["headers"]).json()
    assert len(inbox) == 1
    assert inbox[0]["body"] == "New booking: 9 AM follow-up"


def test_doctor_questionnaire_inbox_aggregated(client, stub_integration):
    setup, _, _ = setup_with_form(client, tag="docinbox")
    login = register_doctor_login(client, setup["hid"], "docinbox")
    link_doctor(client, setup, login["id"])
    h = login["headers"]

    appt = book(client, setup, "doc-inbox-1")
    inbox = client.get("/doctors/me/questionnaire-responses", headers=h)
    assert inbox.status_code == 200, inbox.text
    items = inbox.json()
    assert len(items) >= 1
    item = next(i for i in items if i["appointment_id"] == appt["id"])
    assert item["patient_id"] == setup["patient"]["id"]
    assert item["patient_name"]
    assert isinstance(item["responses"], list)
