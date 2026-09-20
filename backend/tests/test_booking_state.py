"""Phase 2 tests: stateful, tool-grounded booking (§21).

Covers: canonical candidates (doctor/date/type/mode/time/hospital),
IST date parsing + new formats, deterministic duration/interval math,
tool-grounded resolution, invalidation, readiness, typed selections,
persistence, and multi-turn acceptance flows A–F.
"""

import uuid
from datetime import date as _date

import pytest

from app.ai.agent import booking_state as bs
from app.ai.agent import orchestrator
from app.ai.context.ai_context import (
    AIContext,
    clear_ai_context,
    get_ai_context,
    save_ai_context,
)
from app.domain.scheduling.availability import overlaps
from tests.test_mcp_agent import patient_ctx, scripted, seed_setup


@pytest.fixture()
def tool_factory(db):
    from app.integration.integration_service import IntegrationService
    from app.mcp_server.tools import _base as tool_base
    from tests.test_mcp_agent import FakeConnector

    fake = FakeConnector()
    tool_base.set_integration_factory(
        lambda session: IntegrationService(session=session, connector=fake)
    )
    try:
        yield fake
    finally:
        tool_base.set_integration_factory(None)


def fresh_ctx(cid=None):
    return AIContext(conversation_id=cid or f"phase2-{uuid.uuid4().hex[:8]}")


# -- 1-4. canonical candidates ----------------------------------------------

TOMORROW = "2026-09-21"  # Monday after Sun 2026-09-20 (IST)


def test_doctor_plus_tomorrow_extracts_both():
    assert bs.detect_doctor_candidate("Book Dr Rao tomorrow.") == "Rao"
    assert bs.detect_date_iso("Book Dr Rao tomorrow.", today=_date(2026, 9, 20)) == TOMORROW


def test_doctor_date_type_candidate():
    assert bs.detect_doctor_candidate("Book Dr Rao tomorrow for a follow-up.") == "Rao"
    assert bs.detect_type_candidate("Book Dr Rao tomorrow for a follow-up.") == "follow-up"


def test_doctor_date_mode_candidate():
    assert bs.detect_mode_candidate("Book Dr Rao tomorrow by video.") == "video"
    assert bs.detect_mode_candidate("Book Dr Rao tomorrow by video at 9:30.") == "video"


def test_doctor_date_time_candidate():
    assert bs.detect_time_hhmm("Book Dr Rao tomorrow at 9:30.") == "09:30"
    assert bs.detect_time_hhmm("Book Dr Rao tomorrow by video at 9:30.") == "09:30"


# -- 5-6. hospital candidates -------------------------------------------------

def test_hospital_plus_date_candidate():
    assert bs.detect_hospital_candidate("Book me at Apollo tomorrow.") == "Apollo"
    assert (
        bs.detect_date_iso("Book me at Apollo tomorrow.", today=_date(2026, 9, 20))
        == TOMORROW
    )


def test_hospital_candidate_ignores_non_hospitals():
    assert bs.detect_hospital_candidate("Book me at home tomorrow.") is None


# -- 7. NL visit-type aliases --------------------------------------------------

@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("I need a follow-up.", "follow-up"),
        ("Book a follow up visit.", "follow-up"),
        ("I want a review visit.", "follow-up"),
        ("New consultation please.", "new consultation"),
        ("Is this a routine checkup?", "routine checkup"),
        ("Routine check-up tomorrow.", "routine checkup"),
    ],
)
def test_type_aliases(text, expected):
    assert bs.detect_type_candidate(text) == expected


def test_type_offer_grounding_and_duration():
    ctx = fresh_ctx()
    ctx.visit_types = [
        {"id": "t1", "name": "Follow Up Visit", "duration_minutes": 30},
        {"id": "t2", "name": "New Consultation", "duration_minutes": 45},
    ]
    ctx.type_query = "follow-up"
    assert bs.match_type_offer(ctx) == "t1"
    assert ctx.selected_appointment_type_id == "t1"
    assert ctx.duration_minutes == 30
    assert ctx.visit_type_name == "Follow Up Visit"


