"""unit/state_transitions: the machine, not callers, owns state changes."""

import uuid

import pytest

from app.domain.appointment.models import (
    AppointmentHistory,
    AppointmentState,
)
from app.domain.appointment.state_machine import (
    InvalidTransition,
    coerce_state,
    ensure_allowed,
    transition,
)
from tests.test_mcp_agent import seed_setup, slot_iso


def rest_book(client, setup, key):
    start, end = slot_iso()
    return client.post(
        "/appointments",
        json={
            "patient_id": setup["patient"]["id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": key,
        },
        headers=setup["patient"]["headers"],
    )


def test_legal_edges_pass_and_illegal_edges_raise():
    ensure_allowed(AppointmentState.confirmed, AppointmentState.completed)
    ensure_allowed(
        AppointmentState.reconciliation_required, AppointmentState.confirmed
    )
    with pytest.raises(InvalidTransition):
        ensure_allowed(AppointmentState.confirmed, AppointmentState.requested)
    with pytest.raises(InvalidTransition):
        ensure_allowed(AppointmentState.completed, AppointmentState.cancelled)


def test_coerce_state_rejects_unknown_values():
    assert coerce_state("confirmed") == AppointmentState.confirmed
    assert coerce_state(AppointmentState.failed) == AppointmentState.failed
    with pytest.raises(InvalidTransition):
        coerce_state("bogus-state")


def test_transition_appends_history_with_correlation(client, db, ehr_stub):
    from app.domain.appointment.models import Appointment

    setup = seed_setup(client, tag="ustate")
    resp = rest_book(client, setup, "ustate-k1")
    assert resp.status_code == 201, resp.text
    appt = db.get(Appointment, uuid.UUID(resp.json()["id"]))

    transition(
        db, appt, AppointmentState.completed, actor_system="unit-test"
    )
    db.commit()
    assert appt.state == AppointmentState.completed
    rows = (
        db.query(AppointmentHistory)
        .filter(AppointmentHistory.appointment_id == appt.id)
        .all()
    )
    assert {(r.from_state, r.to_state) for r in rows} >= {
        (AppointmentState.confirmed, AppointmentState.completed)
    }
    assert {r.correlation_id for r in rows} == {appt.correlation_id}


def test_transition_requires_exactly_one_actor(client, db, ehr_stub):
    from app.domain.appointment.models import Appointment

    setup = seed_setup(client, tag="ustateactor")
    resp = rest_book(client, setup, "ustate-k2")
    assert resp.status_code == 201, resp.text
    appt = db.get(Appointment, uuid.UUID(resp.json()["id"]))
    with pytest.raises(ValueError):
        transition(db, appt, AppointmentState.completed)
