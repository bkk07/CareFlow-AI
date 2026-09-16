"""Patient self-service endpoints (patient role only, own rows only)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role, User
from app.domain.patient import service
from app.domain.patient.models import UserPreferences
from app.domain.patient.schemas import (
    PatientOut,
    PatientUpdateIn,
    PreferencesOut,
    PreferencesUpdateIn,
)

router = APIRouter(prefix="/patients", tags=["patients"])

_patient = require_role(Role.patient)


@router.get("/me", response_model=PatientOut)
def get_profile(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> User:
    return db.get(User, ctx.user_id)


@router.put("/me", response_model=PatientOut)
def update_profile(
    body: PatientUpdateIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> User:
    user = db.get(User, ctx.user_id)
    return service.update_patient_email(db, user, body.email)


@router.get("/me/preferences", response_model=PreferencesOut)
def get_preferences(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> UserPreferences:
    # Fresh patients get clean null defaults, never an error.
    return service.get_or_create_preferences(db, ctx.user_id)


@router.put("/me/preferences", response_model=PreferencesOut)
def update_preferences(
    body: PreferencesUpdateIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_patient),
) -> UserPreferences:
    return service.update_preferences(db, ctx.user_id, body)
