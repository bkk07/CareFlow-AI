"""Hospital configuration CRUD: departments, specialties, appointment types.

All routes require a hospital-admin of the (approved) hospital in the path.
Deleting a specialty/department referenced by any doctor is blocked — never
cascade-nulled silently.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.tenant import hospital_scoped_query
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role
from app.domain.doctor.models import Doctor
from app.domain.hospital.deps import require_managed_hospital
from app.domain.hospital.models import Hospital
from app.domain.hospital_config.models import (
    AppointmentType,
    Department,
    Specialty,
)
from app.domain.hospital_config.schemas import (
    AppointmentTypeCreateIn,
    AppointmentTypeOut,
    AppointmentTypeUpdateIn,
    DepartmentCreateIn,
    DepartmentOut,
    DepartmentUpdateIn,
    SpecialtyCreateIn,
    SpecialtyOut,
    SpecialtyUpdateIn,
)

router = APIRouter(tags=["hospital-config"])


def _scoped_list(model, hospital: Hospital, ctx: RequestContext, db: Session):
    return (
        hospital_scoped_query(model, ctx, db)
        .filter(model.hospital_id == hospital.id)
        .order_by(model.name)
        .all()
    )


def _scoped_get(model, item_id: uuid.UUID, hospital: Hospital, db: Session):
    item = (
        db.query(model)
        .filter(model.id == item_id, model.hospital_id == hospital.id)
        .first()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
        )
    return item


def _conflict(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


# --- departments ---------------------------------------------------------------


@router.get("/hospitals/{hospital_id}/departments", response_model=list[DepartmentOut])
def list_departments(
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
):
    return _scoped_list(Department, hospital, ctx, db)


@router.post(
    "/hospitals/{hospital_id}/departments",
    response_model=DepartmentOut,
    status_code=201,
)
def create_department(
    body: DepartmentCreateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    dept = Department(hospital_id=hospital.id, name=body.name)
    db.add(dept)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict("A department with this name already exists") from None
    db.refresh(dept)
    return dept


@router.get(
    "/hospitals/{hospital_id}/departments/{department_id}",
    response_model=DepartmentOut,
)
def get_department(
    department_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    return _scoped_get(Department, department_id, hospital, db)


@router.put(
    "/hospitals/{hospital_id}/departments/{department_id}",
    response_model=DepartmentOut,
)
def update_department(
    department_id: uuid.UUID,
    body: DepartmentUpdateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    dept = _scoped_get(Department, department_id, hospital, db)
    dept.name = body.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict("A department with this name already exists") from None
    db.refresh(dept)
    return dept


@router.delete(
    "/hospitals/{hospital_id}/departments/{department_id}", status_code=204
)
def delete_department(
    department_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    dept = _scoped_get(Department, department_id, hospital, db)
    referencing = (
        db.query(Doctor).filter(Doctor.department_id == dept.id).count()
    )
    if referencing:
        raise _conflict(
            f"Cannot delete: referenced by {referencing} doctor(s)"
        )
    db.delete(dept)
    db.commit()
    return None


# --- specialties ---------------------------------------------------------------


@router.get("/hospitals/{hospital_id}/specialties", response_model=list[SpecialtyOut])
def list_specialties(
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
):
    return _scoped_list(Specialty, hospital, ctx, db)


@router.post(
    "/hospitals/{hospital_id}/specialties",
    response_model=SpecialtyOut,
    status_code=201,
)
def create_specialty(
    body: SpecialtyCreateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    spec = Specialty(hospital_id=hospital.id, name=body.name)
    db.add(spec)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict("A specialty with this name already exists") from None
    db.refresh(spec)
    return spec


@router.get(
    "/hospitals/{hospital_id}/specialties/{specialty_id}",
    response_model=SpecialtyOut,
)
def get_specialty(
    specialty_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    return _scoped_get(Specialty, specialty_id, hospital, db)


@router.put(
    "/hospitals/{hospital_id}/specialties/{specialty_id}",
    response_model=SpecialtyOut,
)
def update_specialty(
    specialty_id: uuid.UUID,
    body: SpecialtyUpdateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    spec = _scoped_get(Specialty, specialty_id, hospital, db)
    spec.name = body.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict("A specialty with this name already exists") from None
    db.refresh(spec)
    return spec


@router.delete(
    "/hospitals/{hospital_id}/specialties/{specialty_id}", status_code=204
)
def delete_specialty(
    specialty_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    spec = _scoped_get(Specialty, specialty_id, hospital, db)
    referencing = (
        db.query(Doctor).filter(Doctor.specialty_id == spec.id).count()
    )
    if referencing:
        raise _conflict(
            f"Cannot delete: referenced by {referencing} doctor(s)"
        )
    db.delete(spec)
    db.commit()
    return None


# --- appointment types -----------------------------------------------------------


def _validate_specialty_refs(
    db: Session, hospital: Hospital, specialty_ids: list[uuid.UUID]
) -> None:
    if not specialty_ids:
        return
    found = (
        db.query(Specialty.id)
        .filter(
            Specialty.hospital_id == hospital.id,
            Specialty.id.in_(specialty_ids),
        )
        .count()
    )
    if found != len(set(specialty_ids)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="compatible_specialty_ids must reference this hospital's specialties",
        )


@router.get(
    "/hospitals/{hospital_id}/appointment-types",
    response_model=list[AppointmentTypeOut],
)
def list_appointment_types(
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
):
    return _scoped_list(AppointmentType, hospital, ctx, db)


@router.post(
    "/hospitals/{hospital_id}/appointment-types",
    response_model=AppointmentTypeOut,
    status_code=201,
)
def create_appointment_type(
    body: AppointmentTypeCreateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    _validate_specialty_refs(db, hospital, body.compatible_specialty_ids)
    appt_type = AppointmentType(
        hospital_id=hospital.id,
        name=body.name,
        duration_minutes=body.duration_minutes,
        compatible_specialty_ids=[str(s) for s in body.compatible_specialty_ids],
    )
    db.add(appt_type)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict(
            "An appointment type with this name already exists"
        ) from None
    db.refresh(appt_type)
    return appt_type


@router.get(
    "/hospitals/{hospital_id}/appointment-types/{appointment_type_id}",
    response_model=AppointmentTypeOut,
)
def get_appointment_type(
    appointment_type_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    return _scoped_get(AppointmentType, appointment_type_id, hospital, db)


@router.put(
    "/hospitals/{hospital_id}/appointment-types/{appointment_type_id}",
    response_model=AppointmentTypeOut,
)
def update_appointment_type(
    appointment_type_id: uuid.UUID,
    body: AppointmentTypeUpdateIn,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    appt_type = _scoped_get(AppointmentType, appointment_type_id, hospital, db)
    _validate_specialty_refs(db, hospital, body.compatible_specialty_ids)
    appt_type.name = body.name
    appt_type.duration_minutes = body.duration_minutes
    appt_type.compatible_specialty_ids = [
        str(s) for s in body.compatible_specialty_ids
    ]
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict(
            "An appointment type with this name already exists"
        ) from None
    db.refresh(appt_type)
    return appt_type


@router.delete(
    "/hospitals/{hospital_id}/appointment-types/{appointment_type_id}",
    status_code=204,
)
def delete_appointment_type(
    appointment_type_id: uuid.UUID,
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
):
    appt_type = _scoped_get(AppointmentType, appointment_type_id, hospital, db)
    db.delete(appt_type)
    db.commit()
    return None