def test_type_change_recalculates_duration_and_end():
    ctx = fresh_ctx()
    ctx.visit_types = [
        {"id": "t1", "name": "Follow Up", "duration_minutes": 30},
        {"id": "t2", "name": "New Consultation", "duration_minutes": 45},
    ]
    ctx.selected_appointment_type_id = "t1"
    ctx.selected_date = "2026-09-21"
    ctx.requested_start = "09:30"
    bs.sync_duration_from_types(ctx)
    start, end = bs.compute_interval_utc("2026-09-21", "09:30", ctx.duration_minutes)
    bs.set_canonical_slot(ctx, start, end)
    # 09:30 IST == 04:00 UTC; storage is UTC, labels render IST.
    assert start == "2026-09-21T04:00:00+00:00"
    assert end == "2026-09-21T04:30:00+00:00"
    # Visit-type change: 45-min type recomputes the end deterministically.
    ctx.selected_appointment_type_id = "t2"
    bs.invalidate_on_change(ctx, "visit_type")
    assert ctx.duration_minutes == 45
    # 09:30 + 45 min = 10:15 IST == 04:45 UTC.
    assert ctx.selected_end == "2026-09-21T04:45:00+00:00"


# -- 8. NL consultation-mode aliases -------------------------------------------

@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Book by video.", "video"),
        ("A virtual visit please.", "video"),
        ("Online consultation.", "video"),
        ("Give me a call.", "phone"),
        ("By telephone.", "phone"),
        ("In person tomorrow.", "in_person"),
        ("At the clinic.", "in_person"),
    ],
)
def test_mode_aliases(text, expected):
    assert bs.detect_mode_candidate(text) == expected


# -- 9. NL time variants --------------------------------------------------------

@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Book at 9:30.", "09:30"),
        ("Tomorrow at 10.", "10:00"),
        ("Monday at 9.", "09:00"),
        ("10 AM tomorrow.", "10:00"),
        ("2 PM please.", "14:00"),
        ("14:30 works.", "14:30"),
        ("12 PM sharp.", "12:00"),
    ],
)
def test_time_variants(text, expected):
    assert bs.detect_time_hhmm(text) == expected


# -- 7b. date formats -----------------------------------------------------------

def test_date_formats_ist():
    today = _date(2026, 9, 20)  # a Sunday (IST)
    assert bs.detect_date_iso("today", today=today) == "2026-09-20"
    assert bs.detect_date_iso("tomorrow", today=today) == "2026-09-21"
    assert bs.detect_date_iso("day after tomorrow", today=today) == "2026-09-22"
    assert bs.detect_date_iso("next Monday", today=today) == "2026-09-21"
    assert bs.detect_date_iso("this Friday", today=today) == "2026-09-25"
    assert bs.detect_date_iso("September 25", today=today) == "2026-09-25"
    assert bs.detect_date_iso("25 September", today=today) == "2026-09-25"
    assert bs.detect_date_iso("25/09/2026", today=today) == "2026-09-25"
    assert bs.detect_date_iso("25-09-2026", today=today) == "2026-09-25"


def test_next_weekday_from_same_weekday():
    monday = _date(2026, 9, 21)
    assert bs.detect_date_iso("next Monday", today=monday) == "2026-09-28"
    assert bs.detect_date_iso("Monday", today=monday) == "2026-09-21"


# -- 4/9. duration + interval math -----------------------------------------------

def test_interval_math_examples():
    # IST wall in, UTC ISO out: 09:30 IST == 04:00 UTC.
    start, end = bs.compute_interval_utc("2026-09-21", "09:30", 30)
    assert start == "2026-09-21T04:00:00+00:00"
    assert end == "2026-09-21T04:30:00+00:00"
    start45, end45 = bs.compute_interval_utc("2026-09-21", "09:30", 45)
    assert end45 == "2026-09-21T04:45:00+00:00"


# -- 14/15. sub-grid overlap semantics --------------------------------------------

def test_sub_grid_overlap_and_touching():
    from datetime import datetime, timezone

    def dt(h, m):
        return datetime(2026, 9, 21, h, m, tzinfo=timezone.utc)

    assert overlaps(dt(9, 15), dt(9, 45), dt(9, 30), dt(10, 0)) is True
    assert overlaps(dt(9, 0), dt(9, 30), dt(9, 30), dt(10, 0)) is False


# -- 2/3. hospital offer grounding --------------------------------------------------

def test_hospital_offer_grounding():
    ctx = fresh_ctx()
    ctx.hospital_query = "Apollo"
    hid = bs.match_hospital_offer(
        ctx, [{"id": "h1", "name": "Apollo Hospitals"}, {"id": "h2", "name": "Fortis"}]
    )
    assert hid == "h1"
    assert ctx.offered_hospitals[0]["name"] == "Apollo Hospitals"


