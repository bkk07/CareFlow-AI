"""Failure classification: typed vendor errors -> retry policy.

The mapping is the whole point: a timeout says nothing about the
outcome (the vendor may have committed), so it is retryable only via
query-then-maybe-retry with the same idempotency key. A validation
rejection is definitive — retrying the same payload can never succeed.
Anything unrecognized is UNKNOWN: never blindly retried, parked for an
operator instead. RATE_LIMITED has no typed source in the connector yet
(the mock emits none); it rides the retryable path with backoff when a
vendor adds one.
"""

import enum

from app.integration.connector_interface import (
    EHRNetworkError,
    EHRServerError,
    EHRTimeoutError,
    EHRValidationError,
)
from app.reliability.models import OperationStatus


class FailureClass(str, enum.Enum):
    TRANSIENT_RETRYABLE = "transient_retryable"
    NOT_RETRYABLE_VALIDATION = "not_retryable_validation"
    RATE_LIMITED = "rate_limited"
    UNKNOWN = "unknown"


#: Automatic inline attempts per booking call before parking. Small on
#: purpose — the request path blocks for these; Phase 10 moves retries
#: to Celery and this becomes the per-activation budget instead.
MAX_RETRIES = 2

#: First retry waits this long, doubling per attempt (1s, 2s, ...).
RETRY_BACKOFF_BASE_S = 1.0


def classify(exc: BaseException) -> FailureClass:
    if isinstance(exc, EHRValidationError):
        return FailureClass.NOT_RETRYABLE_VALIDATION
    if isinstance(exc, (EHRTimeoutError, EHRNetworkError, EHRServerError)):
        return FailureClass.TRANSIENT_RETRYABLE
    return FailureClass.UNKNOWN


def operation_status_for(exc: BaseException) -> OperationStatus:
    if isinstance(exc, EHRTimeoutError):
        return OperationStatus.timed_out
    if isinstance(
        exc, (EHRNetworkError, EHRServerError, EHRValidationError)
    ):
        return OperationStatus.failed
    return OperationStatus.unknown


def retry_allowed(failure: FailureClass) -> bool:
    return failure in (
        FailureClass.TRANSIENT_RETRYABLE,
        FailureClass.RATE_LIMITED,
    )


def retry_delay_s(attempt_number: int, base_s: float = RETRY_BACKOFF_BASE_S) -> float:
    """Exponential backoff after a failed attempt (attempt 1 -> base)."""
    return base_s * (2 ** max(attempt_number - 1, 0))
