"""ai/safety_boundary: clinical text and unverified calls stop at the gate."""

from app.ai.agent import orchestrator
from app.mcp_server.models import CapabilityExecution
from tests.test_mcp_agent import patient_ctx, scripted, seed_setup
from tests.test_telephony import seed_caller, seed_telephony_context


def test_clinical_request_never_reaches_tools(client, db, ehr_stub):
    setup = seed_setup(client, tag="aisafe")
    ctx = patient_ctx(setup)

    def _never(messages, specs):
        raise AssertionError("model must not be consulted")

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-aisafe",
        user_message="What does this chest pain mean for my heart?",
        complete=_never,
    )
    assert result["reply"] == orchestrator.CLINICAL_DECLINE
    assert db.query(CapabilityExecution).count() == 0


def test_unverified_telephone_call_gets_no_patient_data(client, db, ehr_stub):
    setup = seed_caller(client, tag="aisafecall")
    cid = seed_telephony_context(db, setup)
    ctx = patient_ctx(setup)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {"id": "g1", "name": "lookup_patient", "arguments": {}},
            ],
        },
        {"content": "Please verify first.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id=cid,
        user_message="What are my visits?",
        complete=complete,
    )
    assert result["reply"] == "Please verify first."
    assert db.query(CapabilityExecution).count() == 0
    tool_msgs = [m for m in complete.messages_seen[1] if m.get("role") == "tool"]
    assert any("caller_identity_required" in m["content"] for m in tool_msgs)
