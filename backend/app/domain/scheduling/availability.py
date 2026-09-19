"""Pure availability math: no DB, no I/O, trivially unit-testable.

Precedence contract (the rule this module implements):
1. Per date, `one_off` rules covering that date WIN over `weekly` rules —
   when any one_off rule covers a date, weekly rules are ignored for it
   (this is how a short-day or holiday override works).
2. Within the winning tier, overlapping or adjacent windows are UNIONED
   (this is what makes split shifts like 09:00-12:00 + 13:00-17:00 work).
3. A candidate slot must fit ENTIRELY within one contiguous window — a
   duration longer than any single window yields no slots.
4. A slot survives only if it overlaps no blocked/booked interval.
   Touching boundaries (a block ending exactly when the slot starts) do
   NOT count as overlap.
5. Rule clock-times are IST (Asia/Kolkata, UTC+5:30, no DST) wall time —
   a 09:00-17:00 rule means 09:00-17:00 India time. Windows are converted
   to UTC for storage/comparison, so patients in IST see the hours the
   doctor entered. Naive datetimes are treated as UTC because SQLite
   returns naive values — `as_utc()` is applied at every boundary.
"""

from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, NamedTuple

#: Hospital working timezone. Fixed offset (no DST in India).
IST = timezone(timedelta(hours=5, minutes=30), name="IST")


class Window(NamedTuple):
    start: datetime
    end: datetime


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _recurrence_of(rule) -> str:
    recurrence = getattr(rule, "recurrence")
    return recurrence.value if hasattr(recurrence, "value") else str(recurrence)


def rule_covers_date(rule, day: date) -> bool:
    """True when `rule` contributes availability on `day` (tier-agnostic)."""
    valid_from = getattr(rule, "valid_from", None)
    valid_to = getattr(rule, "valid_to", None)
    if valid_from is not None and day < valid_from:
        return False
    if valid_to is not None and day > valid_to:
        return False
    if _recurrence_of(rule) == "weekly":
        return getattr(rule, "day_of_week", None) == day.weekday()
    return True


def expand_rules_to_windows(rules: Iterable, day: date) -> list[Window]:
    """Expand rules to merged UTC windows for a single IST date."""
    rules = list(rules)
    one_offs = [
        r for r in rules if _recurrence_of(r) == "one_off" and rule_covers_date(r, day)
    ]
    tier = (
        one_offs
        if one_offs
        else [
            r
            for r in rules
            if _recurrence_of(r) == "weekly" and rule_covers_date(r, day)
        ]
    )
    windows: list[Window] = []
    for rule in tier:
        start_time: time = rule.start_time
        end_time: time = rule.end_time
        if end_time <= start_time:
            raise ValueError("AvailabilityRule end_time must be after start_time")
        # Rule times are IST wall time; convert to UTC for slot math.
        start = datetime(
            day.year, day.month, day.day,
            start_time.hour, start_time.minute, start_time.second,
            tzinfo=IST,
        ).astimezone(timezone.utc)
        end = datetime(
            day.year, day.month, day.day,
            end_time.hour, end_time.minute, end_time.second,
            tzinfo=IST,
        ).astimezone(timezone.utc)
        windows.append(Window(start, end))
    return _merge_windows(windows)


def _merge_windows(windows: list[Window]) -> list[Window]:
    ordered = sorted(windows)
    merged: list[Window] = []
    for window in ordered:
        if merged and window.start <= merged[-1].end:
            merged[-1] = Window(merged[-1].start, max(merged[-1].end, window.end))
        else:
            merged.append(window)
    return merged


def slice_windows(windows: Iterable[Window], duration_minutes: int) -> list[Window]:
    """Cut windows into consecutive slots; a trailing stub shorter than the
    duration is dropped so every slot fits entirely within one window."""
    if duration_minutes <= 0:
        raise ValueError("duration_minutes must be positive")
    step = timedelta(minutes=duration_minutes)
    slots: list[Window] = []
    for window in windows:
        cursor = window.start
        while cursor + step <= window.end:
            slots.append(Window(cursor, cursor + step))
            cursor += step
    return slots


def overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return as_utc(a_start) < as_utc(b_end) and as_utc(b_start) < as_utc(a_end)


def subtract_intervals(
    slots: Iterable[Window], busy: Iterable[Window]
) -> list[Window]:
    """Drop every slot overlapping any busy interval."""
    busy = [(as_utc(s), as_utc(e)) for s, e in busy]
    return [
        slot
        for slot in slots
        if not any(overlaps(slot.start, slot.end, s, e) for s, e in busy)
    ]
