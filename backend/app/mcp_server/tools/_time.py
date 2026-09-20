"""IST display labels for tool outputs.

Scheduling truth is IST wall time but every timestamp on the wire is a UTC
ISO string ("2026-10-05T03:30:00+00:00"). The model repeatedly read those
as local times — proposing "3:30 AM" for a 9:00 AM IST slot and booking
09:00 UTC when the patient tapped "9:00 AM". Every slot/window the model
sees therefore carries ready-made IST strings; the model must speak those
and never the raw ISO.
"""

from datetime import datetime, timedelta, timezone

IST_OFFSET = timedelta(hours=5, minutes=30)

_WDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTH = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


def _as_utc(value: object) -> datetime | None:
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except (ValueError, TypeError, AttributeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def ist_time_label(value: object) -> str | None:
    """'9:00 AM' in IST for a UTC ISO timestamp, else None."""
    dt = _as_utc(value)
    if dt is None:
        return None
    local = dt + IST_OFFSET
    hour12 = local.hour % 12 or 12
    return f"{hour12}:{local.minute:02d} {'AM' if local.hour < 12 else 'PM'}"


def ist_day_label(value: object) -> str | None:
    """'Thu, Sep 24' in IST for a UTC ISO timestamp, else None."""
    dt = _as_utc(value)
    if dt is None:
        return None
    local = dt + IST_OFFSET
    return f"{_WDAY[local.weekday()]}, {_MONTH[local.month - 1]} {local.day}"


__all__ = ["IST_OFFSET", "ist_day_label", "ist_time_label"]
