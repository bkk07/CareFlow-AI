"""Public care directory (Phase 13 UX): approved hospitals expose their
bookable catalog — specialties and appointment types — so patients can
browse and book without knowing internal ids. Read-only, approved-only.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role
from app.domain.hospital.models import Hospital, HospitalStatus
from app.domain.hospital_config.models import AppointmentType, Specialty

router = APIRouter(tags=["directory"])

_reader = require_role(Role.patient, Role.hospital_admin, Role.platform_admin)


def _approved_hospital_or_404(db: Session, hospital_id: uuid.UUID) -> Hospital:
    hospital = db.get(Hospital, hospital_id)
    if hospital is None or hospital.status != HospitalStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Hospital not found",
        )
    return hospital


@router.get("/directory/specialties")
def list_specialties(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_reader),
) -> dict:
    del ctx
    hospital = _approved_hospital_or_404(db, hospital_id)
    rows = (
        db.query(Specialty)
        .filter(Specialty.hospital_id == hospital.id)
        .order_by(Specialty.name)
        .all()
    )
    return {"specialties": [{"id": str(s.id), "name": s.name} for s in rows]}


@router.get("/directory/appointment-types")
def list_appointment_types(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_reader),
) -> dict:
    del ctx
    hospital = _approved_hospital_or_404(db, hospital_id)
    rows = (
        db.query(AppointmentType)
        .filter(AppointmentType.hospital_id == hospital.id)
        .order_by(AppointmentType.name)
        .all()
    )
    return {
        "appointment_types": [
            {"id": str(t.id), "name": t.name, "duration_minutes": t.duration_minutes}
            for t in rows
        ]
    }


__all__ = ["router"]
