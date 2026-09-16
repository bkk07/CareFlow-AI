"""Reconciliation: the unknown-outcome algorithm, implemented precisely.

A timeout (or dropped connection, or 5xx) after a vendor write says
nothing about the outcome — the vendor may have committed. So a failed
create never blindly retries: it first queries by idempotency key and
adopts whatever the vendor has (query-then-confirm, no duplicates).
Only when the vendor provably has nothing does a same-key retry go
out, capped with exponential backoff. Past the budget the booking parks
in a live state (slot still held — the vendor may hold it too) with an
open ReconciliationRecord for an operator.

Update/cancel failures get the lookup-driven equivalent: re-read the
vendor record and finalize, roll back, or park based on what the vendor
actually holds — never on what we hope it holds.
"""

import time
import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment, AppointmentState
from app.domain.appointment.state_machine import transition
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.domain.hospital_config.models import AppointmentType
from app.domain.auth.models import User
from app.domain.scheduling.availability import as_utc
from app.domain.scheduling.service import release_appointment_hold
from app.integration.connector_interface import EHRConnectorError, ExternalAppointment
from app.integration.integration_service import IntegrationService
from app.reliability import operations
from app.reliability.failure_classifier import (
    MAX_RETRIES,
    RETRY_BACKOFF_BASE_S,
    FailureClass,
    classify,
    operation_status_for,
    retry_allowed,
    retry_delay_s,
)
from app.reliability.models import OperationStatus, OperationType
from app.reliability.models import ReconciliationRecord, ResolutionStatus
from app.reliability.synchronization import service as sync_service


def _care_team(
    session: Session, appointment: Appointment
) -> tuple[Hospital, User, Doctor, AppointmentType]:
    hospital = session.get(Hospital, appointment.hospital_id)
    patient = session.get(User, appointment.patient_id)
    doctor = session.get(Doctor, appointment.doctor_id)
    appt_type = session.get(AppointmentType, appointment.appointment_type_id)
    if hospital is None or patient is None or doctor is None or appt_type is None:
        raise RuntimeError("Appointment references a missing care-team row")
    return hospital, patient, doctor, appt_type


def _slot_payload(appointment: Appointment) -> dict:
    return {
        "slot_start": as_utc(appointment.slot_start).isoformat(),
        "slot_end": as_utc(appointment.slot_end).isoformat(),
        "idempotency_key": appointment.idempotency_key,
    }


def _safe_key_lookup(
    integration: IntegrationService, idempotency_key: str
) -> tuple[ExternalAppointment | None, EHRConnectorError | None]:
    """(record, None) on a clean lookup; (None, exc) when even asking failed."""
    try:
        return integration.find_appointment_by_idempotency_key(idempotency_key), None
    except EHRConnectorError as exc:
        return None, exc


def _lookup_miss(
    lookup_error: EHRConnectorError | None,
) -> bool:
    """True when recovery may proceed as if the vendor holds nothing.

    A transient lookup failure (dark vendor) is not proof of absence —
    but proceeding is still safe because any retry reuses the same
    idempotency key the vendor dedupes on. Only a definitive lookup
    failure stops the flow for an operator instead.
    """
    return lookup_error is None or retry_allowed(classify(lookup_error))


def _park_sync_pending(
    session: Session, appointment: Appointment, actor_user_id: uuid.UUID
) -> None:
    if appointment.state == AppointmentState.pending:
        transition(
            session,
            appointment,
            AppointmentState.sync_pending,
            actor_user_id=actor_user_id,
            reason="Awaiting vendor confirmation",
            correlation_id=appointment.correlation_id,
        )


def _fail_booking(
    session: Session,
    appointment: Appointment,
    actor_user_id: uuid.UUID,
    reason: str,
) -> Appointment:
    release_appointment_hold(
        session,
        appointment.doctor_id,
        appointment.slot_start,
        appointment.slot_end,
    )
    transition(
        session,
        appointment,
        AppointmentState.failed,
        actor_user_id=actor_user_id,
        reason=reason,
        correlation_id=appointment.correlation_id,
    )
    session.commit()
    return appointment


