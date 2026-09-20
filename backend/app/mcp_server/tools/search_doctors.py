"""search_doctors — find active doctors in approved hospitals."""

import uuid

from pydantic import BaseModel, Field
from sqlalchemy import func, or_
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

#: People-words models pass vs catalog names we store.
_SPECIALTY_SYNONYMS = {
    "dermatologist": "Dermatology",
    "cardiologist": "Cardiology",
    "neurologist": "Neurology",
    "orthopedist": "Orthopedics",
    "orthopaedic": "Orthopedics",
    "orthopedic": "Orthopedics",
    "pediatrician": "Pediatrics",
    "gynecologist": "Gynecology",
    "gynaecologist": "Gynecology",
    "psychiatrist": "Psychiatry",
    "ophthalmologist": "Ophthalmology",
    "dentist": "Dental",
    "physician": "General Medicine",
    "general physician": "General Medicine",
}


def _specialty_stem(lowered: str) -> str:
    """Short stem so 'dermatologist' also matches 'Dermatology'.

    Strips a trailing people-suffix and returns the first 8+ chars;
    empty string when nothing useful remains (caller skips it).
    """
    for suffix in ("ologist", "iatrist", "ician"):
        if lowered.endswith(suffix) and len(lowered) - len(suffix) >= 4:
            lowered = lowered[: -len(suffix)]
            break
    return lowered if len(lowered) >= 4 else ""


def _offers_mode(doctor: Doctor, mode: str | None) -> bool:
    """True when the doctor offers the requested consultation mode.

    Doctors with no configured types (legacy rows) match every mode so
    the filter never hides unconfigured-but-valid doctors.
    """
    if mode is None:
        return True
    types = list(getattr(doctor, "consultation_types", None) or [])
    if not types:
        return True
    return mode in [str(t).strip().lower() for t in types]


class SearchDoctorsIn(BaseModel):
    hospital_id: uuid.UUID | None = None
    specialty: str | None = None
    query: str | None = None
    city: str | None = None
    consultation_mode: str | None = Field(
        default=None,
        description="Filter by how the patient wants to meet: in_person, video, or phone.",
    )
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_km: float | None = Field(default=None, gt=0, le=20000)
    # Paging for "explore more": chat shows 5 at a time (limit=5,
    # offsets 0/5/10…). Always paired with `total` so the caller knows
    # whether another page exists.
    limit: int = Field(default=5, ge=1, le=50)
    offset: int = Field(default=0, ge=0)


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

    `query` is free text matching doctor name, hospital name, or specialty
    (including people-words like "cardiologist" -> "Cardiology").
    `specialty` narrows to one specialty, `hospital_id` to one hospital,
    and `consultation_mode` (in_person/video/phone) to doctors offering
    that visit mode. `city` matches the hospital's city and ranks
    same-city doctors first so "near me" works off the patient's saved
    city; other cities are still included below. When
    `latitude`+`longitude` are given, hits are ordered by real hospital
    distance (nearest first, each carrying `distance_km`); `radius_km`
    additionally filters out doctors whose hospital is farther away.
    Results are paged (`limit`/`offset`) and always report `total` so
    chat can offer "explore more" while matches remain.
    """
    del ctx, integration
    limit = max(1, min(input.limit or 5, 50))
    offset = max(0, input.offset or 0)
    mode = (input.consultation_mode or "").strip().lower() or None
    if mode is not None and mode not in ("in_person", "video", "phone"):
        from app.mcp_server.errors import CapabilityValidationError

        raise CapabilityValidationError(
            f"consultation_mode must be in_person, video, or phone (got {input.consultation_mode!r})"
        )
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
            # Models often pass "dermatologist" while the catalog stores
            # "Dermatology" (and similar -ist/-logy pairs): match either
            # form so a literal word never yields a false empty result.
            lowered = text.lower()
            variants = {text, _SPECIALTY_SYNONYMS.get(lowered, text)}
            stem = _specialty_stem(lowered)
            if stem:
                variants.add(stem)
            q = q.filter(
                func.lower(Specialty.name).in_([v.lower() for v in variants])
                | Specialty.name.ilike(f"%{text}%")
                | Specialty.name.ilike(f"%{stem}%")
            )
    if input.query:
        text = input.query.strip()
        lowered = text.lower()
        # Free-text "Find care" search: match doctor name, hospital name,
        # or specialty (including people-words like "cardiologist" ->
        # "Cardiology"). Specialty matching reuses the synonym/stem logic
        # so typing a specialty in the search box just works.
        synonym = _SPECIALTY_SYNONYMS.get(lowered, text)
        stem = _specialty_stem(lowered)
        clauses = [
            Doctor.name.ilike(f"%{text}%"),
            Hospital.name.ilike(f"%{text}%"),
            func.lower(Specialty.name).in_([text.lower(), synonym.lower()]),
            Specialty.name.ilike(f"%{text}%"),
            Specialty.name.ilike(f"%{synonym}%"),
        ]
        if stem:
            clauses.append(Specialty.name.ilike(f"%{stem}%"))
        q = q.filter(or_(*clauses))
    city = (input.city or "").strip()
    has_point = geo.validate_point(input.latitude, input.longitude)
    if has_point:
        rows = q.all()
        if mode is not None:
            rows = [r for r in rows if _offers_mode(r[0], mode)]
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
        total = len(scored)
        page = scored[offset : offset + limit]
        return {
            "total": total,
            "offset": offset,
            "limit": limit,
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
                    "available_durations": list(d.available_durations or []),
                    "consultation_types": list(d.consultation_types or []),
                    "default_duration_minutes": d.default_duration_minutes,
                    "distance_km": round(dist, 2) if dist is not None else None,
                }
                for (d, hospital_name, specialty_name, hospital_city, hlat, hlng), dist in page
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
    if mode is not None:
        rows = [r for r in rows if _offers_mode(r[0], mode)]
    total = len(rows)
    page = rows[offset : offset + limit]
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
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
                "available_durations": list(d.available_durations or []),
                "consultation_types": list(d.consultation_types or []),
                "default_duration_minutes": d.default_duration_minutes,
                "distance_km": None,
            }
            for d, hospital_name, specialty_name, hospital_city, hlat, hlng in page
        ],
    }
