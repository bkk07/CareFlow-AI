"""Scheduling orchestration: slot calculation + reservation locking.

`get_available_slots` is the single function everything later calls
(booking in Phase 7, `check_availability` in Phase 9). `reserve_slot` is
the double-booking guard booking calls inside its transaction: the
doctor's calendar row is locked first (row lock), overlap is re-checked
against current rows, then the block is inserted — and the UNIQUE
constraint on (doctor_id, start, end) is the backstop that collapses any
remaining concurrent racers to exactly one winner.
"""

import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.doctor.models import Doctor, DoctorStatus
from app.domain.hospital.models import Hospital
from app.domain.hospital_config.models import AppointmentType
from app.domain.scheduling import availability
from app.domain.scheduling.availability import Window
from app.domain.scheduling.models import (
    AvailabilityRule,
    BlockedReason,
    BlockedSlot,
    Calendar,
    Recurrence,
)

MAX_RANGE_DAYS = 62


class SlotConflictError(Exception):
    pass


def _not_found(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)


def get_hospital_doctor(
    session: Session, hospital: Hospital, doctor_id: uuid.UUID
) -> Doctor:
    doctor = (
        session.query(Doctor)
        .filter(Doctor.id == doctor_id, Doctor.hospital_id == hospital.id)
        .first()
    )
    if doctor is None:
        raise _not_found("Doctor not found")
    return doctor


def get_or_create_calendar(session: Session, doctor_id: uuid.UUID) -> Calendar:
    calendar = (
        session.query(Calendar).filter(Calendar.doctor_id == doctor_id).first()
    )
    if calendar is None:
        calendar = Calendar(doctor_id=doctor_id, is_active=True)
        session.add(calendar)
        try:
            session.commit()
        except IntegrityError:
            # Lost a creation race — the winner's row is the calendar.
            session.rollback()
            calendar = (
                session.query(Calendar)
                .filter(Calendar.doctor_id == doctor_id)
                .one()
            )
        else:
            session.refresh(calendar)
    return calendar


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Datetimes must carry a timezone; UTC is stored",
        )
    return value.astimezone(timezone.utc)


def get_available_slots(
    doctor_id: uuid.UUID,
    appointment_type_id: uuid.UUID,
    date_from: date,
    date_to: date,
    session: Session,
    booked: list[tuple[datetime, datetime]] | None = None,
) -> list[Window]:
    """Available UTC slots for a doctor + appointment type over a date range.

    `booked` carries already-reserved intervals (Phase 7 passes real
    Appointment rows here); BlockedSlot rows are always subtracted.
    """
    if date_to < date_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="date_to must not precede date_from",
        )
    if (date_to - date_from).days > MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Date range capped at {MAX_RANGE_DAYS} days",
        )
    doctor = session.get(Doctor, doctor_id)
    if doctor is None:
        raise _not_found("Doctor not found")
    if doctor.status != DoctorStatus.active:
        return []
    calendar = get_or_create_calendar(session, doctor_id)
    if not calendar.is_active:
        return []

    appt_type = session.get(AppointmentType, appointment_type_id)
    if appt_type is None or appt_type.hospital_id != doctor.hospital_id:
        raise _not_found("Appointment type not found")

    rules = (
        session.query(AvailabilityRule)
        .filter(AvailabilityRule.doctor_id == doctor_id)
        .all()
    )
    range_start = datetime(
        date_from.year, date_from.month, date_from.day, tzinfo=timezone.utc
    )
    range_end = datetime(
        date_to.year, date_to.month, date_to.day, 23, 59, 59,
        tzinfo=timezone.utc,
    )
    blocks = (
        session.query(BlockedSlot)
        .filter(
            BlockedSlot.doctor_id == doctor_id,
            BlockedSlot.start_datetime <= range_end,
            BlockedSlot.end_datetime >= range_start,
        )
        .all()
    )
    busy: list[Window] = [
        Window(b.start_datetime, b.end_datetime) for b in blocks
    ]
    busy.extend(Window(s, e) for s, e in (booked or []))

    slots: list[Window] = []
    day = date_from
    while day <= date_to:
        windows = availability.expand_rules_to_windows(rules, day)
        slots.extend(
            availability.slice_windows(windows, appt_type.duration_minutes)
        )
        day = date.fromordinal(day.toordinal() + 1)
    slots = availability.subtract_intervals(slots, busy)
    return sorted(slots)


