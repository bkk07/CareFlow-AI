"""Platform admin views (Phase 13): cross-hospital lists, AI evaluation,
audit log. Platform admins bypass tenant scoping; every other role is
rejected at the door.
"""

import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.audit import AuditEvent
from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.appointment import service as appointment_service
from app.domain.appointment.models import Appointment, AppointmentState
from app.domain.appointment.schemas import AppointmentOut
from app.domain.auth.models import Role, User
from app.domain.doctor.models import Doctor, DoctorStatus
from app.domain.doctor import service as doctor_service
from app.domain.doctor.schemas import DoctorOut
from app.domain.hospital.models import Hospital, HospitalStatus
from app.domain.scheduling.availability import as_utc
from app.integration.mapping.models import ExternalIdentifierMapping
from app.mcp_server.models import (
    CapabilityExecution,
    Escalation,
    EscalationStatus,
    ExecutionStatus,
)
from app.reliability.models import (
    IntegrationOperation,
    IntegrationVerification,
    ReconciliationRecord,
    ResolutionStatus,
)

router = APIRouter(tags=["platform"])

_platform = require_role(Role.platform_admin)


@router.get("/platform/doctors", response_model=list[DoctorOut])
def platform_list_doctors(
    hospital_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_platform),
) -> list:
    del ctx
    query = db.query(Doctor).order_by(Doctor.name)
    if hospital_id is not None:
        query = query.filter(Doctor.hospital_id == hospital_id)
    return doctor_service.attach_login_emails(db, query.all())


@router.get("/platform/patients")
def platform_list_patients(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_platform),
    limit: int = 100,
) -> dict:
    del ctx
    rows = (
        db.query(User)
        .filter(User.role == Role.patient)
        .order_by(User.created_at.desc())
        .limit(min(max(limit, 1), 500))
        .all()
    )
    return {
        "patients": [
            {
                "id": str(u.id),
                "email": u.email,
                "is_active": u.is_active,
                "created_at": as_utc(u.created_at).isoformat(),
            }
            for u in rows
        ]
    }


@router.get("/platform/appointments", response_model=list[AppointmentOut])
def platform_list_appointments(
    hospital_id: uuid.UUID | None = None,
    state: AppointmentState | None = None,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_platform),
) -> list:
    del ctx
    return appointment_service.list_appointments(
        db, hospital_id=hospital_id, state=state
    )


@router.get("/platform/ai-evaluation")
def platform_ai_evaluation(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_platform),
) -> dict:
    """Tool usage aggregates over the CapabilityExecution log (Phase 9 data)."""
    del ctx
    return _ai_evaluation(db)


def _ai_evaluation(db: Session) -> dict:
    rows = (
        db.query(
            CapabilityExecution.tool_name,
            func.count(CapabilityExecution.id),
            func.sum(
                case(
                    (
                        CapabilityExecution.status == ExecutionStatus.error,
                        1,
                    ),
                    else_=0,
                )
            ),
            func.avg(CapabilityExecution.latency_ms),
        )
        .group_by(CapabilityExecution.tool_name)
        .order_by(CapabilityExecution.tool_name)
        .all()
    )
    total = sum(r[1] for r in rows)
    errors = sum(int(r[2] or 0) for r in rows)
    return {
        "executions_total": total,
        "errors_total": errors,
        "error_rate": (errors / total) if total else 0.0,
        "by_tool": [
            {
                "tool_name": name,
                "calls": calls,
                "errors": int(errs or 0),
                "avg_latency_ms": float(avg) if avg is not None else None,
            }
            for name, calls, errs, avg in rows
        ],
    }


