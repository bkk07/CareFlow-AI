"""Hospital configuration schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class NamedCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class NamedUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class NamedOut(BaseModel):
    id: uuid.UUID
    hospital_id: uuid.UUID
    name: str
    created_at: datetime
    updated_at: datetime


DepartmentCreateIn = NamedCreateIn
DepartmentUpdateIn = NamedUpdateIn


class DepartmentOut(NamedOut):
    pass


SpecialtyCreateIn = NamedCreateIn
SpecialtyUpdateIn = NamedUpdateIn


class SpecialtyOut(NamedOut):
    pass


class AppointmentTypeCreateIn(NamedCreateIn):
    duration_minutes: int = Field(gt=0)
    compatible_specialty_ids: list[uuid.UUID] = Field(default_factory=list)


class AppointmentTypeUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    duration_minutes: int = Field(gt=0)
    compatible_specialty_ids: list[uuid.UUID] = Field(default_factory=list)


class AppointmentTypeOut(NamedOut):
    duration_minutes: int
    compatible_specialty_ids: list[str]
