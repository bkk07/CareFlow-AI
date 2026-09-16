"""Operator endpoints for the reconciliation work queue.

Tenant scoping mirrors the appointment rules: hospital_admins see and
drive only their own hospital's records; platform_admins see everything.
Patients have no business here (403). Records stay queryable by
`resolution_status` for the Operations dashboard (Phase 13).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.appointment.models import Appointment
from app.domain.appointment.router import get_integration_service
from app.domain.appointment.service import get_appointment_or_404
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.reliability import operations
from app.reliability.models import (
    IntegrationOperation,
    ReconciliationRecord,
    ResolutionStatus,
)
from app.reliability.reconciliation import service as reconcile_service
from app.reliability.schemas import (
    AppointmentSummaryOut,
    OperationOut,
    ReconciliationRecordOut,
    RecordDetailOut,
    ResolveIn,
)


router = APIRouter(tags=["reconciliation"])

_operator = require_role(Role.hospital_admin, Role.platform_admin)


def _scoped_record(
    db: Session, ctx: RequestContext, record_id: uuid.UUID
) -> ReconciliationRecord:
    record = db.get(ReconciliationRecord, record_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reconciliation record not found",
        )
    if (
        ctx.role == Role.hospital_admin
        and ctx.hospital_id != record.hospital_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to access this record",
        )
    return record


def _detail_out(db: Session, record: ReconciliationRecord) -> RecordDetailOut:
    appointment = get_appointment_or_404(db, record.appointment_id)
    ops = (
        db.query(IntegrationOperation)
        .filter(IntegrationOperation.appointment_id == appointment.id)
        .order_by(IntegrationOperation.created_at)
        .all()
    )
    return RecordDetailOut(
        id=record.id,
        hospital_id=record.hospital_id,
        operation_id=record.operation_id,
        appointment_id=record.appointment_id,
        external_id=record.external_id,
        error=record.error,
        attempts=record.attempts,
        external_status=record.external_status,
        internal_status=record.internal_status,
        resolution_status=record.resolution_status,
        note=record.note,
        created_at=record.created_at,
        resolved_at=record.resolved_at,
        appointment=AppointmentSummaryOut(
            id=appointment.id,
            state=appointment.state.value,
            slot_start=appointment.slot_start,
            slot_end=appointment.slot_end,
            external_id=appointment.external_id,
            idempotency_key=appointment.idempotency_key,
        ),
        operations=[
            OperationOut(
                id=op.id,
                appointment_id=op.appointment_id,
                operation_type=op.operation_type,
                status=op.status,
                attempt_number=op.attempt_number,
                error=op.error,
                correlation_id=op.correlation_id,
                created_at=op.created_at,
            )
            for op in ops
        ],
    )


@router.get("/reconciliation/records", response_model=list[ReconciliationRecordOut])
def list_records(
    resolution_status: ResolutionStatus | None = None,
    hospital_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_operator),
) -> list:
    if ctx.role == Role.hospital_admin:
        if hospital_id is not None and hospital_id != ctx.hospital_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not allowed to list this hospital",
            )
        hospital_id = ctx.hospital_id
    query = db.query(ReconciliationRecord)
    if hospital_id is not None:
        query = query.filter(ReconciliationRecord.hospital_id == hospital_id)
    if resolution_status is not None:
        query = query.filter(
            ReconciliationRecord.resolution_status == resolution_status
        )
    return query.order_by(ReconciliationRecord.created_at.desc()).all()


@router.get(
    "/reconciliation/records/{record_id}", response_model=RecordDetailOut
)
def get_record(
    record_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_operator),
) -> RecordDetailOut:
    return _detail_out(db, _scoped_record(db, ctx, record_id))


def _consistency_note(
    db: Session, appointment: Appointment, integration: IntegrationService
) -> str | None:
    """Non-None when vendor and internal agree again (safe to auto-close)."""
    return reconcile_service.consistency_note(db, appointment, integration)


@router.post(
    "/reconciliation/records/{record_id}/retry", response_model=RecordDetailOut
)
def retry_record(
    record_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_operator),
    integration: IntegrationService = Depends(get_integration_service),
) -> RecordDetailOut:
    record = _scoped_record(db, ctx, record_id)
    if record.resolution_status == ResolutionStatus.resolved:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Record is already resolved",
        )
    if record.resolution_status == ResolutionStatus.escalated:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Escalated records close manually, not by retry",
        )
    appointment = get_appointment_or_404(db, record.appointment_id)
    operations.set_resolution(db, record, ResolutionStatus.retrying)
    record.attempts += 1
    db.flush()
    appointment = reconcile_service.drive_recovery(
        db, appointment, integration, actor_user_id=ctx.user_id, force=True
    )
    note = _consistency_note(db, appointment, integration)
    if note is not None:
        operations.set_resolution(
            db, record, ResolutionStatus.resolved, note=note
        )
    else:
        operations.set_resolution(db, record, ResolutionStatus.open)
        record.error = (
            f"Retry did not converge; appointment is {appointment.state.value}"
        )
        db.flush()
    db.commit()
    db.refresh(record)
    return _detail_out(db, record)


@router.post(
    "/reconciliation/records/{record_id}/resolve",
    response_model=RecordDetailOut,
)
def resolve_record(
    record_id: uuid.UUID,
    body: ResolveIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_operator),
) -> RecordDetailOut:
    record = reconcile_service.resolve_record(
        db,
        _scoped_record(db, ctx, record_id),
        resolution=body.resolution,
        note=body.note,
        actor_user_id=ctx.user_id,
        final_state=body.final_state,
    )
    return _detail_out(db, record)


__all__ = ["router"]
