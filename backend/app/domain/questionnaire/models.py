"""Pre-visit questionnaire models (Phase 11).

A questionnaire attaches at one scope level — hospital, specialty,
doctor, or appointment type — and the most specific match wins for an
appointment (doctor > appointment type > specialty > hospital).
Responses are keyed drafts until every required question is answered,
at which point `completed_at` is set.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Uuid,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class QuestionnaireScope(str, enum.Enum):
    hospital = "hospital"
    specialty = "specialty"
    doctor = "doctor"
    appointment_type = "appointment_type"


class QuestionType(str, enum.Enum):
    yes_no = "yes_no"
    choice = "choice"
    multi_choice = "multi_choice"
    numeric = "numeric"
    date = "date"
    short_text = "short_text"
    long_text = "long_text"
    structured = "structured"


def _payload() -> Any:
    return JSONB().with_variant(JSON(), "sqlite")


class Questionnaire(Base):
    __tablename__ = "questionnaires"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hospital_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False, index=True
    )
    scope: Mapped[QuestionnaireScope] = mapped_column(
        Enum(QuestionnaireScope, name="questionnaire_scope", validate_strings=True),
        nullable=False,
    )
    scope_ref_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class QuestionnaireQuestion(Base):
    __tablename__ = "questionnaire_questions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("questionnaires.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    type: Mapped[QuestionType] = mapped_column(
        Enum(QuestionType, name="question_type", validate_strings=True),
        nullable=False,
    )
    prompt: Mapped[str] = mapped_column(String(1000), nullable=False)
    options: Mapped[list | None] = mapped_column(_payload(), nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class QuestionnaireResponse(Base):
    __tablename__ = "questionnaire_responses"
    __table_args__ = (
        UniqueConstraint("appointment_id", "questionnaire_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("questionnaires.id", ondelete="CASCADE"), nullable=False
    )
    answers: Mapped[dict] = mapped_column(_payload(), nullable=False, default=dict)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
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


__all__ = [
    "Questionnaire",
    "QuestionnaireQuestion",
    "QuestionnaireResponse",
    "QuestionnaireScope",
    "QuestionType",
]
