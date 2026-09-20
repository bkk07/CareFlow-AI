"""Notification schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.notification.models import NotificationChannel, NotificationStatus


class NotificationOut(BaseModel):
    id: uuid.UUID
    channel: NotificationChannel
    type: str
    status: NotificationStatus
    subject: str | None
    body: str | None
    error: str | None
    sent_at: datetime | None
    created_at: datetime
    # C4: read state (defaults keep old clients working).
    is_read: bool = False
    read_at: datetime | None = None
