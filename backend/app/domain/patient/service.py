"""Patient business logic — always scoped by patient user id, never hospital."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.domain.hospital_config.models import AppointmentType
from app.domain.patient.models import UserPreferences
from app.domain.patient.schemas import PreferencesUpdateIn


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message
    )


def update_patient_email(session: Session, user: User, email: str) -> User:
    user.email = email.lower()
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered",
        ) from None
    session.refresh(user)
    return user


def get_or_create_preferences(
    session: Session, patient_user_id: uuid.UUID
) -> UserPreferences:
    prefs = (
        session.query(UserPreferences)
        .filter(UserPreferences.patient_user_id == patient_user_id)
        .first()
    )
    if prefs is None:
        prefs = UserPreferences(patient_user_id=patient_user_id)
        session.add(prefs)
        session.commit()
        session.refresh(prefs)
    return prefs


def _require_exists(session: Session, model, ref_id: uuid.UUID, label: str) -> None:
    if session.get(model, ref_id) is None:
        raise _unprocessable(f"{label} does not reference a known record")


def update_preferences(
    session: Session, patient_user_id: uuid.UUID, body: PreferencesUpdateIn
) -> UserPreferences:
    data = body.model_dump(exclude_unset=True)
    if data.get("preferred_doctor_id") is not None:
        _require_exists(session, Doctor, data["preferred_doctor_id"], "preferred_doctor_id")
    if data.get("preferred_hospital_id") is not None:
        _require_exists(session, Hospital, data["preferred_hospital_id"], "preferred_hospital_id")
    if data.get("preferred_appointment_type_id") is not None:
        _require_exists(
            session,
            AppointmentType,
            data["preferred_appointment_type_id"],
            "preferred_appointment_type_id",
        )
    prefs = get_or_create_preferences(session, patient_user_id)
    for field, value in data.items():
        setattr(prefs, field, value)
    session.commit()
    session.refresh(prefs)
    return prefs
