"""Appointment endpoints (internal-facing; wrapped as MCP tools in Phase 9).

Mutations are open to the owning patient and to hospital_admins of the
appointment's hospital. Reads additionally allow the owning doctor and
platform_admin.
`get_integration_service` is a dependency (not a singleton) so tests can
inject a stub connector while production uses real HTTP.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.appointment import service
from app.domain.appointment.models import (
    Appointment,
    AppointmentHistory,
    AppointmentState,
)
from app.domain.appointment.schemas import (
    AppointmentCreateIn,
    AppointmentDetailOut,
    AppointmentHistoryOut,
    AppointmentOut,
    CancelIn,
    RescheduleIn,
)
from app.domain.appointment.state_machine import InvalidTransition
from app.domain.auth.models import Role
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.domain.hospital.service import assert_hospital_approved, get_hospital_or_404
from app.integration.integration_service import IntegrationService

router = APIRouter(tags=["appointments"])

_booker = require_role(Role.patient, Role.hospital_admin)
_reader = require_role(
    Role.patient, Role.hospital_admin, Role.platform_admin, Role.doctor
)


def get_integration_service(db: Session = Depends(get_db)) -> IntegrationService:
    return IntegrationService(session=db)


def _resolve_booking_scope(
    db: Session, ctx: RequestContext, doctor_id: uuid.UUID
) -> tuple[Hospital, Doctor]:
    doctor = db.get(Doctor, doctor_id)
    if doctor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Doctor not found"
        )
    hospital = get_hospital_or_404(db, doctor.hospital_id)
    if ctx.role == Role.hospital_admin and ctx.hospital_id != hospital.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to book for this hospital",
        )
    # Booking (and moving) a slot requires a live hospital, for admins
    # and patients alike.
    return assert_hospital_approved(hospital), doctor


def _check_appointment_access(
    ctx: RequestContext, appointment: Appointment, db: Session | None = None
) -> None:
    """Shared access gate (also imported by MCP tools with (ctx, appointment)).

    Doctors see only their own linked calendar's appointments, which needs
    `db`; callers without a session (MCP tools today run with one too, but
    the parameter stays optional for compatibility) deny doctor access.
    """
    if ctx.role == Role.platform_admin:
        return
    if ctx.role == Role.patient and appointment.patient_id == ctx.user_id:
        return
    if (
        ctx.role == Role.hospital_admin
        and ctx.hospital_id == appointment.hospital_id
    ):
        return
    if ctx.role == Role.doctor and db is not None:
        # Doctors see only their own linked calendar's appointments.
        from app.domain.doctor import dashboard as doctor_dashboard

        try:
            linked = doctor_dashboard.get_linked_doctor(db, ctx)
        except HTTPException:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not allowed to access this appointment",
            ) from None
        if appointment.doctor_id == linked.id:
            return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Not allowed to access this appointment",
    )


def _history_out(rows: list[AppointmentHistory]) -> list[AppointmentHistoryOut]:
    return [
        AppointmentHistoryOut(
            id=row.id,
            appointment_id=row.appointment_id,
            from_state=row.from_state,
            to_state=row.to_state,
            actor_user_id=row.actor_user_id,
            actor_system=row.actor_system,
            reason=row.reason,
            correlation_id=row.correlation_id,
            created_at=row.created_at,
        )
        for row in rows
    ]


def _history_for(db: Session, appointment_id: uuid.UUID) -> list[AppointmentHistoryOut]:
    rows = (
        db.query(AppointmentHistory)
        .filter(AppointmentHistory.appointment_id == appointment_id)
        .order_by(AppointmentHistory.created_at)
        .all()
    )
    return _history_out(rows)


@router.post("/appointments", response_model=AppointmentOut, status_code=201)
def book_appointment(
    body: AppointmentCreateIn,
    response: Response,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_booker),
    integration: IntegrationService = Depends(get_integration_service),
) -> Appointment:
    hospital, doctor = _resolve_booking_scope(db, ctx, body.doctor_id)
    if ctx.role == Role.patient and body.patient_id != ctx.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Patients can only book for themselves",
        )
    patient = service.get_scoped_patient(db, body.patient_id)
    appt_type = service.get_scoped_type(db, hospital, body.appointment_type_id)
    appointment, created = service.create_appointment(
        db,
        hospital=hospital,
        patient=patient,
        doctor=doctor,
        appointment_type=appt_type,
        slot_start=body.slot_start,
        slot_end=body.slot_end,
        idempotency_key=body.idempotency_key,
        actor_user_id=ctx.user_id,
        integration=integration,
        consultation_mode=body.consultation_mode,
    )
    if appointment.state == AppointmentState.failed:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "appointment_id": str(appointment.id),
                "error": "Vendor booking failed; appointment marked failed",
            },
        )
    if appointment.state in (
        AppointmentState.sync_pending,
        AppointmentState.reconciliation_required,
    ):
        # Booked locally, vendor outcome still unknown — the slot stays
        # held while verification/reconciliation runs.
        response.status_code = status.HTTP_202_ACCEPTED
    elif not created:
        # Idempotent replay answers 200 with the same row.
        response.status_code = status.HTTP_200_OK
    return appointment


@router.get("/appointments", response_model=list[AppointmentOut])
def list_appointments(
    patient_id: uuid.UUID | None = None,
    doctor_id: uuid.UUID | None = None,
    hospital_id: uuid.UUID | None = None,
    state: AppointmentState | None = None,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_reader),
) -> list:
    if ctx.role == Role.patient:
        if patient_id is not None and patient_id != ctx.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Patients can only list their own appointments",
            )
        patient_id = ctx.user_id
    elif ctx.role == Role.doctor:
        from app.domain.doctor import dashboard as doctor_dashboard

        linked = doctor_dashboard.get_linked_doctor(db, ctx)
        if doctor_id is not None and doctor_id != linked.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Doctors can only list their own appointments",
            )
        doctor_id = linked.id
        if patient_id is not None:
            # Patient filter is allowed (search within own calendar).
            pass
    elif ctx.role == Role.hospital_admin:
        if hospital_id is not None and hospital_id != ctx.hospital_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not allowed to list this hospital",
            )
        hospital_id = ctx.hospital_id
        if doctor_id is not None:
            doctor = db.get(Doctor, doctor_id)
            if doctor is None or doctor.hospital_id != ctx.hospital_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Doctor not found in this hospital",
                )
    return service.list_appointments(
        db,
        hospital_id=hospital_id,
        patient_id=patient_id,
        doctor_id=doctor_id,
        state=state,
    )


@router.get("/appointments/{appointment_id}", response_model=AppointmentDetailOut)
def get_appointment(
    appointment_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_reader),
) -> AppointmentDetailOut:
    appointment = service.get_appointment_or_404(db, appointment_id)
    _check_appointment_access(ctx, appointment, db)
    history = _history_for(db, appointment.id)
    return AppointmentDetailOut(
        id=appointment.id,
        hospital_id=appointment.hospital_id,
        patient_id=appointment.patient_id,
        doctor_id=appointment.doctor_id,
        appointment_type_id=appointment.appointment_type_id,
        slot_start=appointment.slot_start,
        slot_end=appointment.slot_end,
        state=appointment.state,
        external_id=appointment.external_id,
        idempotency_key=appointment.idempotency_key,
        consultation_mode=appointment.consultation_mode,
        correlation_id=appointment.correlation_id,
        created_at=appointment.created_at,
        updated_at=appointment.updated_at,
        history=history,
    )


@router.post(
    "/appointments/{appointment_id}/reschedule", response_model=AppointmentOut
)
def reschedule_appointment(
    appointment_id: uuid.UUID,
    body: RescheduleIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_booker),
    integration: IntegrationService = Depends(get_integration_service),
) -> Appointment:
    appointment = service.get_appointment_or_404(db, appointment_id)
    _check_appointment_access(ctx, appointment, db)
    hospital = get_hospital_or_404(db, appointment.hospital_id)
    try:
        return service.reschedule_appointment(
            db,
            appointment=appointment,
            hospital=hospital,
            new_start=body.slot_start,
            new_end=body.slot_end,
            actor_user_id=ctx.user_id,
            integration=integration,
            reason=body.reason,
        )
    except InvalidTransition as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc


@router.post("/appointments/{appointment_id}/cancel", response_model=AppointmentOut)
def cancel_appointment(
    appointment_id: uuid.UUID,
    body: CancelIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_booker),
    integration: IntegrationService = Depends(get_integration_service),
) -> Appointment:
    appointment = service.get_appointment_or_404(db, appointment_id)
    _check_appointment_access(ctx, appointment, db)
    try:
        return service.cancel_appointment(
            db,
            appointment=appointment,
            actor_user_id=ctx.user_id,
            integration=integration,
            reason=body.reason,
        )
    except InvalidTransition as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc


__all__ = ["get_integration_service", "router"]
