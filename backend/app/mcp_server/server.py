"""Tool registry + HTTP surface: registers all tools.

In-process callers (the Phase 9 orchestrator) use `execute_tool`;
operators and the ChatDebug page use the HTTP routes. Per-tool auth
is enforced inside the wrapper, so both paths share one policy.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, get_current_context
from app.mcp_server.errors import CapabilityValidationError
from app.mcp_server.tools import (
    cancel_appointment,
    check_availability,
    create_appointment,
    get_appointment,
    get_context,
    get_questionnaire,
    list_appointment_types,
    lookup_patient,
    reschedule_appointment,
    search_doctors,
    search_hospitals,
    send_notification,
    start_workflow,
    submit_questionnaire,
    synchronize_state,
    transfer_to_human,
    update_preferences,
    verify_caller_identity,
    verify_external_appointment,
)

router = APIRouter(tags=["mcp"])

_TOOLS: dict[str, dict] = {}


def _register(module) -> None:
    meta = module.run._mcp_tool_meta
    _TOOLS[meta["name"]] = {
        "run": module.run,
        "input_model": meta["input_model"],
        "description": meta["description"],
        "retry_safe": meta["retry_safe"],
        "requires_idempotency": meta["requires_idempotency"],
        "allowed_roles": [r.value for r in meta["allowed_roles"]],
    }


for _module in (
    search_hospitals,
    search_doctors,
    check_availability,
    lookup_patient,
    get_appointment,
    create_appointment,
    reschedule_appointment,
    cancel_appointment,
    get_questionnaire,
    list_appointment_types,
    submit_questionnaire,
    send_notification,
    start_workflow,
    get_context,
    update_preferences,
    verify_caller_identity,
    verify_external_appointment,
    synchronize_state,
    transfer_to_human,
):
    _register(_module)

# 17 tools through Phase 13; verify_caller_identity (Phase 14) makes 18;
# list_appointment_types (nearby-care polish) makes 19.
assert len(_TOOLS) == 19, f"expected 19 tools, registered {len(_TOOLS)}"


def list_tools() -> list[dict]:
    return [
        {
            "name": name,
            "description": spec["description"],
            "allowed_roles": spec["allowed_roles"],
            "requires_idempotency": spec["requires_idempotency"],
        }
        for name, spec in sorted(_TOOLS.items())
    ]


def execute_tool(
    name: str, input_data: dict, ctx: RequestContext, db: Session
) -> dict:
    spec = _TOOLS.get(name)
    if spec is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown capability '{name}'",
        )
    try:
        parsed = spec["input_model"](**input_data)
    except ValidationError as exc:
        raise CapabilityValidationError(
            f"Invalid input for '{name}': {exc.errors()}"
        ) from exc
    try:
        return spec["run"](parsed, ctx, db)
    except ValueError as exc:
        # Tool-level input rejections (e.g. blank conversation id) are
        # caller errors, not crashes.
        raise CapabilityValidationError(str(exc)) from exc


class CallIn(BaseModel):
    tool: str
    input: dict = {}


@router.get("/mcp/tools")
def http_list_tools(ctx: RequestContext = Depends(get_current_context)) -> dict:
    del ctx
    return {"tools": list_tools()}


@router.post("/mcp/call")
def http_call_tool(
    body: CallIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(get_current_context),
) -> dict:
    return {
        "tool": body.tool,
        "result": execute_tool(body.tool, body.input, ctx, db),
    }


__all__ = ["execute_tool", "list_tools", "router"]
