"""Appointment booking service: slot validation, locking, vendor sync.

Happy-path flow (verification loop arrives in Phase 8):
1. validate the exact slot is still inside computed availability
   (rules minus blocks minus live appointments)
2. lock + reserve via the Phase 4 pattern -> Appointment(state=pending)
3. call IntegrationService.create_appointment(...)
4. on success -> state=confirmed (+ external_id, vendor mapping)
5. on vendor failure -> release the held slot, state=failed

Reschedule reserves the NEW slot first and releases the old one only
after the vendor confirms the move — the old booking is never left
slotless by a failed move. Cancel releases the slot with the booking.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment, AppointmentState
from app.domain.appointment.state_machine import (
    LIVE_STATES,
    InvalidTransition,
    ensure_allowed,
    transition,
)
from app.domain.auth.models import Role, User
from app.domain.doctor.models import Doctor, DoctorStatus
from app.domain.hospital.models import Hospital
from app.domain.hospital.service import assert_hospital_approved
from app.domain.hospital_config.models import AppointmentType
from app.domain.scheduling import service as scheduling_service
from app.domain.scheduling.availability import as_utc, overlaps
from app.domain.scheduling.models import BlockedReason
from app.domain.scheduling.service import SlotConflictError
from app.integration.connector_interface import EHRConnectorError
from app.integration.integration_service import IntegrationService

SYSTEM_ACTOR = "booking-service"


def _conflict(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message
    )


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise _unprocessable("Datetimes must carry a timezone; UTC is stored")
    return value.astimezone(timezone.utc)


def get_appointment_or_404(session: Session, appointment_id: uuid.UUID) -> Appointment:
    appointment = session.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found"
        )
    return appointment


def live_intervals_for_doctor(
    session: Session,
    doctor_id: uuid.UUID,
    *,
    exclude_appointment_id: uuid.UUID | None = None,
) -> list[tuple[datetime, datetime]]:
    """(start, end) pairs of appointments still holding the doctor's slot."""
    query = session.query(Appointment).filter(
        Appointment.doctor_id == doctor_id,
        Appointment.state.in_(LIVE_STATES),
    )
    if exclude_appointment_id is not None:
        query = query.filter(Appointment.id != exclude_appointment_id)
    return [(row.slot_start, row.slot_end) for row in query.all()]


def assert_slot_available(
    session: Session,
    *,
    doctor: Doctor,
    appointment_type: AppointmentType,
    start: datetime,
    end: datetime,
    exclude_appointment_id: uuid.UUID | None = None,
) -> None:
    """Pre-check an arbitrary [start, end) range is bookable right now.

    The patient timeline UI lets the patient pick ANY start time — the
    range only needs to:
    1. last exactly the appointment type's duration,
    2. sit entirely inside one working window (weekly/one-off rules),
    3. overlap no blocked slot or live appointment (touching boundaries
       do not count as overlap).
    The reserve-time overlap re-check plus the UNIQUE constraint remain
    the concurrency backstop — this check is the early, legible
    rejection.
    """
    if end <= start:
        raise _unprocessable("slot_end must be after slot_start")
    offered = list(doctor.available_durations or [])
    if offered and appointment_type.duration_minutes not in offered:
        raise _unprocessable(
            f"Doctor does not offer {appointment_type.duration_minutes}-minute visits"
        )
    start_u, end_u = as_utc(start), as_utc(end)
    want = timedelta(minutes=appointment_type.duration_minutes)
    if end_u - start_u != want:
        raise _unprocessable(
            "Visit must be exactly "
            f"{appointment_type.duration_minutes} minutes for this event"
        )
    from app.domain.scheduling import availability as availability_math
    from app.domain.scheduling.models import AvailabilityRule, BlockedSlot

    rules = (
        session.query(AvailabilityRule)
        .filter(AvailabilityRule.doctor_id == doctor.id)
        .all()
    )
    contained = False
    day = start_u.date()
    while day <= end_u.date():
        for window in availability_math.expand_rules_to_windows(rules, day):
            if window.start <= start_u and end_u <= window.end:
                contained = True
                break
        if contained:
            break
        day += timedelta(days=1)
    if not contained:
        raise _conflict("Slot is not available")
    # A reschedule's own old hold must not count against the new range.
    old_hold: tuple[datetime, datetime] | None = None
    if exclude_appointment_id is not None:
        own = session.get(Appointment, exclude_appointment_id)
        if own is not None:
            old_hold = (as_utc(own.slot_start), as_utc(own.slot_end))
    blocks = (
        session.query(BlockedSlot)
        .filter(
            BlockedSlot.doctor_id == doctor.id,
            BlockedSlot.start_datetime < end_u,
            BlockedSlot.end_datetime > start_u,
        )
        .all()
    )
    for block in blocks:
        block_start = as_utc(block.start_datetime)
        block_end = as_utc(block.end_datetime)
        if (
            old_hold is not None
            and block_start == old_hold[0]
            and block_end == old_hold[1]
        ):
            continue
        raise _conflict("Slot is not available")
    for busy_start, busy_end in live_intervals_for_doctor(
        session, doctor.id, exclude_appointment_id=exclude_appointment_id
    ):
        if overlaps(start_u, end_u, busy_start, busy_end):
            raise _conflict("Slot is not available")


