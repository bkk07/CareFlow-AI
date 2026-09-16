"""MCP persistence: capability audit log + human-escalation queue.

`CapabilityExecution` is the per-call audit row the wrapper writes for
every tool invocation (the Phase 13 AI Activity view reads this table).
`Escalation` is the queryable record `transfer_to_human` persists even
though the HITL UI only arrives in Phase 13.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Enum, Float, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ExecutionStatus(str, enum.Enum):
    success = "success"
    error = "error"


class EscalationStatus(str, enum.Enum):
    open = "open"
    resolved = "resolved"


def _payload() -> Any:
    return JSONB().with_variant(JSON(), "sqlite")


class CapabilityExecution(Base):
    __tablename__ = "capability_executions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tool_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    input: Mapped[dict] = mapped_column(_payload(), nullable=False, default=dict)
    status: Mapped[ExecutionStatus] = mapped_column(
        Enum(ExecutionStatus, name="execution_status", validate_strings=True),
        nullable=False,
        default=ExecutionStatus.success,
    )
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    correlation_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Escalation(Base):
    __tablename__ = "escalations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[str] = mapped_column(
        String(100), nullable=False, index=True
    )
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    status: Mapped[EscalationStatus] = mapped_column(
        Enum(EscalationStatus, name="escalation_status", validate_strings=True),
        nullable=False,
        default=EscalationStatus.open,
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    hospital_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


__all__ = [
    "CapabilityExecution",
    "Escalation",
    "EscalationStatus",
    "ExecutionStatus",
]
