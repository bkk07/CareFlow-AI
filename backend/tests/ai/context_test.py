"""ai/context: the model sees the booking when the patient says "that one"."""

from app.ai.agent import orchestrator
from app.ai.context.ai_context import clear_ai_context, get_ai_context, save_ai_context
from tests.test_mcp_agent import patient_ctx, scripted, seed_setup, slot_iso


def test_follow_up_turn_sees_prior_booking(client, db, ehr_stub):
    setup = seed_setup(client, tag="aictx")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    cid = "conv-aictx"
    clear_ai_context(cid)
    # Confirmation turn: the slot was offered previously, so the gate
    # allows the booking after the patient's explicit "yes".
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. aictx"}]
    prior.offered_slots = [{"start": start, "end": end}]
    # The scripted flow jumps straight to confirmation: simulate the
    # visit-type step having happened on an earlier turn.
    prior.visit_types_seen = True
    save_ai_context(prior)
    orchestrator.run_conversation(
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
                            "idempotency_key": "aictx-k1",
                        },
                    }
                ],
            },
            {"content": "Booked.", "tool_calls": []},
        ),
    )
    remembered = get_ai_context(cid).last_appointment_id
    assert remembered

    seen: list = []

    def _complete(messages, specs):
        seen.append(messages)
        return {"content": "Monday at 9.", "tool_calls": []}

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="and who is that one with?",
        complete=_complete,
    )
    assert result["reply"] == "Monday at 9."
    # The reference resolves because the booking id rides the context payload.
    assert remembered in seen[0][0]["content"]
