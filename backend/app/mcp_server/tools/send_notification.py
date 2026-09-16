"""send_notification — deliver a real notification (Phase 10 live)."""

import uuid

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role, User
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool
from app.notification import service as notification_service

TOOL_NAME = "send_notification"


class SendNotificationIn(BaseModel):
    recipient_user_id: uuid.UUID
    channel: str = "in_app"
    message: str = ""
    subject: str | None = None
    type: str = "manual"
    dedupe_key: str | None = None


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=False,
    allowed_roles=[Role.hospital_admin, Role.platform_admin],
)
def run(
    input: SendNotificationIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Queue an email or in-app notification for a user."""
    del integration
    if not input.message.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="message must not be empty",
        )
    recipient = db.get(User, input.recipient_user_id)
    if recipient is None:
        raise HTTPException(status_code=404, detail="Recipient not found")
    key = input.dedupe_key or f"manual:{recipient.id}:{uuid.uuid4().hex}"
    if input.channel == "email":
        row, created = notification_service.deliver_email(
            db,
            recipient_user_id=recipient.id,
            recipient_address=recipient.email,
            subject=input.subject or "Message from your care team",
            body=input.message,
            type=input.type,
            dedupe_key=key,
            correlation_id=ctx.correlation_id,
        )
    elif input.channel == "in_app":
        row, created = notification_service.create_in_app(
            db,
            recipient_user_id=recipient.id,
            type=input.type,
            detail=input.message,
            dedupe_key=key,
            correlation_id=ctx.correlation_id,
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="channel must be 'in_app' or 'email'",
        )
    return {
        "notification_id": str(row.id),
        "channel": row.channel.value,
        "status": row.status.value,
        "created": created,
        "error": row.error,
    }
