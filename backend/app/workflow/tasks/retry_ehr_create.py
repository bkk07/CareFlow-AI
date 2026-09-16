"""retry_ehr_create — the automatic recovery sweep (was inline in Phase 8).

Beat publishes `reconciliation.sweep`; each activation re-drives every
open record once (`force=True`, so one vendor attempt per activation —
the Phase 8 budget governs the request path, Celery owns background
retries). Automatic re-drives stop after RECOVERY_SWEEP_MAX_ATTEMPTS so
a dead vendor is not hammered forever; the record stays open for the
operator. Converged records auto-resolve via the shared consistency
check, and one bad record never aborts the sweep.
"""

from sqlalchemy.orm import Session

from app.domain.appointment.service import get_appointment_or_404
from app.reliability import operations
from app.reliability.models import ReconciliationRecord, ResolutionStatus
from app.reliability.reconciliation import service as reconcile_service
from app.workflow.models import WorkflowExecution
from app.workflow.tasks._base import build_integration, handler, note

#: Automatic re-drives per record before it rests open for an operator.
#: With the hourly beat this is roughly ten hours of background retry.
RECOVERY_SWEEP_MAX_ATTEMPTS = 10


@handler("reconciliation.sweep")
def retry_ehr_create(
    session: Session, execution: WorkflowExecution, payload: dict
) -> None:
    del payload
    records = (
        session.query(ReconciliationRecord)
        .filter(ReconciliationRecord.resolution_status == ResolutionStatus.open)
        .order_by(ReconciliationRecord.created_at)
        .all()
    )
    integration = build_integration(session)
    swept, resolved = 0, 0
    for record in records:
        if record.attempts >= RECOVERY_SWEEP_MAX_ATTEMPTS:
            note(
                execution,
                f"record {record.id} left for the operator "
                f"after {record.attempts} attempts",
            )
            continue
        try:
            appointment = get_appointment_or_404(session, record.appointment_id)
            appointment = reconcile_service.drive_recovery(
                session,
                appointment,
                integration,
                actor_user_id=appointment.patient_id,
                force=True,
                backoff_base_s=0,
            )
            record.attempts += 1
            db_note = reconcile_service.consistency_note(
                session, appointment, integration
            )
            if db_note is not None:
                operations.set_resolution(
                    session, record, ResolutionStatus.resolved, note=db_note
                )
                resolved += 1
            else:
                session.commit()
            swept += 1
        except Exception as exc:
            session.rollback()
            note(
                execution,
                f"record {record.id} skipped: {exc.__class__.__name__}: {exc}",
            )
    note(execution, f"recovery sweep: {swept} re-driven, {resolved} resolved")
