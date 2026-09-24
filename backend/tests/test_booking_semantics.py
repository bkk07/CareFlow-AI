"""Booking-semantics regression tests (Problems P1–P11, cases 1–17).

Deterministic layer only: run_conversation is driven with a scripted
`complete` fn (no LLM keys), real MCP tools, and a real (SQLite) DB.
Every test pins a semantic invariant — never prompt wording.
"""

import uuid

import pytest

from app.ai.agent import booking_state as bs
from app.ai.agent import concierge_state as concierge
from app.ai.agent import orchestrator
from app.ai.context.ai_context import (
    AIContext,
    clear_ai_context,
    get_ai_context,
    save_ai_context,
)
from app.domain.appointment.models import Appointment
from app.domain.doctor.models import Doctor
from tests.test_mcp_agent import (
    MONDAY,
    FakeConnector,
    patient_ctx,
    scripted,
    seed_setup,
    slot_iso,
)


@pytest.fixture()
def fake_connector():
    return FakeConnector()


@pytest.fixture()
def tool_factory(db, fake_connector):
    from app.integration.integration_service import IntegrationService
    from app.mcp_server.tools import _base as tool_base

    tool_base.set_integration_factory(
        lambda session: IntegrationService(session=session, connector=fake_connector)
    )
    try:
        yield fake_connector
    finally:
        tool_base.set_integration_factory(None)


def fresh(cid=None):
    return AIContext(conversation_id=cid or f"sem-{uuid.uuid4().hex[:8]}")


def boom(messages, specs):
    raise AssertionError("deterministic path must not call the LLM")


def noop_content(text="Noted."):
    return scripted({"content": text, "tool_calls": []})


def add_doctor(client, setup, name):
    hid = setup["hid"]
    dept = client.post(
        f"/hospitals/{hid}/departments",
        json={"name": f"Dept {uuid.uuid4().hex[:6]}"},
        headers=setup["hosp"]["owner"],
    )
    assert dept.status_code == 201, dept.text
    d = client.post(
        f"/hospitals/{hid}/doctors",
        json={
            "name": name,
            "specialty_id": setup["spec"]["id"],
            "department_id": dept.json()["id"],
        },
        headers=setup["hosp"]["owner"],
    )
    assert d.status_code == 201, d.text
    did = d.json()["id"]
    assert (
        client.post(
            f"/hospitals/{hid}/doctors/{did}/activate",
            headers=setup["hosp"]["owner"],
        ).status_code
        == 200
    )
    return did


def add_type(client, setup, name, minutes):
    t = client.post(
        f"/hospitals/{setup['hid']}/appointment-types",
        json={"name": name, "duration_minutes": minutes},
        headers=setup["hosp"]["owner"],
    )
    assert t.status_code == 201, t.text
    return t.json()


def set_doctor_offer(db, doctor_id, modes, durations):
    row = db.get(Doctor, uuid.UUID(str(doctor_id)))
    assert row is not None
    row.consultation_types = list(modes)
    row.available_durations = list(durations)
    db.commit()


def full_booking_context(cid, setup, start=None, end=None):
    """Canonical in-progress booking: doctor+date+type+mode+slot."""
    start = start or slot_iso(hour=3, minutes=30)[0]
    end = end or slot_iso(hour=3, minutes=30)[1]
    ctx = get_ai_context(cid)
    ctx.flow_open = True
    ctx.selected_hospital_id = setup["hid"]
    ctx.selected_doctor_id = setup["doctor"]["id"]
    ctx.selected_doctor_name = setup["doctor"]["name"]
    ctx.selected_date = MONDAY
    ctx.visit_types_seen = True
    ctx.visit_types = [
        {
            "id": setup["type"]["id"],
            "name": setup["type"]["name"],
            "duration_minutes": 30,
        }
    ]
    ctx.selected_appointment_type_id = setup["type"]["id"]
    ctx.visit_type_name = setup["type"]["name"]
    ctx.duration_minutes = 30
    ctx.selected_consultation_mode = "video"
    ctx.consultation_modes = ["video", "phone", "in_person"]
    ctx.requested_start = "09:00"
    ctx.offered_slots = [{"start": start, "end": end}]
    bs.set_canonical_slot(ctx, start, end)
    ctx.offered_doctors = [
        {"id": setup["doctor"]["id"], "name": setup["doctor"]["name"]}
    ]
    ctx.offered_doctor_page = [setup["doctor"]["id"]]
    save_ai_context(ctx)
    return ctx


