"""Mock EHR tables — the vendor side of the world (prefixed `mock_ehr_`).

Nothing outside `app/integration` may touch these tables; production code
only sees them through the EHRConnector interface.
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class MockAppointmentStatus(str, enum.Enum):
    scheduled = "scheduled"
    cancelled = "cancelled"


class MockPatient(Base):
    __tablename__ = "mock_ehr_patients"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    mrn: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)


class MockProvider(Base):
    __tablename__ = "mock_ehr_providers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    provider_code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    specialty: Mapped[str | None] = mapped_column(String(255), nullable=True)


class MockFacility(Base):
    __tablename__ = "mock_ehr_facilities"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class MockDepartment(Base):
    """Vendor department hierarchy. Present for data-model completeness;
    appointment flows in this mock reference provider + facility only."""

    __tablename__ = "mock_ehr_departments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    facility_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("mock_ehr_facilities.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class MockAppointment(Base):
    __tablename__ = "mock_ehr_appointments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("mock_ehr_patients.id", ondelete="RESTRICT"), nullable=False
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("mock_ehr_providers.id", ondelete="RESTRICT"), nullable=False
    )
    facility_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("mock_ehr_facilities.id", ondelete="RESTRICT"),
        nullable=True,
    )
    start_datetime: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    end_datetime: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=MockAppointmentStatus.scheduled.value
    )
    # The linchpin of safe retries: creates with a repeated key return the
    # existing row instead of a duplicate, and unknown outcomes are resolved
    # by looking the key back up.
    idempotency_key: Mapped[str | None] = mapped_column(
        String(100), nullable=True, unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


__all__ = [
    "Base",
    "MockAppointment",
    "MockAppointmentStatus",
    "MockDepartment",
    "MockFacility",
    "MockPatient",
    "MockProvider",
]
