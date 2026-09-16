"""Workflow execution log (Phase 10).

Every published event gets a row: what was requested, how many times it
ran, and a readable step-by-step history. `status=failed` plus the
history is the operator-visible trace the plan requires — nothing fails
silently.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Enum, Integer, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ExecutionStatus(str, enum.Enum):
    running = "running"
    completed = "completed"
    failed = "failed"
    retried = "retried"


def _payload() -> Any:
    return JSONB().with_variant(JSON(), "sqlite")


class WorkflowExecution(Base):
    __tablename__ = "workflow_executions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    status: Mapped[ExecutionStatus] = mapped_column(
        Enum(ExecutionStatus, name="workflow_execution_status", validate_strings=True),
        nullable=False,
        default=ExecutionStatus.running,
    )
    payload: Mapped[dict] = mapped_column(_payload(), nullable=False, default=dict)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    execution_history: Mapped[list] = mapped_column(
        _payload(), nullable=False, default=list
    )
    correlation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


__all__ = ["ExecutionStatus", "WorkflowExecution"]