def _normalize_consultation_mode(
    doctor: Doctor, consultation_mode: str | None
) -> str | None:
    """Validate the requested visit mode against the doctor's configured
    consultation types. Doctors with no configured types accept anything
    (back-compat for older profiles); otherwise the mode must be offered."""
    if consultation_mode is None:
        return None
    mode = consultation_mode.strip()
    if not mode:
        return None
    offered = [str(m) for m in (doctor.consultation_types or [])]
    if offered and mode not in offered:
        raise _unprocessable(f"Doctor does not offer '{mode}' visits")
    return mode


def _release_block(
    session: Session, doctor_id: uuid.UUID, start: datetime, end: datetime
) -> None:
    scheduling_service.release_appointment_hold(session, doctor_id, start, end)


def _lock_appointment_row(session: Session, appointment_id: uuid.UUID) -> Appointment:
    """R2: serialize concurrent moves on one booking.

    PostgreSQL takes a real row lock; SQLite (tests/dev) is a no-op — the
    per-doctor reserve lock plus idempotency replay below still prevent a
    second new-slot hold from stranding.
    """
    bind = session.get_bind()
    if bind is not None and getattr(bind.dialect, "name", None) != "sqlite":
        locked = (
            session.query(Appointment)
            .filter(Appointment.id == appointment_id)
            .with_for_update()
            .first()
        )
        if locked is not None:
            return locked
    return get_appointment_or_404(session, appointment_id)


def _find_idempotent_replay(
    session: Session,
    appointment_id: uuid.UUID,
    operation_type: str,
    idempotency_key: str | None,
) -> bool:
    """R2: True when this exact key already drove this appointment's move.

    The key is stamped into IntegrationOperation.request_payload by the
    reschedule/cancel flows below, so a client timeout-retry replays to the
    current booking instead of reserving/cancelling twice.
    """
    if not idempotency_key:
        return False
    from app.reliability.models import IntegrationOperation

    ops = (
        session.query(IntegrationOperation)
        .filter(
            IntegrationOperation.appointment_id == appointment_id,
            IntegrationOperation.operation_type == operation_type,  # type: ignore[arg-type]
        )
        .all()
    )
    for op in ops:
        payload = op.request_payload or {}
        if isinstance(payload, dict) and payload.get("idempotency_key") == idempotency_key:
            return True
    return False


def get_scoped_type(
    session: Session, hospital: Hospital, appointment_type_id: uuid.UUID
) -> AppointmentType:
    appt_type = session.get(AppointmentType, appointment_type_id)
    if appt_type is None or appt_type.hospital_id != hospital.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment type not found in this hospital",
        )
    return appt_type


def get_scoped_patient(session: Session, patient_id: uuid.UUID) -> User:
    patient = session.get(User, patient_id)
    if patient is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found"
        )
    if patient.role != Role.patient:
        raise _unprocessable("patient_id must belong to a patient user")
    return patient


