"""Hospital onboarding models."""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Enum, Float, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class HospitalStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    under_review = "under_review"
    approved = "approved"
    rejected = "rejected"
    suspended = "suspended"


class Hospital(Base):
    __tablename__ = "hospitals"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str] = mapped_column(String(500), nullable=False)
    contact_email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    contact_phone: Mapped[str] = mapped_column(String(50), nullable=False)
    # City the hospital sits in — powers "near me" ranking for patients.
    city: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    # Precise geo for distance-based recommendation. Nullable: older rows
    # and registrations without coordinates fall back to city ranking.
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Hospital-level operating hours: {"mon": ["09:00", "18:00"], ...}.
    # Days absent from the map are closed. Recorded at onboarding/setup;
    # slot calculation still derives from doctor calendars.
    operating_hours: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"), nullable=True
    )
    # Latest platform corrections request (set by request-corrections,
    # cleared on approve). Lets the hospital see what to fix.
    review_notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    status: Mapped[HospitalStatus] = mapped_column(
        Enum(HospitalStatus, name="hospital_status", validate_strings=True),
        nullable=False,
        default=HospitalStatus.submitted,
    )
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    @property
    def is_live(self) -> bool:
        """Only approved hospitals pass the go-live gate used by later flows."""
        return self.status == HospitalStatus.approved


__all__ = ["Base", "Hospital", "HospitalStatus"]