# -- P1: visit type vs consultation mode --------------------------------------


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Video consultation", "video"),
        ("Video visit", "video"),
        ("Virtual consultation", "video"),
        ("Online consultation", "video"),
        ("Phone consultation", "phone"),
        ("Telephone consultation", "phone"),
        ("Phone visit", "phone"),
        ("In-person consultation", "in_person"),
        ("In person visit", "in_person"),
        ("Clinic visit", "in_person"),
        ("New consultation", None),
        ("Follow-up visit", None),
        ("Annual check-up", None),
        ("Lab review", None),
        ("Test results discussion", None),
        ("Chronic-care management", None),
        ("General consultation", None),
        ("Consult", None),
        ("Video follow-up", None),  # purpose-anchored: still a visit type
    ],
)
def test_mode_like_type_classification(name, expected):
    assert bs.implied_mode_from_type_name(name) == expected
    assert bs.is_mode_like_type_name(name) == (expected is not None)


def test_valid_visit_types_hide_modes_unless_only_modes():
    ctx = fresh()
    ctx.visit_types = [
        {"id": "v", "name": "Video consultation", "duration_minutes": 30},
        {"id": "n", "name": "New consultation", "duration_minutes": 30},
        {"id": "f", "name": "Follow-up visit", "duration_minutes": 45},
    ]
    assert [t["id"] for t in bs.get_valid_visit_types(ctx)] == ["n", "f"]
    ctx.visit_types = [
        {"id": "v", "name": "Video consultation", "duration_minutes": 30},
        {"id": "p", "name": "Phone visit", "duration_minutes": 15},
    ]
    # All-mode-like catalog stays fully bookable.
    assert [t["id"] for t in bs.get_valid_visit_types(ctx)] == ["v", "p"]


def test_case14_mode_type_not_presented(client, db, tool_factory):
    setup = seed_setup(client, tag="typemode")
    add_type(client, setup, "Video consultation", 30)
    add_type(client, setup, "New consultation", 30)
    add_type(client, setup, "Follow-up visit", 45)
    ctx = patient_ctx(setup)
    turn = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "list_appointment_types",
                    "arguments": {"hospital_id": setup["hid"]},
                }
            ],
        },
        {"content": "What kind of visit is this?", "tool_calls": []},
    )
    out = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=f"typemode-{uuid.uuid4().hex[:6]}",
        user_message="I need to see Dr. typemode",
        complete=turn,
    )
    names = [t["name"] for t in out["appointment_types"]]
    assert "Video consultation" not in names
    assert "New consultation" in names and "Follow-up visit" in names
    # Grounding still knows the full catalog (data never deleted).
    stored = get_ai_context(out["conversation_id"])
    assert {t["name"] for t in stored.visit_types} >= {
        "Video consultation",
        "New consultation",
    }
    clear_ai_context(out["conversation_id"])


def test_mode_like_type_pick_derives_mode_without_reask(client, db, tool_factory):
    """Picking 'Video consultation' answers the mode question itself."""
    setup = seed_setup(client, tag="typederive")
    ctx = patient_ctx(setup)
    cid = f"typederive-{uuid.uuid4().hex[:6]}"
    context = get_ai_context(cid)
    context.visit_types = [
        {"id": "v1", "name": "Video consultation", "duration_minutes": 30},
        {"id": "n1", "name": "New consultation", "duration_minutes": 30},
    ]
    context.visit_types_seen = True
    save_ai_context(context)
    out = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Video consultation",
        selection={
            "type": "booking_selection",
            "field": "appointment_type",
            "value": "v1",
        },
        complete=noop_content(),
    )
    stored = get_ai_context(cid)
    assert stored.selected_appointment_type_id == "v1"
    assert stored.selected_consultation_mode == "video"
    assert out["consultation_modes"] == []
    clear_ai_context(cid)


# -- P2: modes validated against the doctor ----------------------------------


def test_valid_modes_come_from_doctor_offer():
    assert bs.get_valid_consultation_modes(["in_person", "video"], None) == [
        "in_person",
        "video",
    ]
    # Empty offer (legacy rows) accepts anything: all three, like the service.
    assert bs.get_valid_consultation_modes([], None) == ["video", "phone", "in_person"]
    assert bs.get_valid_consultation_modes(None, None) == ["video", "phone", "in_person"]
    # A mode-defining type narrows to its mode when the doctor offers it.
    assert bs.get_valid_consultation_modes(["in_person", "video"], "video") == ["video"]
    # ...but never to a mode the doctor does NOT offer.
    assert bs.get_valid_consultation_modes(["in_person", "video"], "phone") == [
        "in_person",
        "video",
    ]


