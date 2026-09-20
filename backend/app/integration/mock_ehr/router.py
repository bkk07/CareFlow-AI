"""Mock EHR vendor API (a separate mini-app in miniature).

Unauthenticated by design: a real vendor exposes its own credentials and
network boundary, not our user JWTs. The `_debug` fault switch additionally
requires a non-production environment.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.integration.mock_ehr import fault_injection
from app.integration.mock_ehr.fault_injection import FaultMode
from app.integration.mock_ehr.models import (
    MockAppointment,
    MockAppointmentStatus,
    MockFacility,
    MockPatient,
    MockProvider,
)
from app.integration.mock_ehr.schemas import (
    AppointmentCreateIn,
    AppointmentUpdateIn,
    FacilityLookupIn,
    FaultModeIn,
    FaultModeOut,
    MockAppointmentOut,
    MockFacilityOut,
    MockPatientOut,
    MockProviderOut,
    PatientLookupIn,
    ProviderLookupIn,
)

router = APIRouter(prefix="/mock-ehr", tags=["mock-ehr"])


def _require_debug_env() -> None:
    if settings.environment not in ("local", "test", "dev"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Fault injection is disabled outside demo/test environments",
        )


def _require_aware(value, label: str):
    if value.tzinfo is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{label} must carry a timezone",
        )
    return value


# --- debug ---------------------------------------------------------------------


@router.get("/_debug/fault-mode", response_model=FaultModeOut)
def read_fault_mode() -> FaultModeOut:
    _require_debug_env()
    return FaultModeOut(mode=fault_injection.get_fault_mode())


@router.post("/_debug/fault-mode", response_model=FaultModeOut)
def write_fault_mode(body: FaultModeIn) -> FaultModeOut:
    _require_debug_env()
    return FaultModeOut(mode=fault_injection.set_fault_mode(body.mode))


# --- lookups: get-or-create so sync never hardcodes vendor ids ------------------


@router.post("/patients/lookup", response_model=MockPatientOut)
def lookup_patient(body: PatientLookupIn, db: Session = Depends(get_db)):
    patient = db.query(MockPatient).filter(MockPatient.mrn == body.mrn).first()
    if patient is None:
        patient = MockPatient(
            mrn=body.mrn, full_name=body.full_name, dob=body.dob, phone=body.phone
        )
        db.add(patient)
        try:
            db.commit()
        except IntegrityError:
            # R4: concurrent syncs race the same vendor record.
            db.rollback()
            return db.query(MockPatient).filter(MockPatient.mrn == body.mrn).one()
        db.refresh(patient)
    return patient


@router.post("/providers/lookup", response_model=MockProviderOut)
def lookup_provider(body: ProviderLookupIn, db: Session = Depends(get_db)):
    provider = (
        db.query(MockProvider)
        .filter(MockProvider.provider_code == body.provider_code)
        .first()
    )
    if provider is None:
        provider = MockProvider(
            provider_code=body.provider_code,
            full_name=body.full_name,
            specialty=body.specialty,
        )
        db.add(provider)
        try:
            db.commit()
        except IntegrityError:
            # R4: concurrent syncs race the same vendor record.
            db.rollback()
            return (
                db.query(MockProvider)
                .filter(MockProvider.provider_code == body.provider_code)
                .one()
            )
        db.refresh(provider)
    return provider


@router.post("/facilities/lookup", response_model=MockFacilityOut)
def lookup_facility(body: FacilityLookupIn, db: Session = Depends(get_db)):
    facility = (
        db.query(MockFacility).filter(MockFacility.code == body.code).first()
    )
    if facility is None:
        facility = MockFacility(code=body.code, name=body.name)
        db.add(facility)
        try:
            db.commit()
        except IntegrityError:
            # R4: concurrent syncs race the same vendor record.
            db.rollback()
            return db.query(MockFacility).filter(MockFacility.code == body.code).one()
        db.refresh(facility)
    return facility


# --- appointments ----------------------------------------------------------------


def _by_id(db: Session, appointment_id: uuid.UUID) -> MockAppointment:
    appt = db.get(MockAppointment, appointment_id)
    if appt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor appointment not found",
        )
    return appt


@router.get("/appointments/by-key/{idempotency_key}", response_model=MockAppointmentOut)
def get_by_key(idempotency_key: str, db: Session = Depends(get_db)):
    appt = (
        db.query(MockAppointment)
        .filter(MockAppointment.idempotency_key == idempotency_key)
        .first()
    )
    if appt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No vendor appointment for this idempotency key",
        )
    return appt


@router.post("/appointments", response_model=MockAppointmentOut, status_code=201)
def create_appointment(body: AppointmentCreateIn, db: Session = Depends(get_db)):
    fault_injection.enforce_fault("create")
    start = _require_aware(body.start_datetime, "start_datetime")
    end = _require_aware(body.end_datetime, "end_datetime")
    if end <= start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="end_datetime must be after start_datetime",
        )
    if db.get(MockPatient, body.patient_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unknown vendor patient",
        )
    if db.get(MockProvider, body.provider_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unknown vendor provider",
        )
    if body.facility_id is not None and db.get(MockFacility, body.facility_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unknown vendor facility",
        )
    existing = (
        db.query(MockAppointment)
        .filter(MockAppointment.idempotency_key == body.idempotency_key)
        .first()
    )
    if existing is not None:
        return existing  # idempotent replay: same key, same record
    appt = MockAppointment(
        patient_id=body.patient_id,
        provider_id=body.provider_id,
        facility_id=body.facility_id,
        start_datetime=start,
        end_datetime=end,
        status=MockAppointmentStatus.scheduled.value,
        idempotency_key=body.idempotency_key,
    )
    db.add(appt)
    try:
        db.commit()
    except IntegrityError:
        # Lost a create race on the same key — return the winner's row.
        db.rollback()
        return (
            db.query(MockAppointment)
            .filter(MockAppointment.idempotency_key == body.idempotency_key)
            .one()
        )
    db.refresh(appt)
    if fault_injection.is_create_blackhole():
        # The vendor committed but the response never arrives: the caller
        # must resolve this via idempotency-key lookup, never blind retry.
        raise HTTPException(status_code=504, detail="Mock EHR timed out")
    return appt


@router.get("/appointments/{appointment_id}", response_model=MockAppointmentOut)
def get_appointment(appointment_id: uuid.UUID, db: Session = Depends(get_db)):
    fault_injection.enforce_fault("retrieve")
    return _by_id(db, appointment_id)


@router.put("/appointments/{appointment_id}", response_model=MockAppointmentOut)
def update_appointment(
    appointment_id: uuid.UUID,
    body: AppointmentUpdateIn,
    db: Session = Depends(get_db),
):
    fault_injection.enforce_fault("update")
    appt = _by_id(db, appointment_id)
    if appt.status != MockAppointmentStatus.scheduled.value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Only scheduled vendor appointments can be updated",
        )
    start = _require_aware(body.start_datetime, "start_datetime")
    end = _require_aware(body.end_datetime, "end_datetime")
    if end <= start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="end_datetime must be after start_datetime",
        )
    appt.start_datetime = start
    appt.end_datetime = end
    db.commit()
    db.refresh(appt)
    return appt


@router.delete("/appointments/{appointment_id}", response_model=MockAppointmentOut)
def cancel_appointment(appointment_id: uuid.UUID, db: Session = Depends(get_db)):
    fault_injection.enforce_fault("cancel")
    appt = _by_id(db, appointment_id)
    appt.status = MockAppointmentStatus.cancelled.value  # idempotent: repeat cancels succeed
    db.commit()
    db.refresh(appt)
    return appt
