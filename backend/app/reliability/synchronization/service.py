"""State synchronization: vendor truth -> internal rows.

`diff_appointment` is the single matcher everything trusts: slot times
always compare; patient/provider linkage compares only when both sides
are known (right after a timeout our mapping rows may not exist yet, so
absence must never read as divergence). `adopt_external` confirms an
appointment from a vendor record found by idempotency key — the
query-then-confirm half of "never blindly retry".
"""

import uuid

from sqlalchemy.orm import Session

from app.domain.appointment.models import (
    Appointment,
    AppointmentHistory,
    AppointmentState,
)
from app.domain.appointment.state_machine import transition
from app.domain.scheduling.availability import as_utc
from app.integration.connector_interface import ExternalAppointment
from app.integration.mapping.models import MappingEntityType
from app.integration.mapping.service import get_mapping, get_or_create_mapping


def expected_linkage(
    session: Session, appointment: Appointment
) -> tuple[str | None, str | None]:
    """(patient_external_id, provider_external_id) from our mappings."""
    patient = get_mapping(
        session,
        appointment.hospital_id,
        MappingEntityType.patient,
        appointment.patient_id,
    )
    provider = get_mapping(
        session,
        appointment.hospital_id,
        MappingEntityType.doctor,
        appointment.doctor_id,
    )
    return (
        patient.external_id if patient is not None else None,
        provider.external_id if provider is not None else None,
    )


def diff_appointment(
    session: Session, appointment: Appointment, external: ExternalAppointment
) -> list[str]:
    """Field names where the vendor record diverges from internal state."""
    fields: list[str] = []
    if as_utc(external.start) != as_utc(appointment.slot_start):
        fields.append("slot_start")
    if as_utc(external.end) != as_utc(appointment.slot_end):
        fields.append("slot_end")
    want_patient, want_provider = expected_linkage(session, appointment)
    if (
        external.patient_external_id is not None
        and want_patient is not None
        and external.patient_external_id != want_patient
    ):
        fields.append("patient")
    if (
        external.provider_external_id is not None
        and want_provider is not None
        and external.provider_external_id != want_provider
    ):
        fields.append("provider")
    return fields


def ensure_appointment_mapping(
    session: Session, appointment: Appointment, external_id: str
) -> None:
    get_or_create_mapping(
        session,
        appointment.hospital_id,
        MappingEntityType.appointment,
        appointment.id,
        external_id=external_id,
    )


def was_rescheduled(session: Session, appointment: Appointment) -> bool:
    return (
        session.query(AppointmentHistory)
        .filter(
            AppointmentHistory.appointment_id == appointment.id,
            AppointmentHistory.to_state == AppointmentState.rescheduled,
        )
        .count()
        > 0
    )


def adopt_external(
    session: Session,
    appointment: Appointment,
    external: ExternalAppointment,
    *,
    actor_user_id: uuid.UUID,
) -> tuple[Appointment, list[str]]:
    """Adopt a vendor record found by idempotency key.

    Match -> confirm (returning rescheduled bookings to `rescheduled`,
    everything else to `confirmed`; already-live rows just gain a
    verified link). Divergence -> park in `reconciliation_required`
    where the map allows, else hold state and let the caller open a
    record. Returns (appointment, mismatches).
    """
    ensure_appointment_mapping(session, appointment, external.external_id)
    if appointment.external_id is None:
        appointment.external_id = external.external_id
    mismatches = diff_appointment(session, appointment, external)
    if not mismatches:
        if appointment.state in (
            AppointmentState.pending,
            AppointmentState.sync_pending,
        ):
            transition(
                session,
                appointment,
                AppointmentState.confirmed,
                actor_user_id=actor_user_id,
                correlation_id=appointment.correlation_id,
            )
        elif appointment.state == AppointmentState.reconciliation_required:
            target = (
                AppointmentState.rescheduled
                if was_rescheduled(session, appointment)
                else AppointmentState.confirmed
            )
            transition(
                session,
                appointment,
                target,
                actor_user_id=actor_user_id,
                correlation_id=appointment.correlation_id,
            )
        return appointment, mismatches
    if appointment.state == AppointmentState.pending:
        transition(
            session,
            appointment,
            AppointmentState.sync_pending,
            actor_user_id=actor_user_id,
            correlation_id=appointment.correlation_id,
        )
    if appointment.state == AppointmentState.sync_pending:
        transition(
            session,
            appointment,
            AppointmentState.reconciliation_required,
            actor_user_id=actor_user_id,
            correlation_id=appointment.correlation_id,
        )
    elif appointment.state == AppointmentState.rescheduled:
        transition(
            session,
            appointment,
            AppointmentState.reconciliation_required,
            actor_user_id=actor_user_id,
            correlation_id=appointment.correlation_id,
        )
    return appointment, mismatches
