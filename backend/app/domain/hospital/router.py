"""Hospital onboarding endpoints."""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, get_current_context, require_role
from app.domain.auth.models import Role
from app.domain.hospital import service
from app.domain.hospital.models import Hospital, HospitalStatus
from app.domain.hospital.schemas import (
    HospitalCreateIn,
    HospitalOut,
    ReviewDecisionIn,
)

router = APIRouter(tags=["hospitals"])


def _correlation_id(x_correlation_id: str | None) -> uuid.UUID:
    if x_correlation_id is None:
        return uuid.uuid4()
    try:
        return uuid.UUID(x_correlation_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid X-Correlation-ID header",
        ) from None


@router.post("/hospitals", response_model=HospitalOut, status_code=201)
def register_hospital(
    body: HospitalCreateIn,
    db: Session = Depends(get_db),
    x_correlation_id: str | None = Header(default=None),
) -> Hospital:
    """Public self-service registration → status=submitted + first admin."""
    return service.register_hospital(
        db, body, correlation_id=_correlation_id(x_correlation_id)
    )


@router.get("/hospitals/{hospital_id}", response_model=HospitalOut)
def get_hospital(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(get_current_context),
) -> Hospital:
    hospital = service.get_hospital_or_404(db, hospital_id)
    if ctx.role != Role.platform_admin and (
        ctx.role != Role.hospital_admin or ctx.hospital_id != hospital.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to view this hospital",
        )
    return hospital


@router.get("/platform/hospitals", response_model=list[HospitalOut])
def list_hospitals(
    status: HospitalStatus | None = None,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.platform_admin)),
) -> list[Hospital]:
    q = db.query(Hospital).order_by(Hospital.created_at)
    if status is not None:
        q = q.filter(Hospital.status == status)
    return q.all()


@router.post("/platform/hospitals/{hospital_id}/approve", response_model=HospitalOut)
def approve_hospital(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.platform_admin)),
    x_correlation_id: str | None = Header(default=None),
) -> Hospital:
    hospital = service.get_hospital_or_404(db, hospital_id)
    return service.approve(
        db,
        hospital,
        actor_user_id=ctx.user_id,
        correlation_id=_correlation_id(x_correlation_id),
    )


@router.post("/platform/hospitals/{hospital_id}/reject", response_model=HospitalOut)
def reject_hospital(
    hospital_id: uuid.UUID,
    body: ReviewDecisionIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.platform_admin)),
    x_correlation_id: str | None = Header(default=None),
) -> Hospital:
    hospital = service.get_hospital_or_404(db, hospital_id)
    return service.reject(
        db,
        hospital,
        actor_user_id=ctx.user_id,
        reason=body.reason,
        correlation_id=_correlation_id(x_correlation_id),
    )


@router.post("/platform/hospitals/{hospital_id}/suspend", response_model=HospitalOut)
def suspend_hospital(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.platform_admin)),
    x_correlation_id: str | None = Header(default=None),
) -> Hospital:
    hospital = service.get_hospital_or_404(db, hospital_id)
    return service.suspend(
        db,
        hospital,
        actor_user_id=ctx.user_id,
        correlation_id=_correlation_id(x_correlation_id),
    )