def test_case15_only_offered_modes_shown(client, db, tool_factory):
    # Modes are doctor-scoped: with no doctor chosen yet the fallback is
    # all three; once the doctor is picked only their offer is shown.
    setup = seed_setup(client, tag="modescope")
    set_doctor_offer(db, setup["doctor"]["id"], ["in_person", "video"], [30])
    ctx = patient_ctx(setup)
    cid = f"modescope-{uuid.uuid4().hex[:6]}"
    context = get_ai_context(cid)
    context.offered_doctors = [
        {"id": setup["doctor"]["id"], "name": setup["doctor"]["name"]}
    ]
    context.offered_doctor_page = [setup["doctor"]["id"]]
    save_ai_context(context)
    orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message=setup["doctor"]["name"],
        complete=noop_content("Great choice."),
    )
    assert get_ai_context(cid).selected_doctor_id == setup["doctor"]["id"]
    turn = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "list_appointment_types",
                    "arguments": {"hospital_id": setup["hid"]},
                }
            ],
        },
        {"content": "What kind of visit?", "tool_calls": []},
    )
    out = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="What kind of visit?", complete=turn
    )
    assert set(out["consultation_modes"]) == {"in_person", "video"}
    clear_ai_context(cid)


def test_case15_unoffered_mode_refused_in_code(client, db, tool_factory):
    setup = seed_setup(client, tag="modegate")
    set_doctor_offer(db, setup["doctor"]["id"], ["in_person", "video"], [30])
    ctx = patient_ctx(setup)
    cid = f"modegate-{uuid.uuid4().hex[:6]}"
    # Phone was picked before any slot existed (so no invalidation wiped
    # the offers); the model now tries to book that exact combination.
    seen = get_ai_context(cid)
    seen.visit_types_seen = True
    seen.selected_doctor_id = setup["doctor"]["id"]
    seen.selected_doctor_name = setup["doctor"]["name"]
    seen.offered_doctors = [
        {"id": setup["doctor"]["id"], "name": setup["doctor"]["name"]}
    ]
    seen.selected_appointment_type_id = setup["type"]["id"]
    seen.selected_consultation_mode = "phone"
    seen.selected_date = MONDAY
    start, end = slot_iso(hour=3, minutes=30)
    seen.offered_slots = [{"start": start, "end": end}]
    save_ai_context(seen)
    turn = scripted(
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
                        "consultation_mode": "phone",
                        "idempotency_key": uuid.uuid4().hex,
                    },
                }
            ],
        },
        {"content": "Sorry, that mode is not offered.", "tool_calls": []},
    )
    orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="Yes, book it", complete=turn
    )
    assert (
        db.query(Appointment)
        .filter(Appointment.patient_id == uuid.UUID(setup["patient"]["id"]))
        .count()
        == 0
    )
    tool_payloads = [
        m["content"] for msgs in turn.messages_seen for m in msgs if m.get("role") == "tool"
    ]
    assert any("mode_not_offered" in p for p in tool_payloads)
    clear_ai_context(cid)


# -- P3: compare is first-class ----------------------------------------------


def _seed_compare_room(client, setup, tag):
    a = add_doctor(client, setup, "Dr. Bandaru Kiran")
    b = add_doctor(client, setup, "Dr. E2E")
    c = add_doctor(client, setup, "Dr. Third Option")
    return a, b, c


def _offer_page(cid, ids, names):
    ctx = get_ai_context(cid)
    ctx.offered_doctors = [{"id": i, "name": n} for i, n in zip(ids, names)]
    ctx.offered_doctor_page = list(ids)
    ctx.flow_open = True
    save_ai_context(ctx)


def test_case1_compare_two_named_doctors(client, db, tool_factory):
    setup = seed_setup(client, tag="cmp1")
    a, b, _ = _seed_compare_room(client, setup, "cmp1")
    ctx = patient_ctx(setup)
    cid = f"cmp1-{uuid.uuid4().hex[:6]}"
    _offer_page(cid, [a, b], ["Dr. Bandaru Kiran", "Dr. E2E"])
    out = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Can you compare Bandaru Kiran and Dr E2E?",
        complete=boom,
    )
    assert out["surface"] == "DOCTOR_COMPARE"
    assert out["compare"] is not None
    assert {d["id"] for d in out["compare"]["doctors"]} == {a, b}
    # The booking was NOT hijacked into a pick.
    stored = get_ai_context(cid)
    assert stored.selected_doctor_id is None
    assert stored.compare_ids == [a, b] or set(stored.compare_ids) == {a, b}
    assert any(a["kind"] == "choose_doctor" for a in out["actions"])
    clear_ai_context(cid)