def handle_create_failure(
    session: Session,
    appointment: Appointment,
    exc: EHRConnectorError,
    *,
    integration: IntegrationService,
    actor_user_id: uuid.UUID,
    backoff_base_s: float = RETRY_BACKOFF_BASE_S,
    max_retries: int = MAX_RETRIES,
) -> Appointment:
    """Recover a failed vendor create. Never blindly retries.

    Validation failures die immediately (same payload can never work).
    Everything else queries by idempotency key first: found-and-matching
    confirms with no duplicate; found-and-divergent parks with a record;
    provably-absent retries same-key within budget, then parks.
    """
    hospital, patient, doctor, _ = _care_team(session, appointment)
    key = appointment.idempotency_key
    last_error = f"{type(exc).__name__}: {exc}"
    attempt = operations.next_attempt_number(
        session, appointment.id, OperationType.create
    )
    latest_op = operations.record_operation(
        session,
        appointment_id=appointment.id,
        operation_type=OperationType.create,
        attempt_number=attempt,
        status=operation_status_for(exc),
        request_payload=_slot_payload(appointment),
        error=last_error,
        correlation_id=appointment.correlation_id,
    )
    failure = classify(exc)
    if failure == FailureClass.NOT_RETRYABLE_VALIDATION:
        return _fail_booking(
            session, appointment, actor_user_id, f"Vendor rejected booking: {exc}"
        )

    found, lookup_error = _safe_key_lookup(integration, key)
    if not _lookup_miss(lookup_error):
        assert lookup_error is not None
        _park_sync_pending(session, appointment, actor_user_id)
        operations.open_record(
            session,
            appointment=appointment,
            operation=latest_op,
            error=f"Create outcome unknown ({failure.value}); key lookup failed: "
            f"{type(lookup_error).__name__}: {lookup_error}",
            attempts=attempt,
        )
        session.commit()
        return appointment
    if found is not None:
        adopted, mismatches = sync_service.adopt_external(
            session, appointment, found, actor_user_id=actor_user_id
        )
        if mismatches:
            operations.open_record(
                session,
                appointment=adopted,
                operation=latest_op,
                error=f"Vendor holds a divergent record for this key: {mismatches}",
                attempts=attempt,
                external_id=found.external_id,
                external_status=found.status,
            )
        session.commit()
        return adopted

    _park_sync_pending(session, appointment, actor_user_id)
    while retry_allowed(failure) and attempt < max_retries:
        if backoff_base_s > 0:
            time.sleep(retry_delay_s(attempt, backoff_base_s))
        attempt += 1
        try:
            external = integration.create_appointment(
                hospital=hospital,
                patient=patient,
                doctor=doctor,
                start=as_utc(appointment.slot_start),
                end=as_utc(appointment.slot_end),
                idempotency_key=key,
                internal_appointment_id=appointment.id,
            )
        except EHRConnectorError as retry_exc:
            last_error = f"{type(retry_exc).__name__}: {retry_exc}"
            latest_op = operations.record_operation(
                session,
                appointment_id=appointment.id,
                operation_type=OperationType.create,
                attempt_number=attempt,
                status=operation_status_for(retry_exc),
                request_payload=_slot_payload(appointment),
                error=last_error,
                correlation_id=appointment.correlation_id,
            )
            failure = classify(retry_exc)
            if failure == FailureClass.NOT_RETRYABLE_VALIDATION:
                return _fail_booking(
                    session,
                    appointment,
                    actor_user_id,
                    f"Vendor rejected booking: {retry_exc}",
                )
            found, lookup_error = _safe_key_lookup(integration, key)
            if not _lookup_miss(lookup_error):
                assert lookup_error is not None
                _park_sync_pending(session, appointment, actor_user_id)
                operations.open_record(
                    session,
                    appointment=appointment,
                    operation=latest_op,
                    error="Create outcome unknown; key lookup failed: "
                    f"{type(lookup_error).__name__}: {lookup_error}",
                    attempts=attempt,
                )
                session.commit()
                return appointment
            if found is not None:
                adopted, mismatches = sync_service.adopt_external(
                    session, appointment, found, actor_user_id=actor_user_id
                )
                if mismatches:
                    operations.open_record(
                        session,
                        appointment=adopted,
                        operation=latest_op,
                        error="Vendor holds a divergent record for this key: "
                        f"{mismatches}",
                        attempts=attempt,
                        external_id=found.external_id,
                        external_status=found.status,
                    )
                session.commit()
                return adopted
            continue
        latest_op = operations.record_operation(
            session,
            appointment_id=appointment.id,
            operation_type=OperationType.create,
            attempt_number=attempt,
            status=OperationStatus.succeeded,
            request_payload=_slot_payload(appointment),
            response_payload={
                "external_id": external.external_id,
                "status": external.status,
            },
            correlation_id=appointment.correlation_id,
        )
        adopted, mismatches = sync_service.adopt_external(
            session, appointment, external, actor_user_id=actor_user_id
        )
        if mismatches:
            operations.open_record(
                session,
                appointment=adopted,
                operation=latest_op,
                error=f"Vendor confirmed a divergent record: {mismatches}",
                attempts=attempt,
                external_id=external.external_id,
                external_status=external.status,
            )
        session.commit()
        return adopted

    operations.open_record(
        session,
        appointment=appointment,
        operation=latest_op,
        error=f"Vendor create failed after {attempt} attempt(s); last: {last_error}",
        attempts=attempt,
    )
    transition(
        session,
        appointment,
        AppointmentState.reconciliation_required,
        actor_user_id=actor_user_id,
        reason="Create outcome unknown after retries",
        correlation_id=appointment.correlation_id,
    )
    session.commit()
    return appointment


