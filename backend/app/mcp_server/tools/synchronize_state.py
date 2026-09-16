"""synchronize_state — pull vendor truth into one booking."""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.appointment import service
from app.domain.appointment.router import _check_appointment_access
from app.domain.auth.models import Role
from app.integration.connector_interface import EHRConnectorError
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool
from app.reliability.synchronization import service as sync_service

TOOL_NAME = "synchronize_state"


class SynchronizeStateIn(BaseModel):
    appointment_id: uuid.UUID


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: SynchronizeStateIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Re-read the vendor record and adopt it (confirm on match, park on drift)."""
    appointment = service.get_appointment_or_404(db, input.appointment_id)
    _check_appointment_access(ctx, appointment)
    try:
        if appointment.external_id is not None:
            external = integration.get_appointment(appointment.external_id)
        else:
            external = integration.find_appointment_by_idempotency_key(
                appointment.idempotency_key
            )
    except EHRConnectorError as exc:
        return {
            "appointment_id": str(appointment.id),
            "state": appointment.state.value,
            "synchronized": False,
            "error": f"Vendor unreadable: {type(exc).__name__}: {exc}",
        }
    if external is None:
        return {
            "appointment_id": str(appointment.id),
            "state": appointment.state.value,
            "synchronized": False,
            "error": "No vendor record found for this booking",
        }
    updated, mismatches = sync_service.adopt_external(
        db, appointment, external, actor_user_id=ctx.user_id
    )
    db.commit()
    db.refresh(updated)
    return {
        "appointment_id": str(updated.id),
        "state": updated.state.value,
        "synchronized": not mismatches,
        "mismatches": mismatches,
        "external_id": updated.external_id,
    }
