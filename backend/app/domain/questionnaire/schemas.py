"""Questionnaire schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.domain.questionnaire.models import QuestionnaireScope, QuestionType


class QuestionnaireCreateIn(BaseModel):
    name: str
    scope: QuestionnaireScope
    scope_ref_id: uuid.UUID | None = None


class QuestionnaireOut(BaseModel):
    id: uuid.UUID
    hospital_id: uuid.UUID
    name: str
    scope: QuestionnaireScope
    scope_ref_id: uuid.UUID | None
    is_active: bool
    created_at: datetime


class QuestionCreateIn(BaseModel):
    order: int = 0
    type: QuestionType
    prompt: str
    options: list[str] | None = None
    required: bool = True


class QuestionOut(BaseModel):
    id: uuid.UUID
    questionnaire_id: uuid.UUID
    order: int
    type: QuestionType
    prompt: str
    options: list[str] | None
    required: bool


class QuestionnaireDetailOut(BaseModel):
    questionnaire: QuestionnaireOut
    questions: list[QuestionOut]


class ResponseSubmitIn(BaseModel):
    answers: dict[str, object] = Field(default_factory=dict)


class ResponseOut(BaseModel):
    id: uuid.UUID
    appointment_id: uuid.UUID
    questionnaire_id: uuid.UUID
    answers: dict
    completed: bool
    completed_at: datetime | None
    flagged: bool = False
    escalation_id: uuid.UUID | None = None
