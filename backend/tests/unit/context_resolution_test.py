"""unit/context_resolution: conversation memory bridges turns."""

from app.ai.context.ai_context import (
    clear_ai_context,
    get_ai_context,
    save_ai_context,
)
from tests.test_mcp_agent import patient_ctx, scripted, seed_setup, slot_iso

from app.ai.agent import orchestrator


def test_turns_accumulate_in_order():
    cid = "unit-ctx-order"
    clear_ai_context(cid)
    context = get_ai_context(cid)
    context.remember_turn("user", "I need a cardiologist")
    context.remember_turn("assistant", "Which day works?")
    save_ai_context(context)
    reread = get_ai_context(cid)
    assert [t["text"] for t in reread.history] == [
        "I need a cardiologist",
        "Which day works?",
    ]


def test_clear_resets_the_conversation():
    cid = "unit-ctx-clear"
    get_ai_context(cid).remember_turn("user", "hello")
    clear_ai_context(cid)
    assert get_ai_context(cid).history == []


def test_booking_is_remembered_for_the_next_turn(client, db, ehr_stub):
    setup = seed_setup(client, tag="uctxbook")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    cid = "unit-ctx-book"
    clear_ai_context(cid)
    # Confirmation turn: the slot was offered previously, so the confirm
    # gate allows the booking after the patient's explicit "yes".
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. uctxbook"}]
    prior.offered_slots = [{"start": start, "end": end}]
    # The scripted flow jumps straight to confirmation: simulate the
    # visit-type step having happened on an earlier turn.
    prior.visit_types_seen = True
    save_ai_context(prior)
    first = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="Yes, book me Monday morning",
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
                            "idempotency_key": "uctx-k1",
                        },
                    }
                ],
            },
            {"content": "Booked.", "tool_calls": []},
        ),
    )
    assert first["reply"] == "Booked."
    remembered = get_ai_context(cid)
    assert remembered.last_appointment_id, "booking id must survive the turn"

    seen: list = []

    def _complete(messages, specs):
        seen.append(messages)
        return {"content": "Monday 9:00.", "tool_calls": []}

    second = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="when is it again?",
        complete=_complete,
    )
    assert second["reply"] == "Monday 9:00."
    # The follow-up turn saw the booking id in its context payload.
    assert remembered.last_appointment_id in seen[0][0]["content"]
