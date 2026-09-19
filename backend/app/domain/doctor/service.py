"""Doctor business logic.

Activation is gated: a doctor goes `active` only with a specialty, a
department, and at least one compatible appointment type in the same
hospital. An appointment type with an empty `compatible_specialty_ids`
list counts as universally compatible.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.doctor.models import Doctor, DoctorStatus
from app.domain.doctor.schemas import DoctorCreateIn, DoctorInviteIn, DoctorUpdateIn
from app.core.security import hash_password
from app.domain.auth.models import Role, User
from app.domain.hospital.models import Hospital
from app.domain.hospital_config.models import (
    AppointmentType,
    Department,
    Specialty,
)


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message
    )


def _conflict(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


def _resolve_ref(
    session: Session, hospital: Hospital, model, ref_id: uuid.UUID | None, label: str
):
    if ref_id is None:
        return None
    ref = (
        session.query(model)
        .filter(model.id == ref_id, model.hospital_id == hospital.id)
        .first()
    )
    if ref is None:
        raise _unprocessable(f"{label} does not exist in this hospital")
    return ref


def get_doctor_or_404(session: Session, hospital: Hospital, doctor_id: uuid.UUID) -> Doctor:
    doctor = (
        session.query(Doctor)
        .filter(Doctor.id == doctor_id, Doctor.hospital_id == hospital.id)
        .first()
    )
    if doctor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Doctor not found"
        )
    attach_login_email(session, doctor)
    return doctor


def attach_login_email(session: Session, doctor: Doctor) -> Doctor:
    """Populate the transient `login_email` used by DoctorOut."""
    email = None
    if doctor.user_id is not None:
        user = session.get(User, doctor.user_id)
        email = user.email if user is not None else None
    doctor.login_email = email  # type: ignore[attr-defined]
    return doctor


def attach_login_emails(session: Session, doctors: list[Doctor]) -> list[Doctor]:
    """Batched version for roster listing (single users query)."""
    ids = {d.user_id for d in doctors if d.user_id is not None}
    emails: dict = {}
    if ids:
        rows = session.query(User.id, User.email).filter(User.id.in_(ids)).all()
        emails = {uid: email for uid, email in rows}
    for doctor in doctors:
        doctor.login_email = emails.get(doctor.user_id)  # type: ignore[attr-defined]
    return doctors


def _resolve_login(
    session: Session, hospital: Hospital, user_id: uuid.UUID | None
) -> uuid.UUID | None:
    """Validate a doctor-role login of this hospital for profile linking."""
    if user_id is None:
        return None
    user = session.get(User, user_id)
    if user is None or user.role != Role.doctor or user.hospital_id != hospital.id:
        raise _unprocessable("user_id must be a doctor login of this hospital")
    return user.id


def create_doctor(
    session: Session, hospital: Hospital, body: DoctorCreateIn
) -> Doctor:
    _resolve_ref(session, hospital, Specialty, body.specialty_id, "specialty_id")
    _resolve_ref(session, hospital, Department, body.department_id, "department_id")
    doctor = Doctor(
        hospital_id=hospital.id,
        name=body.name,
        photo_url=body.photo_url,
        specialty_id=body.specialty_id,
        department_id=body.department_id,
        qualifications=body.qualifications,
        experience_years=body.experience_years,
        languages=body.languages,
        consultation_types=body.consultation_types,
        default_duration_minutes=body.default_duration_minutes,
        external_provider_id=body.external_provider_id,
        user_id=_resolve_login(session, hospital, body.user_id),
        status=DoctorStatus.invited,
    )
    session.add(doctor)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise _conflict(
            "external_provider_id or user link is already assigned in this hospital"
        ) from None
    session.refresh(doctor)
    attach_login_email(session, doctor)
    return doctor


def update_doctor(
    session: Session, hospital: Hospital, doctor: Doctor, body: DoctorUpdateIn
) -> Doctor:
    data = body.model_dump(exclude_unset=True)
    if "specialty_id" in data and data["specialty_id"] is not None:
        _resolve_ref(
            session, hospital, Specialty, data["specialty_id"], "specialty_id"
        )
    if "department_id" in data and data["department_id"] is not None:
        _resolve_ref(
            session, hospital, Department, data["department_id"], "department_id"
        )
    if "user_id" in data:
        data["user_id"] = _resolve_login(session, hospital, data["user_id"])
    for field, value in data.items():
        setattr(doctor, field, value)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise _conflict(
            "external_provider_id or user link is already assigned in this hospital"
        ) from None
    session.refresh(doctor)
    attach_login_email(session, doctor)
    return doctor


def _has_compatible_appointment_type(
    session: Session, hospital: Hospital, specialty_id: uuid.UUID
) -> bool:
    types = (
        session.query(AppointmentType)
        .filter(AppointmentType.hospital_id == hospital.id)
        .all()
    )
    needle = str(specialty_id)
    return any(
        not t.compatible_specialty_ids or needle in t.compatible_specialty_ids
        for t in types
    )


def activate(session: Session, hospital: Hospital, doctor: Doctor) -> Doctor:
    if doctor.status not in (DoctorStatus.invited, DoctorStatus.inactive):
        raise _conflict(
            f"Cannot activate a doctor with status={doctor.status.value}"
        )
    if doctor.specialty_id is None:
        raise _unprocessable("Set specialty_id before activation")
    if doctor.department_id is None:
        raise _unprocessable("Set department_id before activation")
    if not _has_compatible_appointment_type(
        session, hospital, doctor.specialty_id
    ):
        raise _unprocessable(
            "No appointment type is compatible with the doctor's specialty"
        )
    doctor.status = DoctorStatus.active
    session.commit()
    session.refresh(doctor)
    attach_login_email(session, doctor)
    return doctor


def deactivate(session: Session, doctor: Doctor) -> Doctor:
    if doctor.status != DoctorStatus.active:
        raise _conflict("Only an active doctor can be deactivated")
    doctor.status = DoctorStatus.inactive
    session.commit()
    session.refresh(doctor)
    attach_login_email(session, doctor)
    return doctor


def invite_login(
    session: Session, hospital: Hospital, doctor: Doctor, email: str, password: str
) -> Doctor:
    """Create a portal login for the doctor and link it, atomically.

    The login is scoped to this hospital; the doctor signs into the
    doctor portal with this email + password.
    """
    if doctor.user_id is not None:
        raise _conflict("This doctor already has a portal login")
    user = User(
        email=email.lower(),
        password_hash=hash_password(password),
        role=Role.doctor,
        hospital_id=hospital.id,
        is_active=True,
    )
    session.add(user)
    try:
        session.flush()  # surface duplicate-email before linking
        doctor.user_id = user.id
        session.commit()
    except IntegrityError:
        session.rollback()
        raise _conflict("Email is already registered") from None
    session.refresh(doctor)
    attach_login_email(session, doctor)
    return doctor


def remove_login(session: Session, hospital: Hospital, doctor: Doctor) -> Doctor:
    """Unlink the portal login and deactivate it (offboarding).

    The user row is kept for audit history but can no longer sign in.
    """
    if doctor.user_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This doctor has no portal login",
        )
    user = session.get(User, doctor.user_id)
    if user is not None and user.hospital_id == hospital.id:
        user.is_active = False
    doctor.user_id = None
    session.commit()
    session.refresh(doctor)
    attach_login_email(session, doctor)
    return doctor
