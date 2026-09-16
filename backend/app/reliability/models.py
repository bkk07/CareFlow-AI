"""Reliability models: operation log, verification evidence, open work items.

IntegrationOperation is the append-only log of every vendor call the
booking flows make (or attempt). IntegrationVerification records each
trust-but-verify check. ReconciliationRecord is the operator work queue:
`resolution_status` is a first-class indexed column — never buried in a
JSON blob — so the Operations dashboard (Phase 13) can query it
directly. `hospital_id` is denormalized onto records for the same
reason: tenant-scoped listing without joining appointments.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class OperationType(str, enum.Enum):
    create = "create"
    update = "update"
    cancel = "cancel"
    verify = "verify"


class OperationStatus(str, enum.Enum):
    sent = "sent"
    succeeded = "succeeded"
    failed = "failed"
    timed_out = "timed_out"
    unknown = "unknown"


class ResolutionStatus(str, enum.Enum):
    open = "open"
    retrying = "retrying"
    resolved = "resolved"
    escalated = "escalated"


def _payload() -> Any:
    return JSONB().with_variant(JSON(), "sqlite")


class IntegrationOperation(Base):
    __tablename__ = "integration_operations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    operation_type: Mapped[OperationType] = mapped_column(
        Enum(OperationType, name="operation_type", validate_strings=True),
        nullable=False,
    )
    request_payload: Mapped[dict[str, Any] | None] = mapped_column(
        _payload(), nullable=True
    )
    response_payload: Mapped[dict[str, Any] | None] = mapped_column(
        _payload(), nullable=True
    )
    status: Mapped[OperationStatus] = mapped_column(
        Enum(OperationStatus, name="operation_status", validate_strings=True),
        nullable=False,
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    correlation_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class IntegrationVerification(Base):
    __tablename__ = "integration_verifications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    operation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("integration_operations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    verified_bool: Mapped[bool] = mapped_column(Boolean, nullable=False)
    details: Mapped[dict[str, Any] | None] = mapped_column(_payload(), nullable=True)
    verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ReconciliationRecord(Base):
    __tablename__ = "reconciliation_records"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hospital_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False, index=True
    )
    operation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("integration_operations.id", ondelete="SET NULL"),
        nullable=True,
    )
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    external_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error: Mapped[str] = mapped_column(String(500), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    external_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    internal_status: Mapped[str] = mapped_column(String(30), nullable=False)
    resolution_status: Mapped[ResolutionStatus] = mapped_column(
        Enum(ResolutionStatus, name="resolution_status", validate_strings=True),
        nullable=False,
        default=ResolutionStatus.open,
        index=True,
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


__all__ = [
    "Base",
    "IntegrationOperation",
    "IntegrationVerification",
    "OperationStatus",
    "OperationType",
    "ReconciliationRecord",
    "ResolutionStatus",
]
