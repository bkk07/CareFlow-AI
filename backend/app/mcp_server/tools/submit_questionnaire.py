"""submit_questionnaire — store pre-visit answers (Phase 11 live).

Returns completed=false with per-question errors until every required
question is answered — the agent must keep asking, never declare done
early. A flagged answer already opened a human escalation; tell the
patient someone from the care team will review it.
"""

import uuid

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment import service as appointment_service
from app.domain.appointment.router import _check_appointment_access
from app.domain.auth.models import Role
from app.domain.questionnaire import service as questionnaire_service
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "submit_questionnaire"


class SubmitQuestionnaireIn(BaseModel):
    appointment_id: uuid.UUID
    answers: dict[str, object] = {}


@mcp_tool(
    TOOL_NAME,
    retry_safe=False,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin],
)
def run(
    input: SubmitQuestionnaireIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Validate and store answers; reports completion and flagging."""
    del integration
    appointment = appointment_service.get_appointment_or_404(
        db, input.appointment_id
    )
    _check_appointment_access(ctx, appointment)
    questionnaire = questionnaire_service.resolve_for_appointment(db, appointment)
    if questionnaire is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="No questionnaire is assigned to this appointment",
        )
    questions = questionnaire_service.list_questions(db, questionnaire)
    stored = {str(k): v for k, v in dict(input.answers).items()}
    problems = questionnaire_service.validate_answers(questions, stored)
    if problems:
        return {
            "appointment_id": str(appointment.id),
            "completed": False,
            "errors": problems,
            "missing_required": questionnaire_service.missing_required(
                questions, stored
            ),
            "flagged": False,
        }
    row, completed, escalation = questionnaire_service.save_response(
        db,
        appointment=appointment,
        questionnaire=questionnaire,
        answers=stored,
        actor_user_id=ctx.user_id,
    )
    return {
        "appointment_id": str(appointment.id),
        "response_id": str(row.id),
        "completed": completed,
        "errors": [],
        "missing_required": questionnaire_service.missing_required(
            questions, stored
        ),
        "flagged": escalation is not None,
        "escalation_id": str(escalation.id) if escalation is not None else None,
    }
