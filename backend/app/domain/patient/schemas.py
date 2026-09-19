"""Patient schemas (self-scoped: everything keys off the caller)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field

from app.domain.appointment.models import AppointmentState
from app.domain.appointment.schemas import AppointmentHistoryOut
from app.domain.auth.models import Role
from app.domain.patient.models import ConsultationMode, TimeOfDay


class PatientOut(BaseModel):
    id: uuid.UUID
    email: str
    role: Role
    hospital_id: uuid.UUID | None
    is_active: bool
    created_at: datetime


class PatientUpdateIn(BaseModel):
    email: EmailStr


class PreferencesOut(BaseModel):
    patient_user_id: uuid.UUID
    preferred_doctor_id: uuid.UUID | None
    preferred_hospital_id: uuid.UUID | None
    preferred_appointment_type_id: uuid.UUID | None
    preferred_time_of_day: TimeOfDay | None
    preferred_consultation_mode: ConsultationMode | None
    updated_at: datetime


class PreferencesUpdateIn(BaseModel):
    preferred_doctor_id: uuid.UUID | None = Field(default=None)
    preferred_hospital_id: uuid.UUID | None = Field(default=None)
    preferred_appointment_type_id: uuid.UUID | None = Field(default=None)
    preferred_time_of_day: TimeOfDay | None = Field(default=None)
    preferred_consultation_mode: ConsultationMode | None = Field(default=None)


class ContactOut(BaseModel):
    patient_user_id: uuid.UUID
    phone: str | None
    full_name: str | None
    date_of_birth: date | None
    city: str | None
    latitude: float | None = None
    longitude: float | None = None
    updated_at: datetime


class ContactUpdateIn(BaseModel):
    phone: str | None = Field(default=None, max_length=32)
    full_name: str | None = Field(default=None, max_length=255)
    date_of_birth: date | None = Field(default=None)
    city: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    def model_post_init(self, _context) -> None:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")


class PatientAppointmentOut(BaseModel):
    """One appointment with display names joined in — the patient portal
    list/detail view without extra lookups."""

    id: uuid.UUID
    doctor_id: uuid.UUID
    doctor_name: str
    doctor_photo_url: str | None
    specialty: str | None
    department: str | None
    hospital_id: uuid.UUID
    hospital_name: str
    appointment_type_id: uuid.UUID
    appointment_type_name: str
    duration_minutes: int
    slot_start: datetime
    slot_end: datetime
    state: AppointmentState
    consultation_mode: str | None = None
    created_at: datetime
    updated_at: datetime


class PatientAppointmentDetailOut(PatientAppointmentOut):
    history: list[AppointmentHistoryOut]