def _overlapping_block(
    session: Session, doctor_id: uuid.UUID, start: datetime, end: datetime
) -> BlockedSlot | None:
    return (
        session.query(BlockedSlot)
        .filter(
            BlockedSlot.doctor_id == doctor_id,
            BlockedSlot.start_datetime < end,
            BlockedSlot.end_datetime > start,
        )
        .first()
    )


def _lock_doctor_calendar(session: Session, doctor_id: uuid.UUID) -> None:
    """Take a row lock on the doctor's calendar to serialize reservations.

    SQLite serializes writers on its own (and rejects FOR UPDATE syntax),
    so this is a no-op there — the UNIQUE backstop still decides races.
    """
    bind = session.get_bind()
    if bind is None or bind.dialect.name == "sqlite":
        return
    (
        session.query(Calendar)
        .filter(Calendar.doctor_id == doctor_id)
        .with_for_update()
        .first()
    )


def reserve_slot(
    session: Session,
    doctor_id: uuid.UUID,
    start: datetime,
    end: datetime,
    reason: BlockedReason = BlockedReason.appointment,
) -> BlockedSlot:
    """Hold a slot: lock the calendar row, re-check overlap, then insert.

    Safe under concurrency — the row lock serializes per-doctor
    reservations, and two racers for the same discrete slot collapse to
    one winner via the UNIQUE(doctor_id, start, end) constraint.
    Raises SlotConflictError when the slot is taken.
    """
    if end <= start:
        raise SlotConflictError("end must be after start")
    doctor = session.get(Doctor, doctor_id)
    if doctor is not None and doctor.status != DoctorStatus.active:
        raise SlotConflictError("Doctor is not active")
    get_or_create_calendar(session, doctor_id)
    calendar = (
        session.query(Calendar).filter(Calendar.doctor_id == doctor_id).first()
    )
    if calendar is not None and not calendar.is_active:
        raise SlotConflictError("Doctor is not accepting appointments")
    _lock_doctor_calendar(session, doctor_id)
    if _overlapping_block(session, doctor_id, start, end) is not None:
        raise SlotConflictError("Slot overlaps an existing block")
    block = BlockedSlot(
        doctor_id=doctor_id,
        start_datetime=start,
        end_datetime=end,
        reason=reason,
    )
    session.add(block)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise SlotConflictError("Slot was taken concurrently") from exc
    session.refresh(block)
    return block


def release_appointment_hold(
    session: Session, doctor_id: uuid.UUID, start: datetime, end: datetime
) -> bool:
    """Delete an appointment's exact held-slot block, if present.

    Matched in Python (normalized to UTC) so naive-vs-aware storage
    differences between SQLite and PostgreSQL cannot strand a block.
    Returns True when a block was removed.
    """
    candidates = (
        session.query(BlockedSlot)
        .filter(
            BlockedSlot.doctor_id == doctor_id,
            BlockedSlot.reason == BlockedReason.appointment,
            BlockedSlot.start_datetime < end,
            BlockedSlot.end_datetime > start,
        )
        .all()
    )
    for block in candidates:
        if availability.as_utc(block.start_datetime) == availability.as_utc(
            start
        ) and availability.as_utc(block.end_datetime) == availability.as_utc(end):
            session.delete(block)
            session.flush()
            return True
    return False


def validate_rule_input(
    day_of_week: int | None,
    start_time,
    end_time,
    recurrence: Recurrence,
    valid_from,
    valid_to,
) -> None:
    if end_time <= start_time:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="end_time must be after start_time",
        )
    if recurrence == Recurrence.weekly and day_of_week is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="day_of_week (0=Monday..6=Sunday) is required for weekly rules",
        )
    if (
        valid_from is not None
        and valid_to is not None
        and valid_to < valid_from
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="valid_to must not precede valid_from",
        )
