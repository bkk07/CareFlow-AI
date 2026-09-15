"""Hospital onboarding schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.domain.hospital.models import HospitalStatus


class HospitalCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    address: str = Field(min_length=1, max_length=500)
    contact_email: EmailStr
    contact_phone: str = Field(min_length=1, max_length=50)
    admin_email: EmailStr
    admin_password: str = Field(min_length=8, max_length=128)


class ReviewDecisionIn(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class HospitalOut(BaseModel):
    id: uuid.UUID
    name: str
    address: str
    contact_email: str
    contact_phone: str
    status: HospitalStatus
    submitted_at: datetime | None
    reviewed_at: datetime | None
    reviewed_by: uuid.UUID | None
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime
