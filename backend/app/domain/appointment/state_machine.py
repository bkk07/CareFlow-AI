"""Explicit appointment state machine.

State is never written directly — every change goes through
`transition()`, which rejects anything outside ALLOWED_TRANSITIONS and
appends an AppointmentHistory row. Terminal states (cancelled,
completed, no_show, failed) have no outgoing edges.
"""

import uuid

from sqlalchemy.orm import Session

from app.domain.appointment.models import Appointment, AppointmentHistory, AppointmentState


class InvalidTransition(Exception):
    """Raised when a state change is not in ALLOWED_TRANSITIONS."""

    def __init__(self, from_state: AppointmentState, to_state: object) -> None:
        self.from_state = from_state
        self.to_state = to_state

        def _name(value: object) -> str:
            return getattr(value, "value", value)  # type: ignore[arg-type]

        super().__init__(
            f"Invalid appointment transition: {_name(from_state)} -> {_name(to_state)}"
        )


ALLOWED_TRANSITIONS: dict[AppointmentState, set[AppointmentState]] = {
    AppointmentState.requested: {
        AppointmentState.pending,
        AppointmentState.failed,
    },
    AppointmentState.pending: {
        AppointmentState.confirmed,
        AppointmentState.sync_pending,
        AppointmentState.failed,
    },
    AppointmentState.confirmed: {
        AppointmentState.rescheduled,
        AppointmentState.cancelled,
        AppointmentState.completed,
        AppointmentState.no_show,
    },
    # A rescheduled appointment is live at its new slot: it can move again
    # or be closed out exactly like a confirmed one. It can also park in
    # reconciliation when a move diverges, and resolve back to rescheduled
    # (never silently to confirmed — the move happened).
    AppointmentState.rescheduled: {
        AppointmentState.rescheduled,
        AppointmentState.reconciliation_required,
        AppointmentState.cancelled,
        AppointmentState.completed,
        AppointmentState.no_show,
    },
    AppointmentState.sync_pending: {
        AppointmentState.confirmed,
        AppointmentState.reconciliation_required,
        AppointmentState.failed,
    },
    AppointmentState.reconciliation_required: {
        AppointmentState.confirmed,
        AppointmentState.rescheduled,
        AppointmentState.cancelled,
        AppointmentState.failed,
    },
    AppointmentState.cancelled: set(),
    AppointmentState.completed: set(),
    AppointmentState.no_show: set(),
    AppointmentState.failed: set(),
}

#: States that keep holding the doctor's slot. Everything else
#: (cancelled, completed, no_show, failed) has released it.
LIVE_STATES: set[AppointmentState] = {
    AppointmentState.requested,
    AppointmentState.pending,
    AppointmentState.confirmed,
    AppointmentState.rescheduled,
    AppointmentState.sync_pending,
    AppointmentState.reconciliation_required,
}


def ensure_allowed(
    from_state: AppointmentState, to_state: AppointmentState
) -> None:
    if to_state not in ALLOWED_TRANSITIONS.get(from_state, set()):
        raise InvalidTransition(from_state, to_state)


def coerce_state(value: AppointmentState | str) -> AppointmentState:
    if isinstance(value, AppointmentState):
        return value
    try:
        return AppointmentState(value)
    except ValueError:
        raise InvalidTransition(value, value) from None


def transition(
    session: Session,
    appointment: Appointment,
    to_state: AppointmentState | str,
    *,
    actor_user_id: uuid.UUID | None = None,
    actor_system: str | None = None,
    reason: str | None = None,
    correlation_id: uuid.UUID | None = None,
) -> Appointment:
    """Move an appointment to `to_state` and record the history row.

    Raises InvalidTransition on any disallowed (or unknown) target.
    Exactly one of `actor_user_id` / `actor_system` is required. The
    history row is flushed; the caller owns the commit so multi-step
    flows (release slot + transition) stay atomic.
    """
    target = coerce_state(to_state)
    ensure_allowed(appointment.state, target)
    if (actor_user_id is None) == (actor_system is None):
        raise ValueError("Exactly one of actor_user_id / actor_system is required")
    history = AppointmentHistory(
        appointment_id=appointment.id,
        from_state=appointment.state,
        to_state=target,
        actor_user_id=actor_user_id,
        actor_system=actor_system,
        reason=reason,
        correlation_id=correlation_id or appointment.correlation_id,
    )
    session.add(history)
    appointment.state = target
    session.flush()
    return appointment
