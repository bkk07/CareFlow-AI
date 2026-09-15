"""Shared dependency for hospital-managed resources (config, doctors)."""

import uuid

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role
from app.domain.hospital import service
from app.domain.hospital.models import Hospital


def require_managed_hospital(
    hospital_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(require_role(Role.hospital_admin)),
) -> Hospital:
    """Hospital-admin callers acting on their own, approved hospital."""
    return service.get_managed_hospital(db, hospital_id, ctx)
