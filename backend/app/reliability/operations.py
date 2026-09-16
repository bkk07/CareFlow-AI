"""Small write helpers shared by the reliability services.

All helpers flush; callers own the commit so a recovery flow (lookup +
transition + record) stays atomic.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment
from app.reliability.models import (
    IntegrationOperation,
    OperationStatus,
    OperationType,
    ReconciliationRecord,
    ResolutionStatus,
)


def next_attempt_number(
    session: Session, appointment_id: uuid.UUID, operation_type: OperationType
) -> int:
    count = (
        session.query(IntegrationOperation)
        .filter(
            IntegrationOperation.appointment_id == appointment_id,
            IntegrationOperation.operation_type == operation_type,
        )
        .count()
    )
    return count + 1


def record_operation(
    session: Session,
    *,
    appointment_id: uuid.UUID,
    operation_type: OperationType,
    attempt_number: int,
    status: OperationStatus,
    request_payload: dict[str, Any] | None = None,
    response_payload: dict[str, Any] | None = None,
    error: str | None = None,
    correlation_id: uuid.UUID,
) -> IntegrationOperation:
    operation = IntegrationOperation(
        appointment_id=appointment_id,
        operation_type=operation_type,
        attempt_number=attempt_number,
        status=status,
        request_payload=request_payload,
        response_payload=response_payload,
        error=error,
        correlation_id=correlation_id,
    )
    session.add(operation)
    session.flush()
    return operation


def open_record(
    session: Session,
    *,
    appointment: Appointment,
    operation: IntegrationOperation | None,
    error: str,
    attempts: int,
    external_id: str | None = None,
    external_status: str | None = None,
) -> ReconciliationRecord:
    record = ReconciliationRecord(
        hospital_id=appointment.hospital_id,
        operation_id=operation.id if operation is not None else None,
        appointment_id=appointment.id,
        external_id=external_id,
        error=error,
        attempts=attempts,
        external_status=external_status,
        internal_status=appointment.state.value,
        resolution_status=ResolutionStatus.open,
    )
    session.add(record)
    session.flush()
    return record


def set_resolution(
    session: Session,
    record: ReconciliationRecord,
    resolution: ResolutionStatus,
    *,
    note: str | None = None,
) -> ReconciliationRecord:
    record.resolution_status = resolution
    if note is not None:
        record.note = note
    if resolution in (ResolutionStatus.resolved, ResolutionStatus.escalated):
        record.resolved_at = datetime.now(timezone.utc)
    else:
        record.resolved_at = None
    session.flush()
    return record
