"""Scheduling orchestration: slot calculation + reservation locking.

`get_available_slots` is the single function everything later calls
(booking in Phase 7, `check_availability` in Phase 9). `reserve_slot` is
the double-booking guard booking calls inside its transaction: the
doctor's calendar row is locked first (row lock), overlap is re-checked
against current rows, then the block is inserted — and the UNIQUE
constraint on (doctor_id, start, end) is the backstop that collapses any
remaining concurrent racers to exactly one winner.
"""

import threading
import uuid
from datetime import date, datetime, time, timedelta, timezone

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

# R1: per-doctor in-process serialization for SQLite (tests / single-worker
# dev). PostgreSQL serializes via the Calendar FOR UPDATE row lock below;
# SQLite rejects FOR UPDATE, so without this two threads can interleave the
# overlap-check + insert and double-book partial overlaps
# (e.g. 09:00-09:30 vs 09:15-09:45) that the exact-match UNIQUE never fires on.
_RESERVE_LOCKS: dict[str, threading.Lock] = {}
_RESERVE_LOCKS_GUARD = threading.Lock()


def _reserve_lock_for(doctor_id: uuid.UUID) -> threading.Lock:
    key = str(doctor_id)
    with _RESERVE_LOCKS_GUARD:
        lock = _RESERVE_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _RESERVE_LOCKS[key] = lock
        return lock


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


def get_day_schedule(
    session: Session,
    doctor_id: uuid.UUID,
    day: date,
    booked: list[tuple[datetime, datetime]] | None = None,
) -> tuple[list[Window], list[Window]]:
    """Working windows + busy intervals for one IST calendar date.

    `windows` are the merged rule windows (UTC). `busy` merges admin
    blocks and already-booked intervals, clipped to the IST day, so a
    patient timeline can render the working day with taken periods as
    anonymous blocks. Returns ([], []) when the doctor is inactive or
    the calendar is paused.
    """
    doctor = session.get(Doctor, doctor_id)
    if doctor is None:
        raise _not_found("Doctor not found")
    if doctor.status != DoctorStatus.active:
        return [], []
    calendar = get_or_create_calendar(session, doctor_id)
    if not calendar.is_active:
        return [], []

    rules = (
        session.query(AvailabilityRule)
        .filter(AvailabilityRule.doctor_id == doctor_id)
        .all()
    )
    windows = availability.expand_rules_to_windows(rules, day)

    day_start = datetime.combine(day, time.min).replace(
        tzinfo=availability.IST
    ).astimezone(timezone.utc)
    day_end = (datetime.combine(day, time.min) + timedelta(days=1)).replace(
        tzinfo=availability.IST
    ).astimezone(timezone.utc)
    blocks = (
        session.query(BlockedSlot)
        .filter(
            BlockedSlot.doctor_id == doctor_id,
            BlockedSlot.start_datetime < day_end,
            BlockedSlot.end_datetime > day_start,
        )
        .all()
    )
    spans: list[Window] = [
        Window(
            max(availability.as_utc(b.start_datetime), day_start),
            min(availability.as_utc(b.end_datetime), day_end),
        )
        for b in blocks
    ]
    for s, e in booked or []:
        s_u, e_u = availability.as_utc(s), availability.as_utc(e)
        if e_u > day_start and s_u < day_end:
            spans.append(Window(max(s_u, day_start), min(e_u, day_end)))
    spans.sort()
    busy: list[Window] = []
    for span in spans:
        if span.end <= span.start:
            continue
        if busy and span.start <= busy[-1].end:
            busy[-1] = Window(busy[-1].start, max(busy[-1].end, span.end))
        else:
            busy.append(span)
    return windows, busy


def _overlapping_block(
    session: Session,
    doctor_id: uuid.UUID,
    start: datetime,
    end: datetime,
    *,
    exclude: tuple[datetime, datetime] | None = None,
) -> BlockedSlot | None:
    """First block overlapping [start, end). `exclude` skips the mover's own
    old hold so a reschedule that shifts by minutes is not a false conflict."""
    query = session.query(BlockedSlot).filter(
        BlockedSlot.doctor_id == doctor_id,
        BlockedSlot.start_datetime < end,
        BlockedSlot.end_datetime > start,
    )
    row = query.first()
    if row is not None and exclude is not None:
        from app.domain.scheduling.availability import as_utc as _as_utc

        if _as_utc(row.start_datetime) == _as_utc(
            exclude[0]
        ) and _as_utc(row.end_datetime) == _as_utc(exclude[1]):
            # Own hold — look for any *other* overlapping block.
            return (
                query.filter(BlockedSlot.id != row.id).first()
            )
    return row


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
    *,
    exclude: tuple[datetime, datetime] | None = None,
) -> BlockedSlot:
    """Hold a slot: lock the calendar row, re-check overlap, then insert.

    Safe under concurrency — the row lock serializes per-doctor
    reservations on PostgreSQL (plus a per-doctor in-process lock for
    SQLite, which rejects FOR UPDATE), and two racers for the same
    discrete slot collapse to one winner via the
    UNIQUE(doctor_id, start, end) constraint. Partial overlaps are caught
    by the overlap re-check while holding the lock.
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
    bind = session.get_bind()
    if bind is not None and bind.dialect.name == "sqlite":
        # SQLite: serialize check+insert in-process (see _reserve_lock_for).
        with _reserve_lock_for(doctor_id):
            return _reserve_slot_inner(
                session, doctor_id, start, end, reason, exclude=exclude
            )
    _lock_doctor_calendar(session, doctor_id)
    return _reserve_slot_inner(
        session, doctor_id, start, end, reason, exclude=exclude
    )


def _reserve_slot_inner(
    session: Session,
    doctor_id: uuid.UUID,
    start: datetime,
    end: datetime,
    reason: BlockedReason,
    *,
    exclude: tuple[datetime, datetime] | None = None,
) -> BlockedSlot:
    if _overlapping_block(session, doctor_id, start, end, exclude=exclude) is not None:
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
