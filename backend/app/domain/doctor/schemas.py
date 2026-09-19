"""Doctor schemas."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.domain.appointment.schemas import AppointmentOut
from app.domain.doctor.models import DoctorStatus
from app.domain.questionnaire.schemas import ResponseOut
from app.domain.scheduling.schemas import (
    AvailabilityRuleOut,
    BlockedSlotOut,
    CalendarOut,
)


class DoctorCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    photo_url: str | None = Field(default=None, max_length=1000)
    specialty_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    qualifications: dict[str, Any] = Field(default_factory=dict)
    experience_years: int = Field(default=0, ge=0)
    languages: list[str] = Field(default_factory=list)
    consultation_types: list[str] = Field(default_factory=list)
    default_duration_minutes: int = Field(default=30, gt=0)
    available_durations: list[int] | None = Field(default=None)
    external_provider_id: str | None = Field(default=None, max_length=255)
    user_id: uuid.UUID | None = None


class DoctorUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    photo_url: str | None = Field(default=None, max_length=1000)
    specialty_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    qualifications: dict[str, Any] | None = None
    experience_years: int | None = Field(default=None, ge=0)
    languages: list[str] | None = None
    consultation_types: list[str] | None = None
    default_duration_minutes: int | None = Field(default=None, gt=0)
    available_durations: list[int] | None = None
    external_provider_id: str | None = Field(default=None, max_length=255)
    user_id: uuid.UUID | None = None


class DoctorOut(BaseModel):
    id: uuid.UUID
    hospital_id: uuid.UUID
    name: str
    photo_url: str | None
    specialty_id: uuid.UUID | None
    department_id: uuid.UUID | None
    qualifications: dict[str, Any]
    experience_years: int
    languages: list[str]
    consultation_types: list[str]
    default_duration_minutes: int
    available_durations: list[int]
    external_provider_id: str | None
    user_id: uuid.UUID | None
    # Linked login's email for roster display. Populated by the service
    # layer as a transient attribute (never a column); None = no login yet.
    login_email: str | None = None
    status: DoctorStatus
    created_at: datetime
    updated_at: datetime


class DoctorInviteIn(BaseModel):
    """Create a portal login for a doctor and link it in one step."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class DoctorSelfUpdateIn(BaseModel):
    """Self-service profile edit for a doctor login.

    Restricted to presentation/practice fields only — specialty,
    department, status,     hospital linkage and login linkage stay
    hospital-admin managed.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    photo_url: str | None = Field(default=None, max_length=1000)
    qualifications: dict[str, Any] | None = None
    experience_years: int | None = Field(default=None, ge=0)
    languages: list[str] | None = None
    consultation_types: list[str] | None = None
    default_duration_minutes: int | None = Field(default=None, gt=0)
    available_durations: list[int] | None = None


class DoctorAppointmentOut(BaseModel):
    """Enriched appointment row for the doctor dashboard.

    Patient display names come from PatientProfile/User so the portal
    renders today/upcoming/detail without extra lookups.
    """

    id: uuid.UUID
    patient_id: uuid.UUID
    patient_name: str
    patient_email: str | None = None
    patient_phone: str | None = None
    doctor_id: uuid.UUID
    appointment_type_id: uuid.UUID
    appointment_type_name: str
    slot_start: datetime
    slot_end: datetime
    state: str
    consultation_mode: str | None = None
    created_at: datetime
    updated_at: datetime


class DoctorQuestionPrompt(BaseModel):
    """Question id -> prompt so the portal shows text, not UUIDs."""

    id: uuid.UUID
    prompt: str


class DoctorQuestionnaireItemOut(BaseModel):
    """One appointment with its questionnaire responses for the doctor inbox."""

    appointment_id: uuid.UUID
    patient_id: uuid.UUID
    patient_name: str
    slot_start: datetime
    slot_end: datetime
    state: str
    responses: list[ResponseOut]
    questions: list[DoctorQuestionPrompt] = Field(default_factory=list)
    has_questionnaire: bool = False


class DoctorCalendarOut(BaseModel):
    calendar: CalendarOut
    rules: list[AvailabilityRuleOut]
    blocks: list[BlockedSlotOut]
    live_appointments: list[AppointmentOut]
