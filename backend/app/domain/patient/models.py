"""Patient preference models.

Preferences are keyed by patient user id only — never by hospital. Patient
identity stays hospital-agnostic; per-hospital scoping lives on the
appointment side, not here. Reference columns are plain UUIDs (no FKs) so
preferences survive config renames and deletions; existence is validated
on write instead.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Uuid, func
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


__all__ = ["Base", "ConsultationMode", "TimeOfDay", "UserPreferences"]
