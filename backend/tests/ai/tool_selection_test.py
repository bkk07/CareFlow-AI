"""ai/tool_selection: the right capability fires with the caller's words."""

from app.ai.agent import orchestrator
from app.mcp_server.models import CapabilityExecution
from tests.test_mcp_agent import patient_ctx, scripted, seed_setup


def test_search_query_selects_search_doctors(client, db, ehr_stub):
    setup = seed_setup(client, tag="aitool")
    ctx = patient_ctx(setup)
    seen_specs: list = []

    def _complete(messages, specs):
        seen_specs.append([s["name"] for s in specs])
        return {
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "name": "search_doctors",
                    "arguments": {"specialty": "Cardiology aitool"},
                }
            ],
        }

    def _done(messages, specs):
        return {"content": "Here is one.", "tool_calls": []}

    calls = [_complete, _done]

    def _router(messages, specs):
        return calls.pop(0)(messages, specs)

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-aitool",
        user_message="find me a cardiologist",
        complete=_router,
    )
    assert result["reply"] == "Here is one."
    rows = db.query(CapabilityExecution).all()
    assert [r.tool_name for r in rows] == ["search_doctors"]
    assert rows[0].input["specialty"] == "Cardiology aitool"
    # The model chose from the full capability set, not a narrowed one.
    assert "create_appointment" in seen_specs[0]
    assert "search_doctors" in seen_specs[0]
