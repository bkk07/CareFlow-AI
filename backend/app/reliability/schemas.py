"""Reconciliation schemas (operator work queue)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.reliability.models import OperationStatus, OperationType, ResolutionStatus


class ReconciliationRecordOut(BaseModel):
    id: uuid.UUID
    hospital_id: uuid.UUID
    operation_id: uuid.UUID | None
    appointment_id: uuid.UUID
    external_id: str | None
    error: str
    attempts: int
    external_status: str | None
    internal_status: str
    resolution_status: ResolutionStatus
    note: str | None
    created_at: datetime
    resolved_at: datetime | None


class AppointmentSummaryOut(BaseModel):
    id: uuid.UUID
    state: str
    slot_start: datetime
    slot_end: datetime
    external_id: str | None
    idempotency_key: str


class OperationOut(BaseModel):
    id: uuid.UUID
    appointment_id: uuid.UUID
    operation_type: OperationType
    status: OperationStatus
    attempt_number: int
    error: str | None
    correlation_id: uuid.UUID
    created_at: datetime


class RecordDetailOut(ReconciliationRecordOut):
    appointment: AppointmentSummaryOut
    operations: list[OperationOut]


class ResolveIn(BaseModel):
    resolution: ResolutionStatus
    note: str | None = Field(default=None, max_length=500)
