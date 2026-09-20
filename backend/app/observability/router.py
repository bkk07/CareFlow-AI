"""Trace + metrics surface (Phase 15).

`GET /observability/trace/{correlation_id}` assembles one full story —
conversation, AI decision, capability, scheduling, EHR op,
verification, sync, workflow, notification — from the rows those layers
already write, ordered by time. No collector, no sampling: the
correlation id IS the trace id.

`GET /observability/metrics` returns booking success rate,
reconciliation depth, and AI latency for the (basic) dashboard.
"""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.audit import AuditEvent
from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.appointment.models import Appointment, AppointmentHistory
from app.domain.auth.models import Role
from app.mcp_server.models import CapabilityExecution, Escalation
from app.notification.models import Notification
from app.observability import metrics as metrics_mod
from app.reliability.models import (
    IntegrationOperation,
    IntegrationVerification,
    ReconciliationRecord,
)
from app.workflow.models import WorkflowExecution

router = APIRouter(prefix="/observability", tags=["observability"])


def _iso(ts: datetime | None) -> str | None:
    return ts.isoformat() if ts is not None else None


def _maybe_uuid(raw: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        return None


def _appointment_ids_from_executions(
    executions: list[CapabilityExecution],
) -> set[uuid.UUID]:
    found: set[uuid.UUID] = set()
    for row in executions:
        if isinstance(row.input, dict):
            ref = _maybe_uuid(row.input.get("appointment_id"))
            if ref is not None:
                found.add(ref)
    return found


def trace_timeline(session: Session, correlation_id: uuid.UUID) -> dict[str, Any]:
    """Assemble every row carrying this correlation id, in time order."""
    audits = (
        session.query(AuditEvent)
        .filter(AuditEvent.correlation_id == correlation_id)
        .all()
    )
    executions = (
        session.query(CapabilityExecution)
        .filter(CapabilityExecution.correlation_id == correlation_id)
        .all()
    )
    appointments = (
        session.query(Appointment)
        .filter(Appointment.correlation_id == correlation_id)
        .all()
    )
    history = (
        session.query(AppointmentHistory)
        .filter(AppointmentHistory.correlation_id == correlation_id)
        .all()
    )
    operations = (
        session.query(IntegrationOperation)
        .filter(IntegrationOperation.correlation_id == correlation_id)
        .all()
    )
    workflows = (
        session.query(WorkflowExecution)
        .filter(WorkflowExecution.correlation_id == correlation_id)
        .all()
    )
    notifications = (
        session.query(Notification)
        .filter(Notification.correlation_id == correlation_id)
        .all()
    )

    appointment_ids = {a.id for a in appointments} | (
        _appointment_ids_from_executions(executions)
    )
    op_ids = {op.id for op in operations}
    verifications = (
        session.query(IntegrationVerification)
        .filter(IntegrationVerification.operation_id.in_(op_ids))
        .all()
        if op_ids
        else []
    )
    reconciliations = (
        session.query(ReconciliationRecord)
        .filter(ReconciliationRecord.appointment_id.in_(appointment_ids))
        .all()
        if appointment_ids
        else []
    )
    escalations = (
        session.query(Escalation)
        .filter(Escalation.appointment_id.in_(appointment_ids))
        .all()
        if appointment_ids
        else []
    )

    items: list[dict[str, Any]] = []
    for row in audits:
        meta = row.meta if isinstance(row.meta, dict) else {}
        if row.action == "observability.span":
            layer = "conversation"
            summary = f"span {meta.get('span')} ({meta.get('duration_ms')} ms)"
        elif row.action == "telephony.inbound":
            layer = "conversation"
            summary = f"inbound call from {meta.get('caller', '?')}"
        elif row.entity_type.startswith("appointment"):
            layer = "scheduling"
            summary = f"{row.action} {row.entity_type}"
        else:
            layer = "domain"
            summary = f"{row.action} {row.entity_type}"
        items.append(
            {
                "at": _iso(row.created_at),
                "layer": layer,
                "kind": "audit",
                "summary": summary,
                "ref": str(row.id),
                "_sort": row.created_at,
            }
        )
    for row in executions:
        items.append(
            {
                "at": _iso(row.created_at),
                "layer": "ai_decision",
                "kind": "capability",
                "summary": (
                    f"{row.tool_name} {row.status.value} "
                    f"({round(row.latency_ms, 1)} ms)"
                    + (f" error={row.error}" if row.error else "")
                ),
                "ref": str(row.id),
                "_sort": row.created_at,
            }
        )
    for row in appointments:
        items.append(
            {
                "at": _iso(row.created_at),
                "layer": "scheduling",
                "kind": "appointment",
                "summary": (
                    f"appointment {row.id} state={row.state.value} "
                    f"external={row.external_id or '-'}"
                ),
                "ref": str(row.id),
                "_sort": row.created_at,
            }
        )
    for row in history:
        items.append(
            {
                "at": _iso(row.created_at),
                "layer": "scheduling",
                "kind": "transition",
                "summary": (
                    f"{row.from_state.value} -> {row.to_state.value}"
                    + (f" ({row.reason})" if row.reason else "")
                ),
                "ref": str(row.id),
                "_sort": row.created_at,
            }
        )
    for row in operations:
        items.append(
            {
                "at": _iso(row.created_at),
                "layer": "ehr",
                "kind": "operation",
                "summary": (
                    f"vendor {row.operation_type.value} {row.status.value}"
                    + (f" error={row.error}" if row.error else "")
                ),
                "ref": str(row.id),
                "_sort": row.created_at,
            }
        )
    for row in verifications:
        items.append(
            {
                "at": _iso(row.verified_at),
                "layer": "ehr",
                "kind": "verification",
                "summary": (
                    f"vendor record {'matches' if row.verified_bool else 'DIVERGES'}"
                ),
                "ref": str(row.id),
                "_sort": row.verified_at,
            }
        )
    for row in reconciliations:
        items.append(
            {
                "at": _iso(row.created_at),
                "layer": "reliability",
                "kind": "reconciliation",
                "summary": (
                    f"reconciliation {row.resolution_status.value}: {row.error}"
                ),
                "ref": str(row.id),
                "_sort": row.created_at,
            }
        )
    for row in workflows:
        items.append(
            {
                "at": _iso(row.created_at),
                "layer": "workflow",
                "kind": "workflow",
                "summary": f"{row.event_type} {row.status.value}",
                "ref": str(row.id),
                "_sort": row.created_at,
            }
        )
    for row in notifications:
        items.append(
            {
                "at": _iso(row.created_at),
                "layer": "notification",
                "kind": "notification",
                "summary": (
                    f"{row.channel.value} {row.type} {row.status.value}"
                    + (f" error={row.error}" if row.error else "")
                ),
                "ref": str(row.id),
                "_sort": row.created_at,
            }
        )
    for row in escalations:
        items.append(
            {
                "at": _iso(row.created_at),
                "layer": "escalation",
                "kind": "escalation",
                "summary": f"{row.status.value}: {row.reason[:120]}",
                "ref": str(row.id),
                "_sort": row.created_at,
            }
        )

    items.sort(key=lambda item: (item["_sort"] is None, item["_sort"]))
    for item in items:
        del item["_sort"]
    return {
        "correlation_id": str(correlation_id),
        "items": items,
        "layers": sorted({item["layer"] for item in items}),
    }


_ops = require_role(Role.hospital_admin, Role.platform_admin)


def _trace_hospital_ids(
    session: Session, correlation_id: uuid.UUID
) -> set[uuid.UUID]:
    """Every non-null hospital attribution on this correlation's rows."""
    found: set[uuid.UUID] = set()
    for row in (
        session.query(Appointment.hospital_id)
        .filter(Appointment.correlation_id == correlation_id)
        .all()
    ):
        if row[0] is not None:
            found.add(row[0])
    for row in (
        session.query(AuditEvent.hospital_id)
        .filter(AuditEvent.correlation_id == correlation_id)
        .all()
    ):
        if row[0] is not None:
            found.add(row[0])
    for row in (
        session.query(CapabilityExecution.hospital_id)
        .filter(CapabilityExecution.correlation_id == correlation_id)
        .all()
    ):
        if row[0] is not None:
            found.add(row[0])
    appointment_ids = {
        a.id
        for a in session.query(Appointment.id)
        .filter(Appointment.correlation_id == correlation_id)
        .all()
    }
    if appointment_ids:
        for row in (
            session.query(ReconciliationRecord.hospital_id)
            .filter(ReconciliationRecord.appointment_id.in_(appointment_ids))
            .all()
        ):
            if row[0] is not None:
                found.add(row[0])
        for row in (
            session.query(Escalation.hospital_id)
            .filter(Escalation.appointment_id.in_(appointment_ids))
            .all()
        ):
            if row[0] is not None:
                found.add(row[0])
    return found


@router.get("/trace/{correlation_id}")
def get_trace(
    correlation_id: uuid.UUID,
    appointment_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_ops),
) -> dict[str, Any]:
    """Full trace/log view for one correlation id.

    With `?appointment_id=` the booking's own correlation is resolved
    first — the booking turn's id is the one the UI holds.

    Hospital admins may only view traces attributed to their own
    hospital; anything else (including other tenants' traces) reads as
    404 so one tenant cannot probe another's activity. Correlation ids
    are unguessable UUIDs, so there is no list/enumeration surface.
    """
    if appointment_id is not None:
        appointment = db.get(Appointment, appointment_id)
        if appointment is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Appointment not found",
            )
        if (
            ctx.role != Role.platform_admin
            and appointment.hospital_id != ctx.hospital_id
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Appointment not found",
            )
        correlation_id = appointment.correlation_id
    view = trace_timeline(db, correlation_id)
    if not view["items"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No records for this correlation id",
        )
    if ctx.role != Role.platform_admin:
        attributed = _trace_hospital_ids(db, correlation_id)
        if any(hid != ctx.hospital_id for hid in attributed):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No records for this correlation id",
            )
    return view


@router.get("/metrics")
def get_metrics(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_ops),
) -> dict[str, Any]:
    """Booking success rate, reconciliation depth, AI latency.

    Platform admins see the global view; hospital admins see only their
    own hospital's data.
    """
    if ctx.role == Role.platform_admin:
        return metrics_mod.overview(db)
    return metrics_mod.overview(db, hospital_id=ctx.hospital_id)


__all__ = ["router", "trace_timeline"]
