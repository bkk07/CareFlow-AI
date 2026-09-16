"""Trust-but-verify: every vendor "success" is re-read before it counts.

`verify_external_appointment` fetches the vendor record and diffs it
against internal state. It never raises for vendor trouble — a missing
record is divergence (the vendor lost our booking), a failed read is
unknown (we learned nothing). Each check writes its evidence row so an
operator can see exactly what was compared.
"""

import enum
import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment
from app.integration.connector_interface import EHRConnectorError, EHRNotFoundError
from app.integration.integration_service import IntegrationService
from app.reliability import operations
from app.reliability.models import IntegrationVerification, OperationStatus, OperationType
from app.reliability.synchronization import service as sync_service


class VerifyOutcome(str, enum.Enum):
    matched = "matched"
    mismatched = "mismatched"
    unknown = "unknown"


@dataclass(frozen=True)
class VerifyResult:
    outcome: VerifyOutcome
    mismatches: list[str]
    operation_id: uuid.UUID


def _record_verification(
    session: Session,
    appointment: Appointment,
    *,
    outcome: VerifyOutcome,
    status: OperationStatus,
    details: dict,
    error: str | None = None,
) -> VerifyResult:
    operation = operations.record_operation(
        session,
        appointment_id=appointment.id,
        operation_type=OperationType.verify,
        attempt_number=operations.next_attempt_number(
            session, appointment.id, OperationType.verify
        ),
        status=status,
        request_payload={"external_id": appointment.external_id},
        error=error,
        correlation_id=appointment.correlation_id,
    )
    session.add(
        IntegrationVerification(
            operation_id=operation.id,
            appointment_id=appointment.id,
            verified_bool=outcome == VerifyOutcome.matched,
            details=details,
        )
    )
    session.flush()
    return VerifyResult(
        outcome=outcome,
        mismatches=list(details.get("mismatches", [])),
        operation_id=operation.id,
    )


def verify_external_appointment(
    session: Session,
    appointment: Appointment,
    integration: IntegrationService,
    *,
    read_attempts: int = 2,
) -> VerifyResult:
    """Re-read the vendor record and compare. Never raises for vendor errors."""
    if appointment.external_id is None:
        return _record_verification(
            session,
            appointment,
            outcome=VerifyOutcome.unknown,
            status=OperationStatus.unknown,
            details={},
            error="No vendor record linked",
        )
    last_error: EHRConnectorError | None = None
    for _ in range(max(read_attempts, 1)):
        try:
            external = integration.get_appointment(appointment.external_id)
        except EHRNotFoundError:
            return _record_verification(
                session,
                appointment,
                outcome=VerifyOutcome.mismatched,
                status=OperationStatus.failed,
                details={"mismatches": ["vendor record missing"]},
            )
        except EHRConnectorError as exc:
            last_error = exc
            continue
        mismatches = sync_service.diff_appointment(session, appointment, external)
        return _record_verification(
            session,
            appointment,
            outcome=VerifyOutcome.matched if not mismatches else VerifyOutcome.mismatched,
            status=OperationStatus.succeeded,
            details={"mismatches": mismatches},
        )
    assert last_error is not None
    from app.reliability.failure_classifier import operation_status_for

    return _record_verification(
        session,
        appointment,
        outcome=VerifyOutcome.unknown,
        status=operation_status_for(last_error),
        details={},
        error=f"Verify read failed: {type(last_error).__name__}: {last_error}",
    )