def test_case2_compare_first_and_third(client, db, tool_factory):
    setup = seed_setup(client, tag="cmp2")
    a, b, c = _seed_compare_room(client, setup, "cmp2")
    ctx = patient_ctx(setup)
    cid = f"cmp2-{uuid.uuid4().hex[:6]}"
    _offer_page(cid, [a, b, c], ["Dr. Bandaru Kiran", "Dr. E2E", "Dr. Third Option"])
    out = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Compare the first and third doctors.",
        complete=boom,
    )
    assert out["surface"] == "DOCTOR_COMPARE"
    assert [d["id"] for d in out["compare"]["doctors"]] == [a, c]
    clear_ai_context(cid)


def test_compare_needs_two_options(client, db, tool_factory):
    setup = seed_setup(client, tag="cmp3")
    ctx = patient_ctx(setup)
    cid = f"cmp3-{uuid.uuid4().hex[:6]}"
    _offer_page(cid, [setup["doctor"]["id"]], [setup["doctor"]["name"]])
    out = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="Compare them.", complete=boom
    )
    assert out["compare"] is None
    assert "only" in out["reply"].lower()
    clear_ai_context(cid)


def test_resolve_compare_ids_unit():
    ctx = fresh()
    ctx.offered_doctors = [
        {"id": "a", "name": "Dr. Bandaru Kiran"},
        {"id": "b", "name": "Dr. E2E"},
        {"id": "c", "name": "Dr. Third Option"},
    ]
    ctx.offered_doctor_page = ["a", "b", "c"]
    assert concierge.resolve_compare_ids(ctx, "Compare the first and third doctors.") == [
        "a",
        "c",
    ]
    assert set(concierge.resolve_compare_ids(ctx, "compare Bandaru Kiran and Dr E2E")) == {
        "a",
        "b",
    }
    assert concierge.resolve_compare_ids(ctx, "compare them") == ["a", "b", "c"]


# -- P4/P9: stale widgets never mutate ----------------------------------------


def test_case5_stale_doctor_tap_ignored(client, db, tool_factory):
    setup = seed_setup(client, tag="stale5")
    other = add_doctor(client, setup, "Dr. Other Physician")
    ctx = patient_ctx(setup)
    cid = f"stale5-{uuid.uuid4().hex[:6]}"
    full_booking_context(cid, setup)
    stored = get_ai_context(cid)
    stored.state_revision = 5
    save_ai_context(stored)
    out = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="OK",
        selection={
            "type": "booking_selection",
            "field": "doctor",
            "value": other,
            "message_id": "msg_old",
            "state_revision": 2,
            "widget_id": "doctor:old",
        },
        complete=boom,
    )
    assert "earlier step" in out["reply"]
    kept = get_ai_context(cid)
    assert kept.selected_doctor_id == setup["doctor"]["id"]
    clear_ai_context(cid)


def test_case6_stale_mode_tap_ignored(client, db, tool_factory):
    setup = seed_setup(client, tag="stale6")
    ctx = patient_ctx(setup)
    cid = f"stale6-{uuid.uuid4().hex[:6]}"
    full_booking_context(cid, setup)
    stored = get_ai_context(cid)
    stored.state_revision = 4
    save_ai_context(stored)
    out = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="OK",
        selection={
            "type": "booking_selection",
            "field": "consultation_mode",
            "value": "phone",
            "message_id": "msg_old",
            "state_revision": 1,
            "widget_id": "mode:old",
        },
        complete=boom,
    )
    assert "earlier step" in out["reply"]
    assert get_ai_context(cid).selected_consultation_mode == "video"
    clear_ai_context(cid)