# -- 11/12. invalidation ------------------------------------------------------------

def _full_context():
    ctx = fresh_ctx()
    ctx.selected_hospital_id = "h1"
    ctx.selected_doctor_id = "d1"
    ctx.selected_appointment_type_id = "t1"
    ctx.duration_minutes = 30
    ctx.selected_date = "2026-09-21"
    bs.set_canonical_slot(ctx, "2026-09-21T04:00:00+00:00", "2026-09-21T04:30:00+00:00")
    ctx.offered_slots = [{"start": "2026-09-21T04:00:00+00:00", "end": "2026-09-21T04:30:00+00:00"}]
    ctx.pending_booking = {"kind": "create"}
    ctx.awaiting_confirmation = True
    return ctx


def test_doctor_change_invalidates_slot():
    ctx = _full_context()
    bs.invalidate_on_change(ctx, "doctor")
    assert ctx.offered_slots == []
    assert ctx.selected_slot is None and ctx.selected_start is None
    assert ctx.awaiting_confirmation is False


def test_date_change_invalidates_slot():
    ctx = _full_context()
    bs.invalidate_on_change(ctx, "date")
    assert ctx.offered_slots == []
    assert ctx.selected_slot is None


def test_hospital_change_resets_flow():
    ctx = _full_context()
    bs.invalidate_on_change(ctx, "hospital")
    assert ctx.selected_doctor_id is None
    assert ctx.visit_types == [] and ctx.duration_minutes is None
    assert ctx.offered_slots == []


def test_mode_change_keeps_availability_but_drops_proposal():
    ctx = _full_context()
    bs.invalidate_on_change(ctx, "consultation_mode")
    assert ctx.offered_slots != []
    assert ctx.pending_booking is None and ctx.awaiting_confirmation is False


# -- 17. readiness -------------------------------------------------------------------

def test_readiness_missing_then_ready():
    ctx = fresh_ctx()
    assert bs.evaluate_readiness(ctx)["ready"] is False
    assert "doctor" in bs.evaluate_readiness(ctx)["missing"]
    ctx.selected_doctor_id = "d1"
    ctx.selected_date = "2026-09-21"
    ctx.visit_types = [{"id": "t1", "name": "Follow Up", "duration_minutes": 30}]
    ctx.selected_appointment_type_id = "t1"
    ctx.duration_minutes = 30
    ctx.selected_consultation_mode = "video"
    ctx.requested_start = "09:30"
    assert bs.evaluate_readiness(ctx)["missing"] == ["start_time"]  # known, not validated
    bs.set_canonical_slot(ctx, "2026-09-21T04:00:00+00:00", "2026-09-21T04:30:00+00:00")
    assert bs.evaluate_readiness(ctx)["ready"] is True


def test_field_status_lifecycle():
    ctx = fresh_ctx()
    assert bs.field_status(ctx)["doctor"] == "UNKNOWN"
    ctx.doctor_query = "Rao"
    assert bs.field_status(ctx)["doctor"] == "KNOWN"
    ctx.selected_doctor_id = "d1"
    ctx.offered_doctors = [{"id": "d1", "name": "Dr. Rao"}]
    assert bs.field_status(ctx)["doctor"] == "VALIDATED"


# -- 18. persistence ------------------------------------------------------------------

def test_context_persists_canonical_fields(db):
    cid = f"phase2-persist-{uuid.uuid4().hex[:8]}"
    clear_ai_context(cid)
    ctx = get_ai_context(cid)
    ctx.selected_hospital_id = "h1"
    ctx.selected_hospital_name = "Apollo"
    ctx.selected_doctor_id = "d1"
    ctx.duration_minutes = 45
    ctx.requested_start = "09:30"
    bs.set_canonical_slot(ctx, "a", "b")
    save_ai_context(ctx)
    back = get_ai_context(cid)
    assert back.selected_hospital_name == "Apollo"
    assert back.duration_minutes == 45
    assert back.selected_start == "a" and back.selected_slot == {"start": "a", "end": "b"}


# -- 10. typed selections ---------------------------------------------------------------

