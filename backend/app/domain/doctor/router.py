"""Doctor CRUD + activation endpoints (hospital-admin, managed hospital)."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.core.tenant import hospital_scoped_query
from app.domain.auth.models import Role
from app.domain.doctor import dashboard, service
from app.domain.doctor.models import Doctor
from app.domain.doctor.schemas import (
    DoctorAppointmentOut,
    DoctorCalendarOut,
    DoctorCreateIn,
    DoctorInviteIn,
    DoctorOut,
    DoctorQuestionnaireItemOut,
    DoctorSelfUpdateIn,
    DoctorUpdateIn,
)
from app.domain.hospital.deps import require_managed_hospital
from app.domain.hospital.models import Hospital
from app.domain.questionnaire.schemas import ResponseOut

router = APIRouter(tags=["doctors"])


@router.get("/hospitals/{hospital_id}/doctors", response_model=list[DoctorOut])
def list_doctors(
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
):
    rows = (
        hospital_scoped_query(Doctor, ctx, db)
        .filter(Doctor.hospital_id == hospital.id)
        .order_by(Doctor.name)
        .all()
    )
    return service.attach_login_emails(db, rows)


@router.post(
    "/hospitals/{hospital_id}/doctors", response_model=DoctorOut, status_code=201
)
def create_doctor(
    body: DoctorCreateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    return service.create_doctor(db, hospital, body)


@router.get("/hospitals/{hospital_id}/doctors/{doctor_id}", response_model=DoctorOut)
def get_doctor(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    return service.get_doctor_or_404(db, hospital, doctor_id)


@router.put("/hospitals/{hospital_id}/doctors/{doctor_id}", response_model=DoctorOut)
def update_doctor(
    doctor_id: uuid.UUID,
    body: DoctorUpdateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    return service.update_doctor(db, hospital, doctor, body)


@router.delete("/hospitals/{hospital_id}/doctors/{doctor_id}", status_code=204)
def delete_doctor(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    db.delete(doctor)
    db.commit()
    return None


@router.post(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/activate",
    response_model=DoctorOut,
)
def activate_doctor(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    return service.activate(db, hospital, doctor)


@router.post(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/deactivate",
    response_model=DoctorOut,
)
def deactivate_doctor(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    return service.deactivate(db, doctor)


@router.post(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/suspend",
    response_model=DoctorOut,
)
def suspend_doctor(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    """Suspend an active doctor (compliance hold); re-activatable."""
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    return service.suspend(db, doctor)


@router.post(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/invite",
    response_model=DoctorOut,
    status_code=201,
)
def invite_doctor_login(
    doctor_id: uuid.UUID,
    body: DoctorInviteIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
):
    """Create a doctor-portal login and link it to this profile.

    Hospital-admin only, scoped to the managed (approved) hospital.
    """
    del ctx
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    return service.invite_login(db, hospital, doctor, body.email, body.password)


@router.delete(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/login",
    response_model=DoctorOut,
)
def remove_doctor_login(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
):
    """Unlink the portal login and deactivate it (offboarding)."""
    del ctx
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    return service.remove_login(db, hospital, doctor)


_doctor = require_role(Role.doctor)


@router.get("/doctors/me", response_model=DoctorOut)
def get_my_profile(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_doctor),
) -> Doctor:
    return dashboard.get_linked_doctor(db, ctx)


@router.put("/doctors/me", response_model=DoctorOut)
def update_my_profile(
    body: DoctorSelfUpdateIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_doctor),
) -> Doctor:
    """Self-service edit: presentation/practice fields only.

    Specialty, department, status and hospital linkage stay
    hospital-admin managed — the schema simply has no such fields.
    """
    from app.domain.hospital.models import Hospital as HospitalModel

    doctor = dashboard.get_linked_doctor(db, ctx)
    hospital = db.get(HospitalModel, doctor.hospital_id)
    data = body.model_dump(exclude_unset=True)
    allowed = {
        "name",
        "photo_url",
        "qualifications",
        "experience_years",
        "languages",
        "consultation_types",
        "default_duration_minutes",
        "available_durations",
    }
    safe = {k: v for k, v in data.items() if k in allowed}
    if not safe:
        return doctor
    update_body = DoctorUpdateIn(**safe)
    return service.update_doctor(db, hospital, doctor, update_body)


@router.get("/doctors/me/appointments", response_model=list[DoctorAppointmentOut])
def get_my_appointments(
    range: str = "upcoming",
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_doctor),
) -> list:
    if range not in ("today", "upcoming"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="range must be 'today' or 'upcoming'",
        )
    doctor = dashboard.get_linked_doctor(db, ctx)
    today, upcoming = dashboard.enriched_appointments(
        db, doctor, day=datetime.now(timezone.utc)
    )
    return today if range == "today" else upcoming


@router.get(
    "/doctors/me/questionnaire-responses",
    response_model=list[DoctorQuestionnaireItemOut],
)
def get_my_questionnaire_inbox(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_doctor),
) -> list:
    """All own appointments (newest first) with responses attached."""
    doctor = dashboard.get_linked_doctor(db, ctx)
    return dashboard.questionnaire_inbox(db, doctor)


@router.get("/doctors/me/calendar", response_model=DoctorCalendarOut)
def get_my_calendar(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_doctor),
) -> dict:
    doctor = dashboard.get_linked_doctor(db, ctx)
    data = dashboard.calendar_for(db, doctor)
    return {
        "calendar": data["calendar"],
        "rules": data["rules"],
        "blocks": data["blocks"],
        "live_appointments": data["live"],
    }


@router.get(
    "/doctors/me/questionnaire-responses/{appointment_id}",
    response_model=list[ResponseOut],
)
def get_my_questionnaire_responses(
    appointment_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_doctor),
) -> list:
    from app.domain.appointment.service import get_appointment_or_404
    from app.domain.questionnaire.models import QuestionnaireResponse

    doctor = dashboard.get_linked_doctor(db, ctx)
    appointment = get_appointment_or_404(db, appointment_id)
    if appointment.doctor_id != doctor.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not your appointment",
        )
    rows = (
        db.query(QuestionnaireResponse)
        .filter(QuestionnaireResponse.appointment_id == appointment.id)
        .order_by(QuestionnaireResponse.created_at)
        .all()
    )
    return [
        ResponseOut(
            id=row.id,
            appointment_id=row.appointment_id,
            questionnaire_id=row.questionnaire_id,
            answers=row.answers,
            completed=row.completed_at is not None,
            completed_at=row.completed_at,
        )
        for row in rows
    ]
