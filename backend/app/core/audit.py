"""Audit log: model + write helper (used by every domain from here on).

Every status transition or sensitive operation writes an `AuditEvent` row
carrying actor, action, entity, tenant, correlation id, and metadata.
`correlation_id` ties together everything that happened as part of one
request or workflow; callers may pass one in (e.g. from the
`X-Correlation-ID` header) or a fresh one is generated.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, Session

from app.core.db import Base


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    hospital_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True, index=True
    )
    correlation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False, index=True, default=uuid.uuid4
    )
    # Attribute is `meta` because `metadata` is reserved on the declarative
    # Base; the column itself is named `metadata` per the data model.
    meta: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB().with_variant(JSON(), "sqlite"),
        nullable=False,
        default=dict,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


def write_audit_event(
    session: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID,
    hospital_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    correlation_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    """Stage (not commit) an audit row; the caller owns the transaction."""
    event = AuditEvent(
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        hospital_id=hospital_id,
        correlation_id=correlation_id or uuid.uuid4(),
        meta=metadata or {},
    )
    session.add(event)
    return event


__all__ = ["AuditEvent", "write_audit_event"]