def handle_update_failure(
    session: Session,
    appointment: Appointment,
    new_start,
    new_end,
    exc: EHRConnectorError,
    *,
    integration: IntegrationService,
    actor_user_id: uuid.UUID,
) -> Appointment:
    """Recover a failed vendor reschedule from what the vendor holds.

    Vendor already moved -> finalize locally. Vendor never moved ->
    release the new hold, original stands. Anything else -> park with
    both holds kept (releasing either would risk double-booking).
    """
    attempt = operations.next_attempt_number(
        session, appointment.id, OperationType.update
    )
    latest_op = operations.record_operation(
        session,
        appointment_id=appointment.id,
        operation_type=OperationType.update,
        attempt_number=attempt,
        status=operation_status_for(exc),
        request_payload={
            "new_slot_start": as_utc(new_start).isoformat(),
            "new_slot_end": as_utc(new_end).isoformat(),
        },
        error=f"{type(exc).__name__}: {exc}",
        correlation_id=appointment.correlation_id,
    )
    if classify(exc) == FailureClass.NOT_RETRYABLE_VALIDATION:
        release_appointment_hold(session, appointment.doctor_id, new_start, new_end)
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Vendor rejected the reschedule; booking unchanged",
        )
    try:
        current = integration.get_appointment(appointment.external_id)
    except EHRConnectorError as lookup_exc:
        operations.open_record(
            session,
            appointment=appointment,
            operation=latest_op,
            error=f"Reschedule outcome unknown: {exc}; re-read failed: {lookup_exc}",
            attempts=attempt,
            external_id=appointment.external_id,
        )
        session.commit()
        return appointment
    if as_utc(current.start) == as_utc(new_start) and as_utc(current.end) == as_utc(
        new_end
    ):
        old_start, old_end = appointment.slot_start, appointment.slot_end
        appointment.slot_start = as_utc(new_start)
        appointment.slot_end = as_utc(new_end)
        release_appointment_hold(session, appointment.doctor_id, old_start, old_end)
        transition(
            session,
            appointment,
            AppointmentState.rescheduled,
            actor_user_id=actor_user_id,
            correlation_id=appointment.correlation_id,
        )
        linkage = [
            f
            for f in sync_service.diff_appointment(session, appointment, current)
            if f not in ("slot_start", "slot_end")
        ]
        if linkage:
            operations.open_record(
                session,
                appointment=appointment,
                operation=latest_op,
                error=f"Vendor moved the slot but linkage diverges: {linkage}",
                attempts=attempt,
                external_id=current.external_id,
                external_status=current.status,
            )
        session.commit()
        return appointment
    if as_utc(current.start) == as_utc(appointment.slot_start) and as_utc(
        current.end
    ) == as_utc(appointment.slot_end):
        release_appointment_hold(session, appointment.doctor_id, new_start, new_end)
        session.commit()
        return appointment
    operations.open_record(
        session,
        appointment=appointment,
        operation=latest_op,
        error="Vendor holds neither the old nor the new slot; both holds kept",
        attempts=attempt,
        external_id=current.external_id,
        external_status=current.status,
    )
    session.commit()
    return appointment


