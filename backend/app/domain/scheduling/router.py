"""Scheduling endpoints: calendar, rules, blocks, slot lookup."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.domain.hospital.service import assert_hospital_approved, get_hospital_or_404
from app.domain.scheduling import service
from app.domain.scheduling.models import (
    AvailabilityRule,
    BlockedSlot,
    Recurrence,
)
from app.domain.scheduling.schemas import (
    AvailabilityRuleCreateIn,
    AvailabilityRuleOut,
    BlockedSlotCreateIn,
    BlockedSlotOut,
    CalendarOut,
    CalendarUpdateIn,
    SlotOut,
)

router = APIRouter(tags=["scheduling"])

_editor = require_role(Role.hospital_admin, Role.doctor)


def _managed_hospital(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> Hospital:
    """The caller's own live hospital — admins and doctors alike."""
    hospital = get_hospital_or_404(db, hospital_id)
    if ctx.hospital_id != hospital.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to manage this hospital",
        )
    return assert_hospital_approved(hospital)


def _hospital_doctor(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> Doctor:
    if ctx.role == Role.doctor:
        # Doctors manage only their own linked calendar.
        from app.domain.doctor import dashboard as doctor_dashboard

        linked = doctor_dashboard.get_linked_doctor(db, ctx)
        if linked.id != doctor_id or linked.hospital_id != hospital.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Doctors can only manage their own calendar",
            )
        return linked
    return service.get_hospital_doctor(db, hospital, doctor_id)


@router.get(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/calendar",
    response_model=CalendarOut,
)
def get_calendar(
    doctor: Doctor = Depends(_hospital_doctor),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> CalendarOut:
    del ctx
    return service.get_or_create_calendar(db, doctor.id)


@router.put(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/calendar",
    response_model=CalendarOut,
)
def update_calendar(
    body: CalendarUpdateIn,
    doctor: Doctor = Depends(_hospital_doctor),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> CalendarOut:
    del ctx
    calendar = service.get_or_create_calendar(db, doctor.id)
    calendar.is_active = body.is_active
    db.commit()
    db.refresh(calendar)
    return calendar


@router.get(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/availability-rules",
    response_model=list[AvailabilityRuleOut],
)
def list_rules(
    doctor: Doctor = Depends(_hospital_doctor),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> list:
    del ctx
    return (
        db.query(AvailabilityRule)
        .filter(AvailabilityRule.doctor_id == doctor.id)
        .order_by(AvailabilityRule.created_at)
        .all()
    )


@router.post(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/availability-rules",
    response_model=AvailabilityRuleOut,
    status_code=201,
)
def create_rule(
    body: AvailabilityRuleCreateIn,
    doctor: Doctor = Depends(_hospital_doctor),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> AvailabilityRule:
    del ctx
    service.validate_rule_input(
        body.day_of_week,
        body.start_time,
        body.end_time,
        body.recurrence,
        body.valid_from,
        body.valid_to,
    )
    rule = AvailabilityRule(
        doctor_id=doctor.id,
        day_of_week=body.day_of_week if body.recurrence == Recurrence.weekly else None,
        start_time=body.start_time,
        end_time=body.end_time,
        recurrence=body.recurrence,
        valid_from=body.valid_from,
        valid_to=body.valid_to,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/availability-rules/{rule_id}",
    status_code=204,
)
def delete_rule(
    rule_id: uuid.UUID,
    doctor: Doctor = Depends(_hospital_doctor),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> None:
    del ctx
    rule = (
        db.query(AvailabilityRule)
        .filter(
            AvailabilityRule.id == rule_id,
            AvailabilityRule.doctor_id == doctor.id,
        )
        .first()
    )
    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Availability rule not found",
        )
    db.delete(rule)
    db.commit()
    return None


@router.get(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/blocked-slots",
    response_model=list[BlockedSlotOut],
)
def list_blocks(
    doctor: Doctor = Depends(_hospital_doctor),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> list:
    del ctx
    return (
        db.query(BlockedSlot)
        .filter(BlockedSlot.doctor_id == doctor.id)
        .order_by(BlockedSlot.start_datetime)
        .all()
    )


@router.post(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/blocked-slots",
    response_model=BlockedSlotOut,
    status_code=201,
)
def create_block(
    body: BlockedSlotCreateIn,
    doctor: Doctor = Depends(_hospital_doctor),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> BlockedSlot:
    del ctx
    start = service._to_utc(body.start_datetime)
    end = service._to_utc(body.end_datetime)
    if end <= start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="end_datetime must be after start_datetime",
        )
    # R3: route through the same guarded reservation path as bookings —
    # lock + overlap re-check + UNIQUE backstop — so an admin/doctor block
    # can never silently overlay a live appointment hold.
    from app.domain.scheduling.models import BlockedReason as _Reason
    from app.domain.scheduling.service import SlotConflictError

    try:
        return service.reserve_slot(
            db, doctor.id, start, end, reason=body.reason or _Reason.ad_hoc
        )
    except SlotConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc


@router.delete(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/blocked-slots/{block_id}",
    status_code=204,
)
def delete_block(
    block_id: uuid.UUID,
    doctor: Doctor = Depends(_hospital_doctor),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> None:
    del ctx
    block = (
        db.query(BlockedSlot)
        .filter(
            BlockedSlot.id == block_id,
            BlockedSlot.doctor_id == doctor.id,
        )
        .first()
    )
    if block is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Blocked slot not found"
        )
    db.delete(block)
    db.commit()
    return None


@router.get(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/slots",
    response_model=list[SlotOut],
)
def read_slots(
    date_from: date,
    date_to: date,
    appointment_type_id: uuid.UUID,
    doctor: Doctor = Depends(_hospital_doctor),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_editor),
) -> list[SlotOut]:
    del ctx
    from app.domain.appointment import service as appointment_service

    windows = service.get_available_slots(
        doctor.id,
        appointment_type_id,
        date_from,
        date_to,
        db,
        booked=appointment_service.live_intervals_for_doctor(db, doctor.id),
    )
    return [SlotOut(start=w.start, end=w.end) for w in windows]
