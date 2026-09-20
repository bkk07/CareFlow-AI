"""Notification model: one delivered (or visibly failed) message.

`dedupe_key` is unique so a redelivered Celery task can never double-send:
the second run finds the first run's row and returns it. Email delivery
attempts real SMTP; without a configured server the row stays `failed`
with the error — visible, never silently swallowed.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class NotificationChannel(str, enum.Enum):
    email = "email"
    in_app = "in_app"


class NotificationStatus(str, enum.Enum):
    pending = "pending"
    sent = "sent"
    failed = "failed"


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False, index=True
    )
    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel, name="notification_channel", validate_strings=True),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[NotificationStatus] = mapped_column(
        Enum(NotificationStatus, name="notification_status", validate_strings=True),
        nullable=False,
        default=NotificationStatus.pending,
    )
    dedupe_key: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )
    # Phase 15: which request/call caused this notification. Nullable so
    # pre-Phase-15 rows stay valid; always stamped on new rows.
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True, index=True
    )
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body: Mapped[str | None] = mapped_column(String(4000), nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # C4: server-side read state replaces the frontend localStorage stubs.
    is_read: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


__all__ = ["Notification", "NotificationChannel", "NotificationStatus"]