def create_appointment(
    session: Session,
    *,
    hospital: Hospital,
    patient: User,
    doctor: Doctor,
    appointment_type: AppointmentType,
    slot_start: datetime,
    slot_end: datetime,
    idempotency_key: str,
    actor_user_id: uuid.UUID,
    integration: IntegrationService,
    correlation_id: uuid.UUID | None = None,
    consultation_mode: str | None = None,
) -> tuple[Appointment, bool]:
    """Book an appointment; returns (appointment, created).

    A repeated call with the same idempotency_key returns the existing
    appointment with created=False — never a second row.
    """
    correlation_id = correlation_id or uuid.uuid4()
    existing = (
        session.query(Appointment)
        .filter(Appointment.idempotency_key == idempotency_key)
        .first()
    )
    if existing is not None:
        return existing, False

    assert_hospital_approved(hospital)
    if doctor.hospital_id != hospital.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doctor not found in this hospital",
        )
    if appointment_type.hospital_id != hospital.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment type not found in this hospital",
        )
    if doctor.status != DoctorStatus.active:
        raise _unprocessable("Doctor is not active")
    mode = _normalize_consultation_mode(doctor, consultation_mode)
    start, end = _to_utc(slot_start), _to_utc(slot_end)
    assert_slot_available(
        session, doctor=doctor, appointment_type=appointment_type, start=start, end=end
    )
    try:
        scheduling_service.reserve_slot(
            session, doctor.id, start, end, reason=BlockedReason.appointment
        )
    except SlotConflictError as exc:
        raise _conflict("Slot was taken concurrently") from exc

    appointment = Appointment(
        hospital_id=hospital.id,
        patient_id=patient.id,
        doctor_id=doctor.id,
        appointment_type_id=appointment_type.id,
        slot_start=start,
        slot_end=end,
        state=AppointmentState.pending,
        idempotency_key=idempotency_key,
        correlation_id=correlation_id,
        consultation_mode=mode,
    )
    session.add(appointment)
    try:
        session.flush()
    except IntegrityError:
        # Lost an idempotency race: drop our orphan hold and replay.
        session.rollback()
        _release_block(session, doctor.id, start, end)
        session.commit()
        winner = (
            session.query(Appointment)
            .filter(Appointment.idempotency_key == idempotency_key)
            .one()
        )
        return winner, False

    try:
        external = integration.create_appointment(
            hospital=hospital,
            patient=patient,
            doctor=doctor,
            start=start,
            end=end,
            idempotency_key=idempotency_key,
            internal_appointment_id=appointment.id,
        )
    except EHRConnectorError as exc:
        # Unknown outcome — the vendor may have committed. Recovery
        # queries first, retries same-key within budget, then parks.
        # (It commits internally; refresh below re-reads the outcome.)
        from app.reliability.reconciliation import service as reconcile_service

        appointment = reconcile_service.handle_create_failure(
            session,
            appointment,
            exc,
            integration=integration,
            actor_user_id=actor_user_id,
        )
        session.refresh(appointment)
        return appointment, True

    appointment.external_id = external.external_id
    from app.reliability.verification import service as verify_service

    result = verify_service.verify_external_appointment(
        session, appointment, integration
    )
    if result.outcome == verify_service.VerifyOutcome.matched:
        transition(
            session,
            appointment,
            AppointmentState.confirmed,
            actor_user_id=actor_user_id,
            correlation_id=correlation_id,
        )
    else:
        # A "success" we cannot corroborate is not a success. The slot
        # stays held (the vendor may hold it too) while an operator
        # looks: mismatch parks for reconciliation, an unreadable
        # vendor parks in sync_pending for a re-read.
        from app.reliability import operations as reliability_ops

        detail = result.mismatches or ["unreadable vendor record"]
        if appointment.state == AppointmentState.pending:
            transition(
                session,
                appointment,
                AppointmentState.sync_pending,
                actor_user_id=actor_user_id,
                reason=f"Vendor response not corroborated: {detail}",
                correlation_id=correlation_id,
            )
        if result.outcome == verify_service.VerifyOutcome.mismatched:
            transition(
                session,
                appointment,
                AppointmentState.reconciliation_required,
                actor_user_id=actor_user_id,
                reason=f"Vendor response not corroborated: {result.mismatches}",
                correlation_id=correlation_id,
            )
        reliability_ops.open_record(
            session,
            appointment=appointment,
            operation=session.get(
                reliability_ops.IntegrationOperation, result.operation_id
            ),
            error=f"Uncorroborated vendor success: {detail}",
            attempts=1,
            external_id=external.external_id,
            external_status=external.status,
        )
    session.commit()
    session.refresh(appointment)
    if appointment.state == AppointmentState.confirmed:
        # Booked AND vendor-corroborated: tell the workflow engine so the
        # patient is notified. Parked/failed outcomes notify nobody yet.
        # (This tail is only reached for fresh bookings; replays and the
        # failure path return earlier.)
        from app.workflow import event_bus

        event_bus.publish_event(
            session,
            "appointment.booked",
            {"appointment_id": str(appointment.id)},
            correlation_id=appointment.correlation_id,
        )
    return appointment, True


