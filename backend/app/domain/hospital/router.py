"""Hospital onboarding + self-service profile + staff endpoints."""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, get_current_context, require_role
from app.core.security import hash_password
from app.domain.auth.models import Role, User
from app.domain.hospital import service
from app.domain.hospital.models import Hospital, HospitalStatus
from app.domain.hospital.schemas import (
    CorrectionsIn,
    HospitalCreateIn,
    HospitalOut,
    HospitalUpdateIn,
    ReviewDecisionIn,
    StaffCreateIn,
    StaffOut,
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


def _own_hospital_or_403(
    db: Session, ctx: RequestContext, hospital_id: uuid.UUID
) -> Hospital:
    """The caller's own hospital (no approved gate — profile/staff edits
    are administrative, not care delivery)."""
    hospital = service.get_hospital_or_404(db, hospital_id)
    if ctx.role != Role.hospital_admin or ctx.hospital_id != hospital.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to manage this hospital",
        )
    return hospital


@router.put("/hospitals/{hospital_id}", response_model=HospitalOut)
def update_hospital(
    hospital_id: uuid.UUID,
    body: HospitalUpdateIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
) -> Hospital:
    hospital = _own_hospital_or_403(db, ctx, hospital_id)
    data = body.model_dump(exclude_unset=True)
    if "contact_email" in data:
        data["contact_email"] = data["contact_email"].lower()
    if "city" in data:
        data["city"] = (data["city"] or "").strip() or None
    for field, value in data.items():
        setattr(hospital, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Contact email is already in use",
        ) from None
    db.refresh(hospital)
    return hospital


@router.get("/hospitals/{hospital_id}/staff", response_model=list[StaffOut])
def list_staff(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
) -> list:
    hospital = _own_hospital_or_403(db, ctx, hospital_id)
    return (
        db.query(User)
        .filter(User.hospital_id == hospital.id)
        .order_by(User.created_at)
        .all()
    )


@router.post(
    "/hospitals/{hospital_id}/staff", response_model=StaffOut, status_code=201
)
def invite_staff(
    hospital_id: uuid.UUID,
    body: StaffCreateIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
) -> User:
    hospital = _own_hospital_or_403(db, ctx, hospital_id)
    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        role=Role.hospital_admin,
        hospital_id=hospital.id,
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered",
        ) from None
    db.refresh(user)
    return user


@router.delete("/hospitals/{hospital_id}/staff/{user_id}", status_code=204)
def deactivate_staff(
    hospital_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
) -> None:
    hospital = _own_hospital_or_403(db, ctx, hospital_id)
    if user_id == ctx.user_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="You cannot deactivate your own login",
        )
    user = db.get(User, user_id)
    if user is None or user.hospital_id != hospital.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Staff member not found in this hospital",
        )
    # Soft-deactivate so audit/history rows keep their actor reference.
    user.is_active = False
    db.commit()
    return None


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


@router.post("/platform/hospitals/{hospital_id}/reinstate", response_model=HospitalOut)
def reinstate_hospital(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.platform_admin)),
    x_correlation_id: str | None = Header(default=None),
) -> Hospital:
    """Bring a suspended hospital back live after platform review."""
    hospital = service.get_hospital_or_404(db, hospital_id)
    return service.reinstate(
        db,
        hospital,
        actor_user_id=ctx.user_id,
        correlation_id=_correlation_id(x_correlation_id),
    )


@router.post(
    "/platform/hospitals/{hospital_id}/start-review", response_model=HospitalOut
)
def start_hospital_review(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.platform_admin)),
    x_correlation_id: str | None = Header(default=None),
) -> Hospital:
    hospital = service.get_hospital_or_404(db, hospital_id)
    return service.start_review(
        db,
        hospital,
        actor_user_id=ctx.user_id,
        correlation_id=_correlation_id(x_correlation_id),
    )


@router.post(
    "/platform/hospitals/{hospital_id}/request-corrections",
    response_model=HospitalOut,
)
def request_hospital_corrections(
    hospital_id: uuid.UUID,
    body: CorrectionsIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.platform_admin)),
    x_correlation_id: str | None = Header(default=None),
) -> Hospital:
    """Send the application back to draft with a fix-list for the hospital."""
    hospital = service.get_hospital_or_404(db, hospital_id)
    return service.request_corrections(
        db,
        hospital,
        actor_user_id=ctx.user_id,
        message=body.message,
        correlation_id=_correlation_id(x_correlation_id),
    )


@router.post("/hospitals/{hospital_id}/resubmit", response_model=HospitalOut)
def resubmit_hospital(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
    x_correlation_id: str | None = Header(default=None),
) -> Hospital:
    """Re-submit a draft application (e.g. after applying corrections)."""
    hospital = _own_hospital_or_403(db, ctx, hospital_id)
    return service.resubmit(
        db,
        hospital,
        actor_user_id=ctx.user_id,
        correlation_id=_correlation_id(x_correlation_id),
    )
