"""Patient self-service endpoints (patient role only, own rows only)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role, User
from app.domain.patient import service
from app.domain.patient.models import PatientProfile, UserPreferences
from app.domain.patient.schemas import (
    ContactOut,
    ContactUpdateIn,
    PatientAppointmentDetailOut,
    PatientAppointmentOut,
    PatientOut,
    PatientUpdateIn,
    PreferencesOut,
    PreferencesUpdateIn,
)

router = APIRouter(prefix="/patients", tags=["patients"])

_patient = require_role(Role.patient)


@router.get("/me", response_model=PatientOut)
def get_profile(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> User:
    return db.get(User, ctx.user_id)


@router.put("/me", response_model=PatientOut)
def update_profile(
    body: PatientUpdateIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> User:
    user = db.get(User, ctx.user_id)
    return service.update_patient_email(db, user, body.email)


@router.get("/me/preferences", response_model=PreferencesOut)
def get_preferences(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> UserPreferences:
    # Fresh patients get clean null defaults, never an error.
    return service.get_or_create_preferences(db, ctx.user_id)


@router.put("/me/preferences", response_model=PreferencesOut)
def update_preferences(
    body: PreferencesUpdateIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> UserPreferences:
    return service.update_preferences(db, ctx.user_id, body)


@router.get("/me/contact", response_model=ContactOut)
def get_contact(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> PatientProfile:
    return service.get_or_create_profile(db, ctx.user_id)


@router.put("/me/contact", response_model=ContactOut)
def update_contact(
    body: ContactUpdateIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> PatientProfile:
    """Register the phone/name/DOB the telephone channel verifies against."""
    return service.update_contact(db, ctx.user_id, body)


@router.get("/me/appointments", response_model=list[PatientAppointmentOut])
def list_my_appointments(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> list:
    """Own appointments with doctor/hospital/type names joined in, so the
    patient portal renders list + detail without extra lookups."""
    return service.list_patient_appointments(db, ctx.user_id)


@router.get(
    "/me/appointments/{appointment_id}",
    response_model=PatientAppointmentDetailOut,
)
def get_my_appointment(
    appointment_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> PatientAppointmentDetailOut:
    detail = service.get_patient_appointment_detail(db, ctx.user_id, appointment_id)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found",
        )
    return detail
