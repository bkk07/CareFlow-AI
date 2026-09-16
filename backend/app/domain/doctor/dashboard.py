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
from app.domain.doctor.models import Doctor
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
    return doctor


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


__all__ = ["appointments_for", "calendar_for", "get_linked_doctor"]
