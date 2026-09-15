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
from app.domain.doctor.schemas import DoctorCreateIn, DoctorUpdateIn
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
    return doctor


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
        status=DoctorStatus.invited,
    )
    session.add(doctor)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise _conflict(
            "external_provider_id is already assigned in this hospital"
        ) from None
    session.refresh(doctor)
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
    for field, value in data.items():
        setattr(doctor, field, value)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise _conflict(
            "external_provider_id is already assigned in this hospital"
        ) from None
    session.refresh(doctor)
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
    return doctor


def deactivate(session: Session, doctor: Doctor) -> Doctor:
    if doctor.status != DoctorStatus.active:
        raise _conflict("Only an active doctor can be deactivated")
    doctor.status = DoctorStatus.inactive
    session.commit()
    session.refresh(doctor)
    return doctor
