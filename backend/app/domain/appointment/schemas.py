"""Appointment schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.domain.appointment.models import AppointmentState


class AppointmentCreateIn(BaseModel):
    patient_id: uuid.UUID
    doctor_id: uuid.UUID
    appointment_type_id: uuid.UUID
    slot_start: datetime
    slot_end: datetime
    idempotency_key: str = Field(min_length=1, max_length=100)
    consultation_mode: str | None = Field(default=None, max_length=20)


class RescheduleIn(BaseModel):
    slot_start: datetime
    slot_end: datetime
    reason: str | None = Field(default=None, max_length=500)


class CancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class AppointmentHistoryOut(BaseModel):
    id: uuid.UUID
    appointment_id: uuid.UUID
    from_state: AppointmentState
    to_state: AppointmentState
    actor_user_id: uuid.UUID | None
    actor_system: str | None
    reason: str | None
    correlation_id: uuid.UUID
    created_at: datetime


class AppointmentOut(BaseModel):
    id: uuid.UUID
    hospital_id: uuid.UUID
    patient_id: uuid.UUID
    doctor_id: uuid.UUID
    appointment_type_id: uuid.UUID
    slot_start: datetime
    slot_end: datetime
    state: AppointmentState
    external_id: str | None
    idempotency_key: str
    consultation_mode: str | None = None
    correlation_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AppointmentDetailOut(AppointmentOut):
    history: list[AppointmentHistoryOut]
