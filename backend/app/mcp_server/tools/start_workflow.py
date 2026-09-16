"""start_workflow — publish a real workflow event (Phase 10 live)."""

import uuid

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool
from app.workflow import event_bus
from app.workflow.tasks._base import HANDLERS

TOOL_NAME = "start_workflow"


class StartWorkflowIn(BaseModel):
    event_type: str
    payload: dict = {}


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=False,
    allowed_roles=[Role.hospital_admin, Role.platform_admin],
)
def run(
    input: StartWorkflowIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Publish a workflow event for async handling."""
    del integration
    if input.event_type not in HANDLERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown event type '{input.event_type}'. "
            f"Known: {sorted(HANDLERS)}",
        )
    execution = event_bus.publish_event(
        db, input.event_type, dict(input.payload), correlation_id=uuid.uuid4()
    )
    return {
        "execution_id": str(execution.id),
        "event_type": execution.event_type,
        "status": execution.status.value,
    }