def test_typed_date_and_mode_selection(client, db, tool_factory):
    setup = seed_setup(client, tag="ph2sel")
    ctx = patient_ctx(setup)
    cid = f"phase2-sel-{uuid.uuid4().hex[:8]}"
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Hello",
        selection={"type": "booking_selection", "field": "date", "value": "2026-10-06"},
        complete=scripted({"content": "Noted.", "tool_calls": []}),
    )
    assert result["conversation_id"] == cid
    assert get_ai_context(cid).selected_date == "2026-10-06"
    result2 = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Video please",
        selection={"type": "booking_selection", "field": "consultation_mode", "value": "video"},
        complete=scripted({"content": "Video noted.", "tool_calls": []}),
    )
    assert result2["conversation_id"] == cid
    assert get_ai_context(cid).selected_consultation_mode == "video"


def test_typed_invalid_selection_ignored(client, db, tool_factory):
    setup = seed_setup(client, tag="ph2bad")
    ctx = patient_ctx(setup)
    cid = f"phase2-bad-{uuid.uuid4().hex[:8]}"
    orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Hmm",
        selection={"type": "booking_selection", "field": "doctor", "value": "not-a-uuid"},
        complete=scripted({"content": "OK.", "tool_calls": []}),
    )
    assert get_ai_context(cid).selected_doctor_id is None


# -- 19. multi-turn: Example A ------------------------------------------------------------

def test_example_a_doctor_tomorrow_no_reask(client, db, tool_factory):
    """'Book Dr Rao tomorrow.' stores doctor-query + date without re-asking."""
    setup = seed_setup(client, tag="ph2a")
    doctor_name = "Dr. ph2a"
    ctx = patient_ctx(setup)
    cid = f"phase2-a-{uuid.uuid4().hex[:8]}"

    def _search(arguments):
        assert arguments.get("hospital_id", None) in (None, setup["hid"])
        return None

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message=f"Book {doctor_name} tomorrow.",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {"id": "c1", "name": "search_doctors", "arguments": {"query": "ph2a"}}
                ],
            },
            {"content": "Found them. Which day suits you?", "tool_calls": []},
        ),
    )
    ctx_after = get_ai_context(cid)
    # Cold-start name grounded post-search: no doctor re-ask needed.
    assert ctx_after.selected_doctor_id == setup["doctor"]["id"]
    assert ctx_after.selected_date is not None
    # Contract carries the canonical snapshot.
    from app.ai.router import ChatOut

    body = ChatOut(**result)
    assert body.selected_date == ctx_after.selected_date
    assert isinstance(body.missing_fields, list)


def test_example_f_hospital_first(client, db, tool_factory):
    """'Book me at <hospital> tomorrow.' resolves hospital, scopes doctors."""
    setup = seed_setup(client, tag="ph2f")
    ctx = patient_ctx(setup)
    cid = f"phase2-f-{uuid.uuid4().hex[:8]}"
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Book me at Hospital ph2f tomorrow.",
        complete=scripted(
            {
                "content": None,
                "tool_calls": [
                    {
                        "id": "c1",
                        "name": "search_hospitals",
                        "arguments": {"query": "Hospital ph2f"},
                    }
                ],
            },
            {"content": "Great, which doctor there?", "tool_calls": []},
        ),
    )
    ctx_after = get_ai_context(cid)
    assert ctx_after.selected_hospital_id == setup["hid"]
    assert ctx_after.selected_date is not None
    from app.ai.router import ChatOut

    assert ChatOut(**result).hospital is not None


def test_hospital_doctor_mismatch_structured_correction(client, db, tool_factory):
    """Doctor outside the named hospital: no silent substitution."""
    setup = seed_setup(client, tag="ph2m1")
    other = seed_setup(client, tag="ph2m2")
    ctx = patient_ctx(setup)
    cid = f"phase2-m-{uuid.uuid4().hex[:8]}"
    prior = get_ai_context(cid)
    prior.selected_hospital_id = setup["hid"]
    prior.selected_hospital_name = "Hospital ph2m1"
    prior.selected_doctor_id = other["doctor"]["id"]
    save_ai_context(prior)
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Yes, book them.",
        complete=scripted({"content": "Should not reach.", "tool_calls": []}),
    )
    assert "isn't at" in result["reply"]
    assert get_ai_context(cid).selected_doctor_id is None
    assert result["missing_fields"] == ["doctor"]
    assert len(result["doctors"]) >= 1