def test_case17_stale_text_pick_does_not_repick(client, db, tool_factory):
    """An old Choose tap re-sends its doctor's NAME as text; with a stale
    revision the fuzzy matcher must not re-apply it either."""
    setup = seed_setup(client, tag="stale17")
    other = add_doctor(client, setup, "Dr. Stale Candidate")
    ctx = patient_ctx(setup)
    cid = f"stale17-{uuid.uuid4().hex[:6]}"
    full_booking_context(cid, setup)
    stored = get_ai_context(cid)
    stored.state_revision = 6
    save_ai_context(stored)
    out = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Dr. Stale Candidate",
        selection={
            "type": "booking_selection",
            "field": "doctor",
            "value": other,
            "message_id": "msg_old",
            "state_revision": 3,
            "widget_id": "doctor:old",
        },
        complete=boom,
    )
    assert "earlier step" in out["reply"]
    assert get_ai_context(cid).selected_doctor_id == setup["doctor"]["id"]
    clear_ai_context(cid)


def test_current_revision_tap_applies(client, db, tool_factory):
    setup = seed_setup(client, tag="freshrev")
    other = add_doctor(client, setup, "Dr. Fresh Pick")
    ctx = patient_ctx(setup)
    cid = f"freshrev-{uuid.uuid4().hex[:6]}"
    context = get_ai_context(cid)
    context.offered_doctors = [
        {"id": setup["doctor"]["id"], "name": setup["doctor"]["name"]},
        {"id": other, "name": "Dr. Fresh Pick"},
    ]
    context.offered_doctor_page = [setup["doctor"]["id"], other]
    context.state_revision = 7
    save_ai_context(context)
    out = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Dr. Fresh Pick",
        selection={
            "type": "booking_selection",
            "field": "doctor",
            "value": other,
            "message_id": "msg_now",
            "state_revision": 7,
            "widget_id": "doctor:now",
        },
        complete=noop_content("Great choice."),
    )
    assert "earlier step" not in out["reply"]
    assert get_ai_context(cid).selected_doctor_id == other
    clear_ai_context(cid)


# -- P5: dependency invalidation ----------------------------------------------


def test_case4_change_doctor_reopens_selection(client, db, tool_factory):
    setup = seed_setup(client, tag="chgdoc")
    ctx = patient_ctx(setup)
    cid = f"chgdoc-{uuid.uuid4().hex[:6]}"
    full_booking_context(cid, setup)
    out = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="Change doctor", complete=noop_content()
    )
    stored = get_ai_context(cid)
    assert stored.selected_doctor_id is None
    assert stored.selected_date == MONDAY  # upstream day survives
    assert stored.offered_slots == []
    assert stored.selected_start is None
    assert stored.awaiting_confirmation is False
    assert "earlier step" not in out["reply"]
    clear_ai_context(cid)


def test_case7_change_type_after_mode(client, db, tool_factory):
    setup = seed_setup(client, tag="chgtype")
    add_type(client, setup, "Follow-up visit", 45)
    ctx = patient_ctx(setup)
    cid = f"chgtype-{uuid.uuid4().hex[:6]}"
    full_booking_context(cid, setup)
    context = get_ai_context(cid)
    # Register the second genuine type in the listing.
    from app.domain.hospital_config.models import AppointmentType as ATModel

    rows = (
        db.query(ATModel).filter(ATModel.hospital_id == uuid.UUID(setup["hid"])).all()
    )
    context.visit_types = [
        {"id": str(r.id), "name": r.name, "duration_minutes": r.duration_minutes}
        for r in rows
    ]
    context.state_revision = 3
    save_ai_context(context)
    follow_id = next(str(r.id) for r in rows if r.name == "Follow-up visit")
    orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Make it a follow-up visit",
        selection={
            "type": "booking_selection",
            "field": "appointment_type",
            "value": follow_id,
            "message_id": "msg_now",
            "state_revision": 3,
            "widget_id": "type:now",
        },
        complete=noop_content(),
    )
    stored = get_ai_context(cid)
    assert stored.selected_appointment_type_id == follow_id
    assert stored.duration_minutes == 45
    assert stored.selected_consultation_mode == "video"  # still offered: kept
    assert stored.selected_start is None and stored.offered_slots == []
    clear_ai_context(cid)