def reschedule_appointment(
    session: Session,
    *,
    appointment: Appointment,
    hospital: Hospital,
    new_start: datetime,
    new_end: datetime,
    actor_user_id: uuid.UUID,
    integration: IntegrationService,
    reason: str | None = None,
    idempotency_key: str | None = None,
) -> Appointment:
    """Move a live appointment to a new slot.

    The new slot is reserved and vendor-confirmed BEFORE the old slot is
    released; any failure leaves the original booking untouched.
    R2: the appointment row is locked first and a repeated
    idempotency_key replays to the current booking.
    """
    # Serialize concurrent moves on this row before reading state.
    appointment = _lock_appointment_row(session, appointment.id)
    if idempotency_key and _find_idempotent_replay(
        session, appointment.id, "update", idempotency_key
    ):
        session.refresh(appointment)
        return appointment
    ensure_allowed(appointment.state, AppointmentState.rescheduled)
    assert_hospital_approved(hospital)
    start, end = _to_utc(new_start), _to_utc(new_end)
    if as_utc(start) == as_utc(
        appointment.slot_start
    ) and as_utc(end) == as_utc(appointment.slot_end):
        raise _unprocessable("New slot is the same as the current slot")
    doctor = session.get(Doctor, appointment.doctor_id)
    appt_type = session.get(AppointmentType, appointment.appointment_type_id)
    assert_slot_available(
        session,
        doctor=doctor,
        appointment_type=appt_type,
        start=start,
        end=end,
        exclude_appointment_id=appointment.id,
    )
    try:
        scheduling_service.reserve_slot(
            session,
            doctor.id,
            start,
            end,
            reason=BlockedReason.appointment,
            # R1: shifting by minutes overlaps our own old hold — exclude it.
            exclude=(appointment.slot_start, appointment.slot_end),
        )
    except SlotConflictError as exc:
        raise _conflict("New slot was taken concurrently") from exc

    if appointment.external_id is None:
        _release_block(session, doctor.id, start, end)
        session.commit()
        raise _conflict("Appointment has no vendor record; cannot reschedule")
    try:
        integration.update_appointment(appointment.external_id, start, end)
    except EHRConnectorError as exc:
        # Unknown outcome — reconcile from vendor truth (commits inside).
        from app.reliability.reconciliation import service as reconcile_service

        appointment = reconcile_service.handle_update_failure(
            session,
            appointment,
            start,
            end,
            exc,
            integration=integration,
            actor_user_id=actor_user_id,
        )
        session.refresh(appointment)
        return appointment

    old_start, old_end = appointment.slot_start, appointment.slot_end
    appointment.slot_start = start
    appointment.slot_end = end
    # R2: stamp the move so a retried key replays instead of moving again.
    if idempotency_key:
        from app.reliability import operations as _ops
        from app.reliability.models import OperationStatus as _OpStatus
        from app.reliability.models import OperationType as _OpType

        _ops.record_operation(
            session,
            appointment_id=appointment.id,
            operation_type=_OpType.update,
            attempt_number=_ops.next_attempt_number(
                session, appointment.id, _OpType.update
            ),
            status=_OpStatus.succeeded,
            request_payload={
                "idempotency_key": idempotency_key,
                "new_slot_start": as_utc(start).isoformat(),
                "new_slot_end": as_utc(end).isoformat(),
            },
            correlation_id=appointment.correlation_id,
        )
    # R5: verify BEFORE releasing the old hold. Both slots stay held while
    # the vendor move is corroborated; the old hold is released only on a
    # matched verification. On divergence both holds are kept (never risk a
    # double-book) and the booking parks with an open record.
    from app.reliability import operations as reliability_ops
    from app.reliability.verification import service as verify_service

    result = verify_service.verify_external_appointment(
        session, appointment, integration
    )
    if result.outcome == verify_service.VerifyOutcome.matched:
        _release_block(session, doctor.id, old_start, old_end)
        transition(
            session,
            appointment,
            AppointmentState.rescheduled,
            actor_user_id=actor_user_id,
            reason=reason,
            correlation_id=appointment.correlation_id,
        )
    else:
        transition(
            session,
            appointment,
            AppointmentState.rescheduled,
            actor_user_id=actor_user_id,
            reason=reason,
            correlation_id=appointment.correlation_id,
        )
        transition(
            session,
            appointment,
            AppointmentState.reconciliation_required,
            actor_user_id=actor_user_id,
            reason=f"Vendor move not corroborated: {result.mismatches or ['unreadable vendor record']}",
            correlation_id=appointment.correlation_id,
        )
        reliability_ops.open_record(
            session,
            appointment=appointment,
            operation=session.get(
                reliability_ops.IntegrationOperation, result.operation_id
            ),
            error="Uncorroborated vendor move: "
            f"{result.mismatches or ['unreadable vendor record']}",
            attempts=1,
            external_id=appointment.external_id,
        )
    session.commit()
    session.refresh(appointment)
    if appointment.state == AppointmentState.rescheduled:
        from app.workflow import event_bus

        event_bus.publish_event(
            session,
            "appointment.rescheduled",
            {
                "appointment_id": str(appointment.id),
                "slot_start": appointment.slot_start.isoformat(),
                "slot_end": appointment.slot_end.isoformat(),
            },
            correlation_id=appointment.correlation_id,
        )
    return appointment


