"""Platform admin views (Phase 13): cross-hospital lists, AI evaluation,
audit log. Platform admins bypass tenant scoping; every other role is
rejected at the door.
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.audit import AuditEvent
from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.appointment import service as appointment_service
from app.domain.appointment.models import AppointmentState
from app.domain.appointment.schemas import AppointmentOut
from app.domain.auth.models import Role, User
from app.domain.doctor.models import Doctor
from app.domain.doctor.schemas import DoctorOut
from app.domain.scheduling.availability import as_utc
from app.mcp_server.models import CapabilityExecution, ExecutionStatus

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
    return query.all()


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


__all__ = ["router"]
