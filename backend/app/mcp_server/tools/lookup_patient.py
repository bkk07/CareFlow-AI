"""lookup_patient — read a patient profile within scope."""

import uuid

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment.models import Appointment
from app.domain.auth.models import Role, User
from app.integration.integration_service import IntegrationService
from app.mcp_server.errors import CapabilityAuthError
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "lookup_patient"


class LookupPatientIn(BaseModel):
    patient_id: uuid.UUID | None = None


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: LookupPatientIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Return the caller's own profile, or an in-scope patient for staff."""
    del integration
    target_id = input.patient_id or ctx.user_id
    if ctx.role == Role.patient and target_id != ctx.user_id:
        raise CapabilityAuthError("Patients may only look up their own profile")
    patient = db.get(User, target_id)
    if patient is None or patient.role != Role.patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if ctx.role == Role.hospital_admin:
        shared = (
            db.query(Appointment.id)
            .filter(
                Appointment.patient_id == patient.id,
                Appointment.hospital_id == ctx.hospital_id,
            )
            .first()
        )
        if shared is None:
            raise CapabilityAuthError(
                "No care relationship with this patient in your hospital"
            )
    return {"id": str(patient.id), "email": patient.email}
