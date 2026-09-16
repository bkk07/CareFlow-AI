"""Patient schemas (self-scoped: everything keys off the caller)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

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
