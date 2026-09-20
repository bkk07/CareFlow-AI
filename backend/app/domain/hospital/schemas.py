"""Hospital onboarding schemas."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.domain.auth.models import Role
from app.domain.hospital.models import HospitalStatus


class HospitalCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    address: str = Field(min_length=1, max_length=500)
    contact_email: EmailStr
    contact_phone: str = Field(min_length=1, max_length=50)
    city: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    admin_email: EmailStr
    admin_password: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def _coords_come_in_pairs(self) -> "HospitalCreateIn":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        return self


class ReviewDecisionIn(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class CorrectionsIn(BaseModel):
    """Platform asks the hospital to fix its application before review."""

    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=1000)


WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def validate_operating_hours(value: dict | None) -> dict | None:
    """Weekly hours map: {"mon": ["09:00", "18:00"], ...}; absent = closed."""
    if value is None:
        return None
    import re

    if not isinstance(value, dict):
        raise ValueError("operating_hours must be an object")
    for day, span in value.items():
        if day not in WEEKDAYS:
            raise ValueError(f"unknown day: {day}")
        if (
            not isinstance(span, list)
            or len(span) != 2
            or not all(isinstance(t, str) and re.fullmatch(r"[0-2]\d:[0-5]\d", t) for t in span)
        ):
            raise ValueError(f"{day} must be [open, close] as HH:MM")
        if span[0] >= span[1]:
            raise ValueError(f"{day}: open must be before close")
    return value


class HospitalOut(BaseModel):
    id: uuid.UUID
    name: str
    address: str
    contact_email: str
    contact_phone: str
    city: str | None
    latitude: float | None
    longitude: float | None
    image_url: str | None
    operating_hours: dict | None
    review_notes: str | None
    status: HospitalStatus
    submitted_at: datetime | None
    reviewed_at: datetime | None
    reviewed_by: uuid.UUID | None
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime


class HospitalUpdateIn(BaseModel):
    """Self-service profile edit for a hospital admin.

    Status/lifecycle fields are deliberately absent — onboarding state
    moves only through the platform review endpoints.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    address: str | None = Field(default=None, min_length=1, max_length=500)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, min_length=1, max_length=50)
    city: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    image_url: str | None = Field(default=None, max_length=1000)
    operating_hours: dict | None = None

    @model_validator(mode="after")
    def _coords_come_in_pairs(self) -> "HospitalUpdateIn":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        return self

    @model_validator(mode="after")
    def _hours_well_formed(self) -> "HospitalUpdateIn":
        self.operating_hours = validate_operating_hours(self.operating_hours)
        return self


class StaffOut(BaseModel):
    id: uuid.UUID
    email: str
    role: Role
    hospital_id: uuid.UUID | None
    is_active: bool
    created_at: datetime


class StaffCreateIn(BaseModel):
    """Invite a staff login for this hospital.

    Only the hospital_admin role can be granted here — doctors get logins
    through the doctor profile link, and platform_admin is never granted
    by a hospital admin.
    """

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Literal["hospital_admin"] = "hospital_admin"
