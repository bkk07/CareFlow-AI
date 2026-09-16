"""Debug fault injection for the mock EHR (demo/test environments only).

Each mode simulates a real vendor failure shape so the reliability layer
can be exercised deterministically:
- none: normal operation.
- timeout: appointment ops answer 504 (connector maps to EHRTimeoutError).
- network_error: appointment ops answer 503 (connector maps to EHRNetworkError).
- slow_5s: appointment ops sleep 5s, then behave normally (tests patience,
  not correctness — the connector timeout must exceed 5s).
- create_but_no_response: creates are PERSISTED but answered 504 — the
  classic unknown outcome: the vendor committed, the caller cannot tell.
  Resolution happens via idempotency-key lookup, never blind retry.
- server_error: appointment ops answer 500.

Faults apply to appointment operations only; patient/provider/facility
lookups stay reliable. `create_but_no_response` affects creates only —
other operations behave normally under it.
"""

import enum
import threading
import time

from fastapi import HTTPException

_state = {"mode": "none"}
_lock = threading.Lock()


class FaultMode(str, enum.Enum):
    none = "none"
    timeout = "timeout"
    network_error = "network_error"
    slow_5s = "slow_5s"
    create_but_no_response = "create_but_no_response"
    server_error = "server_error"


def get_fault_mode() -> FaultMode:
    with _lock:
        return FaultMode(_state["mode"])


def set_fault_mode(mode: FaultMode) -> FaultMode:
    with _lock:
        _state["mode"] = mode.value
        return mode


def is_create_blackhole() -> bool:
    return get_fault_mode() == FaultMode.create_but_no_response


def enforce_fault(operation: str) -> None:
    """Sleep or raise to simulate the active fault for an appointment op."""
    mode = get_fault_mode()
    if mode == FaultMode.none:
        return
    if mode == FaultMode.slow_5s:
        time.sleep(5)
        return
    if mode == FaultMode.create_but_no_response and operation != "create":
        return
    if mode == FaultMode.create_but_no_response and operation == "create":
        return  # handled post-commit by the create handler (blackhole)
    if mode == FaultMode.timeout:
        raise HTTPException(status_code=504, detail="Mock EHR timed out")
    if mode == FaultMode.network_error:
        raise HTTPException(status_code=503, detail="Mock EHR network failure")
    if mode == FaultMode.server_error:
        raise HTTPException(status_code=500, detail="Mock EHR internal error")
