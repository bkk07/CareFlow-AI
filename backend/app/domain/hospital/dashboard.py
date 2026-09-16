"""Hospital dashboard endpoints (Phase 13): overview, AI activity,
integration status, analytics. All read-only aggregates over data the
earlier phases already store — no new tables.
"""

from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.appointment.models import Appointment, AppointmentState
from app.domain.auth.models import Role
from app.domain.doctor.models import Doctor, DoctorStatus
from app.domain.hospital.deps import require_managed_hospital
from app.domain.hospital.models import Hospital
from app.domain.scheduling.availability import as_utc
from app.integration.mapping.models import ExternalIdentifierMapping
from app.mcp_server.models import CapabilityExecution
from app.reliability.models import (
    IntegrationOperation,
    IntegrationVerification,
    ReconciliationRecord,
    ResolutionStatus,
)

router = APIRouter(tags=["hospital-dashboard"])

_admin = require_role(Role.hospital_admin)


def _week_bounds() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    return now - timedelta(days=7), now


@router.get("/hospitals/{hospital_id}/overview")
def hospital_overview(
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> dict:
    del ctx
    week_start, now = _week_bounds()
    doctors = (
        db.query(Doctor).filter(Doctor.hospital_id == hospital.id).all()
    )
    week_appts = (
        db.query(Appointment)
        .filter(
            Appointment.hospital_id == hospital.id,
            Appointment.slot_start >= week_start.replace(tzinfo=None),
            Appointment.slot_start < now.replace(tzinfo=None),
        )
        .all()
    )
    pending = (
        db.query(ReconciliationRecord)
        .filter(
            ReconciliationRecord.hospital_id == hospital.id,
            ReconciliationRecord.resolution_status == ResolutionStatus.open,
        )
        .count()
    )
    upcoming = (
        db.query(Appointment)
        .filter(
            Appointment.hospital_id == hospital.id,
            Appointment.slot_start >= now.replace(tzinfo=None),
            Appointment.state.in_(
                [
                    AppointmentState.confirmed,
                    AppointmentState.rescheduled,
                    AppointmentState.sync_pending,
                    AppointmentState.reconciliation_required,
                    AppointmentState.pending,
                ]
            ),
        )
        .count()
    )
    return {
        "hospital_id": str(hospital.id),
        "doctors_total": len(doctors),
        "doctors_active": sum(1 for d in doctors if d.status == DoctorStatus.active),
        "appointments_this_week": len(week_appts),
        "upcoming_appointments": upcoming,
        "pending_reconciliations": pending,
    }


@router.get("/hospitals/{hospital_id}/ai-activity")
def hospital_ai_activity(
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
    tool: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> dict:
    del ctx
    query = (
        db.query(CapabilityExecution)
        .filter(CapabilityExecution.hospital_id == hospital.id)
        .order_by(CapabilityExecution.created_at.desc())
        .limit(min(max(limit, 1), 100))
    )
    rows = query.all()
    if tool is not None:
        rows = [r for r in rows if r.tool_name == tool]
    if status is not None:
        rows = [r for r in rows if r.status.value == status]
    return {
        "hospital_id": str(hospital.id),
        "executions": [
            {
                "id": str(r.id),
                "tool_name": r.tool_name,
                "status": r.status.value,
                "latency_ms": r.latency_ms,
                "correlation_id": str(r.correlation_id),
                "actor_user_id": str(r.actor_user_id) if r.actor_user_id else None,
                "error": r.error,
                "created_at": as_utc(r.created_at).isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/hospitals/{hospital_id}/integration-status")
def hospital_integration_status(
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> dict:
    del ctx
    mappings = (
        db.query(ExternalIdentifierMapping)
        .filter(ExternalIdentifierMapping.hospital_id == hospital.id)
        .count()
    )
    open_records = (
        db.query(ReconciliationRecord)
        .filter(
            ReconciliationRecord.hospital_id == hospital.id,
            ReconciliationRecord.resolution_status == ResolutionStatus.open,
        )
        .count()
    )
    recent_ops = (
        db.query(IntegrationOperation)
        .join(Appointment, Appointment.id == IntegrationOperation.appointment_id)
        .filter(Appointment.hospital_id == hospital.id)
        .order_by(IntegrationOperation.created_at.desc())
        .limit(10)
        .all()
    )
    day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    verifications = (
        db.query(IntegrationVerification)
        .join(Appointment, Appointment.id == IntegrationVerification.appointment_id)
        .filter(
            Appointment.hospital_id == hospital.id,
            IntegrationVerification.verified_at >= day_ago.replace(tzinfo=None),
        )
        .all()
    )
    verify_counts = Counter(
        "matched" if v.verified_bool else "mismatched" for v in verifications
    )
    return {
        "hospital_id": str(hospital.id),
        "vendor_mappings": mappings,
        "open_reconciliations": open_records,
        "verifications_24h": dict(verify_counts),
        "recent_operations": [
            {
                "id": str(op.id),
                "appointment_id": str(op.appointment_id),
                "operation_type": op.operation_type.value,
                "status": op.status.value,
                "attempt_number": op.attempt_number,
                "error": op.error,
            }
            for op in recent_ops
        ],
    }


@router.get("/hospitals/{hospital_id}/analytics")
def hospital_analytics(
    hospital: Hospital = Depends(require_managed_hospital),
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_admin),
) -> dict:
    del ctx
    rows = (
        db.query(Appointment)
        .filter(Appointment.hospital_id == hospital.id)
        .all()
    )
    by_state: dict[str, int] = Counter(a.state.value for a in rows)
    per_day: dict[str, int] = Counter(
        as_utc(a.created_at).date().isoformat() for a in rows
    )
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    daily = {day: count for day, count in sorted(per_day.items()) if day >= cutoff}
    avg_latency = db.query(func.avg(CapabilityExecution.latency_ms)).filter(
        CapabilityExecution.hospital_id == hospital.id,
        CapabilityExecution.status == "success",
    ).scalar()
    return {
        "hospital_id": str(hospital.id),
        "appointments_total": len(rows),
        "appointments_by_state": dict(by_state),
        "bookings_per_day_30d": daily,
        "tool_success_avg_latency_ms": float(avg_latency)
        if avg_latency is not None
        else None,
    }


__all__ = ["router"]
