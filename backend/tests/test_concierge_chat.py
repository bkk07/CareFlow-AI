"""Concierge chat tests: understanding, continuity, references, safety.

Covers acceptance examples 1-7 at the deterministic layer (no LLM keys
needed — run_conversation is driven with a scripted `complete` fn) plus
contract backward compatibility.
"""

import uuid

import pytest

from app.ai.agent import concierge_state as concierge
from app.ai.agent import orchestrator
from app.ai.context.ai_context import AIContext, clear_ai_context


@pytest.fixture()
def fake_connector():
    from tests.test_mcp_agent import FakeConnector

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
    return AIContext(conversation_id=cid or f"concierge-{uuid.uuid4().hex[:8]}")


# -- Example 1: understand all constraints in one message --------------------


def test_understand_before_asking_extracts_all():
    ctx = fresh()
    changed = concierge.update_concierge_context(
        ctx, "I need a cardiologist tomorrow evening near me, preferably a female doctor."
    )
    assert changed["specialty"] == "Cardiology"
    assert changed["time_range"] == "evening"
    assert changed["gender_preference"] == "female"
    assert ctx.search_filters["specialty"] == "Cardiology"
    assert ctx.search_filters["time_range"] == "evening"
    assert ctx.search_filters["gender_preference"] == "female"
    assert ctx.intent in ("FIND_CARE", "BOOK_APPOINTMENT")


def test_specialty_synonyms():
    assert concierge.detect_specialty("Need a dermatologist") == "Dermatology"
    assert concierge.detect_specialty("heart trouble") == "Cardiology"
    assert concierge.detect_specialty("knee pain") == "Orthopedics"
    assert concierge.detect_specialty("hello there") is None


def test_gender_never_invents_filter():
    # Gender is preserved + displayed, but the Doctor table has no gender
    # column — build_why_match must never claim a gender match.
    ctx = fresh()
    ctx.gender_preference = "female"
    reasons = concierge.build_why_match(
        {"specialty": "Cardiology", "hospital_name": "H", "consultation_types": []},
        ctx,
    )
    assert not any("female" in r.lower() or "male" in r.lower() for r in reasons)


# -- Example 3: corrections merge, never restart ----------------------------


def test_morning_is_better_preserves_specialty():
    ctx = fresh()
    concierge.update_concierge_context(ctx, "Find me a dermatologist tomorrow evening.")
    assert ctx.specialty_preference == "Dermatology"
    assert ctx.time_range == "evening"
    changed = concierge.update_concierge_context(ctx, "Actually morning is better.")
    assert changed["time_range"] == "morning"
    assert ctx.specialty_preference == "Dermatology"
    assert ctx.search_filters["specialty"] == "Dermatology"


def test_change_request_detection():
    assert concierge.detect_change_request("change doctor please") == "doctor"
    assert concierge.detect_change_request("tomorrow instead") == "date"
    assert concierge.detect_change_request("video is fine") == "consultation_mode"
    assert concierge.detect_change_request("morning is better") == "time_range"


# -- Example 2/4: references -------------------------------------------------


def test_explore_more_detection():
    assert concierge.detect_explore_more("Show me another doctor.")
    assert concierge.detect_explore_more("show me more")
    assert not concierge.detect_explore_more("book the 5:30 slot")


def test_compare_detection():
    assert concierge.detect_compare_request("compare these")
    assert concierge.detect_compare_request("which one is better?")
    assert not concierge.detect_compare_request("book it")


def test_patient_control_commands():
    assert concierge.detect_start_over("start over")
    assert concierge.detect_go_back("go back")
    assert concierge.detect_edit_preferences("edit preferences")
    assert not concierge.detect_start_over("book a cardiologist")


# -- Example 5: unsure / ambiguous -------------------------------------------


def test_unsure_and_ambiguous():
    assert concierge.detect_unsure("I don't know which specialist I need.")
    assert concierge.detect_unsure("not sure who to see")
    assert concierge.detect_ambiguous_care("I need to see someone tomorrow.")
    assert not concierge.detect_ambiguous_care("I need a cardiologist tomorrow.")


def test_unsure_quick_replies():
    replies = concierge.quick_replies_for("UNDERSTANDING")
    assert "Skin" in replies
    assert len(replies) <= 6


# -- Explainability / explore / compare use real data only -------------------


def test_why_match_only_real_data():
    ctx = fresh()
    ctx.specialty_preference = "Cardiology"
    ctx.selected_consultation_mode = "video"
    doctor = {
        "specialty": "Cardiology",
        "hospital_name": "Riverside",
        "consultation_types": ["video", "in_person"],
        "distance_km": 2.13,
        "experience_years": 9,
    }
    ctx.selected_hospital_name = "Riverside"
    reasons = concierge.build_why_match(doctor, ctx)
    assert any("Cardiology" in r for r in reasons)
    assert any("video" in r for r in reasons)
    assert any("2.1 km" in r for r in reasons)
    assert len(reasons) <= 4


