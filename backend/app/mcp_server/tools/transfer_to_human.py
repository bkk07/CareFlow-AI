"""transfer_to_human — escalate a conversation to a staff queue.

Persists a queryable `Escalation` row immediately; the HITL review UI
itself arrives in Phase 13.
"""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.models import Escalation, EscalationStatus
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "transfer_to_human"


class TransferToHumanIn(BaseModel):
    conversation_id: str
    reason: str
    appointment_id: uuid.UUID | None = None


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: TransferToHumanIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Open a human-review escalation for this conversation."""
    del integration
    row = Escalation(
        conversation_id=input.conversation_id.strip(),
        appointment_id=input.appointment_id,
        reason=input.reason.strip(),
        status=EscalationStatus.open,
        created_by_user_id=ctx.user_id,
        hospital_id=ctx.hospital_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "escalation_id": str(row.id),
        "conversation_id": row.conversation_id,
        "status": row.status.value,
    }
