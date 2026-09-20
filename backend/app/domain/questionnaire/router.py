"""Questionnaire endpoints: admin authoring + appointment answering.

Authoring is hospital-admin on the managed hospital. Answering is the
owning patient (or an admin of the hospital); responses are also
readable by doctors of the hospital (dashboard stub until Phase 13)
and by platform admins.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.appointment.models import Appointment
from app.domain.appointment.service import get_appointment_or_404
from app.domain.auth.models import Role
from app.domain.hospital.deps import require_managed_hospital
from app.domain.hospital.models import Hospital
from app.domain.questionnaire import service
from app.domain.questionnaire.models import Questionnaire, QuestionnaireResponse
from app.domain.questionnaire.schemas import (
    QuestionCreateIn,
    QuestionnaireCreateIn,
    QuestionnaireDetailOut,
    QuestionnaireOut,
    QuestionnaireUpdateIn,
    QuestionOut,
    QuestionUpdateIn,
    ResponseOut,
    ResponseSubmitIn,
)

router = APIRouter(tags=["questionnaires"])

_admin = require_role(Role.hospital_admin)
_answerer = require_role(Role.patient, Role.hospital_admin, Role.doctor)
_viewer = require_role(Role.patient, Role.hospital_admin, Role.platform_admin, Role.doctor)


def _questionnaire_out(row: Questionnaire) -> QuestionnaireOut:
    return QuestionnaireOut(
        id=row.id,
        hospital_id=row.hospital_id,
        name=row.name,
        scope=row.scope,
        scope_ref_id=row.scope_ref_id,
        is_active=row.is_active,
        created_at=row.created_at,
    )


def _question_out(row) -> QuestionOut:
    return QuestionOut(
        id=row.id,
        questionnaire_id=row.questionnaire_id,
        order=row.order,
        type=row.type,
        prompt=row.prompt,
        options=row.options,
        required=row.required,
    )


def _check_appointment_access(ctx: RequestContext, appointment: Appointment) -> None:
    if ctx.role == Role.platform_admin:
        return
    if ctx.role == Role.patient and appointment.patient_id == ctx.user_id:
        return
    if (
        ctx.role in (Role.hospital_admin, Role.doctor)
        and ctx.hospital_id == appointment.hospital_id
    ):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Not allowed to access this appointment",
    )


def _response_out(
    row: QuestionnaireResponse, *, flagged: bool = False, escalation_id=None
) -> ResponseOut:
    return ResponseOut(
        id=row.id,
        appointment_id=row.appointment_id,
        questionnaire_id=row.questionnaire_id,
        answers=row.answers,
        completed=row.completed_at is not None,
        completed_at=row.completed_at,
        flagged=flagged,
        escalation_id=escalation_id,
    )


# -- admin authoring -----------------------------------------------------------


@router.post("/hospitals/{hospital_id}/questionnaires", response_model=QuestionnaireOut, status_code=201)
def create_questionnaire(
    body: QuestionnaireCreateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> Questionnaire:
    del ctx
    return service.create_questionnaire(
        db, hospital, name=body.name, scope=body.scope, scope_ref_id=body.scope_ref_id
    )


@router.get("/hospitals/{hospital_id}/questionnaires", response_model=list[QuestionnaireOut])
def list_questionnaires(
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> list:
    del ctx
    return (
        db.query(Questionnaire)
        .filter(Questionnaire.hospital_id == hospital.id)
        .order_by(Questionnaire.created_at)
        .all()
    )


@router.post(
    "/hospitals/{hospital_id}/questionnaires/{questionnaire_id}/questions",
    response_model=QuestionOut,
    status_code=201,
)
def add_question(
    questionnaire_id: uuid.UUID,
    body: QuestionCreateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> object:
    del ctx
    questionnaire = service.get_hospital_questionnaire(db, hospital, questionnaire_id)
    return service.add_question(
        db,
        questionnaire,
        order=body.order,
        type=body.type,
        prompt=body.prompt,
        options=body.options,
        required=body.required,
    )


@router.get(
    "/hospitals/{hospital_id}/questionnaires/{questionnaire_id}",
    response_model=QuestionnaireDetailOut,
)
def get_questionnaire_detail(
    questionnaire_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> QuestionnaireDetailOut:
    del ctx
    questionnaire = service.get_hospital_questionnaire(db, hospital, questionnaire_id)
    return QuestionnaireDetailOut(
        questionnaire=_questionnaire_out(questionnaire),
        questions=[
            _question_out(q) for q in service.list_questions(db, questionnaire)
        ],
    )


@router.put(
    "/hospitals/{hospital_id}/questionnaires/{questionnaire_id}",
    response_model=QuestionnaireOut,
)
def update_questionnaire(
    questionnaire_id: uuid.UUID,
    body: QuestionnaireUpdateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> Questionnaire:
    """Rename or (de)activate a form. Inactive forms stop resolving for
    new appointments but keep their history."""
    del ctx
    questionnaire = service.get_hospital_questionnaire(db, hospital, questionnaire_id)
    return service.update_questionnaire(db, questionnaire, body)


@router.delete(
    "/hospitals/{hospital_id}/questionnaires/{questionnaire_id}",
    status_code=204,
)
def delete_questionnaire(
    questionnaire_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> None:
    """C2: delete a form and its questions. Past responses are kept."""
    del ctx
    questionnaire = service.get_hospital_questionnaire(db, hospital, questionnaire_id)
    service.delete_questionnaire(db, questionnaire)
    return None


@router.put(
    "/hospitals/{hospital_id}/questionnaires/{questionnaire_id}/questions/{question_id}",
    response_model=QuestionOut,
)
def update_question(
    questionnaire_id: uuid.UUID,
    question_id: uuid.UUID,
    body: QuestionUpdateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> object:
    """C2: edit one question (prompt / options / required / order / type)."""
    del ctx
    questionnaire = service.get_hospital_questionnaire(db, hospital, questionnaire_id)
    question = service.get_question(db, questionnaire, question_id)
    return service.update_question(db, question, body)


@router.delete(
    "/hospitals/{hospital_id}/questionnaires/{questionnaire_id}/questions/{question_id}",
    status_code=204,
)
def delete_question(
    questionnaire_id: uuid.UUID,
    question_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> None:
    """C2: delete one question."""
    del ctx
    questionnaire = service.get_hospital_questionnaire(db, hospital, questionnaire_id)
    question = service.get_question(db, questionnaire, question_id)
    service.delete_question(db, question)
    return None


# -- appointment answering -----------------------------------------------------


@router.get(
    "/appointments/{appointment_id}/questionnaire",
    response_model=QuestionnaireDetailOut | None,
)
def get_appointment_questionnaire(
    appointment_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_answerer),
) -> QuestionnaireDetailOut | None:
    appointment = get_appointment_or_404(db, appointment_id)
    _check_appointment_access(ctx, appointment)
    questionnaire = service.resolve_for_appointment(db, appointment)
    if questionnaire is None:
        return None
    return QuestionnaireDetailOut(
        questionnaire=_questionnaire_out(questionnaire),
        questions=[
            _question_out(q) for q in service.list_questions(db, questionnaire)
        ],
    )


@router.post(
    "/appointments/{appointment_id}/questionnaire/responses",
    response_model=ResponseOut,
)
def submit_response(
    appointment_id: uuid.UUID,
    body: ResponseSubmitIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_answerer),
) -> ResponseOut:
    appointment = get_appointment_or_404(db, appointment_id)
    _check_appointment_access(ctx, appointment)
    questionnaire = service.resolve_for_appointment(db, appointment)
    if questionnaire is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="No questionnaire is assigned to this appointment",
        )
    row, completed, escalation = service.save_response(
        db,
        appointment=appointment,
        questionnaire=questionnaire,
        answers=dict(body.answers),
        actor_user_id=ctx.user_id,
    )
    del completed
    return _response_out(
        row,
        flagged=escalation is not None,
        escalation_id=escalation.id if escalation is not None else None,
    )


@router.get(
    "/appointments/{appointment_id}/questionnaire/responses",
    response_model=list[ResponseOut],
)
def list_responses(
    appointment_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_viewer),
) -> list:
    appointment = get_appointment_or_404(db, appointment_id)
    _check_appointment_access(ctx, appointment)
    return [
        _response_out(row)
        for row in db.query(QuestionnaireResponse)
        .filter(QuestionnaireResponse.appointment_id == appointment.id)
        .order_by(QuestionnaireResponse.created_at)
        .all()
    ]


__all__ = ["router"]