def test_case8_and_13_mode_change_clears_slot(client, db, tool_factory):
    # Via typed tap...
    setup = seed_setup(client, tag="chgmode")
    ctx = patient_ctx(setup)
    cid = f"chgmode-{uuid.uuid4().hex[:6]}"
    full_booking_context(cid, setup)
    context = get_ai_context(cid)
    context.state_revision = 2
    save_ai_context(context)
    orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Phone visit",
        selection={
            "type": "booking_selection",
            "field": "consultation_mode",
            "value": "phone",
            "message_id": "msg_now",
            "state_revision": 2,
            "widget_id": "mode:now",
        },
        complete=noop_content(),
    )
    stored = get_ai_context(cid)
    assert stored.selected_consultation_mode == "phone"
    assert stored.selected_start is None and stored.offered_slots == []
    clear_ai_context(cid)
    # ...and via natural language ("No, in-person" is a correction, P8).
    cid2 = f"chgmode2-{uuid.uuid4().hex[:6]}"
    full_booking_context(cid2, setup)
    assert orchestrator._is_declined("No, in-person") is False
    orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid2, user_message="No, in-person", complete=noop_content()
    )
    stored2 = get_ai_context(cid2)
    assert stored2.selected_consultation_mode == "in_person"
    assert stored2.selected_start is None and stored2.offered_slots == []
    clear_ai_context(cid2)


def test_case9_change_date_clears_slot(client, db, tool_factory):
    setup = seed_setup(client, tag="chgdate")
    ctx = patient_ctx(setup)
    cid = f"chgdate-{uuid.uuid4().hex[:6]}"
    full_booking_context(cid, setup)
    from app.ai.agent import booking_state as bs_mod

    expected = bs_mod.detect_date_iso("tomorrow")
    assert expected
    orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="Actually make it tomorrow", complete=noop_content()
    )
    stored = get_ai_context(cid)
    assert stored.selected_date == expected
    assert stored.selected_start is None and stored.offered_slots == []
    assert stored.selected_doctor_id == setup["doctor"]["id"]
    clear_ai_context(cid)


def test_update_booking_field_doctor_revalidation():
    ctx = fresh()
    ctx.selected_appointment_type_id = "t30"
    ctx.visit_type_name = "Consult"
    ctx.duration_minutes = 30
    ctx.selected_consultation_mode = "video"
    cleared = bs.update_booking_field(
        ctx, "doctor", doctor_offer=["in_person"], doctor_durations=[45]
    )
    assert "visit_type" in cleared and "consultation_mode" in cleared
    assert ctx.selected_appointment_type_id is None
    assert ctx.selected_consultation_mode is None
    assert ctx.state_revision == 1
    # Compatible doctor keeps both.
    ctx2 = fresh()
    ctx2.selected_appointment_type_id = "t30"
    ctx2.duration_minutes = 30
    ctx2.selected_consultation_mode = "video"
    cleared2 = bs.update_booking_field(
        ctx2, "doctor", doctor_offer=["video", "in_person"], doctor_durations=[30]
    )
    assert "visit_type" not in cleared2 and "consultation_mode" not in cleared2
    assert ctx2.selected_consultation_mode == "video"


def test_update_booking_field_type_derives_mode():
    ctx = fresh()
    ctx.visit_type_name = "Video consultation"
    cleared = bs.update_booking_field(ctx, "visit_type")
    assert ctx.selected_consultation_mode == "video"
    assert "slot" in cleared


# -- P6: summary is a first-class command --------------------------------------


def test_detect_summary_request():
    for text in [
        "Can you tell me what all the things you know about this appointment?",
        "Can you tell me everything about this appointment?",
        "What's currently selected?",
        "What is currently selected?",
        "Show me the appointment summary",
        "What is the status of my booking?",
    ]:
        assert concierge.detect_summary_request(text), text
    for text in [
        "Book a cardiologist",
        "Yes, book it",
        "Compare them",
        "What appointments do I have?",
    ]:
        assert not concierge.detect_summary_request(text), text


def test_case10_summary_is_structured(client, db, tool_factory):
    setup = seed_setup(client, tag="sum10")
    ctx = patient_ctx(setup)
    cid = f"sum10-{uuid.uuid4().hex[:6]}"
    full_booking_context(cid, setup)
    out = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Can you tell me everything about this appointment?",
        complete=boom,
    )
    assert out["surface"] == "BOOKING_REVIEW"
    summary = out["booking_summary"]
    assert summary["doctor"]["name"] == setup["doctor"]["name"]
    assert summary["date"] == MONDAY
    assert summary["visit_type"]["name"] == setup["type"]["name"]
    assert summary["consultation_mode"] == "video"
    assert summary["slot"]["start"] is not None
    assert summary["status"] == "Ready to book"
    assert summary["can_confirm"] is True
    assert len(summary["changes"]) == 5
    assert any(a["kind"] == "confirm" for a in out["actions"])
    # Read-only: nothing moved.
    stored = get_ai_context(cid)
    assert stored.selected_doctor_id == setup["doctor"]["id"]
    assert stored.selected_start is not None
    clear_ai_context(cid)


