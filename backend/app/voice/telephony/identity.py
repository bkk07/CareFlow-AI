"""Caller identity: phone lookup + spoken name/DOB confirmation.

The telephone channel has no JWT, so trust is built in two steps:
1. `find_patient_by_phone` maps the Twilio `From` number to a patient
   row (best effort — unknown numbers stay anonymous).
2. `verify_identity` compares the *spoken* name + date of birth against
   the matched profile. Only a match flips `caller_verified`, which is
   what unlocks patient-data tools in the orchestrator gate.

Comparisons are normalized (case/whitespace/punctuation-insensitive
names, digit-only phones) because speech transcripts are messy.
"""

import re
import uuid
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.domain.auth.models import Role, User
from app.domain.patient.models import PatientProfile
from app.domain.patient.service import normalize_phone

_NAME_JUNK = re.compile(r"[^a-z0-9]+")


def normalize_name(raw: str | None) -> str:
    return _NAME_JUNK.sub("", (raw or "").lower()).strip()


def find_patient_by_phone(db: Session, raw_phone: str | None) -> User | None:
    """Return the active patient whose profile phone matches the caller.

    Exact digit match first; otherwise a shared 10-digit suffix (country
    code present on one side only). Never matches non-patients.
    """
    digits = normalize_phone(raw_phone)
    if not digits:
        return None
    candidates = (
        db.query(PatientProfile).filter(PatientProfile.phone.isnot(None)).all()
    )
    match: PatientProfile | None = None
    for profile in candidates:
        stored = profile.phone or ""
        if stored == digits:
            match = profile
            break
    if match is None and len(digits) >= 10:
        suffix = digits[-10:]
        for profile in candidates:
            stored = profile.phone or ""
            if len(stored) >= 10 and stored[-10:] == suffix:
                match = profile
                break
    if match is None:
        return None
    user = db.get(User, match.patient_user_id)
    if user is None or user.role != Role.patient or not user.is_active:
        return None
    return user


def verify_identity(
    db: Session,
    *,
    patient_id: uuid.UUID,
    full_name: str,
    date_of_birth: str,
) -> dict[str, Any]:
    """Check spoken name + DOB against the matched profile.

    Returns {"verified": bool, "reason": str}. Never reveals the stored
    values — the agent must collect both from the caller first.
    """
    try:
        dob = date.fromisoformat((date_of_birth or "").strip())
    except ValueError:
        return {"verified": False, "reason": "date of birth must be YYYY-MM-DD"}
    profile = (
        db.query(PatientProfile)
        .filter(PatientProfile.patient_user_id == patient_id)
        .first()
    )
    if profile is None or not profile.full_name or profile.date_of_birth is None:
        return {"verified": False, "reason": "no identity on file for this number"}
    if normalize_name(profile.full_name) != normalize_name(full_name):
        return {"verified": False, "reason": "name does not match"}
    if profile.date_of_birth != dob:
        return {"verified": False, "reason": "date of birth does not match"}
    return {"verified": True, "reason": "identity confirmed"}


__all__ = ["find_patient_by_phone", "normalize_name", "verify_identity"]
