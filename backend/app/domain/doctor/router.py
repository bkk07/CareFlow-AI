"""Doctor CRUD + activation endpoints (hospital-admin, managed hospital)."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.core.tenant import hospital_scoped_query
from app.domain.auth.models import Role
from app.domain.doctor import service
from app.domain.doctor.models import Doctor
from app.domain.doctor.schemas import DoctorCreateIn, DoctorOut, DoctorUpdateIn
from app.domain.hospital.deps import require_managed_hospital
from app.domain.hospital.models import Hospital

router = APIRouter(tags=["doctors"])


@router.get("/hospitals/{hospital_id}/doctors", response_model=list[DoctorOut])
def list_doctors(
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
):
    return (
        hospital_scoped_query(Doctor, ctx, db)
        .filter(Doctor.hospital_id == hospital.id)
        .order_by(Doctor.name)
        .all()
    )


@router.post(
    "/hospitals/{hospital_id}/doctors", response_model=DoctorOut, status_code=201
)
def create_doctor(
    body: DoctorCreateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    return service.create_doctor(db, hospital, body)


@router.get("/hospitals/{hospital_id}/doctors/{doctor_id}", response_model=DoctorOut)
def get_doctor(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    return service.get_doctor_or_404(db, hospital, doctor_id)


@router.put("/hospitals/{hospital_id}/doctors/{doctor_id}", response_model=DoctorOut)
def update_doctor(
    doctor_id: uuid.UUID,
    body: DoctorUpdateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    return service.update_doctor(db, hospital, doctor, body)


@router.delete("/hospitals/{hospital_id}/doctors/{doctor_id}", status_code=204)
def delete_doctor(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    db.delete(doctor)
    db.commit()
    return None


@router.post(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/activate",
    response_model=DoctorOut,
)
def activate_doctor(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    return service.activate(db, hospital, doctor)


@router.post(
    "/hospitals/{hospital_id}/doctors/{doctor_id}/deactivate",
    response_model=DoctorOut,
)
def deactivate_doctor(
    doctor_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    doctor = service.get_doctor_or_404(db, hospital, doctor_id)
    return service.deactivate(db, doctor)
