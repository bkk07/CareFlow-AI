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
from datetime import datetime, timezone

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
from app.domain.scheduling.availability import Window, as_utc
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
    """Pre-check the exact discrete slot is bookable right now.

    The slot must sit entirely inside the doctor's computed availability
    for the day (weekly/one-off rules minus blocked slots minus live
    appointments). The reserve-time overlap re-check plus the UNIQUE
    constraint remain the concurrency backstop — this check is the
    early, legible rejection.
    """
    if end <= start:
        raise _unprocessable("slot_end must be after slot_start")
    windows = scheduling_service.get_available_slots(
        doctor.id,
        appointment_type.id,
        as_utc(start).date(),
        as_utc(end).date(),
        session,
        booked=live_intervals_for_doctor(
            session, doctor.id, exclude_appointment_id=exclude_appointment_id
        ),
    )
    if Window(as_utc(start), as_utc(end)) not in windows:
        raise _conflict("Slot is not available")


def _release_block(
    session: Session, doctor_id: uuid.UUID, start: datetime, end: datetime
) -> None:
    scheduling_service.release_appointment_hold(session, doctor_id, start, end)


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
) -> Appointment:
    """Move a live appointment to a new slot.

    The new slot is reserved and vendor-confirmed BEFORE the old slot is
    released; any failure leaves the original booking untouched.
    """
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
            session, doctor.id, start, end, reason=BlockedReason.appointment
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
    _release_block(session, doctor.id, old_start, old_end)
    transition(
        session,
        appointment,
        AppointmentState.rescheduled,
        actor_user_id=actor_user_id,
        reason=reason,
        correlation_id=appointment.correlation_id,
    )
    # The vendor said yes — corroborate before trusting it. On divergence
    # the booking parks (new slot still held) with an open record.
    from app.reliability import operations as reliability_ops
    from app.reliability.verification import service as verify_service

    result = verify_service.verify_external_appointment(
        session, appointment, integration
    )
    if result.outcome != verify_service.VerifyOutcome.matched:
        if appointment.state == AppointmentState.rescheduled:
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
    return appointment


def cancel_appointment(
    session: Session,
    *,
    appointment: Appointment,
    actor_user_id: uuid.UUID,
    integration: IntegrationService,
    reason: str | None = None,
) -> Appointment:
    """Cancel a live appointment and release its slot.

    Cancellation is allowed even when the hospital is no longer live —
    tearing a booking down must never be gated. The vendor is told
    first; a vendor failure leaves local state untouched for a retry.
    """
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
    return appointment


def list_appointments(
    session: Session,
    *,
    hospital_id: uuid.UUID | None = None,
    patient_id: uuid.UUID | None = None,
    doctor_id: uuid.UUID | None = None,
) -> list[Appointment]:
    query = session.query(Appointment)
    if hospital_id is not None:
        query = query.filter(Appointment.hospital_id == hospital_id)
    if patient_id is not None:
        query = query.filter(Appointment.patient_id == patient_id)
    if doctor_id is not None:
        query = query.filter(Appointment.doctor_id == doctor_id)
    return query.order_by(Appointment.slot_start).all()


__all__ = [
    "SYSTEM_ACTOR",
    "InvalidTransition",
    "assert_slot_available",
    "cancel_appointment",
    "create_appointment",
    "get_appointment_or_404",
    "get_scoped_patient",
    "get_scoped_type",
    "list_appointments",
    "live_intervals_for_doctor",
    "reschedule_appointment",
]
