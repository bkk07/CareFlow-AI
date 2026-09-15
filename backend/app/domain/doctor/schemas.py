"""Doctor schemas."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.domain.doctor.models import DoctorStatus


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
    external_provider_id: str | None = Field(default=None, max_length=255)


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
    external_provider_id: str | None = Field(default=None, max_length=255)


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
    external_provider_id: str | None
    status: DoctorStatus
    created_at: datetime
    updated_at: datetime
