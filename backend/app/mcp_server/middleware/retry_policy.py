"""Retry middleware: bounded same-call retry for read-safe tools.

Only transient vendor faults (timeout / 5xx / network) are retried, at
most once, with no sleep — this guards a single flaky read, never a
write. Writes get their safety from idempotency keys plus the Phase 8
recovery path, not from blind re-execution.
"""

from typing import Callable, TypeVar

from app.integration.connector_interface import (
    EHRNetworkError,
    EHRServerError,
    EHRTimeoutError,
)

T = TypeVar("T")

_RETRYABLE = (EHRTimeoutError, EHRServerError, EHRNetworkError)


def run_retry_safe(fn: Callable[[], T]) -> T:
    try:
        return fn()
    except _RETRYABLE:
        return fn()


__all__ = ["run_retry_safe"]
