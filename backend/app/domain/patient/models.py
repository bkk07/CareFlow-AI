"""Patient preference + contact models.

Preferences are keyed by patient user id only — never by hospital. Patient
identity stays hospital-agnostic; per-hospital scoping lives on the
appointment side, not here. Reference columns are plain UUIDs (no FKs) so
preferences survive config renames and deletions; existence is validated
on write instead.

`PatientProfile` holds the real-world identity used by the telephone
channel (Phase 14): a normalized phone number for inbound caller lookup
plus the full name / date of birth the agent confirms out loud before
any patient data tool may run.
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, Float, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TimeOfDay(str, enum.Enum):
    morning = "morning"
    afternoon = "afternoon"
    evening = "evening"


class ConsultationMode(str, enum.Enum):
    in_person = "in_person"
    video = "video"
    phone = "phone"


class UserPreferences(Base):
    __tablename__ = "user_preferences"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    patient_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False, unique=True, index=True
    )
    preferred_doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True
    )
    preferred_hospital_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True
    )
    preferred_appointment_type_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True
    )
    preferred_time_of_day: Mapped[TimeOfDay | None] = mapped_column(
        Enum(TimeOfDay, name="time_of_day", validate_strings=True), nullable=True
    )
    preferred_consultation_mode: Mapped[ConsultationMode | None] = mapped_column(
        Enum(ConsultationMode, name="consultation_mode", validate_strings=True),
        nullable=True,
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


class PatientProfile(Base):
    """Real-world identity for the telephone channel.

    `phone` stores digits only (E.164 without the leading "+"), so
    "+1 (555) 0100" and "15550100" match the same row. Name/DOB are
    compared case-insensitively by the identity service, never by SQL.
    """

    __tablename__ = "patient_profiles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    patient_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False, unique=True, index=True
    )
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Patient's saved city, captured once and reused for "nearby" suggestions.
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Precise home location from "Use my location" (WGS84). Nullable: older
    # rows and city-only profiles fall back to city ranking. Powers
    # distance-based doctor/hospital ordering in search tools + chat.
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


__all__ = ["Base", "ConsultationMode", "PatientProfile", "TimeOfDay", "UserPreferences"]
