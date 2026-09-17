"""Human-escalation queue for the hospital operator console.

Rows are written by `transfer_to_human` (any caller) and by flagged
questionnaire answers. Hospital admins see escalations carrying their
hospital id — falling back to the linked appointment's hospital when
the escalation itself is hospital-agnostic (e.g. patient-created).
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
from app.mcp_server.models import Escalation, EscalationStatus

router = APIRouter(tags=["escalations"])

_operator = require_role(Role.hospital_admin, Role.platform_admin)


class EscalationOut(BaseModel):
    id: uuid.UUID
    conversation_id: str
    appointment_id: uuid.UUID | None
    reason: str
    status: EscalationStatus
    created_by_user_id: uuid.UUID
    hospital_id: uuid.UUID | None
    created_at: datetime


def _hospital_of(db: Session, row: Escalation) -> uuid.UUID | None:
    if row.hospital_id is not None:
        return row.hospital_id
    if row.appointment_id is not None:
        appt = db.get(Appointment, row.appointment_id)
        return appt.hospital_id if appt is not None else None
    return None


def _scoped(
    db: Session, ctx: RequestContext, escalation_id: uuid.UUID
) -> Escalation:
    row = db.get(Escalation, escalation_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Escalation not found"
        )
    if (
        ctx.role == Role.hospital_admin
        and _hospital_of(db, row) != ctx.hospital_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to access this escalation",
        )
    return row


@router.get("/escalations", response_model=list[EscalationOut])
def list_escalations(
    status: EscalationStatus | None = None,
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
    rows = (
        db.query(Escalation).order_by(Escalation.created_at.desc()).all()
    )
    if status is not None:
        rows = [r for r in rows if r.status == status]
    if hospital_id is not None:
        rows = [r for r in rows if _hospital_of(db, r) == hospital_id]
    return [
        EscalationOut(
            id=r.id,
            conversation_id=r.conversation_id,
            appointment_id=r.appointment_id,
            reason=r.reason,
            status=r.status,
            created_by_user_id=r.created_by_user_id,
            hospital_id=r.hospital_id,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/escalations/{escalation_id}/resolve", response_model=EscalationOut)
def resolve_escalation(
    escalation_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_operator),
) -> Escalation:
    row = _scoped(db, ctx, escalation_id)
    if row.status == EscalationStatus.resolved:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Escalation is already resolved",
        )
    row.status = EscalationStatus.resolved
    db.commit()
    db.refresh(row)
    return row


__all__ = ["router"]
