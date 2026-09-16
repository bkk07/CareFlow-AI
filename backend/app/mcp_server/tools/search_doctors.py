"""search_doctors — find active doctors in approved hospitals."""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.domain.doctor.models import Doctor, DoctorStatus
from app.domain.hospital.models import Hospital, HospitalStatus
from app.domain.hospital_config.models import Specialty
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "search_doctors"


class SearchDoctorsIn(BaseModel):
    hospital_id: uuid.UUID | None = None
    specialty: str | None = None
    query: str | None = None


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient, Role.hospital_admin, Role.platform_admin],
)
def run(
    input: SearchDoctorsIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Search active doctors; specialty matches name or id."""
    del ctx, integration
    q = (
        db.query(Doctor, Hospital.name, Specialty.name)
        .join(Hospital, Hospital.id == Doctor.hospital_id)
        .outerjoin(Specialty, Specialty.id == Doctor.specialty_id)
        .filter(
            Doctor.status == DoctorStatus.active,
            Hospital.status == HospitalStatus.approved,
        )
    )
    if input.hospital_id is not None:
        q = q.filter(Doctor.hospital_id == input.hospital_id)
    if input.specialty:
        text = input.specialty.strip()
        try:
            specialty_id = uuid.UUID(text)
        except (ValueError, AttributeError):
            specialty_id = None
        if specialty_id is not None:
            q = q.filter(Doctor.specialty_id == specialty_id)
        else:
            q = q.filter(Specialty.name.ilike(f"%{text}%"))
    if input.query:
        q = q.filter(Doctor.name.ilike(f"%{input.query.strip()}%"))
    rows = q.order_by(Doctor.name).all()
    return {
        "doctors": [
            {
                "id": str(d.id),
                "name": d.name,
                "hospital_id": str(d.hospital_id),
                "hospital_name": hospital_name,
                "specialty": specialty_name,
            }
            for d, hospital_name, specialty_name in rows
        ],
    }
