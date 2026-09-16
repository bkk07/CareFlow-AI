"""search_hospitals — discover live hospitals by name."""

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.domain.hospital.models import Hospital, HospitalStatus
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "search_hospitals"


class SearchHospitalsIn(BaseModel):
    query: str | None = None


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: SearchHospitalsIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """List approved hospitals, optionally filtered by name."""
    del ctx, integration
    q = db.query(Hospital).filter(Hospital.status == HospitalStatus.approved)
    if input.query:
        q = q.filter(Hospital.name.ilike(f"%{input.query.strip()}%"))
    rows = q.order_by(Hospital.name).all()
    return {
        "hospitals": [{"id": str(h.id), "name": h.name} for h in rows],
    }
