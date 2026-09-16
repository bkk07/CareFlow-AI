"""ai/clarification: missing details become questions, not guesses."""

import pytest

from app.ai.agent import orchestrator
from app.mcp_server.models import CapabilityExecution
from tests.test_mcp_agent import patient_ctx, seed_setup


def test_model_question_passes_through_with_no_tools(client, db, ehr_stub):
    setup = seed_setup(client, tag="aiclarify")
    ctx = patient_ctx(setup)

    def _complete(messages, specs):
        assert specs, "tools must still be advertised"
        return {"content": "Which day works for you?", "tool_calls": []}

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-aiclarify",
        user_message="I need to see someone",
        complete=_complete,
    )
    assert result["reply"] == "Which day works for you?"
    assert result["iterations"] == 1
    assert db.query(CapabilityExecution).count() == 0


def test_blank_message_is_rejected_before_the_model(client, db, ehr_stub):
    setup = seed_setup(client, tag="aiclarifyblank")
    ctx = patient_ctx(setup)
    with pytest.raises(ValueError):
        orchestrator.run_conversation(
            db=db,
            ctx=ctx,
            conversation_id="conv-aiclarify-blank",
            user_message="   ",
            complete=lambda messages, specs: {"content": "x", "tool_calls": []},
        )
