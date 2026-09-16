"""ai/intent: scheduling requests act, clinical ones never reach tools."""

from app.ai.agent import orchestrator
from app.ai.agent.orchestrator import is_clinical_request
from app.mcp_server.models import CapabilityExecution
from tests.test_mcp_agent import patient_ctx, scripted, seed_setup


def test_classifier_separates_care_from_clinical():
    assert is_clinical_request("I need a cardiologist this week") is False
    assert is_clinical_request("What does this chest pain mean for me?") is True


def test_scheduling_message_fires_tools(client, db, ehr_stub):
    setup = seed_setup(client, tag="aiintent")
    ctx = patient_ctx(setup)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "search_doctors",
                    "arguments": {"specialty": "Cardiology aiintent"},
                }
            ],
        },
        {"content": "Found one cardiologist.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-aiintent",
        user_message="I need a cardiologist this week",
        complete=complete,
    )
    assert result["reply"] == "Found one cardiologist."
    assert db.query(CapabilityExecution).count() == 1


def test_clinical_message_is_declined_without_tools(client, db, ehr_stub):
    setup = seed_setup(client, tag="aiintentclin")
    ctx = patient_ctx(setup)

    def _never(messages, specs):
        raise AssertionError("model must not be consulted for clinical text")

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-aiintent-clin",
        user_message="What does this chest pain mean for my heart?",
        complete=_never,
    )
    assert result["reply"] == orchestrator.CLINICAL_DECLINE
    assert result["iterations"] == 0
    assert db.query(CapabilityExecution).count() == 0
