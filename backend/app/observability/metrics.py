"""Metrics: booking success, reconciliation load, AI latency.

All three are plain aggregate queries over the tables the booking flows
already write — no separate metrics pipeline to drift from reality.
Percentiles are computed in Python so the same code runs on Postgres
and SQLite.
"""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.audit import AuditEvent
from app.domain.appointment.models import Appointment, AppointmentState
from app.mcp_server.models import (
    CapabilityExecution,
    Escalation,
    EscalationStatus,
)
from app.notification.models import Notification, NotificationStatus
from app.observability.tracing import SPAN_ACTION
from app.reliability.models import ReconciliationRecord, ResolutionStatus
from app.workflow.models import ExecutionStatus, WorkflowExecution

# Terminal booking states. Success = the patient has a live booking;
# everything else terminal counts against the rate.
_SUCCESS_STATES = {AppointmentState.confirmed, AppointmentState.completed}
_COUNTED_STATES = _SUCCESS_STATES | {
    AppointmentState.failed,
    AppointmentState.cancelled,
    AppointmentState.no_show,
}


def _percentile(sorted_vals: list[float], pct: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    rank = (len(sorted_vals) - 1) * (pct / 100)
    low, high = int(rank), min(int(rank) + 1, len(sorted_vals) - 1)
    frac = rank - low
    return sorted_vals[low] * (1 - frac) + sorted_vals[high] * frac


def _counts(session: Session, model, column) -> dict[str, int]:
    rows = (
        session.query(column, func.count())
        .select_from(model)
        .group_by(column)
        .all()
    )
    return {getattr(key, "value", key): int(n) for key, n in rows}


def booking_metrics(session: Session) -> dict[str, Any]:
    """Booking success rate over terminal states + raw state counts."""
    by_state = _counts(session, Appointment, Appointment.state)
    success = sum(by_state.get(s.value, 0) for s in _SUCCESS_STATES)
    total = sum(by_state.get(s.value, 0) for s in _COUNTED_STATES)
    return {
        "by_state": by_state,
        "terminal_total": total,
        "success_total": success,
        "success_rate": (success / total) if total else None,
    }


def reconciliation_metrics(session: Session) -> dict[str, Any]:
    """Operator queue depth by resolution status."""
    by_status = _counts(
        session, ReconciliationRecord, ReconciliationRecord.resolution_status
    )
    return {
        "by_status": by_status,
        "open": by_status.get(ResolutionStatus.open.value, 0),
        "total": sum(by_status.values()),
    }


def _chat_turn_durations_ms(session: Session) -> list[float]:
    rows = (
        session.query(AuditEvent)
        .filter(AuditEvent.action == SPAN_ACTION)
        .all()
    )
    durations = [
        float(row.meta["duration_ms"])
        for row in rows
        if isinstance(row.meta, dict)
        and row.meta.get("span") == "chat.turn"
        and isinstance(row.meta.get("duration_ms"), (int, float))
    ]
    return sorted(durations)


def ai_latency_metrics(session: Session) -> dict[str, Any]:
    """Chat-turn latency (p50/p95) + per-tool mean latency from executions."""
    durations = _chat_turn_durations_ms(session)
    per_tool_rows = (
        session.query(
            CapabilityExecution.tool_name,
            func.count(),
            func.avg(CapabilityExecution.latency_ms),
        )
        .group_by(CapabilityExecution.tool_name)
        .all()
    )
    return {
        "chat_turn": {
            "count": len(durations),
            "avg_ms": (sum(durations) / len(durations)) if durations else None,
            "p50_ms": _percentile(durations, 50),
            "p95_ms": _percentile(durations, 95),
            "max_ms": durations[-1] if durations else None,
        },
        "per_tool": {
            name: {"calls": int(n), "avg_ms": round(float(avg), 2)}
            for name, n, avg in per_tool_rows
        },
    }


def workflow_metrics(session: Session) -> dict[str, Any]:
    """Workflow, notification, and escalation health at a glance."""
    open_escalations = (
        session.query(func.count())
        .select_from(Escalation)
        .filter(Escalation.status == EscalationStatus.open)
        .scalar()
    )
    return {
        "workflows_by_status": _counts(
            session, WorkflowExecution, WorkflowExecution.status
        ),
        "notifications_by_status": _counts(
            session, Notification, Notification.status
        ),
        "open_escalations": int(open_escalations or 0),
        "escalation_statuses": _counts(
            session, Escalation, Escalation.status
        ),
    }


def overview(session: Session) -> dict[str, Any]:
    """Everything the metrics endpoint returns."""
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "booking": booking_metrics(session),
        "reconciliation": reconciliation_metrics(session),
        "ai_latency": ai_latency_metrics(session),
        "workflow": workflow_metrics(session),
    }


__all__ = [
    "ai_latency_metrics",
    "booking_metrics",
    "overview",
    "reconciliation_metrics",
    "workflow_metrics",
]
