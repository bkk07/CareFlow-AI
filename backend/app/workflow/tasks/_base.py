"""Shared task runtime: session factory hook + handler registry.

`handle_event` is the single Celery task; each plan task file registers
its event handler here. `set_session_factory` / `set_integration_factory`
are test hooks so eager tasks run on the test session with a stubbed
vendor connector. `acks_late` means a worker killed mid-task gets the
event redelivered — handlers stay idempotent via dedupe keys, so the
retry notifies nothing twice.
"""

import uuid
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.integration.integration_service import IntegrationService
from app.workflow.celery_app import celery_app
from app.workflow.models import ExecutionStatus, WorkflowExecution

_session_factory: Callable[[], Session] | None = None
_integration_factory: Callable[[Session], IntegrationService] | None = None

HANDLERS: dict[str, Callable[[Session, WorkflowExecution, dict], None]] = {}


def set_session_factory(factory: Callable[[], Session] | None) -> None:
    global _session_factory
    _session_factory = factory


def set_integration_factory(
    factory: Callable[[Session], IntegrationService] | None,
) -> None:
    global _integration_factory
    _integration_factory = factory


def get_session() -> tuple[Session, bool]:
    """Return (session, owned); test sessions are never closed here."""
    if _session_factory is not None:
        return _session_factory(), False
    return SessionLocal(), True


def build_integration(session: Session) -> IntegrationService:
    if _integration_factory is not None:
        return _integration_factory(session)
    return IntegrationService(session=session)


def handler(event_type: str):
    def decorator(fn):
        HANDLERS[event_type] = fn
        return fn

    return decorator


def note(execution: WorkflowExecution, message: str) -> None:
    history = list(execution.execution_history or [])
    history.append({"event": message})
    execution.execution_history = history


@celery_app.task(
    name="careflow.handle_event", bind=True, acks_late=True, max_retries=0
)
def handle_event(self, execution_id: str) -> dict:
    """Run one published event to completed/failed. Never raises."""
    del self
    db, owned = get_session()
    try:
        try:
            execution = db.get(WorkflowExecution, uuid.UUID(execution_id))
        except (ValueError, AttributeError):
            return {"ok": False, "error": "bad execution id"}
        if execution is None:
            return {"ok": False, "error": "execution not found"}
        if execution.status == ExecutionStatus.completed:
            return {"ok": True, "duplicate": True}
        execution.attempt += 1
        fn = HANDLERS.get(execution.event_type)
        if fn is None:
            execution.status = ExecutionStatus.failed
            note(execution, f"no handler for event '{execution.event_type}'")
            db.commit()
            return {"ok": False, "error": "unknown event type"}
        try:
            fn(db, execution, dict(execution.payload or {}))
        except Exception as exc:
            execution.status = ExecutionStatus.failed
            note(execution, f"handler failed: {exc.__class__.__name__}: {exc}")
            db.commit()
            return {"ok": False, "error": str(exc)}
        if execution.status == ExecutionStatus.running:
            execution.status = ExecutionStatus.completed
            note(execution, "completed")
        db.commit()
        return {"ok": True, "status": execution.status.value}
    finally:
        if owned:
            db.close()


# Import handler modules for their registration side effects.
from app.workflow.tasks import (  # noqa: E402,F401
    on_appointment_booked,
    on_appointment_cancelled,
    on_appointment_rescheduled,
    retry_ehr_create,
    send_reminder,
)

__all__ = [
    "HANDLERS",
    "build_integration",
    "get_session",
    "handle_event",
    "handler",
    "note",
    "set_integration_factory",
    "set_session_factory",
]