def test_summary_reports_missing_fields(client, db, tool_factory):
    setup = seed_setup(client, tag="sum11")
    ctx = patient_ctx(setup)
    cid = f"sum11-{uuid.uuid4().hex[:6]}"
    context = get_ai_context(cid)
    context.selected_doctor_id = setup["doctor"]["id"]
    context.selected_doctor_name = setup["doctor"]["name"]
    save_ai_context(context)
    out = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="What's currently selected?", complete=boom
    )
    assert out["booking_summary"]["status"] == "Not ready to book"
    assert "consultation_mode" in out["booking_summary"]["missing"]
    assert out["booking_summary"]["can_confirm"] is False
    clear_ai_context(cid)


# -- P7/P8/P11: slot pick, NL changes, confirm ---------------------------------


def test_case11_change_time_preserves_rest(client, db, tool_factory):
    setup = seed_setup(client, tag="chgtime")
    ctx = patient_ctx(setup)
    cid = f"chgtime-{uuid.uuid4().hex[:6]}"
    full_booking_context(cid, setup)
    orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="Change it to 4 PM", complete=noop_content()
    )
    stored = get_ai_context(cid)
    # 4 PM IST == 10:30 UTC.
    assert stored.selected_start == "2026-10-05T10:30:00+00:00"
    assert stored.selected_end == "2026-10-05T11:00:00+00:00"
    assert stored.selected_doctor_id == setup["doctor"]["id"]
    assert stored.selected_date == MONDAY
    assert stored.selected_appointment_type_id == setup["type"]["id"]
    assert stored.selected_consultation_mode == "video"
    assert stored.awaiting_confirmation is False
    clear_ai_context(cid)


def test_case3_show_someone_else_pages_forward(client, db, tool_factory):
    setup = seed_setup(client, tag="explore3")
    ctx = patient_ctx(setup)
    cid = f"explore3-{uuid.uuid4().hex[:6]}"
    context = get_ai_context(cid)
    context.offered_doctors = [
        {"id": setup["doctor"]["id"], "name": setup["doctor"]["name"]}
    ]
    context.offered_doctor_page = [setup["doctor"]["id"]]
    context.last_search = {
        "filters": {"specialty": "Cardiology explore3"},
        "offset": 0,
        "total": 10,
    }
    context.flow_open = True
    save_ai_context(context)
    turn = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "search_doctors",
                    "arguments": {
                        "specialty": "Cardiology explore3",
                        "limit": 5,
                        "offset": 5,
                    },
                }
            ],
        },
        {"content": "Here are a few more.", "tool_calls": []},
    )
    orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="Show me someone else", complete=turn
    )
    stored = get_ai_context(cid)
    assert stored.last_search["offset"] == 5
    assert stored.last_search["filters"]["specialty"] == "Cardiology explore3"
    clear_ai_context(cid)


def test_case12_confirm_books_exact_slot(client, db, tool_factory):
    setup = seed_setup(client, tag="confirm12")
    start, end = slot_iso(hour=3, minutes=30)
    ctx = patient_ctx(setup)
    cid = f"confirm12-{uuid.uuid4().hex[:6]}"
    seen = get_ai_context(cid)
    seen.visit_types_seen = True
    seen.selected_doctor_id = setup["doctor"]["id"]
    seen.selected_doctor_name = setup["doctor"]["name"]
    seen.offered_doctors = [
        {"id": setup["doctor"]["id"], "name": setup["doctor"]["name"]}
    ]
    seen.offered_doctor_page = [setup["doctor"]["id"]]
    seen.selected_appointment_type_id = setup["type"]["id"]
    seen.selected_consultation_mode = "in_person"
    seen.selected_date = MONDAY
    seen.offered_slots = [{"start": start, "end": end}]
    save_ai_context(seen)
    turn = scripted(
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
                        "idempotency_key": "case12-key",
                    },
                }
            ],
        },
        {"content": "Booked.", "tool_calls": []},
    )
    out = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="Confirm booking", complete=turn
    )
    appt = (
        db.query(Appointment).filter(Appointment.idempotency_key == "case12-key").one()
    )
    # SQLite stores naive wall time: compare wall-clock components.
    assert appt.slot_start.isoformat()[:19] == start[:19]
    assert appt.slot_end.isoformat()[:19] == end[:19]
    assert out["stage"] == "BOOKING_SUCCESS"
    assert out["message_id"] and out["state_revision"] >= 1
    assert out["upcoming_appointment"]["appointment_id"] == str(appt.id)
    clear_ai_context(cid)


