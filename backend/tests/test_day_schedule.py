"""Patient timeline UI: day schedule + free-start-time booking.

The patient app renders the doctor's working day as one timeline with
anonymous busy blocks and lets the patient pick ANY start time — the
backend accepts any [start, end) that matches the event duration, fits
inside working hours, and overlaps nothing.
"""

from datetime import datetime, timedelta

import pytest

from app.domain.appointment.router import get_integration_service
from app.integration.integration_service import IntegrationService
from app.main import app
from tests.test_appointments import FakeConnector, book, iso, seed_setup, slot_utc

MONDAY = "2026-10-05"  # a Monday

# 09:00-17:00 IST Monday rule -> UTC working window.
DAY_OPEN_UTC = datetime.fromisoformat(f"{MONDAY}T03:30:00+00:00")
DAY_CLOSE_UTC = datetime.fromisoformat(f"{MONDAY}T11:30:00+00:00")


@pytest.fixture()
def fake_connector():
    return FakeConnector()


@pytest.fixture()
def stub_integration(db, fake_connector):
    def _override():
        return IntegrationService(session=db, connector=fake_connector)

    app.dependency_overrides[get_integration_service] = _override
    yield fake_connector
    app.dependency_overrides.clear()


def day_schedule(client, setup, day=MONDAY):
    resp = client.post(
        "/mcp/call",
        json={
            "tool": "get_day_schedule",
            "input": {"doctor_id": setup["doctor"]["id"], "date": day},
        },
        headers=setup["patient"],
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["result"]


def test_day_schedule_shape_is_anonymous(client, stub_integration):
    setup = seed_setup(client, tag="daysched")
    result = day_schedule(client, setup)
    assert result["doctor_id"] == setup["doctor"]["id"]
    assert result["date"] == MONDAY
    assert result["working_hours"] == [
        {
            "start": DAY_OPEN_UTC.isoformat(),
            "end": DAY_CLOSE_UTC.isoformat(),
            "start_ist": "9:00 AM",
            "end_ist": "5:00 PM",
        }
    ]
    assert result["busy"] == []
    # No patient details may leak through the timeline payload.
    assert set(result.keys()) == {"doctor_id", "date", "working_hours", "busy"}
    for block in result["busy"]:
        assert set(block.keys()) == {"start", "end", "start_ist", "end_ist"}


def test_off_grid_start_books_when_free(client, stub_integration):
    """09:45-10:15 IST is not on the 30-min slot grid — still bookable."""
    setup = seed_setup(client, tag="dayfree")
    owner = setup["hosp"]["owner"]
    start = datetime.fromisoformat(f"{MONDAY}T04:15:00+00:00")
    resp = book(client, owner, setup, start, start + timedelta(minutes=30), "free-k1")
    assert resp.status_code in (201, 202), resp.text

    result = day_schedule(client, setup)
    assert result["busy"] == [
        {
            "start": start.isoformat(),
            "end": (start + timedelta(minutes=30)).isoformat(),
            "start_ist": "9:45 AM",
            "end_ist": "10:15 AM",
        }
    ]


def test_overlapping_range_rejected(client, stub_integration):
    setup = seed_setup(client, tag="dayclash")
    owner = setup["hosp"]["owner"]
    first = datetime.fromisoformat(f"{MONDAY}T04:15:00+00:00")
    assert (
        book(client, owner, setup, first, first + timedelta(minutes=30), "clash-k1").status_code
        in (201, 202)
    )
    # On-grid 04:30 start still overlaps the 04:15-04:45 hold.
    second = datetime.fromisoformat(f"{MONDAY}T04:30:00+00:00")
    clash = book(client, owner, setup, second, second + timedelta(minutes=30), "clash-k2")
    assert clash.status_code == 409, clash.text


def test_touching_boundary_allowed_but_overrun_rejected(client, stub_integration):
    setup = seed_setup(client, tag="dayedge")
    owner = setup["hosp"]["owner"]
    # 16:30-17:00 IST ends exactly at closing — allowed.
    close = DAY_CLOSE_UTC - timedelta(minutes=30)
    ok = book(client, owner, setup, close, DAY_CLOSE_UTC, "edge-k1")
    assert ok.status_code in (201, 202), ok.text
    # 16:45-17:15 IST exceeds working hours — rejected.
    late = DAY_CLOSE_UTC - timedelta(minutes=15)
    bad = book(client, owner, setup, late, late + timedelta(minutes=30), "edge-k2")
    assert bad.status_code == 409, bad.text


def test_wrong_duration_rejected(client, stub_integration):
    setup = seed_setup(client, tag="daydur")
    start, _ = slot_utc()
    resp = book(
        client,
        setup["hosp"]["owner"],
        setup,
        start,
        start + timedelta(minutes=45),
        "dur-k1",
    )
    assert resp.status_code == 422, resp.text
    assert "30 minutes" in resp.text


def test_booking_outside_working_hours_rejected(client, stub_integration):
    setup = seed_setup(client, tag="dayhours")
    start = datetime.fromisoformat(f"{MONDAY}T12:00:00+00:00")  # 17:30 IST
    resp = book(
        client,
        setup["hosp"]["owner"],
        setup,
        start,
        start + timedelta(minutes=30),
        "hours-k1",
    )
    assert resp.status_code == 409, resp.text
