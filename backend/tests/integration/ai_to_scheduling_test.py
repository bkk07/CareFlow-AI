"""integration/ai_to_scheduling: the agent's words become slot lookups."""

from app.ai.agent import orchestrator
from app.mcp_server.models import CapabilityExecution
from tests.test_mcp_agent import patient_ctx, scripted, seed_setup


def test_agent_check_availability_returns_real_slots(client, db, ehr_stub):
    setup = seed_setup(client, tag="i2sched")
    ctx = patient_ctx(setup)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "check_availability",
                    "arguments": {
                        "doctor_id": setup["doctor"]["id"],
                        "appointment_type_id": setup["type"]["id"],
                        "date_from": "2026-10-05",
                        "date_to": "2026-10-05",
                    },
                }
            ],
        },
        {"content": "Monday has 16 open slots.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-i2sched",
        user_message="When is Dr. i2sched free on Monday?",
        complete=complete,
    )
    assert result["reply"] == "Monday has 16 open slots."
    rows = db.query(CapabilityExecution).all()
    assert len(rows) == 1
    assert rows[0].tool_name == "check_availability"
    assert rows[0].status.value == "success"
    assert rows[0].input["doctor_id"] == setup["doctor"]["id"]
