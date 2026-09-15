"""Hospital onboarding business logic.

Registration creates the Hospital (status=submitted) plus its first
hospital-admin User in a single transaction. All status transitions write
an audit event. `assert_hospital_approved` is the go-live gate that booking
and configuration flows must call — suspended or never-approved hospitals
are blocked here, at booking time, not just at onboarding time.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import write_audit_event
from app.core.security import hash_password
from app.domain.auth.models import Role, User
from app.domain.hospital.models import Hospital, HospitalStatus
from app.domain.hospital.schemas import HospitalCreateIn

REVIEWABLE = {HospitalStatus.submitted, HospitalStatus.under_review}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_hospital_or_404(session: Session, hospital_id: uuid.UUID) -> Hospital:
    hospital = session.get(Hospital, hospital_id)
    if hospital is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Hospital not found"
        )
    return hospital


def assert_hospital_approved(hospital: Hospital) -> Hospital:
    """Go-live gate: only approved hospitals may configure or take bookings."""
    if not hospital.is_live:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Hospital is not approved (status={hospital.status.value})",
        )
    return hospital


def register_hospital(
    session: Session,
    payload: HospitalCreateIn,
    *,
    correlation_id: uuid.UUID | None = None,
) -> Hospital:
    correlation_id = correlation_id or uuid.uuid4()
    duplicate = (
        session.query(Hospital)
        .filter(Hospital.contact_email == payload.contact_email.lower())
        .first()
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A hospital with this contact email is already registered",
        )
    hospital = Hospital(
        name=payload.name,
        address=payload.address,
        contact_email=payload.contact_email.lower(),
        contact_phone=payload.contact_phone,
        status=HospitalStatus.submitted,
        submitted_at=_utcnow(),
    )
    session.add(hospital)
    try:
        session.flush()  # assign hospital.id for the admin row + audit below
        admin = User(
            email=payload.admin_email.lower(),
            password_hash=hash_password(payload.admin_password),
            role=Role.hospital_admin,
            hospital_id=hospital.id,
            is_active=True,
        )
        session.add(admin)
        session.flush()
        write_audit_event(
            session,
            action="hospital.submitted",
            entity_type="hospital",
            entity_id=hospital.id,
            hospital_id=hospital.id,
            actor_user_id=admin.id,
            correlation_id=correlation_id,
            metadata={"contact_email": hospital.contact_email},
        )
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Hospital or admin email is already registered",
        ) from None
    session.refresh(hospital)
    return hospital


def _transition(
    session: Session,
    hospital: Hospital,
    to: HospitalStatus,
    *,
    actor_user_id: uuid.UUID,
    correlation_id: uuid.UUID,
    action: str,
    metadata: dict | None = None,
) -> Hospital:
    from_status = hospital.status
    hospital.status = to
    if to in (HospitalStatus.approved, HospitalStatus.rejected):
        hospital.reviewed_at = _utcnow()
        hospital.reviewed_by = actor_user_id
    if to == HospitalStatus.rejected:
        hospital.rejection_reason = (metadata or {}).get("reason")
    if to == HospitalStatus.approved:
        hospital.rejection_reason = None
    write_audit_event(
        session,
        action=action,
        entity_type="hospital",
        entity_id=hospital.id,
        hospital_id=hospital.id,
        actor_user_id=actor_user_id,
        correlation_id=correlation_id,
        metadata={"from": from_status.value, "to": to.value, **(metadata or {})},
    )
    session.commit()
    session.refresh(hospital)
    return hospital


def approve(
    session: Session,
    hospital: Hospital,
    *,
    actor_user_id: uuid.UUID,
    correlation_id: uuid.UUID | None = None,
) -> Hospital:
    if hospital.status not in REVIEWABLE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot approve a hospital with status={hospital.status.value}",
        )
    return _transition(
        session,
        hospital,
        HospitalStatus.approved,
        actor_user_id=actor_user_id,
        correlation_id=correlation_id or uuid.uuid4(),
        action="hospital.approved",
    )


def reject(
    session: Session,
    hospital: Hospital,
    *,
    actor_user_id: uuid.UUID,
    reason: str,
    correlation_id: uuid.UUID | None = None,
) -> Hospital:
    if hospital.status not in REVIEWABLE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot reject a hospital with status={hospital.status.value}",
        )
    return _transition(
        session,
        hospital,
        HospitalStatus.rejected,
        actor_user_id=actor_user_id,
        correlation_id=correlation_id or uuid.uuid4(),
        action="hospital.rejected",
        metadata={"reason": reason},
    )


def suspend(
    session: Session,
    hospital: Hospital,
    *,
    actor_user_id: uuid.UUID,
    correlation_id: uuid.UUID | None = None,
) -> Hospital:
    if hospital.status != HospitalStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an approved hospital can be suspended",
        )
    return _transition(
        session,
        hospital,
        HospitalStatus.suspended,
        actor_user_id=actor_user_id,
        correlation_id=correlation_id or uuid.uuid4(),
        action="hospital.suspended",
    )