def handle_cancel_failure(
    session: Session,
    appointment: Appointment,
    exc: EHRConnectorError,
    *,
    integration: IntegrationService,
    actor_user_id: uuid.UUID,
) -> Appointment:
    """Recover a failed vendor cancellation from what the vendor holds."""
    attempt = operations.next_attempt_number(
        session, appointment.id, OperationType.cancel
    )
    latest_op = operations.record_operation(
        session,
        appointment_id=appointment.id,
        operation_type=OperationType.cancel,
        attempt_number=attempt,
        status=operation_status_for(exc),
        request_payload={"external_id": appointment.external_id},
        error=f"{type(exc).__name__}: {exc}",
        correlation_id=appointment.correlation_id,
    )
    if classify(exc) == FailureClass.NOT_RETRYABLE_VALIDATION:
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Vendor rejected the cancellation; booking unchanged",
        )
    try:
        current = integration.get_appointment(appointment.external_id)
    except EHRConnectorError as lookup_exc:
        operations.open_record(
            session,
            appointment=appointment,
            operation=latest_op,
            error=f"Cancel outcome unknown: {exc}; re-read failed: {lookup_exc}",
            attempts=attempt,
            external_id=appointment.external_id,
        )
        session.commit()
        return appointment
    if current.status == "cancelled":
        release_appointment_hold(
            session,
            appointment.doctor_id,
            appointment.slot_start,
            appointment.slot_end,
        )
        transition(
            session,
            appointment,
            AppointmentState.cancelled,
            actor_user_id=actor_user_id,
            correlation_id=appointment.correlation_id,
        )
        session.commit()
        return appointment
    operations.open_record(
        session,
        appointment=appointment,
        operation=latest_op,
        error=f"Vendor still shows status={current.status}; booking kept",
        attempts=attempt,
        external_id=current.external_id,
        external_status=current.status,
    )
    session.commit()
    return appointment


def _open_record_unless_open(
    session: Session, appointment: Appointment, **kwargs
) -> ReconciliationRecord:
    """Open a record unless the queue already tracks this appointment.

    Retries re-drive the same divergence; the queue should gain evidence
    (operation rows), not duplicate work items.
    """
    existing = (
        session.query(ReconciliationRecord)
        .filter(
            ReconciliationRecord.appointment_id == appointment.id,
            ReconciliationRecord.resolution_status.in_(
                (ResolutionStatus.open, ResolutionStatus.retrying)
            ),
        )
        .first()
    )
    if existing is not None:
        return existing
    return operations.open_record(session, appointment=appointment, **kwargs)