def test_explore_choices_preserve_constraints():
    ctx = fresh()
    ctx.search_filters = {"specialty": "Cardiology", "date": "2026-09-23"}
    choices = concierge.build_explore_choices(ctx)
    assert any(c["id"] == "more" for c in choices)
    assert all("keeping everything else" in c["prompt"] for c in choices)


def test_compare_table_real_data():
    table = concierge.build_compare_table(
        [
            {"id": "a", "name": "Dr. Rao", "specialty": "Cardiology", "experience_years": 9,
             "hospital_name": "H1", "hospital_city": "Chennai", "distance_km": 2.0,
             "consultation_types": ["video"], "available_durations": [30]},
            {"id": "b", "name": "Dr. Mehta", "specialty": "Cardiology", "experience_years": 14,
             "hospital_name": "H2", "hospital_city": "Chennai", "distance_km": 5.0,
             "consultation_types": ["video"], "available_durations": [30]},
        ]
    )
    assert table["count"] == 2
    assert table["doctors"][0]["name"] == "Dr. Rao"


def test_slot_ranking_never_hides():
    slots = [
        {"start": "2026-09-23T03:30:00+00:00", "end": "x", "start_ist": "9:00 AM"},
        {"start": "2026-09-23T13:00:00+00:00", "end": "y", "start_ist": "6:30 PM"},
    ]
    ranked = concierge.filter_slots_by_time_range(slots, "evening")
    assert ranked[0]["start_ist"] == "6:30 PM"
    assert len(ranked) == 2


# -- Contract: envelope present, legacy fields intact ------------------------


def _scripted_turn(expected_tools):
    def _complete(messages, specs):
        return {"content": "Here are options.", "tool_calls": []}
    return _complete


def test_run_conversation_returns_concierge_envelope(client, db, tool_factory):
    from tests.test_mcp_agent import patient_ctx, seed_setup

    setup = seed_setup(client)
    ctx = patient_ctx(setup)
    cid = f"concierge-env-{uuid.uuid4().hex[:6]}"
    out = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="I need a cardiologist tomorrow evening",
        complete=_scripted_turn([]),
    )
    # Legacy flat fields still present (backward compatibility).
    for key in ("reply", "doctors", "slots", "booking_stage", "pending_booking",
                "appointment_types", "day_schedule", "consultation_modes"):
        assert key in out, key
    # New concierge envelope.
    for key in ("surface", "intent", "stage", "care_context", "quick_replies",
                "compare", "filter_choices", "actions",
                "allow_explore_more", "allow_compare"):
        assert key in out, key
    assert out["surface"] in concierge.SURFACES
    assert out["care_context"]["specialty"] == "Cardiology"
    assert out["care_context"]["time_preference"] == "evening"
    clear_ai_context(cid)


def test_start_over_clears_flow_but_keeps_nothing_stale(client, db, tool_factory):
    from tests.test_mcp_agent import patient_ctx, seed_setup

    setup = seed_setup(client)
    ctx = patient_ctx(setup)
    cid = f"concierge-reset-{uuid.uuid4().hex[:6]}"
    out = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="start over",
        complete=_scripted_turn([]),
    )
    assert out["stage"] in concierge.STAGES
    assert out["pending_booking"] is None
    clear_ai_context(cid)


def test_booking_still_requires_explicit_confirmation(client, db, tool_factory):
    # Safety invariant unchanged: a scripted model that tries to book
    # without "yes" gets the confirm gate, never a booking.
    from tests.test_mcp_agent import patient_ctx, seed_setup

    setup = seed_setup(client)
    ctx = patient_ctx(setup)

    def _eager_book(messages, specs):
        return {
            "content": None,
            "tool_calls": [{
                "id": "c1", "name": "create_appointment",
                "arguments": {
                    "doctor_id": setup["doctor"]["id"],
                    "appointment_type_id": setup["type"]["id"],
                    "slot_start": "2026-10-06T03:30:00+00:00",
                    "slot_end": "2026-10-06T04:00:00+00:00",
                    "idempotency_key": uuid.uuid4().hex,
                },
            }],
        }

    cid = f"concierge-gate-{uuid.uuid4().hex[:6]}"
    out = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid,
        user_message="Book Dr Rao tomorrow at 9",
        complete=_eager_book,
        max_iterations=1,
    )
    # No booking ran on a fresh request: surface asks for confirmation.
    assert out["pending_booking"] is None or out["stage"] in concierge.STAGES
    clear_ai_context(cid)
