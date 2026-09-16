"""Unit tests for the pure availability engine (no DB, no I/O)."""

from datetime import date, datetime, time, timezone

import pytest

from app.domain.scheduling import availability
from app.domain.scheduling.availability import Window, overlaps
from app.domain.scheduling.models import AvailabilityRule, Recurrence

MONDAY = date(2026, 9, 14)  # a Monday
TUESDAY = date(2026, 9, 15)

assert MONDAY.weekday() == 0 and TUESDAY.weekday() == 1


def weekly(day_of_week=0, start=(9, 0), end=(17, 0), **kwargs):
    return AvailabilityRule(
        doctor_id=None,
        day_of_week=day_of_week,
        start_time=time(*start),
        end_time=time(*end),
        recurrence=Recurrence.weekly,
        **kwargs,
    )


def one_off(day, start=(9, 0), end=(17, 0), **kwargs):
    return AvailabilityRule(
        doctor_id=None,
        day_of_week=None,
        start_time=time(*start),
        end_time=time(*end),
        recurrence=Recurrence.one_off,
        valid_from=day,
        valid_to=kwargs.pop("valid_to", day),
        **kwargs,
    )


def utc(day, hour, minute=0):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)


def test_weekly_rule_expands_only_on_matching_weekday():
    rule = weekly()
    windows = availability.expand_rules_to_windows([rule], MONDAY)
    assert windows == [Window(utc(MONDAY, 9), utc(MONDAY, 17))]
    assert availability.expand_rules_to_windows([rule], TUESDAY) == []


def test_validity_bounds_restrict_weekly_rule():
    rule = weekly(valid_from=date(2026, 9, 21), valid_to=date(2026, 9, 28))
    assert availability.expand_rules_to_windows([rule], MONDAY) == []
    assert len(availability.expand_rules_to_windows([rule], date(2026, 9, 21))) == 1


def test_one_off_overrides_weekly_on_same_date():
    short_day = one_off(MONDAY, start=(10, 0), end=(14, 0))
    windows = availability.expand_rules_to_windows([weekly(), short_day], MONDAY)
    assert windows == [Window(utc(MONDAY, 10), utc(MONDAY, 14))]
    # Other Mondays still follow the weekly rule.
    assert availability.expand_rules_to_windows(
        [weekly(), short_day], date(2026, 9, 21)
    ) == [Window(utc(date(2026, 9, 21), 9), utc(date(2026, 9, 21), 17))]


def test_overlapping_windows_union_within_tier():
    morning = weekly(start=(9, 0), end=(12, 0))
    afternoon = weekly(start=(12, 0), end=(17, 0))
    windows = availability.expand_rules_to_windows([morning, afternoon], MONDAY)
    assert windows == [Window(utc(MONDAY, 9), utc(MONDAY, 17))]


def test_slicing_drops_trailing_stub():
    windows = [Window(utc(MONDAY, 9), utc(MONDAY, 10))]
    assert availability.slice_windows(windows, 30) == [
        Window(utc(MONDAY, 9), utc(MONDAY, 9, 30)),
        Window(utc(MONDAY, 9, 30), utc(MONDAY, 10)),
    ]
    assert len(availability.slice_windows(windows, 45)) == 1
    # Duration longer than the window yields nothing.
    assert availability.slice_windows(windows, 61) == []
    with pytest.raises(ValueError):
        availability.slice_windows(windows, 0)


def test_subtraction_drops_overlapping_keeps_touching():
    slots = [
        Window(utc(MONDAY, 9), utc(MONDAY, 9, 30)),
        Window(utc(MONDAY, 9, 30), utc(MONDAY, 10)),
        Window(utc(MONDAY, 10), utc(MONDAY, 10, 30)),
    ]
    # Block overlaps the middle slot; touching the third is fine.
    busy = [Window(utc(MONDAY, 9, 45), utc(MONDAY, 10))]
    remaining = availability.subtract_intervals(slots, busy)
    assert remaining == [slots[0], slots[2]]


def test_naive_datetimes_treated_as_utc():
    slot = Window(utc(MONDAY, 9), utc(MONDAY, 9, 30))
    naive_block = Window(
        datetime(2026, 9, 14, 9, 15), datetime(2026, 9, 14, 9, 45)
    )
    assert availability.subtract_intervals([slot], [naive_block]) == []
    assert overlaps(slot.start, slot.end, naive_block[0], naive_block[1])


def test_inverted_rule_rejected():
    bad = weekly(start=(17, 0), end=(9, 0))
    with pytest.raises(ValueError):
        availability.expand_rules_to_windows([bad], MONDAY)
