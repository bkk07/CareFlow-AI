"""Notification endpoints: patients and doctors read their own inbox."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role
from app.notification.models import Notification
from app.notification.schemas import NotificationOut

router = APIRouter(tags=["notifications"])

_reader = require_role(Role.patient, Role.doctor)


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_reader),
) -> list:
    return (
        db.query(Notification)
        .filter(Notification.recipient_user_id == ctx.user_id)
        .order_by(Notification.created_at.desc())
        .all()
    )


__all__ = ["router"]
