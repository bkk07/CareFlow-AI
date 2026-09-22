"""Workflow execution reads for the hospital operator console.

`WorkflowExecution` rows carry no hospital id by design (the bus is
hospital-agnostic); scoping resolves `payload.appointment_id` to its
appointment's hospital. Sweeps and manual events without an appointment
reference are platform-visible only.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.appointment.models import Appointment
from app.domain.auth.models import Role
from app.workflow.models import ExecutionStatus, WorkflowExecution

router = APIRouter(tags=["workflows"])

_operator = require_role(Role.hospital_admin, Role.platform_admin)


class WorkflowExecutionOut(BaseModel):
    id: uuid.UUID
    event_type: str
    status: ExecutionStatus
    attempt: int
    appointment_id: uuid.UUID | None = None
    correlation_id: uuid.UUID
    execution_history: list
    created_at: datetime
    updated_at: datetime


def _appointment_id_of(row: WorkflowExecution) -> uuid.UUID | None:
    try:
        raw = (row.payload or {}).get("appointment_id")
        return uuid.UUID(str(raw)) if raw is not None else None
    except (ValueError, AttributeError, TypeError):
        return None


def _out(row: WorkflowExecution) -> WorkflowExecutionOut:
    return WorkflowExecutionOut(
        id=row.id,
        event_type=row.event_type,
        status=row.status,
        attempt=row.attempt,
        appointment_id=_appointment_id_of(row),
        correlation_id=row.correlation_id,
        execution_history=list(row.execution_history or []),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/workflows", response_model=list[WorkflowExecutionOut])
def list_workflows(
    event_type: str | None = None,
    status: ExecutionStatus | None = None,
    hospital_id: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
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
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    query = (
        db.query(WorkflowExecution)
        .order_by(WorkflowExecution.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = query.all()
    if event_type is not None:
        rows = [r for r in rows if r.event_type == event_type]
    if status is not None:
        rows = [r for r in rows if r.status == status]
    if hospital_id is not None:
        scoped: list[WorkflowExecution] = []
        for row in rows:
            appt_id = _appointment_id_of(row)
            if appt_id is None:
                continue
            appt = db.get(Appointment, appt_id)
            if appt is not None and appt.hospital_id == hospital_id:
                scoped.append(row)
        rows = scoped
    return [_out(r) for r in rows]


__all__ = ["router"]
