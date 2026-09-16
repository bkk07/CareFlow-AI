"""get_questionnaire — fetch the exact pre-visit question set (Phase 11 live)."""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment import service as appointment_service
from app.domain.appointment.router import _check_appointment_access
from app.domain.auth.models import Role
from app.domain.questionnaire import service as questionnaire_service
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "get_questionnaire"


class GetQuestionnaireIn(BaseModel):
    appointment_id: uuid.UUID


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: GetQuestionnaireIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Return the appointment's question set.

    AGENT RULE: ask ONLY these questions, in order. Never invent
    clinical questions of your own, never rephrase a prompt into a
    diagnosis, and never mark the questionnaire complete until
    submit_questionnaire reports completed=true.
    """
    del integration
    appointment = appointment_service.get_appointment_or_404(
        db, input.appointment_id
    )
    _check_appointment_access(ctx, appointment)
    questionnaire = questionnaire_service.resolve_for_appointment(db, appointment)
    if questionnaire is None:
        return {"appointment_id": str(appointment.id), "questionnaire": None}
    questions = questionnaire_service.list_questions(db, questionnaire)
    return {
        "appointment_id": str(appointment.id),
        "questionnaire": {
            "id": str(questionnaire.id),
            "name": questionnaire.name,
            "questions": [
                {
                    "id": str(q.id),
                    "order": q.order,
                    "type": q.type.value,
                    "prompt": q.prompt,
                    "options": q.options,
                    "required": q.required,
                }
                for q in questions
            ],
        },
    }
