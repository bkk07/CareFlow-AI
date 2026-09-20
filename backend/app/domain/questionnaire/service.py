"""Questionnaire service: admin CRUD, appointment resolution, validation.

Resolution precedence for an appointment: doctor > appointment type >
specialty (of the booked doctor) > hospital. Only active questionnaires
participate.

The concern flag is a deliberate keyword rule, not medical judgment: if
a free-text answer contains an urgent-sounding phrase, the response is
flagged and a human escalation opens — the AI never interprets symptoms.
"""

import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.domain.questionnaire.models import (
    Questionnaire,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireScope,
    QuestionType,
)
from app.mcp_server.models import Escalation, EscalationStatus

#: Free-text phrases that auto-flag a response for human review.
#: Keyword match only — never a clinical interpretation.
FLAG_PHRASES = (
    "chest pain",
    "can't breathe",
    "cannot breathe",
    "difficulty breathing",
    "bleeding",
    "blood in",
    "suicid",
    "kill myself",
    "hurt myself",
    "overdose",
    "heart attack",
    "stroke",
    "unconscious",
    "severe pain",
    "getting worse",
    "emergency",
    "call an ambulance",
)


def _not_found(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message
    )


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# -- admin CRUD --------------------------------------------------------------


def create_questionnaire(
    session: Session,
    hospital: Hospital,
    *,
    name: str,
    scope: QuestionnaireScope,
    scope_ref_id: uuid.UUID | None,
) -> Questionnaire:
    """Create a question set; hospital scope takes no reference id."""
    name = name.strip()
    if not name:
        raise _unprocessable("name must not be empty")
    if scope == QuestionnaireScope.hospital and scope_ref_id is not None:
        raise _unprocessable("hospital scope takes no scope_ref_id")
    if scope != QuestionnaireScope.hospital and scope_ref_id is None:
        raise _unprocessable(f"{scope.value} scope requires a scope_ref_id")
    row = Questionnaire(
        hospital_id=hospital.id,
        name=name,
        scope=scope,
        scope_ref_id=scope_ref_id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def get_hospital_questionnaire(
    session: Session, hospital: Hospital, questionnaire_id: uuid.UUID
) -> Questionnaire:
    row = session.get(Questionnaire, questionnaire_id)
    if row is None or row.hospital_id != hospital.id:
        raise _not_found("Questionnaire not found in this hospital")
    return row


def update_questionnaire(
    session: Session, questionnaire: Questionnaire, body
) -> Questionnaire:
    """Rename / (de)activate. Deactivation keeps history; the resolver
    only considers active forms for new appointments."""
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        name = data["name"].strip()
        if not name:
            raise _unprocessable("name must not be empty")
        questionnaire.name = name
    if "is_active" in data:
        questionnaire.is_active = data["is_active"]
    session.commit()
    session.refresh(questionnaire)
    return questionnaire


def add_question(
    session: Session,
    questionnaire: Questionnaire,
    *,
    order: int,
    type: QuestionType,
    prompt: str,
    options: list | None,
    required: bool = True,
) -> QuestionnaireQuestion:
    """Append one question; choice kinds must carry their option list."""
    if not prompt.strip():
        raise _unprocessable("prompt must not be empty")
    if type in (QuestionType.choice, QuestionType.multi_choice):
        if not options:
            raise _unprocessable(f"{type.value} questions require options")
    row = QuestionnaireQuestion(
        questionnaire_id=questionnaire.id,
        order=order,
        type=type,
        prompt=prompt.strip(),
        options=list(options) if options else None,
        required=required,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_questions(
    session: Session, questionnaire: Questionnaire
) -> list[QuestionnaireQuestion]:
    return (
        session.query(QuestionnaireQuestion)
        .filter(QuestionnaireQuestion.questionnaire_id == questionnaire.id)
        .order_by(QuestionnaireQuestion.order, QuestionnaireQuestion.created_at)
        .all()
    )


def delete_questionnaire(session: Session, questionnaire: Questionnaire) -> None:
    """C2: delete a form and its questions. Responses are kept (history)."""
    session.query(QuestionnaireQuestion).filter(
        QuestionnaireQuestion.questionnaire_id == questionnaire.id
    ).delete()
    session.delete(questionnaire)
    session.commit()


def get_question(
    session: Session, questionnaire: Questionnaire, question_id: uuid.UUID
) -> QuestionnaireQuestion:
    row = session.get(QuestionnaireQuestion, question_id)
    if row is None or row.questionnaire_id != questionnaire.id:
        raise _not_found("Question not found in this questionnaire")
    return row


def update_question(
    session: Session, question: QuestionnaireQuestion, body
) -> QuestionnaireQuestion:
    """C2: edit prompt / options / required / order / type."""
    data = body.model_dump(exclude_unset=True)
    if "prompt" in data:
        prompt = str(data["prompt"]).strip()
        if not prompt:
            raise _unprocessable("prompt must not be empty")
        question.prompt = prompt
    if "type" in data and data["type"] is not None:
        question.type = data["type"]
    if "options" in data:
        options = data["options"]
        if question.type in (QuestionType.choice, QuestionType.multi_choice):
            if not options:
                raise _unprocessable(f"{question.type.value} questions require options")
            question.options = list(options)
        else:
            question.options = list(options) if options else None
    if "required" in data and data["required"] is not None:
        question.required = bool(data["required"])
    if "order" in data and data["order"] is not None:
        question.order = int(data["order"])
    session.commit()
    session.refresh(question)
    return question


def delete_question(session: Session, question: QuestionnaireQuestion) -> None:
    """C2: delete one question; sibling order values are left as-is."""
    session.delete(question)
    session.commit()


# -- resolution --------------------------------------------------------------


def resolve_for_appointment(
    session: Session, appointment: Appointment
) -> Questionnaire | None:
    """Most specific active questionnaire for this booking, if any."""
    doctor = session.get(Doctor, appointment.doctor_id)
    candidates = (
        session.query(Questionnaire)
        .filter(
            Questionnaire.hospital_id == appointment.hospital_id,
            Questionnaire.is_active.is_(True),
        )
        .all()
    )
    best: Questionnaire | None = None
    best_rank = -1
    for row in candidates:
        rank = _match_rank(row, appointment, doctor)
        if rank is not None and rank > best_rank:
            best, best_rank = row, rank
    return best


def _match_rank(
    row: Questionnaire, appointment: Appointment, doctor: Doctor | None
) -> int | None:
    if row.scope == QuestionnaireScope.hospital:
        return 0
    if row.scope == QuestionnaireScope.specialty:
        if doctor is not None and doctor.specialty_id == row.scope_ref_id:
            return 1
        return None
    if row.scope == QuestionnaireScope.appointment_type:
        if appointment.appointment_type_id == row.scope_ref_id:
            return 2
        return None
    if row.scope == QuestionnaireScope.doctor:
        if appointment.doctor_id == row.scope_ref_id:
            return 3
        return None
    return None


# -- validation --------------------------------------------------------------


def _type_error(question: QuestionnaireQuestion, value, why: str) -> str:
    return f"'{question.prompt}': {why}"


def validate_answers(
    questions: list[QuestionnaireQuestion], answers: dict
) -> list[str]:
    """Hard problems (unknown keys, wrong types); empty means storable.

    Missing required answers are NOT errors here — they just leave the
    response a draft (see `missing_required`). This lets patients and
    the agent save progress without completing.
    """
    errors: list[str] = []
    by_id = {str(q.id): q for q in questions}
    for key in answers:
        if key not in by_id:
            errors.append(f"Unknown question id '{key}'")
    for qid, question in by_id.items():
        value = answers.get(qid)
        if value is None or value == "" or value == []:
            continue
        errors.extend(_check_type(question, value))
    return errors


def _check_type(question: QuestionnaireQuestion, value) -> list[str]:
    kind = question.type
    if kind == QuestionType.yes_no:
        if not isinstance(value, bool):
            return [_type_error(question, value, "expected true/false")]
    elif kind == QuestionType.choice:
        if value not in (question.options or []):
            return [_type_error(question, value, "not one of the options")]
    elif kind == QuestionType.multi_choice:
        if not isinstance(value, list) or any(
            v not in (question.options or []) for v in value
        ):
            return [_type_error(question, value, "must list only options")]
    elif kind == QuestionType.numeric:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return [_type_error(question, value, "expected a number")]
    elif kind == QuestionType.date:
        if not isinstance(value, str):
            return [_type_error(question, value, "expected a YYYY-MM-DD date")]
        try:
            date.fromisoformat(value)
        except ValueError:
            return [_type_error(question, value, "expected a YYYY-MM-DD date")]
    elif kind in (QuestionType.short_text, QuestionType.long_text):
        if not isinstance(value, str):
            return [_type_error(question, value, "expected text")]
    elif kind == QuestionType.structured:
        if not isinstance(value, dict):
            return [_type_error(question, value, "expected an object")]
    return []


def missing_required(
    questions: list[QuestionnaireQuestion], answers: dict
) -> list[str]:
    """Prompts still unanswered that block completion."""
    missing = []
    for question in questions:
        value = answers.get(str(question.id))
        if (
            question.required
            and (value is None or value == "" or value == [])
        ):
            missing.append(question.prompt)
    return missing


# -- responses + flag rule ---------------------------------------------------


def _free_texts(questions: list[QuestionnaireQuestion], answers: dict) -> list[str]:
    texts = []
    for question in questions:
        if question.type not in (
            QuestionType.short_text,
            QuestionType.long_text,
            QuestionType.structured,
        ):
            continue
        value = answers.get(str(question.id))
        if isinstance(value, str):
            texts.append(value)
        elif isinstance(value, dict):
            texts.extend(v for v in value.values() if isinstance(v, str))
    return texts


def find_flag_phrase(
    questions: list[QuestionnaireQuestion], answers: dict
) -> str | None:
    """First urgent-sounding phrase in free text, if any (keyword match)."""
    for text in _free_texts(questions, answers):
        lowered = text.lower()
        for phrase in FLAG_PHRASES:
            if phrase in lowered:
                return phrase
    return None


def save_response(
    session: Session,
    *,
    appointment: Appointment,
    questionnaire: Questionnaire,
    answers: dict[str, object],
    actor_user_id: uuid.UUID,
) -> tuple[QuestionnaireResponse, bool, Escalation | None]:
    """Store answers; returns (response, completed, escalation-or-None.

    Completion needs zero validation errors AND every required question
    answered. A flagged phrase opens a human escalation either way.
    """
    questions = list_questions(session, questionnaire)
    problems = validate_answers(questions, answers)
    if problems:
        raise _unprocessable("; ".join(problems))
    stored = {str(k): v for k, v in answers.items()}
    response = (
        session.query(QuestionnaireResponse)
        .filter(
            QuestionnaireResponse.appointment_id == appointment.id,
            QuestionnaireResponse.questionnaire_id == questionnaire.id,
        )
        .first()
    )
    if response is None:
        response = QuestionnaireResponse(
            appointment_id=appointment.id,
            questionnaire_id=questionnaire.id,
            answers=stored,
        )
        session.add(response)
    else:
        response.answers = stored
    completed = not missing_required(questions, stored)
    response.completed_at = _utcnow() if completed else None
    escalation: Escalation | None = None
    phrase = find_flag_phrase(questions, stored)
    if phrase is not None:
        escalation = Escalation(
            conversation_id=f"questionnaire:{appointment.id}",
            appointment_id=appointment.id,
            reason=(
                "Questionnaire answer flagged for human review "
                f"(matched '{phrase}')"
            ),
            status=EscalationStatus.open,
            created_by_user_id=actor_user_id,
            hospital_id=appointment.hospital_id,
        )
        session.add(escalation)
    session.commit()
    session.refresh(response)
    if escalation is not None:
        session.refresh(escalation)
    return response, completed, escalation


__all__ = [
    "FLAG_PHRASES",
    "add_question",
    "create_questionnaire",
    "find_flag_phrase",
    "get_hospital_questionnaire",
    "list_questions",
    "missing_required",
    "resolve_for_appointment",
    "save_response",
    "validate_answers",
]