def cancel_appointment(
    session: Session,
    *,
    appointment: Appointment,
    actor_user_id: uuid.UUID,
    integration: IntegrationService,
    reason: str | None = None,
    idempotency_key: str | None = None,
) -> Appointment:
    """Cancel a live appointment and release its slot.

    Cancellation is allowed even when the hospital is no longer live —
    tearing a booking down must never be gated. The vendor is told
    first; a vendor failure leaves local state untouched for a retry.
    R2: row-locked and idempotent — a retried key replays.
    """
    appointment = _lock_appointment_row(session, appointment.id)
    if idempotency_key and _find_idempotent_replay(
        session, appointment.id, "cancel", idempotency_key
    ):
        session.refresh(appointment)
        return appointment
    ensure_allowed(appointment.state, AppointmentState.cancelled)
    if appointment.external_id is not None:
        try:
            integration.cancel_appointment(appointment.external_id)
        except EHRConnectorError as exc:
            # Unknown outcome — reconcile from vendor truth (commits inside).
            from app.reliability.reconciliation import service as reconcile_service

            appointment = reconcile_service.handle_cancel_failure(
                session,
                appointment,
                exc,
                integration=integration,
                actor_user_id=actor_user_id,
            )
            session.refresh(appointment)
            return appointment
    _release_block(session, appointment.doctor_id, appointment.slot_start, appointment.slot_end)
    transition(
        session,
        appointment,
        AppointmentState.cancelled,
        actor_user_id=actor_user_id,
        reason=reason,
        correlation_id=appointment.correlation_id,
    )
    # Corroborate the vendor cancellation; divergence opens a record but
    # the local booking stands cancelled — it will not be resurrected.
    from app.reliability import operations as reliability_ops
    from app.reliability.verification import service as verify_service

    if idempotency_key:
        reliability_ops.record_operation(
            session,
            appointment_id=appointment.id,
            operation_type=reliability_ops.OperationType.cancel,
            attempt_number=reliability_ops.next_attempt_number(
                session,
                appointment.id,
                reliability_ops.OperationType.cancel,
            ),
            status=reliability_ops.OperationStatus.succeeded,
            request_payload={"idempotency_key": idempotency_key},
            correlation_id=appointment.correlation_id,
        )

    try:
        current = (
            integration.get_appointment(appointment.external_id)
            if appointment.external_id is not None
            else None
        )
    except EHRConnectorError as exc:
        current = None
        verify_error: str | None = f"{type(exc).__name__}: {exc}"
    else:
        verify_error = None
    if current is None or current.status != "cancelled":
        result_detail = (
            verify_error
            or f"vendor status={current.status if current else 'missing'}"
        )
        # R5: the slot was already released above but the vendor may still
        # hold it — quarantine the slot (re-hold) so it cannot be rebooked
        # into a vendor-side double-booking while the operator resolves.
        try:
            scheduling_service.reserve_slot(
                session,
                appointment.doctor_id,
                appointment.slot_start,
                appointment.slot_end,
                reason=BlockedReason.appointment,
            )
        except SlotConflictError:
            pass
        op = reliability_ops.record_operation(
            session,
            appointment_id=appointment.id,
            operation_type=reliability_ops.OperationType.verify,
            attempt_number=reliability_ops.next_attempt_number(
                session,
                appointment.id,
                reliability_ops.OperationType.verify,
            ),
            status=reliability_ops.OperationStatus.failed
            if verify_error
            else reliability_ops.OperationStatus.succeeded,
            request_payload={"external_id": appointment.external_id},
            error=result_detail,
            correlation_id=appointment.correlation_id,
        )
        reliability_ops.open_record(
            session,
            appointment=appointment,
            operation=op,
            error=f"Uncorroborated vendor cancellation: {result_detail}",
            attempts=1,
            external_id=appointment.external_id,
            external_status=current.status if current else None,
        )
    session.commit()
    session.refresh(appointment)
    if appointment.state == AppointmentState.cancelled:
        from app.workflow import event_bus

        event_bus.publish_event(
            session,
            "appointment.cancelled",
            {"appointment_id": str(appointment.id)},
            correlation_id=appointment.correlation_id,
        )
    return appointment


