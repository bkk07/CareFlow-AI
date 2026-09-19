"""Patient business logic — always scoped by patient user id, never hospital."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment, AppointmentHistory
from app.domain.appointment.schemas import AppointmentHistoryOut
from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.domain.hospital_config.models import AppointmentType, Department, Specialty
from app.domain.patient.models import PatientProfile, UserPreferences
from app.domain.patient.schemas import (
    ContactUpdateIn,
    PatientAppointmentDetailOut,
    PatientAppointmentOut,
    PreferencesUpdateIn,
)


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


def normalize_phone(raw: str | None) -> str | None:
    """Digits only ("+1 (555) 0100" -> "15550100"); None stays None."""
    if raw is None:
        return None
    digits = "".join(ch for ch in raw if ch.isdecimal())
    return digits or None


def get_or_create_profile(
    session: Session, patient_user_id: uuid.UUID
) -> PatientProfile:
    profile = (
        session.query(PatientProfile)
        .filter(PatientProfile.patient_user_id == patient_user_id)
        .first()
    )
    if profile is None:
        profile = PatientProfile(patient_user_id=patient_user_id)
        session.add(profile)
        session.commit()
        session.refresh(profile)
    return profile


def update_contact(
    session: Session, patient_user_id: uuid.UUID, body: ContactUpdateIn
) -> PatientProfile:
    data = body.model_dump(exclude_unset=True)
    profile = get_or_create_profile(session, patient_user_id)
    if "phone" in data:
        profile.phone = normalize_phone(data["phone"])
    if "full_name" in data:
        name = (data["full_name"] or "").strip()
        profile.full_name = name or None
    if "date_of_birth" in data:
        profile.date_of_birth = data["date_of_birth"]
    if "city" in data:
        city = (data["city"] or "").strip()
        profile.city = city or None
    if "latitude" in data or "longitude" in data:
        lat, lng = data.get("latitude"), data.get("longitude")
        if (lat is None) != (lng is None):
            raise _unprocessable("latitude and longitude must be provided together")
        if lat is not None and not (-90 <= lat <= 90):
            raise _unprocessable("latitude must be between -90 and 90")
        if lng is not None and not (-180 <= lng <= 180):
            raise _unprocessable("longitude must be between -180 and 180")
        profile.latitude = lat
        profile.longitude = lng
    session.commit()
    session.refresh(profile)
    return profile


def _appointment_display(
    session: Session, appointment: Appointment
) -> PatientAppointmentOut:
    """Join display names for one appointment owned by the caller."""
    doctor = session.get(Doctor, appointment.doctor_id)
    hospital = session.get(Hospital, appointment.hospital_id)
    appt_type = session.get(AppointmentType, appointment.appointment_type_id)
    specialty_name: str | None = None
    department_name: str | None = None
    if doctor is not None:
        if doctor.specialty_id is not None:
            specialty = session.get(Specialty, doctor.specialty_id)
            specialty_name = specialty.name if specialty is not None else None
        if doctor.department_id is not None:
            department = session.get(Department, doctor.department_id)
            department_name = department.name if department is not None else None
    return PatientAppointmentOut(
        id=appointment.id,
        doctor_id=appointment.doctor_id,
        doctor_name=doctor.name if doctor is not None else "Unknown doctor",
        doctor_photo_url=doctor.photo_url if doctor is not None else None,
        specialty=specialty_name,
        department=department_name,
        hospital_id=appointment.hospital_id,
        hospital_name=hospital.name if hospital is not None else "Unknown hospital",
        appointment_type_id=appointment.appointment_type_id,
        appointment_type_name=appt_type.name if appt_type is not None else "Visit",
        duration_minutes=appt_type.duration_minutes if appt_type is not None else 30,
        slot_start=appointment.slot_start,
        slot_end=appointment.slot_end,
        state=appointment.state,
        consultation_mode=appointment.consultation_mode,
        created_at=appointment.created_at,
        updated_at=appointment.updated_at,
    )


def list_patient_appointments(
    session: Session, patient_user_id: uuid.UUID
) -> list[PatientAppointmentOut]:
    rows = (
        session.query(Appointment)
        .filter(Appointment.patient_id == patient_user_id)
        .order_by(Appointment.slot_start.desc())
        .all()
    )
    return [_appointment_display(session, row) for row in rows]


def get_patient_appointment_detail(
    session: Session, patient_user_id: uuid.UUID, appointment_id: uuid.UUID
) -> PatientAppointmentDetailOut | None:
    """Enriched detail for an owned appointment; None when not found/owned."""
    appointment = session.get(Appointment, appointment_id)
    if appointment is None or appointment.patient_id != patient_user_id:
        return None
    history = (
        session.query(AppointmentHistory)
        .filter(AppointmentHistory.appointment_id == appointment.id)
        .order_by(AppointmentHistory.created_at)
        .all()
    )
    base = _appointment_display(session, appointment)
    return PatientAppointmentDetailOut(
        **base.model_dump(),
        history=[
            AppointmentHistoryOut(
                id=row.id,
                appointment_id=row.appointment_id,
                from_state=row.from_state,
                to_state=row.to_state,
                actor_user_id=row.actor_user_id,
                actor_system=row.actor_system,
                reason=row.reason,
                correlation_id=row.correlation_id,
                created_at=row.created_at,
            )
            for row in history
        ],
    )
