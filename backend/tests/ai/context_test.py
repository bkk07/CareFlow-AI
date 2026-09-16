"""ai/context: the model sees the booking when the patient says "that one"."""

from app.ai.agent import orchestrator
from app.ai.context.ai_context import clear_ai_context, get_ai_context
from tests.test_mcp_agent import patient_ctx, scripted, seed_setup, slot_iso


def test_follow_up_turn_sees_prior_booking(client, db, ehr_stub):
    setup = seed_setup(client, tag="aictx")
    start, end = slot_iso()
    ctx = patient_ctx(setup)
    cid = "conv-aictx"
    clear_ai_context(cid)
    orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="book me Monday morning",
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
