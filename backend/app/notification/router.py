"""Notification endpoints: patients and doctors read their own inbox."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role
from app.notification.models import Notification
from app.notification.schemas import NotificationOut

router = APIRouter(tags=["notifications"])

_reader = require_role(Role.patient, Role.doctor)


def _own_or_404(db: Session, ctx: RequestContext, notification_id: uuid.UUID) -> Notification:
    row = db.get(Notification, notification_id)
    if row is None or row.recipient_user_id != ctx.user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found"
        )
    return row


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


@router.post("/notifications/read-all", response_model=dict)
def mark_all_read(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_reader),
) -> dict:
    """C4: mark the whole inbox read (static route stays above {id} routes)."""
    rows = (
        db.query(Notification)
        .filter(
            Notification.recipient_user_id == ctx.user_id,
            Notification.is_read.is_(False),
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    for row in rows:
        row.is_read = True
        row.read_at = now
    db.commit()
    return {"marked": len(rows)}


@router.get("/notifications/{notification_id}", response_model=NotificationOut)
def get_notification(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_reader),
) -> Notification:
    return _own_or_404(db, ctx, notification_id)


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_reader),
) -> Notification:
    """C4: server-side read receipt (replaces localStorage stubs)."""
    row = _own_or_404(db, ctx, notification_id)
    if not row.is_read:
        row.is_read = True
        row.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(row)
    return row


@router.delete("/notifications/{notification_id}", status_code=204)
def delete_notification(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_reader),
) -> None:
    row = _own_or_404(db, ctx, notification_id)
    db.delete(row)
    db.commit()
    return None


__all__ = ["router"]
