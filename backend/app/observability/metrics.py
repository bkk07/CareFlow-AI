"""Metrics: booking success, reconciliation load, AI latency.

All three are plain aggregate queries over the tables the booking flows
already write — no separate metrics pipeline to drift from reality.
Percentiles are computed in Python so the same code runs on Postgres
and SQLite.
"""

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

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


def booking_metrics(
    session: Session, hospital_id: UUID | None = None
) -> dict[str, Any]:
    """Booking success rate over terminal states + raw state counts."""
    query = session.query(Appointment.state, func.count()).select_from(Appointment)
    if hospital_id is not None:
        query = query.filter(Appointment.hospital_id == hospital_id)
    by_state = {getattr(key, "value", key): int(n) for key, n in query.group_by(Appointment.state).all()}
    success = sum(by_state.get(s.value, 0) for s in _SUCCESS_STATES)
    total = sum(by_state.get(s.value, 0) for s in _COUNTED_STATES)
    return {
        "by_state": by_state,
        "terminal_total": total,
        "success_total": success,
        "success_rate": (success / total) if total else None,
    }


def reconciliation_metrics(
    session: Session, hospital_id: UUID | None = None
) -> dict[str, Any]:
    """Operator queue depth by resolution status."""
    query = session.query(
        ReconciliationRecord.resolution_status, func.count()
    ).select_from(ReconciliationRecord)
    if hospital_id is not None:
        query = query.filter(ReconciliationRecord.hospital_id == hospital_id)
    by_status = {
        getattr(key, "value", key): int(n)
        for key, n in query.group_by(ReconciliationRecord.resolution_status).all()
    }
    return {
        "by_status": by_status,
        "open": by_status.get(ResolutionStatus.open.value, 0),
        "total": sum(by_status.values()),
    }


def _chat_turn_durations_ms(
    session: Session, hospital_id: UUID | None = None
) -> list[float]:
    query = session.query(AuditEvent).filter(AuditEvent.action == SPAN_ACTION)
    if hospital_id is not None:
        cids = _hospital_correlation_ids(session, hospital_id)
        query = query.filter(
            _tenant_or_own_correlation_filter(AuditEvent, hospital_id, cids)
        )
    rows = query.all()
    durations = [
        float(row.meta["duration_ms"])
        for row in rows
        if isinstance(row.meta, dict)
        and row.meta.get("span") == "chat.turn"
        and isinstance(row.meta.get("duration_ms"), (int, float))
    ]
    return sorted(durations)


def ai_latency_metrics(
    session: Session, hospital_id: UUID | None = None
) -> dict[str, Any]:
    """Chat-turn latency (p50/p95) + per-tool mean latency from executions."""
    durations = _chat_turn_durations_ms(session, hospital_id)
    tool_query = session.query(
        CapabilityExecution.tool_name,
        func.count(),
        func.avg(CapabilityExecution.latency_ms),
    )
    if hospital_id is not None:
        cids = _hospital_correlation_ids(session, hospital_id)
        tool_query = tool_query.filter(
            _tenant_or_own_correlation_filter(
                CapabilityExecution, hospital_id, cids
            )
        )
    per_tool_rows = tool_query.group_by(CapabilityExecution.tool_name).all()
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


def _hospital_correlation_ids(
    session: Session, hospital_id: UUID
) -> set[Any]:
    """Correlation ids of a hospital's appointments.

    Workflow executions and notifications carry no hospital column, so a
    hospital-scoped view joins them through the appointments they belong
    to. Anything unattributable is excluded from the scoped view rather
    than leaked across tenants.
    """
    rows = (
        session.query(Appointment.correlation_id)
        .filter(Appointment.hospital_id == hospital_id)
        .all()
    )
    return {row[0] for row in rows}


def _tenant_or_own_correlation_filter(model, hospital_id: UUID, cids: set[Any]):
    """Rows attributed to this hospital, plus unattributed rows whose
    correlation belongs to one of the hospital's appointments (e.g.
    patient-driven tool calls and spans, which carry no hospital id)."""
    return (
        (model.hospital_id == hospital_id)
        | (
            model.hospital_id.is_(None)
            & model.correlation_id.in_(cids)
        )
    )


def workflow_metrics(
    session: Session, hospital_id: UUID | None = None
) -> dict[str, Any]:
    """Workflow, notification, and escalation health at a glance."""
    esc_query = session.query(func.count()).select_from(Escalation)
    esc_status_query = session.query(Escalation.status, func.count()).select_from(
        Escalation
    )
    wf_query = session.query(
        WorkflowExecution.status, func.count()
    ).select_from(WorkflowExecution)
    notif_query = session.query(Notification.status, func.count()).select_from(
        Notification
    )
    if hospital_id is not None:
        esc_query = esc_query.filter(Escalation.hospital_id == hospital_id)
        esc_status_query = esc_status_query.filter(
            Escalation.hospital_id == hospital_id
        )
        cids = _hospital_correlation_ids(session, hospital_id)
        wf_query = wf_query.filter(WorkflowExecution.correlation_id.in_(cids))
        notif_query = notif_query.filter(Notification.correlation_id.in_(cids))
    open_escalations = esc_query.filter(
        Escalation.status == EscalationStatus.open
    ).scalar()
    return {
        "workflows_by_status": {
            getattr(key, "value", key): int(n)
            for key, n in wf_query.group_by(WorkflowExecution.status).all()
        },
        "notifications_by_status": {
            getattr(key, "value", key): int(n)
            for key, n in notif_query.group_by(Notification.status).all()
        },
        "open_escalations": int(open_escalations or 0),
        "escalation_statuses": {
            getattr(key, "value", key): int(n)
            for key, n in esc_status_query.group_by(Escalation.status).all()
        },
    }


def overview(
    session: Session, hospital_id: UUID | None = None
) -> dict[str, Any]:
    """Everything the metrics endpoint returns.

    With `hospital_id` set, every section is scoped to that hospital;
    rows that cannot be attributed to a hospital are excluded rather
    than leaked across tenants.
    """
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "booking": booking_metrics(session, hospital_id),
        "reconciliation": reconciliation_metrics(session, hospital_id),
        "ai_latency": ai_latency_metrics(session, hospital_id),
        "workflow": workflow_metrics(session, hospital_id),
    }


__all__ = [
    "ai_latency_metrics",
    "booking_metrics",
    "overview",
    "reconciliation_metrics",
    "workflow_metrics",
]
