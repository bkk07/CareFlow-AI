"""Mock EHR request/response schemas (vendor REST shape)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.integration.mock_ehr.fault_injection import FaultMode


class PatientLookupIn(BaseModel):
    mrn: str = Field(min_length=1, max_length=100)
    full_name: str = Field(default="", max_length=255)
    dob: date | None = None
    phone: str | None = Field(default=None, max_length=50)


class MockPatientOut(BaseModel):
    id: uuid.UUID
    mrn: str
    full_name: str
    dob: date | None
    phone: str | None


class ProviderLookupIn(BaseModel):
    provider_code: str = Field(min_length=1, max_length=100)
    full_name: str = Field(default="", max_length=255)
    specialty: str | None = Field(default=None, max_length=255)


class MockProviderOut(BaseModel):
    id: uuid.UUID
    provider_code: str
    full_name: str
    specialty: str | None


class FacilityLookupIn(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(default="", max_length=255)


class MockFacilityOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class AppointmentCreateIn(BaseModel):
    patient_id: uuid.UUID
    provider_id: uuid.UUID
    facility_id: uuid.UUID | None = None
    start_datetime: datetime
    end_datetime: datetime
    idempotency_key: str = Field(min_length=1, max_length=100)


class AppointmentUpdateIn(BaseModel):
    start_datetime: datetime
    end_datetime: datetime


class MockAppointmentOut(BaseModel):
    id: uuid.UUID
    patient_id: uuid.UUID
    provider_id: uuid.UUID
    facility_id: uuid.UUID | None
    start_datetime: datetime
    end_datetime: datetime
    status: str
    idempotency_key: str | None


class FaultModeIn(BaseModel):
    mode: FaultMode


class FaultModeOut(BaseModel):
    mode: FaultMode
