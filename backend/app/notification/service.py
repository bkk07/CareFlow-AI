"""send_email() + create_in_app(): the two delivery paths.

Email goes through real SMTP (`SMTP_HOST/PORT/FROM`); without a server
the notification row records `failed` with the error — visible, never
swallowed. In-app delivery IS the row: creating it `sent` is the send,
and the unique `dedupe_key` makes redelivered tasks no-ops.
"""

import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

from sqlalchemy.orm import Session

from app.core.config import settings
from app.notification.models import (
    Notification,
    NotificationChannel,
    NotificationStatus,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def send_email(to_address: str, subject: str, body: str) -> None:
    """Deliver one email via SMTP; raises on any failure."""
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to_address
    message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        smtp.send_message(message)


def create_in_app(
    session: Session,
    *,
    recipient_user_id,
    type: str,
    detail: str,
    dedupe_key: str,
) -> tuple[Notification, bool]:
    """Store an in-app notification; returns (row, created).

    A repeated call with the same dedupe_key returns the existing row
    with created=False — a killed-and-redelivered worker task cannot
    double-notify.
    """
    existing = (
        session.query(Notification)
        .filter(Notification.dedupe_key == dedupe_key)
        .first()
    )
    if existing is not None:
        return existing, False
    row = Notification(
        recipient_user_id=recipient_user_id,
        channel=NotificationChannel.in_app,
        type=type,
        status=NotificationStatus.sent,
        dedupe_key=dedupe_key,
        body=detail,
        sent_at=_utcnow(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row, True


def deliver_email(
    session: Session,
    *,
    recipient_user_id,
    recipient_address: str,
    subject: str,
    body: str,
    type: str,
    dedupe_key: str,
) -> tuple[Notification, bool]:
    """Queue-and-send one email; failures land visibly on the row."""
    existing = (
        session.query(Notification)
        .filter(Notification.dedupe_key == dedupe_key)
        .first()
    )
    if existing is not None:
        return existing, False
    row = Notification(
        recipient_user_id=recipient_user_id,
        channel=NotificationChannel.email,
        type=type,
        status=NotificationStatus.pending,
        dedupe_key=dedupe_key,
        subject=subject,
        body=body,
    )
    session.add(row)
    session.commit()
    try:
        send_email(recipient_address, subject, body)
    except Exception as exc:
        row.status = NotificationStatus.failed
        row.error = f"{exc.__class__.__name__}: {exc}"[:500]
        session.commit()
        session.refresh(row)
        return row, True
    row.status = NotificationStatus.sent
    row.sent_at = _utcnow()
    session.commit()
    session.refresh(row)
    return row, True


__all__ = ["create_in_app", "deliver_email", "send_email"]
