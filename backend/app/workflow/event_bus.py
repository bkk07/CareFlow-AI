"""publish_event(): the single way state changes notify the world."""

import uuid

from sqlalchemy.orm import Session

from app.workflow.models import ExecutionStatus, WorkflowExecution
from app.workflow.tasks._base import handle_event, note


def publish_event(
    session: Session,
    event_type: str,
    payload: dict,
    correlation_id: uuid.UUID | None = None,
) -> WorkflowExecution:
    """Persist a running execution row, then hand it to the worker.

    Booking is never held hostage by the bus: if enqueueing fails the
    execution is marked failed with the reason instead of raising.
    """
    execution = WorkflowExecution(
        event_type=event_type,
        status=ExecutionStatus.running,
        payload=dict(payload),
        attempt=0,
        execution_history=[],
        correlation_id=correlation_id or uuid.uuid4(),
    )
    session.add(execution)
    session.commit()
    session.refresh(execution)
    note(execution, f"published '{event_type}'")
    session.commit()
    try:
        handle_event.delay(str(execution.id))
    except Exception as exc:
        execution.status = ExecutionStatus.failed
        note(execution, f"enqueue failed: {exc.__class__.__name__}: {exc}")
        session.commit()
    session.refresh(execution)
    return execution


__all__ = ["publish_event"]
