"""Spans: timed blocks recorded into the audit log.

No collector, no new table, no new dependency: a span is one
`AuditEvent` row (`action="observability.span"`) carrying the ambient
correlation id, the span name, its duration, and caller-supplied
attributes. Because spans live in the same table as every other audit
row, the trace view picks them up with no special-casing — the chat
turn span is what makes "AI latency" queryable per request.

Spans never break the wrapped work: a failed span commit rolls back
and logs instead of raising.
"""

import logging
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy.orm import Session

from app.core.audit import write_audit_event
from app.observability.correlation import get_correlation_id

logger = logging.getLogger(__name__)

SPAN_ACTION = "observability.span"
SPAN_ENTITY = "observability.span"


@contextmanager
def span(
    session: Session, name: str, **attrs: Any
) -> Iterator[dict[str, Any]]:
    """Time a block and persist it as an audit row; yields mutable info.

    Callers can add attributes mid-block (`info["iterations"] = n`);
    they land in the row's metadata. Errors in the block are recorded
    on the span and re-raised.
    """
    info: dict[str, Any] = dict(attrs)
    start = time.perf_counter()
    error: str | None = None
    try:
        yield info
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        metadata: dict[str, Any] = {
            "span": name,
            "duration_ms": round((time.perf_counter() - start) * 1000, 2),
            **info,
        }
        if error is not None:
            metadata["error"] = error
        try:
            write_audit_event(
                session,
                action=SPAN_ACTION,
                entity_type=SPAN_ENTITY,
                entity_id=uuid.uuid4(),
                correlation_id=get_correlation_id(),
                metadata=metadata,
            )
            session.commit()
        except Exception:
            logger.warning("span '%s' commit failed", name, exc_info=True)
            session.rollback()


__all__ = ["SPAN_ACTION", "SPAN_ENTITY", "span"]
