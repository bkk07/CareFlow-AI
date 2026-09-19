"""search_doctors — find active doctors in approved hospitals."""

import uuid

from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.domain.doctor.models import Doctor, DoctorStatus
from app.domain.hospital.models import Hospital, HospitalStatus
from app.domain.hospital_config.models import Specialty
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools import _geo as geo
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "search_doctors"


class SearchDoctorsIn(BaseModel):
    hospital_id: uuid.UUID | None = None
    specialty: str | None = None
    query: str | None = None
    city: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_km: float | None = Field(default=None, gt=0, le=20000)


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
    """Search active doctors; specialty matches name or id.

    `city` matches the hospital's city and ranks same-city doctors first
    so "near me" works off the patient's saved city; other cities are
    still included below. When `latitude`+`longitude` are given, hits are
    ordered by real hospital distance (nearest first, each carrying
    `distance_km`); `radius_km` additionally filters out doctors whose
    hospital is farther away.
    """
    del ctx, integration
    q = (
        db.query(
            Doctor,
            Hospital.name,
            Specialty.name,
            Hospital.city,
            Hospital.latitude,
            Hospital.longitude,
        )
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
    city = (input.city or "").strip()
    has_point = geo.validate_point(input.latitude, input.longitude)
    if has_point:
        rows = q.all()
        scored = []
        for row in rows:
            d, hospital_name, specialty_name, hospital_city, hlat, hlng = row
            dist = (
                geo.haversine_km(input.latitude, input.longitude, hlat, hlng)
                if hlat is not None and hlng is not None
                else None
            )
            scored.append((row, dist))
        if input.radius_km is not None:
            scored = [
                (r, dist) for r, dist in scored
                if dist is not None and dist <= input.radius_km
            ]
        scored.sort(
            key=lambda t: (
                t[1] is None,
                t[1] if t[1] is not None else 0,
                t[0][0].name or "",
            )
        )
        return {
            "doctors": [
                {
                    "id": str(d.id),
                    "name": d.name,
                    "hospital_id": str(d.hospital_id),
                    "hospital_name": hospital_name,
                    "hospital_city": hospital_city,
                    "hospital_latitude": hlat,
                    "hospital_longitude": hlng,
                    "specialty": specialty_name,
                    "distance_km": round(dist, 2) if dist is not None else None,
                }
                for (d, hospital_name, specialty_name, hospital_city, hlat, hlng), dist in scored
            ],
        }
    if city:
        q = q.order_by(
            func.lower(Hospital.city) != city.lower(),
            Doctor.name,
        )
    else:
        q = q.order_by(Doctor.name)
    rows = q.all()
    return {
        "doctors": [
            {
                "id": str(d.id),
                "name": d.name,
                "hospital_id": str(d.hospital_id),
                "hospital_name": hospital_name,
                "hospital_city": hospital_city,
                "hospital_latitude": hlat,
                "hospital_longitude": hlng,
                "specialty": specialty_name,
                "distance_km": None,
            }
            for d, hospital_name, specialty_name, hospital_city, hlat, hlng in rows
        ],
    }
