"""Audit middleware: one CapabilityExecution row per tool call."""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.mcp_server.models import CapabilityExecution, ExecutionStatus


def record_execution(
    db: Session,
    *,
    tool: str,
    input: BaseModel,
    status: ExecutionStatus,
    latency_ms: float,
    correlation_id: uuid.UUID,
    actor: RequestContext,
    error: str | None = None,
) -> CapabilityExecution:
    try:
        payload = input.model_dump(mode="json", exclude_unset=True)
    except Exception:
        payload = {}
    row = CapabilityExecution(
        tool_name=tool,
        input=payload if isinstance(payload, dict) else {},
        status=status,
        latency_ms=latency_ms,
        correlation_id=correlation_id,
        actor_user_id=actor.user_id,
        error=(error or "")[:500] or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


__all__ = ["record_execution"]
