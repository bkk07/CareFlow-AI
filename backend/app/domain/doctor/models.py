"""Doctor models."""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DoctorStatus(str, enum.Enum):
    invited = "invited"
    active = "active"
    inactive = "inactive"
    suspended = "suspended"


class Doctor(Base):
    __tablename__ = "doctors"
    __table_args__ = (
        # External provider IDs map doctors to EHR providers later — unique
        # per hospital from day one. (Multiple NULLs are allowed.)
        UniqueConstraint("hospital_id", "external_provider_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hospital_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    photo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    specialty_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("specialties.id", ondelete="RESTRICT"), nullable=True
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("departments.id", ondelete="RESTRICT"), nullable=True
    )
    qualifications: Mapped[dict[str, Any]] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=False, default=dict
    )
    experience_years: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    languages: Mapped[list[str]] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=False, default=list
    )
    consultation_types: Mapped[list[str]] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=False, default=list
    )
    default_duration_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, default=30
    )
    external_provider_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    status: Mapped[DoctorStatus] = mapped_column(
        Enum(DoctorStatus, name="doctor_status", validate_strings=True),
        nullable=False,
        default=DoctorStatus.invited,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


__all__ = ["Base", "Doctor", "DoctorStatus"]
