"""Hospital configuration models: departments, specialties, appointment types."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class _HospitalScoped:
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hospital_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Department(_HospitalScoped, Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("hospital_id", "name"),)


class Specialty(_HospitalScoped, Base):
    __tablename__ = "specialties"
    __table_args__ = (UniqueConstraint("hospital_id", "name"),)


class AppointmentType(_HospitalScoped, Base):
    __tablename__ = "appointment_types"
    __table_args__ = (UniqueConstraint("hospital_id", "name"),)

    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    # Specialty UUIDs (as strings) this type may be booked with. An empty
    # list means universally compatible with all hospital specialties.
    compatible_specialty_ids: Mapped[list[str]] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=False, default=list
    )


__all__ = ["AppointmentType", "Base", "Department", "Specialty"]
