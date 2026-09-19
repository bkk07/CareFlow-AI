"""list_appointment_types — bookable visit types for one hospital."""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.domain.hospital.service import assert_hospital_approved, get_hospital_or_404
from app.domain.hospital_config.models import AppointmentType
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "list_appointment_types"


class ListAppointmentTypesIn(BaseModel):
    hospital_id: uuid.UUID


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: ListAppointmentTypesIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Visit types (with ids + durations) the patient can book at a hospital.

    Use this to resolve an appointment type id for check_availability —
    never ask the user for ids.
    """
    del ctx, integration
    hospital = get_hospital_or_404(db, input.hospital_id)
    assert_hospital_approved(hospital)
    rows = (
        db.query(AppointmentType)
        .filter(AppointmentType.hospital_id == hospital.id)
        .order_by(AppointmentType.name)
        .all()
    )
    return {
        "appointment_types": [
            {
                "id": str(t.id),
                "name": t.name,
                "duration_minutes": t.duration_minutes,
            }
            for t in rows
        ],
    }