def drive_recovery(    session: Session,
    appointment: Appointment,
    integration: IntegrationService,
    *,
    actor_user_id: uuid.UUID,
    force: bool = False,
    backoff_base_s: float = 0,
    max_retries: int = MAX_RETRIES,
) -> Appointment:
    """Operator re-drive for a parked (or diverged) appointment.

    Looks the vendor up first — adopting what exists — and only creates
    when the vendor provably has nothing and the attempt budget (or an
    explicit `force`) allows it. Returns the appointment in whatever
    state the vendor truth dictates; the caller decides record closure.
    """
    if appointment.state in (
        AppointmentState.pending,
        AppointmentState.sync_pending,
        AppointmentState.reconciliation_required,
    ):
        found, lookup_error = _safe_key_lookup(
            integration, appointment.idempotency_key
        )
        if lookup_error is not None:
            return appointment
        if found is not None:
            adopted, mismatches = sync_service.adopt_external(
                session, appointment, found, actor_user_id=actor_user_id
            )
            if mismatches:
                _open_record_unless_open(
                    session,
                    adopted,
                    operation=None,
                    error=f"Retry found a divergent vendor record: {mismatches}",
                    attempts=operations.next_attempt_number(
                        session, appointment.id, OperationType.create
                    )
                    - 1,
                    external_id=found.external_id,
                    external_status=found.status,
                )
            session.commit()
            return adopted
        spent = (
            operations.next_attempt_number(
                session, appointment.id, OperationType.create
            )
            - 1
        )
        if not force and spent >= max_retries:
            return appointment
        _park_sync_pending(session, appointment, actor_user_id)
        hospital, patient, doctor, _ = _care_team(session, appointment)
        attempt = operations.next_attempt_number(
            session, appointment.id, OperationType.create
        )
        try:
            external = integration.create_appointment(
                hospital=hospital,
                patient=patient,
                doctor=doctor,
                start=as_utc(appointment.slot_start),
                end=as_utc(appointment.slot_end),
                idempotency_key=appointment.idempotency_key,
                internal_appointment_id=appointment.id,
            )
        except EHRConnectorError as exc:
            operations.record_operation(
                session,
                appointment_id=appointment.id,
                operation_type=OperationType.create,
                attempt_number=attempt,
                status=operation_status_for(exc),
                request_payload=_slot_payload(appointment),
                error=f"{type(exc).__name__}: {exc}",
                correlation_id=appointment.correlation_id,
            )
            session.commit()
            return appointment
        operations.record_operation(
            session,
            appointment_id=appointment.id,
            operation_type=OperationType.create,
            attempt_number=attempt,
            status=OperationStatus.succeeded,
            request_payload=_slot_payload(appointment),
            response_payload={
                "external_id": external.external_id,
                "status": external.status,
            },
            correlation_id=appointment.correlation_id,
        )
        adopted, mismatches = sync_service.adopt_external(
            session, appointment, external, actor_user_id=actor_user_id
        )
        if mismatches:
            _open_record_unless_open(
                session,
                adopted,
                operation=None,
                error=f"Retry confirmed a divergent record: {mismatches}",
                attempts=attempt,
                external_id=external.external_id,
                external_status=external.status,
            )
        session.commit()
        return adopted
    return appointment


def resolve_record(
    session: Session,
    record: ReconciliationRecord,
    *,
    resolution: ResolutionStatus,
    note: str | None,
    actor_user_id: uuid.UUID,
) -> ReconciliationRecord:
    """Manually close an operator work item. Resolved/escalated only, with a note."""
    del actor_user_id
    if record.resolution_status == ResolutionStatus.resolved:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Record is already resolved",
        )
    if resolution not in (ResolutionStatus.resolved, ResolutionStatus.escalated):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Resolution must be resolved or escalated",
        )
    if not (note or "").strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A note is required to close a record",
        )
    operations.set_resolution(session, record, resolution, note=note.strip())
    session.commit()
    session.refresh(record)
    return record


def consistency_note(
    session: Session, appointment: Appointment, integration: IntegrationService
) -> str | None:
    """Non-None when vendor and internal agree again (safe to auto-close)."""
    if appointment.external_id is None:
        return None
    try:
        external = integration.get_appointment(appointment.external_id)
    except EHRConnectorError:
        return None
    if appointment.state == AppointmentState.cancelled:
        return (
            "Auto-resolved by retry: vendor confirms cancellation"
            if external.status == "cancelled"
            else None
        )
    if appointment.state in (
        AppointmentState.confirmed,
        AppointmentState.rescheduled,
    ):
        return (
            "Auto-resolved by retry: vendor matches internal state"
            if not sync_service.diff_appointment(session, appointment, external)
            else None
        )
    return None


__all__ = [
    "consistency_note",
    "drive_recovery",
    "handle_cancel_failure",
    "handle_create_failure",
    "handle_update_failure",
    "resolve_record",
]
