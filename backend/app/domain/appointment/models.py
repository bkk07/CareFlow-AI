"""Appointment Core models: appointments + immutable transition history.

An Appointment is the internal booking record. `external_id` links the
vendor-side record (written by the IntegrationService on success);
`idempotency_key` is globally unique so a retried booking replays to the
same row instead of double-booking. Every state change appends an
AppointmentHistory row — history is append-only, never updated.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AppointmentState(str, enum.Enum):
    requested = "requested"
    pending = "pending"
    confirmed = "confirmed"
    rescheduled = "rescheduled"
    cancelled = "cancelled"
    completed = "completed"
    no_show = "no_show"
    failed = "failed"
    sync_pending = "sync_pending"
    reconciliation_required = "reconciliation_required"


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        # Idempotency backstop: two rows can never share a key, so a
        # retried create collapses to the existing appointment.
        UniqueConstraint("idempotency_key"),
        # R1: fast per-doctor overlap scans used by the booking guard.
        # Partial overlaps cannot be a UNIQUE (they are ranges, not discrete
        # slots) — the check+insert atomicity in reserve_slot plus this
        # index is the guard; PostgreSQL deployments can additionally add
        # an EXCLUDE USING gist constraint out-of-band.
        Index("ix_appointments_doctor_slot", "doctor_id", "slot_start", "slot_end"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hospital_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("hospitals.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    doctor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("doctors.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    appointment_type_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("appointment_types.id", ondelete="RESTRICT"),
        nullable=False,
    )
    slot_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    slot_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # How the visit happens (in_person/video/phone). Mirrors the doctor's
    # consultation_types at booking time; NULL means "not specified"
    # (bookings made before the field existed or without a mode).
    consultation_mode: Mapped[str | None] = mapped_column(
        String(20), nullable=True, default=None
    )
    state: Mapped[AppointmentState] = mapped_column(
        Enum(AppointmentState, name="appointment_state", validate_strings=True),
        nullable=False,
        default=AppointmentState.pending,
        index=True,
    )
    external_id: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True
    )
    idempotency_key: Mapped[str] = mapped_column(
        String(100), nullable=False, unique=True, index=True
    )
    correlation_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class AppointmentHistory(Base):
    __tablename__ = "appointment_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_state: Mapped[AppointmentState] = mapped_column(
        Enum(AppointmentState, name="appointment_state", validate_strings=True),
        nullable=False,
    )
    to_state: Mapped[AppointmentState] = mapped_column(
        Enum(AppointmentState, name="appointment_state", validate_strings=True),
        nullable=False,
    )
    # Exactly one actor is set: the user who acted, or a system component.
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_system: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    correlation_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


__all__ = ["Appointment", "AppointmentHistory", "AppointmentState", "Base"]