def _close_appointment(
    session: Session,
    appointment_id: uuid.UUID,
    to_state: AppointmentState,
    actor_user_id: uuid.UUID,
    reason: str | None = None,
) -> Appointment:
    """C1: lock + move a live booking to a terminal/confirm state.

    Used by the complete / no-show / confirm endpoints so doctors and
    operators can close the loop without going through reconciliation.
    """
    appointment = _lock_appointment_row(session, appointment_id)
    transition(
        session,
        appointment,
        to_state,
        actor_user_id=actor_user_id,
        reason=reason,
        correlation_id=appointment.correlation_id,
    )
    session.commit()
    session.refresh(appointment)
    return appointment


def complete_appointment(
    session: Session,
    appointment_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    reason: str | None = None,
) -> Appointment:
    return _close_appointment(
        session, appointment_id, AppointmentState.completed, actor_user_id, reason
    )


def mark_no_show(
    session: Session,
    appointment_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    reason: str | None = None,
) -> Appointment:
    return _close_appointment(
        session, appointment_id, AppointmentState.no_show, actor_user_id, reason
    )


def confirm_appointment(
    session: Session,
    appointment_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    reason: str | None = None,
) -> Appointment:
    return _close_appointment(
        session, appointment_id, AppointmentState.confirmed, actor_user_id, reason
    )


def list_appointments(
    session: Session,
    *,
    hospital_id: uuid.UUID | None = None,
    patient_id: uuid.UUID | None = None,
    doctor_id: uuid.UUID | None = None,
    state: AppointmentState | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[Appointment]:
    query = session.query(Appointment)
    if hospital_id is not None:
        query = query.filter(Appointment.hospital_id == hospital_id)
    if patient_id is not None:
        query = query.filter(Appointment.patient_id == patient_id)
    if doctor_id is not None:
        query = query.filter(Appointment.doctor_id == doctor_id)
    if state is not None:
        query = query.filter(Appointment.state == state)
    limit = min(max(limit, 1), 500)
    offset = max(offset, 0)
    return query.order_by(Appointment.slot_start.desc()).offset(offset).limit(limit).all()


__all__ = [
    "SYSTEM_ACTOR",
    "InvalidTransition",
    "assert_slot_available",
    "cancel_appointment",
    "complete_appointment",
    "confirm_appointment",
    "create_appointment",
    "get_appointment_or_404",
    "get_scoped_patient",
    "get_scoped_type",
    "list_appointments",
    "live_intervals_for_doctor",
    "mark_no_show",
    "reschedule_appointment",
]
