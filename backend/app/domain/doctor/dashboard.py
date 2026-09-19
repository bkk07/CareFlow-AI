"""Doctor self-service dashboard (Phase 13).

A doctor login sees only its linked profile (`Doctor.user_id`): today's
and upcoming appointments, its calendar (rules + blocks + live
bookings), and questionnaire responses for its own appointments.
"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment.models import Appointment
from app.domain.appointment.state_machine import LIVE_STATES
from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital_config.models import AppointmentType
from app.domain.patient.models import PatientProfile
from app.domain.scheduling import service as scheduling_service
from app.domain.scheduling.availability import as_utc
from app.domain.scheduling.models import AvailabilityRule, BlockedSlot


def _not_found(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)


def get_linked_doctor(session: Session, ctx: RequestContext) -> Doctor:
    """The caller's own doctor profile, or a clear 404."""
    doctor = (
        session.query(Doctor).filter(Doctor.user_id == ctx.user_id).first()
    )
    if doctor is None:
        raise _not_found("No doctor profile is linked to this login")
    if doctor.hospital_id != ctx.hospital_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Doctor profile belongs to another hospital",
        )
    from app.domain.doctor import service as doctor_service

    return doctor_service.attach_login_email(session, doctor)


def _day_bounds_utc(now: datetime) -> tuple[datetime, datetime]:
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def appointments_for(
    session: Session, doctor: Doctor, *, day: datetime
) -> tuple[list[Appointment], list[Appointment]]:
    """(today, upcoming) splits for the doctor's dashboard tabs."""
    today_start, today_end = _day_bounds_utc(day)
    rows = (
        session.query(Appointment)
        .filter(Appointment.doctor_id == doctor.id)
        .order_by(Appointment.slot_start)
        .all()
    )
    # as_utc: sqlite returns naive datetimes, postgres aware — compare uniformly.
    today = [
        a
        for a in rows
        if today_start <= as_utc(a.slot_start) < today_end
    ]
    upcoming = [
        a
        for a in rows
        if as_utc(a.slot_start) >= as_utc(day) and a.state in LIVE_STATES
    ]
    return today, upcoming


def calendar_for(session: Session, doctor: Doctor) -> dict:
    """Rules + blocks + live bookings for the next 30 days."""
    # Stored datetimes are UTC; sqlite drops tzinfo while postgres keeps
    # it, so query bounds go in naive UTC and Python compares via as_utc.
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rules = (
        session.query(AvailabilityRule)
        .filter(AvailabilityRule.doctor_id == doctor.id)
        .order_by(AvailabilityRule.created_at)
        .all()
    )
    blocks = (
        session.query(BlockedSlot)
        .filter(
            BlockedSlot.doctor_id == doctor.id,
            BlockedSlot.end_datetime >= now,
        )
        .order_by(BlockedSlot.start_datetime)
        .all()
    )
    live = (
        session.query(Appointment)
        .filter(
            Appointment.doctor_id == doctor.id,
            Appointment.state.in_(LIVE_STATES),
            Appointment.slot_start >= now,
            Appointment.slot_start <= now + timedelta(days=30),
        )
        .order_by(Appointment.slot_start)
        .all()
    )
    calendar = scheduling_service.get_or_create_calendar(session, doctor.id)
    return {"calendar": calendar, "rules": rules, "blocks": blocks, "live": live}


def _patient_display(
    session: Session, patient_id
) -> tuple[str, str | None, str | None]:
    """(name, email, phone) for a patient user, with graceful fallbacks."""
    user = session.get(User, patient_id)
    profile = (
        session.query(PatientProfile)
        .filter(PatientProfile.patient_user_id == patient_id)
        .first()
    )
    name = (
        profile.full_name
        if (profile and profile.full_name)
        else (user.email.split("@")[0] if user else "Patient")
    )
    email = user.email if user else None
    phone = profile.phone if profile and profile.phone else None
    return name, email, phone


def enriched_appointments(
    session: Session, doctor: Doctor, *, day
) -> tuple[list[dict], list[dict]]:
    """(today, upcoming) enriched rows for the doctor portal list views."""
    today_rows, upcoming_rows = appointments_for(session, doctor, day=day)

    def enrich(row: Appointment) -> dict:
        name, email, phone = _patient_display(session, row.patient_id)
        appt_type = session.get(AppointmentType, row.appointment_type_id)
        return {
            "id": row.id,
            "patient_id": row.patient_id,
            "patient_name": name,
            "patient_email": email,
            "patient_phone": phone,
            "doctor_id": row.doctor_id,
            "appointment_type_id": row.appointment_type_id,
            "appointment_type_name": appt_type.name
            if appt_type is not None
            else "Visit",
            "slot_start": row.slot_start,
            "slot_end": row.slot_end,
            "state": row.state.value
            if hasattr(row.state, "value")
            else str(row.state),
            "consultation_mode": row.consultation_mode,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    return [enrich(r) for r in today_rows], [enrich(r) for r in upcoming_rows]


def questionnaire_inbox(session: Session, doctor: Doctor) -> list[dict]:
    """Every own appointment (newest first) with its responses attached."""
    from app.domain.questionnaire import service as questionnaire_service
    from app.domain.questionnaire.models import QuestionnaireQuestion, QuestionnaireResponse
    from app.domain.questionnaire.schemas import ResponseOut

    rows = (
        session.query(Appointment)
        .filter(Appointment.doctor_id == doctor.id)
        .order_by(Appointment.slot_start.desc())
        .all()
    )
    inbox: list[dict] = []
    for appt in rows:
        responses = (
            session.query(QuestionnaireResponse)
            .filter(QuestionnaireResponse.appointment_id == appt.id)
            .order_by(QuestionnaireResponse.created_at)
            .all()
        )
        name, _, _ = _patient_display(session, appt.patient_id)
        qids = list({r.questionnaire_id for r in responses})
        prompts: list[dict] = []
        if qids:
            for q in (
                session.query(QuestionnaireQuestion)
                .filter(QuestionnaireQuestion.questionnaire_id.in_(qids))
                .all()
            ):
                prompts.append({"id": q.id, "prompt": q.prompt})
        # Whether any active form resolves for this booking (independent of
        # whether the patient has answered yet).
        form = questionnaire_service.resolve_for_appointment(session, appt)
        inbox.append(
            {
                "appointment_id": appt.id,
                "patient_id": appt.patient_id,
                "patient_name": name,
                "slot_start": appt.slot_start,
                "slot_end": appt.slot_end,
                "state": appt.state.value
                if hasattr(appt.state, "value")
                else str(appt.state),
                "responses": [
                    ResponseOut(
                        id=r.id,
                        appointment_id=r.appointment_id,
                        questionnaire_id=r.questionnaire_id,
                        answers=r.answers,
                        completed=r.completed_at is not None,
                        completed_at=r.completed_at,
                    )
                    for r in responses
                ],
                "questions": prompts,
                "has_questionnaire": form is not None,
            }
        )
    return inbox


__all__ = [
    "appointments_for",
    "calendar_for",
    "enriched_appointments",
    "get_linked_doctor",
    "questionnaire_inbox",
]
