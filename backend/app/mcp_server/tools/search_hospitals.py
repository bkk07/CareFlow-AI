"""search_hospitals — discover live hospitals by name, city, or coordinates."""

from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.domain.hospital.models import Hospital, HospitalStatus
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools import _geo as geo
from app.mcp_server.tools._base import mcp_tool

TOOL_NAME = "search_hospitals"


class SearchHospitalsIn(BaseModel):
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
    input: SearchHospitalsIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """List approved hospitals, optionally filtered by name or city.

    `query` matches hospital name or city so free-text "Find care" search
    just works. `city` ranks same-city hospitals first so "near me" works
    off the patient's saved city; it never excludes other cities. When
    `latitude`+`longitude` are given, hits are ordered by real distance
    (nearest first, each carrying `distance_km`); `radius_km` additionally
    filters out anything farther away.
    """
    del ctx, integration
    q = db.query(Hospital).filter(Hospital.status == HospitalStatus.approved)
    if input.query:
        text = input.query.strip()
        q = q.filter(
            Hospital.name.ilike(f"%{text}%") | Hospital.city.ilike(f"%{text}%")
        )
    city = (input.city or "").strip()
    has_point = geo.validate_point(input.latitude, input.longitude)
    if has_point:
        # Distance needs Python math: fetch candidates, rank in memory.
        rows = q.all()
        scored = []
        for h in rows:
            dist = (
                geo.haversine_km(input.latitude, input.longitude, h.latitude, h.longitude)
                if h.latitude is not None and h.longitude is not None
                else None
            )
            scored.append((h, dist))
        if input.radius_km is not None:
            scored = [
                (h, d) for h, d in scored if d is not None and d <= input.radius_km
            ]
        scored.sort(key=lambda t: (t[1] is None, t[1] if t[1] is not None else 0, (t[0].name or "")))
        return {
            "hospitals": [
                {
                    "id": str(h.id),
                    "name": h.name,
                    "city": h.city,
                    "latitude": h.latitude,
                    "longitude": h.longitude,
                    "distance_km": round(d, 2) if d is not None else None,
                }
                for h, d in scored
            ],
        }
    if city:
        q = q.order_by(
            func.lower(Hospital.city) != city.lower(),
            Hospital.name,
        )
    else:
        q = q.order_by(Hospital.name)
    rows = q.all()
    return {
        "hospitals": [
            {
                "id": str(h.id),
                "name": h.name,
                "city": h.city,
                "latitude": h.latitude,
                "longitude": h.longitude,
                "distance_km": None,
            }
            for h in rows
        ],
    }