def test_case16_single_time_selector(client, db, tool_factory):
    setup = seed_setup(client, tag="single16")
    ctx = patient_ctx(setup)
    cid = f"single16-{uuid.uuid4().hex[:6]}"
    seen = get_ai_context(cid)
    seen.visit_types_seen = True
    seen.selected_appointment_type_id = setup["type"]["id"]
    seen.selected_consultation_mode = "in_person"
    seen.selected_date = MONDAY
    save_ai_context(seen)
    turn = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "check_availability",
                    "arguments": {
                        "doctor_id": setup["doctor"]["id"],
                        "appointment_type_id": setup["type"]["id"],
                        "date_from": MONDAY,
                        "date_to": MONDAY,
                    },
                },
                {
                    "id": "c2",
                    "name": "get_day_schedule",
                    "arguments": {"doctor_id": setup["doctor"]["id"], "date": MONDAY},
                },
            ],
        },
        {"content": "Pick a time.", "tool_calls": []},
    )
    out = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="Monday works", complete=turn
    )
    # The day timeline subsumes the slot chips: never both.
    assert out["day_schedule"] is not None
    assert out["slots"] == []
    assert out["appointment_types"] == []
    assert out["consultation_modes"] == []
    clear_ai_context(cid)


# -- P8: change-command coverage -------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Change doctor", "doctor"),
        ("Change the date", "date"),
        ("Change it to 11:00", "start_time"),
        ("Change it to 4 PM", "start_time"),
        ("Actually make it tomorrow", "date"),
        ("Make it Friday", "date"),
        ("Evening is better", "time_range"),
        ("Video is fine", "consultation_mode"),
        ("Go back to doctor selection", "goback_doctor"),
        ("Go back to date selection", "goback_date"),
        ("Keep everything else the same", "keep"),
        ("Change the visit type", "visit_type"),
        ("Change the consultation mode", "consultation_mode"),
    ],
)
def test_change_commands(text, expected):
    assert concierge.detect_change_request(text) == expected, text


def test_goback_reopens_stage_only():
    ctx = fresh()
    ctx.selected_doctor_id = "d1"
    ctx.selected_doctor_name = "Dr. A"
    ctx.selected_date = "2026-10-06"
    ctx.selected_appointment_type_id = "t1"
    ctx.visit_type_name = "Consult"
    ctx.duration_minutes = 30
    ctx.selected_consultation_mode = "video"
    bs.set_canonical_slot(ctx, "2026-10-06T03:30:00+00:00", "2026-10-06T04:00:00+00:00")
    orchestrator._reopen_stage(ctx, "doctor")
    assert ctx.selected_doctor_id is None
    assert ctx.selected_date == "2026-10-06"  # upstream of nothing: kept
    assert ctx.selected_start is None  # downstream: cleared
    ctx.selected_doctor_id = "d1"
    orchestrator._reopen_stage(ctx, "date")
    assert ctx.selected_date is None
    assert ctx.selected_doctor_id == "d1"  # above the date stage: kept


# -- Proper-noun mode guard (telephony caller names) -------------------------------


def test_telephone_testerson_is_not_a_mode():
    text = "My name is Telephone Testerson, born January second 1990"
    assert bs.detect_mode_candidate(text) is None
    assert orchestrator.detect_consultation_mode(text) is None
    assert bs.is_proper_noun_mention(text, text.index("Telephone"), text.index("Telephone") + 9)


def test_genuine_mode_mentions_still_count():
    assert orchestrator.detect_consultation_mode("Video is fine") == "video"
    assert orchestrator.detect_consultation_mode("No, in-person") == "in_person"
    assert orchestrator.detect_consultation_mode("A phone call works") == "phone"
    assert orchestrator.detect_consultation_mode("I want something nearby") is None


# -- P9: revision monotonicity ---------------------------------------------------


def test_revision_advances_with_mutations():
    ctx = fresh()
    assert ctx.state_revision == 0
    bs.bump_revision(ctx)
    assert ctx.state_revision == 1
    bs.update_booking_field(ctx, "date")
    assert ctx.state_revision == 2