@router.get("/platform/audit-events")
def platform_audit_events(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_platform),
    action: str | None = None,
    hospital_id: uuid.UUID | None = None,
    limit: int = 100,
) -> dict:
    del ctx
    query = db.query(AuditEvent).order_by(AuditEvent.created_at.desc())
    if action is not None:
        query = query.filter(AuditEvent.action == action)
    if hospital_id is not None:
        query = query.filter(AuditEvent.hospital_id == hospital_id)
    rows = query.limit(min(max(limit, 1), 500)).all()
    return {
        "events": [
            {
                "id": str(e.id),
                "action": e.action,
                "entity_type": e.entity_type,
                "entity_id": str(e.entity_id),
                "hospital_id": str(e.hospital_id) if e.hospital_id else None,
                "actor_user_id": str(e.actor_user_id) if e.actor_user_id else None,
                "correlation_id": str(e.correlation_id),
                "created_at": as_utc(e.created_at).isoformat(),
            }
            for e in rows
        ]
    }


@router.get("/platform/overview")
def platform_overview(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_platform),
) -> dict:
    """Network-wide counts for the platform overview cards."""
    del ctx
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    hospitals = db.query(Hospital).all()
    by_status: dict[str, int] = Counter(h.status.value for h in hospitals)
    doctors = db.query(Doctor).all()
    today = (
        db.query(Appointment)
        .filter(
            Appointment.slot_start >= day_start.replace(tzinfo=None),
            Appointment.slot_start < day_end.replace(tzinfo=None),
        )
        .count()
    )
    return {
        "hospitals_total": len(hospitals),
        "hospitals_by_status": dict(by_status),
        "pending_applications": sum(
            by_status.get(s, 0) for s in ("submitted", "under_review")
        ),
        "doctors_total": len(doctors),
        "doctors_active": sum(1 for d in doctors if d.status == DoctorStatus.active),
        "patients_total": db.query(User).filter(User.role == Role.patient).count(),
        "appointments_today": today,
        "open_reconciliations": db.query(ReconciliationRecord)
        .filter(ReconciliationRecord.resolution_status == ResolutionStatus.open)
        .count(),
        "open_escalations": db.query(Escalation)
        .filter(Escalation.status == EscalationStatus.open)
        .count(),
    }


@router.get("/platform/integrations")
def platform_integrations(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_platform),
) -> dict:
    """Per-hospital vendor-connection health across the network."""
    del ctx
    day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    out = []
    for hospital in db.query(Hospital).order_by(Hospital.name).all():
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
        ops = (
            db.query(IntegrationOperation)
            .join(Appointment, Appointment.id == IntegrationOperation.appointment_id)
            .filter(Appointment.hospital_id == hospital.id)
            .all()
        )
        by_status: dict[str, int] = Counter(o.status.value for o in ops)
        verifications = (
            db.query(IntegrationVerification)
            .join(Appointment, Appointment.id == IntegrationVerification.appointment_id)
            .filter(
                Appointment.hospital_id == hospital.id,
                IntegrationVerification.verified_at >= day_ago.replace(tzinfo=None),
            )
            .count()
        )
        out.append(
            {
                "hospital_id": str(hospital.id),
                "hospital_name": hospital.name,
                "hospital_status": hospital.status.value,
                "vendor_mappings": mappings,
                "open_reconciliations": open_records,
                "operations_total": len(ops),
                "operations_by_status": dict(by_status),
                "verifications_24h": verifications,
            }
        )
    return {"integrations": out}


@router.get("/platform/analytics")
def platform_analytics(
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_platform),
) -> dict:
    """Network-level booking + AI trends."""
    del ctx
    rows = db.query(Appointment).all()
    by_state: dict[str, int] = Counter(a.state.value for a in rows)
    per_day: dict[str, int] = Counter(
        as_utc(a.created_at).date().isoformat() for a in rows
    )
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    daily = {day: count for day, count in sorted(per_day.items()) if day >= cutoff}
    ai = _ai_evaluation(db)
    return {
        "appointments_total": len(rows),
        "appointments_by_state": dict(by_state),
        "bookings_per_day_30d": daily,
        "ai_executions_total": ai["executions_total"],
        "ai_error_rate": ai["error_rate"],
        "ai_by_tool": ai["by_tool"],
    }


__all__ = ["router"]
