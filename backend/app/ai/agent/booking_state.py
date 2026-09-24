"""Phase 2 deterministic booking state: extractors, validation, invalidation.

The LLM handles language ambiguity. This module handles state integrity:

- small deterministic extractors (hospital/doctor/date/time/type/mode)
- tool-grounded resolution (candidates validated against offered lists)
- duration + interval math (never by the LLM)
- explicit invalidation (stale availability never survives a change)
- one readiness evaluator (the LLM never decides booking readiness)

Product timezone is IST (UTC+5:30, no DST). Natural-language dates resolve
in IST; storage stays UTC ISO exactly like the scheduling service.
"""

from __future__ import annotations

import re
from datetime import date as _date
from datetime import datetime, timedelta, timezone
from typing import Any

IST_OFFSET = timedelta(hours=5, minutes=30)
IST = timezone(IST_OFFSET)

_WEEKDAYS = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}

_MONTHS = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sept": 9, "sep": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

# Natural-language visit-type aliases -> normalized candidate key. Final
# resolution ALWAYS happens against offered visit_types (match_type_offer);
# these keys only let "review visit" survive until the listing arrives.
_TYPE_ALIASES = (
    ("follow-up", re.compile(r"\bfollow[\s-]?up\b|\breview\b|\breview\s+visit\b")),
    ("new consultation", re.compile(r"\bnew\s+consult(ation)?\b|\bfirst\s+(visit|consult)\b")),
    ("routine checkup", re.compile(r"\broutine\b|\bcheck[\s-]?up\b|\bgeneral\s+check\b")),
    ("consultation", re.compile(r"\bconsult(ation)?\b")),
)

_MODE_ALIASES = (
    ("video", re.compile(r"\bvideo\b|\bvirtual\b|\bvideo\s?call\b|\bonline\b")),
    ("phone", re.compile(r"\bphone\b|\bcall\b|\btelephone\b|\bvoice\s?call\b")),
    ("in_person", re.compile(r"\bin[\s-]?person\b|\bnormal\b|\bclinic\b|\bface\s?to\s?face\b|\bphysical\b|\bin\s+clinic\b")),
)

# -- visit type vs consultation mode (§P1) ------------------------------------
# AppointmentType rows are free-form catalog names. Some rows encode a
# consultation MODE ("Video consultation") rather than a business purpose
# ("New consultation"). Presenting those as visit types and then asking
# the mode again forces the patient to answer one question twice.
# Classification is name-semantics only and NEVER deletes data: the row
# stays bookable; it is only hidden from the visit-type question (and,
# when picked, it auto-derives the mode instead of re-asking it).

#: (implied mode, pattern) — a type name matches at most one mode, first
#: wins. "Video consultation" -> video; "General consultation" -> None.
_MODE_LIKE_TYPE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("video", re.compile(
        r"\bvideo\b|\bvirtual\b|\btele[\s-]?video\b|\bvideo\s?(visit|consult|consultation|call|appointment)\b"
        r"|\b(visit|consult|consultation|appointment)\s?\(?\s*video\b|\bonline\s?(visit|consult|consultation)\b"
    )),
    ("phone", re.compile(
        r"\bphone\b|\btelephone\b|\btele[\s-]?consult\b|\bvoice\s?call\b"
        r"|\bphone\s?(visit|consult|consultation|call|appointment)\b"
        r"|\b(visit|consult|consultation|appointment)\s?\(?\s*phone\b|\baudio\s?(visit|consult)\b"
    )),
    ("in_person", re.compile(
        r"\bin[\s-]?person\b|\bface\s?to\s?face\b|\bclinic\s?(visit|consult|consultation|appointment)\b"
        r"|\b(visit|consult|consultation|appointment)\s?\(?\s*in[\s-]?person\b|\bphysical\s?(visit|exam)\b"
        r"|\bwalk[\s-]?in\b"
    )),
)

#: Words that prove a name is a real business purpose even when it
#: mentions a mode-adjacent word ("Video review of lab results" stays a
#: visit type; the mode word is incidental, not definitional).
_PURPOSE_ANCHORS = re.compile(
    r"\bfollow[\s-]?up\b|\bnew\b|\broutine\b|\bcheck[\s-]?up\b|\breview\b|\blab\b"
    r"|\btest\b|\bresults?\b|\bchronic\b|\bmanagement\b|\bannual\b|\bphysical\b"
    r"|\bscreening\b|\bvaccin|\bcounseling\b|\btherapy\b|\btreatment\b|\bconsult\b",
)


def implied_mode_from_type_name(name: str) -> str | None:
    """Mode a visit-type NAME defines ("Video consultation" -> "video").

    Returns None for genuine business purposes ("New consultation",
    "Follow-up visit", "Lab review", "General consultation"). A name that
    carries both a purpose anchor and a mode word ("Video follow-up")
    keeps its purpose: the patient still picks the mode separately.
    """
    text = (name or "").strip().lower()
    if not text:
        return None
    for mode, pattern in _MODE_LIKE_TYPE_PATTERNS:
        if pattern.search(text):
            # Purpose-anchored names are business purposes first; the
            # mode word is incidental ("Video follow-up" still needs the
            # mode question answered... unless the catalog says otherwise).
            # Only a BARE mode name ("Video consultation", "Phone visit",
            # "In-person appointment") defines the mode.
            bare = re.sub(
                r"\b(consultation|consult|visit|appointment|call|session)\b|[()]",
                " ",
                text,
            )
            bare = re.sub(r"\s+", " ", bare).strip()
            if _PURPOSE_ANCHORS.search(bare):
                return None
            return mode
    return None


def is_mode_like_type_name(name: str) -> bool:
    """True when the row's meaning IS a consultation mode (P1 rule)."""
    return implied_mode_from_type_name(name) is not None


def get_valid_visit_types(context: Any) -> list[dict[str, Any]]:
    """Visit types to PRESENT (never a mode masquerading as a purpose).

    Mode-like rows are hidden from the visit-type question — UNLESS that
    would leave zero options (a catalog of only mode-like rows is still
    genuinely bookable, so all rows stay). Data is never deleted; the
    full listing remains on context.visit_types for grounding/booking.
    """
    types = [
        t for t in (getattr(context, "visit_types", None) or [])
        if isinstance(t, dict) and t.get("id")
    ]
    genuine = [t for t in types if not is_mode_like_type_name(str(t.get("name", "")))]
    return genuine if genuine else types


def ist_today() -> _date:
    """Product today in IST (not UTC)."""
    return datetime.now(IST).date()


def detect_date_iso(text: str, today: _date | None = None) -> str | None:
    """IST visit-day extraction ("tomorrow" -> YYYY-MM-DD).

    Supports today/tomorrow/day-after-tomorrow, weekday names with
    this/next disambiguation ("this Friday" = upcoming incl. today,
    "next Monday" = strictly next week), month-day ("Sep 25",
    "25 September"), ISO (YYYY-MM-DD) and numeric DD/MM/YYYY or
    DD-MM-YYYY. Explicit dates win over weekdays, which win over
    relative words. Past month-day rolls to next year.
    """
    today = today or ist_today()
    s = (text or "").strip().lower()
    if not s:
        return None

    def _iso(d: _date) -> str:
        return d.isoformat()

    month_names = "|".join(sorted(_MONTHS, key=len, reverse=True))
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", s)
    if m:
        try:
            return _iso(_date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
        except ValueError:
            pass
    # Numeric DD/MM/YYYY or DD-MM-YYYY (product locale format first).
    m = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", s)
    if m:
        day_n, mon_n, year_n = int(m.group(1)), int(m.group(2)), int(m.group(3))
        # Disambiguate DD/MM vs MM/DD: prefer DD/MM (product locale); fall
        # back to MM/DD when DD/MM is invalid but MM/DD is valid.
        for day_c, mon_c in ((day_n, mon_n), (mon_n, day_n)):
            try:
                return _iso(_date(year_n, mon_c, day_c))
            except ValueError:
                continue
    m = re.search(rf"\b({month_names})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", s)
    day_first: int | None = None
    month = 0
    if m:
        month, day_first = _MONTHS[m.group(1)], int(m.group(2))
    else:
        m = re.search(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({month_names})\b", s)
        if m:
            month, day_first = _MONTHS[m.group(2)], int(m.group(1))
    if day_first is not None:
        for year in (today.year, today.year + 1):
            try:
                candidate = _date(year, month, day_first)
            except ValueError:
                return None
            if candidate >= today:
                return _iso(candidate)
        return None

    # Weekday names with this/next handling.
    for name, weekday in _WEEKDAYS.items():
        hit = re.search(rf"\b(?:(this|next)\s+)?{re.escape(name)}\b", s)
        if hit:
            qualifier = hit.group(1)
            base = (weekday - today.weekday()) % 7
            if qualifier == "next":
                # "next Monday": the coming Monday, or 7 days out when
                # today IS that weekday (strictly next week's instance).
                delta = base if base > 0 else 7
            elif qualifier == "this":
                delta = base
            else:
                delta = base
            return _iso(today + timedelta(days=delta))

    if re.search(r"\bday after tomorrow\b", s):
        return _iso(today + timedelta(days=2))
    if re.search(r"\btomorrow\b|\btmrw\b", s):
        return _iso(today + timedelta(days=1))
    if re.search(r"\btoday\b|\btonight\b", s):
        return _iso(today)
    return None


def detect_time_hhmm(text: str) -> str | None:
    """Deterministic start-time extraction -> "HH:MM" (24h) or None.

    Supports: 9, 9:00, 9:30, 09:30, at 9:30, at 10, 10 AM, 2 PM, 14:30.
    First match wins. Bare 1-12 without am/pm is taken as given (the
    confirmation proposal lets the patient correct it); am/pm shifts
    correctly (12 AM -> 00, 12 PM -> 12).
    """
    s = (text or "").strip().lower()
    if not s:
        return None
    # Explicit HH:MM first (with optional am/pm).
    m = re.search(r"\b(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\b", s)
    if m:
        hour, minute, mer = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
        if minute > 59:
            return None
        if mer.startswith("p") and hour < 12:
            hour += 12
        elif mer.startswith("a") and hour == 12:
            hour = 0
        if 0 <= hour <= 23:
            return f"{hour:02d}:{minute:02d}"
        return None
    m = re.search(r"\b(?:at\s+)(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b", s)
    if not m:
        m = re.search(r"\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b", s)
    if m:
        hour, mer = int(m.group(1)), m.group(2).lower()
        if 1 <= hour <= 12:
            if mer.startswith("p") and hour < 12:
                hour += 12
            elif mer.startswith("a") and hour == 12:
                hour = 0
            return f"{hour:02d}:00"
        return None
    # Bare "at 9" / "at 10" (no meridian): attach :00.
    m = re.search(r"\bat\s+(\d{1,2})\b", s)
    if m:
        hour = int(m.group(1))
        if 0 <= hour <= 23:
            return f"{hour:02d}:00"
    return None


#: Trailing words that can never be part of a hospital/doctor name.
#: The candidate keeps the raw mention ("Rao tomorrow for") so grounding
#: trims it back to the name ("Rao") instead of swallowing the sentence.
_FILLER_TAIL = {
    "today", "tonight", "tomorrow", "morning", "afternoon", "evening", "night",
    "please", "for", "at", "in", "on", "by", "with", "and", "or", "a", "the",
    "video", "phone", "follow", "up", "routine", "new", "consultation",
    "consult", "visit", "next", "this",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
}


def _trim_tail(candidate: str) -> str | None:
    words = candidate.strip().split()
    while words and words[-1].lower().rstrip(".") in _FILLER_TAIL:
        words.pop()
    cleaned = " ".join(words).strip()
    if not cleaned or cleaned.lower() in {"home", "clinic", "hospital", "me"}:
        return None
    return cleaned


def detect_hospital_candidate(text: str) -> str | None:
    """Raw hospital mention ("Book me at Apollo") -> "Apollo" or None.

    "at|in|near|from <Name words>" plus a bare "<Name> hospital" match,
    with day/time filler trimmed ("Apollo tomorrow" -> "Apollo"). This is
    a CANDIDATE (hospital_query), not identity — match_hospital_offer()
    grounds it against search results.
    """
    s = (text or "").strip()
    if not s:
        return None
    m = re.search(
        r"\b(?:at|in|near|from)\b\s+([A-Z][A-Za-z0-9&']*(?:\s+[A-Za-z0-9&']+){0,3})(?:\s+[Hh]ospital)?\b",
        s,
    )
    if m:
        cleaned = _trim_tail(m.group(1))
        if cleaned:
            return cleaned
    # Every name word must be capitalized: "What are the hospital ..."
    # must never match (all-lowercase filler before the noun).
    m = re.search(r"\b([A-Z][A-Za-z&']+(?:\s+[A-Z][A-Za-z&']+){0,2})\s+[Hh]ospital\b", s)
    if m:
        return m.group(1).strip()
    return None


def detect_doctor_candidate(text: str) -> str | None:
    """Raw doctor mention ("Dr Rao", "doctor Smith") -> name or None.

    Trailing filler is trimmed ("Rao tomorrow for" -> "Rao"). Candidate
    only (doctor_query). Grounded later against offered doctors.
    """
    s = (text or "").strip()
    if not s:
        return None
    m = re.search(r"\b[Dd]r\.?\s+([A-Za-z][A-Za-z0-9'’\.-]*(?:\s+[A-Za-z][A-Za-z0-9'’\.-]*){0,2})", s)
    if m:
        cleaned = _trim_tail(m.group(1))
        if cleaned:
            return cleaned
    m = re.search(r"\b[Dd]octor\s+([A-Za-z][A-Za-z0-9'’\.-]*(?:\s+[A-Za-z][A-Za-z0-9'’\.-]*){0,2})", s)
    if m:
        cleaned = _trim_tail(m.group(1))
        if cleaned:
            return cleaned
    return None


def detect_type_candidate(text: str) -> str | None:
    """Semantic visit-type candidate key ("follow-up") or None.

    Alias-level only — match_type_offer() resolves it against the actual
    offered visit_types from list_appointment_types.
    """
    lowered = f" {(text or '').strip().lower()} "
    for key, pattern in _TYPE_ALIASES:
        if pattern.search(lowered):
            return key
    return None


def detect_mode_candidate(text: str) -> str | None:
    """Canonical mode (video|phone|in_person) from NL aliases or None.

    Mode words inside proper names ("Telephone Testerson") never count —
    they are someone's name, not a how-to-meet answer.
    """
    raw = text or ""
    lowered = f" {raw.strip().lower()} "
    # Offset mapping back onto the ORIGINAL text (leading space + lstripped
    # whitespace shift the lowercase-search spans).
    base = 1 + (len(raw) - len(raw.lstrip()))
    first: tuple[int, str] | None = None
    for mode, pattern in _MODE_ALIASES:
        for hit in pattern.finditer(lowered):
            start = base + (hit.start() - 1)
            if is_proper_noun_mention(raw, start, start + (hit.end() - hit.start())):
                continue
            if first is None or hit.start() < first[0]:
                first = (hit.start(), mode)
            break
    return first[1] if first else None


_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'.]*")


def _proper_noun_spans(text: str) -> list[tuple[int, int]]:
    """Spans of 2+ adjacent capitalized words (likely proper names)."""
    spans: list[tuple[int, int]] = []
    run: list[tuple[int, int]] = []
    for m in _WORD_RE.finditer(text or ""):
        word = m.group(0)
        if word and word[0].isupper():
            run.append((m.start(), m.end()))
        else:
            if len(run) >= 2:
                spans.append((run[0][0], run[-1][1]))
            run = []
    if len(run) >= 2:
        spans.append((run[0][0], run[-1][1]))
    return spans


def is_proper_noun_mention(text: str, start: int, end: int) -> bool:
    """True when [start, end) sits inside a proper-name span (P8).

    Guards mode extraction against names like "Telephone Testerson":
    a capitalized mode word glued to another capitalized word is a name,
    not an answer. Sentence-initial caps ("Video is fine") have no
    capitalized neighbor and still count.
    """
    try:
        for span_start, span_end in _proper_noun_spans(text):
            if start >= span_start and end <= span_end:
                return True
    except (TypeError, ValueError):
        pass
    return False


def match_hospital_offer(context: Any, hospitals: list[dict[str, Any]]) -> str | None:
    """Ground hospital_query against search_hospitals results.

    Exact/contains match on name (case-insensitive); stores the offered
    list on context.offered_hospitals. Returns hospital id or None.
    """
    if isinstance(hospitals, list):
        context.offered_hospitals = [
            {"id": str(h.get("id", "")), "name": str(h.get("name", ""))}
            for h in hospitals[:20]
            if isinstance(h, dict) and h.get("id")
        ]
    query = (getattr(context, "hospital_query", None) or "").strip().lower()
    if not query:
        return None
    for h in context.offered_hospitals:
        name = str(h.get("name", "")).lower()
        if query and (query == name or query in name or name in query):
            return str(h["id"])
    if len(context.offered_hospitals) == 1:
        return str(context.offered_hospitals[0]["id"])
    return None


def match_type_offer(context: Any) -> str | None:
    """Ground type_query against offered visit_types.

    Matches the semantic candidate key, then exact name, then first-word
    stem ("Consult" ~ "Consult (Evening)"). Genuine business purposes
    are tried BEFORE mode-named rows, so "consultation" never latches
    onto "Video consultation" while "New consultation" exists. Returns
    type id or None and syncs duration_minutes + names on success.
    """
    all_types = [t for t in (getattr(context, "visit_types", None) or []) if isinstance(t, dict) and t.get("id")]
    if not all_types:
        return None
    genuine = [t for t in all_types if not is_mode_like_type_name(str(t.get("name", "")))]
    pools = [genuine, all_types] if genuine else [all_types]
    query = (getattr(context, "type_query", None) or "").strip().lower()
    if query:
        for types in pools:
            for t in types:
                name = str(t.get("name", "")).strip().lower()
                if query == name or query in name:
                    return _accept_type(context, t)
        # Alias key vs name words ("follow-up" ~ "Follow Up Visit").
        q_words = set(re.findall(r"[a-z]{3,}", query))
        for types in pools:
            for t in types:
                name_words = set(re.findall(r"[a-z]{3,}", str(t.get("name", "")).lower()))
                if q_words & name_words:
                    return _accept_type(context, t)
    return None


def _accept_type(context: Any, t: dict[str, Any]) -> str:
    tid = str(t.get("id"))
    context.selected_appointment_type_id = tid
    name = str(t.get("name", ""))
    context.visit_type_name = name
    try:
        context.duration_minutes = int(t.get("duration_minutes") or 0) or None
    except (TypeError, ValueError):
        context.duration_minutes = None
    context.flow_open = True
    return tid


def sync_duration_from_types(context: Any) -> None:
    """Re-derive duration_minutes from the selected type (single writer)."""
    tid = str(getattr(context, "selected_appointment_type_id", None) or "")
    if not tid:
        return
    for t in (getattr(context, "visit_types", None) or []):
        if isinstance(t, dict) and str(t.get("id")) == tid:
            try:
                context.duration_minutes = int(t.get("duration_minutes") or 0) or None
            except (TypeError, ValueError):
                context.duration_minutes = None
            name = str(t.get("name", ""))
            if name:
                context.visit_type_name = name
            return


def set_canonical_slot(context: Any, start_iso: str, end_iso: str) -> None:
    """Single writer for the canonical interval (all mirrors in sync)."""
    context.selected_start = start_iso
    context.selected_end = end_iso
    context.selected_slot = {"start": start_iso, "end": end_iso}


def clear_canonical_slot(context: Any) -> None:
    context.selected_start = None
    context.selected_end = None
    context.selected_slot = None


def compute_interval_utc(date_iso: str, start_hhmm: str, duration_minutes: int) -> tuple[str, str]:
    """Deterministic interval math: IST wall -> UTC ISO (start, end).

    Never by the LLM: end = start + duration_minutes exactly.
    """
    day = _date.fromisoformat(date_iso)
    hour, minute = (int(p) for p in start_hhmm.split(":"))
    start_ist = datetime(day.year, day.month, day.day, hour, minute, tzinfo=IST)
    end_ist = start_ist + timedelta(minutes=int(duration_minutes))
    return start_ist.astimezone(timezone.utc).isoformat(), end_ist.astimezone(timezone.utc).isoformat()


# -- knowledge status ------------------------------------------------------

#: Canonical booking fields tracked for UNKNOWN/KNOWN/VALIDATED/STALE.
TRACKED_FIELDS = (
    "hospital",
    "doctor",
    "date",
    "visit_type",
    "consultation_mode",
    "start_time",
    "availability",
)


def field_status(context: Any) -> dict[str, str]:
    """Per-field knowledge status (derived, never stored).

    UNKNOWN: nothing on record. KNOWN: candidate extracted but not yet
    grounded in tool data. VALIDATED: confirmed against tool/domain data.
    STALE: dependent source changed (availability after doctor/date/type
    change clears offered_slots, so availability reads STALE).
    """
    status: dict[str, str] = {}
    # Hospital: validated when a canonical id is selected (hospital search
    # results are the grounding; offered_hospitals recorded at search).
    if getattr(context, "selected_hospital_id", None):
        status["hospital"] = "VALIDATED"
    elif (getattr(context, "hospital_query", None) or "").strip():
        status["hospital"] = "KNOWN"
    else:
        status["hospital"] = "UNKNOWN"
    # Doctor: validated when the id sits inside the offered set.
    offered_ids = {
        str(d.get("id")) for d in (getattr(context, "offered_doctors", None) or []) if isinstance(d, dict) and d.get("id")
    }
    did = str(getattr(context, "selected_doctor_id", None) or "")
    if did and (not offered_ids or did in offered_ids):
        status["doctor"] = "VALIDATED"
    elif did:
        status["doctor"] = "KNOWN"
    elif (getattr(context, "doctor_query", None) or "").strip():
        status["doctor"] = "KNOWN"
    else:
        status["doctor"] = "UNKNOWN"
    # Date: known == validated (deterministic IST parse, no tool to check).
    status["date"] = "VALIDATED" if getattr(context, "selected_date", None) else "UNKNOWN"
    # Visit type: validated when id is inside offered visit_types.
    type_ids = {
        str(t.get("id")) for t in (getattr(context, "visit_types", None) or []) if isinstance(t, dict) and t.get("id")
    }
    tid = str(getattr(context, "selected_appointment_type_id", None) or "")
    if tid and tid in type_ids:
        status["visit_type"] = "VALIDATED"
    elif tid or (getattr(context, "type_query", None) or "").strip():
        status["visit_type"] = "KNOWN"
    else:
        status["visit_type"] = "UNKNOWN"
    # Mode: validated when canonical and (no doctor offer contradiction).
    mode = str(getattr(context, "selected_consultation_mode", None) or "").lower()
    status["consultation_mode"] = "VALIDATED" if mode in ("video", "phone", "in_person") else "UNKNOWN"
    # Start time: validated once folded into a canonical interval.
    if getattr(context, "selected_start", None) and getattr(context, "selected_end", None):
        status["start_time"] = "VALIDATED"
    elif (getattr(context, "requested_start", None) or "").strip():
        status["start_time"] = "KNOWN"
    else:
        status["start_time"] = "UNKNOWN"
    # Availability: validated when fresh slots are on record for the
    # CURRENT doctor+date+type; stale as soon as any of them changed
    # (invalidation clears offered_slots, which is the signal).
    if getattr(context, "offered_slots", None):
        status["availability"] = "VALIDATED"
    elif did or getattr(context, "selected_date", None):
        status["availability"] = "STALE"
    else:
        status["availability"] = "UNKNOWN"
    return status


# -- invalidation -----------------------------------------------------------
#
# Dependency chain (P5):
#   Doctor -> Date -> Visit type -> Consultation mode -> Time slot -> Confirm
# Changing a field clears everything downstream of it and any pending
# proposal, but NEVER unrelated upstream fields. A single entry point
# (update_booking_field) owns every mutation so no path can leave stale
# dependents behind.


def bump_revision(context: Any) -> int:
    """Monotonic per-conversation edit counter (P4/P9 widget versioning).

    Every booking-field mutation bumps it; each assistant reply carries
    the revision its widgets were built against. A tap arriving with an
    older revision is stale and must never mutate state.
    """
    rev = int(getattr(context, "state_revision", 0) or 0) + 1
    try:
        context.state_revision = rev
    except (AttributeError, TypeError, ValueError):
        pass
    return rev


def _drop_proposal(context: Any) -> None:
    context.pending_booking = None
    context.awaiting_confirmation = False
    if getattr(context, "pending_clarification", None) == "booking_confirmation":
        context.pending_clarification = None


def _drop_slot_and_offers(context: Any) -> None:
    context.offered_slots = []
    clear_canonical_slot(context)
    context.requested_start = None
    _drop_proposal(context)


def invalidate_on_change(context: Any, changed: str) -> None:
    """Explicit invalidation so stale state never books (§18, P5).

    Doctor/date/type/mode/hospital changes drop dependent availability
    and the selected slot; hospital change additionally drops the doctor
    and the visit types fetched for the old hospital. A mode change now
    also clears the selected slot and slot availability: the proposal
    names a mode, and a fresh availability pass is required — the slot
    must be re-picked, never booked stale.
    """
    if changed == "doctor":
        _drop_slot_and_offers(context)
    elif changed == "date":
        _drop_slot_and_offers(context)
    elif changed == "visit_type":
        sync_duration_from_types(context)
        # Duration changed with the type, so any previously computed
        # interval is wrong by construction: clear it (never recompute
        # a stale start into a new range) and require a fresh pick.
        _drop_slot_and_offers(context)
    elif changed == "hospital":
        context.selected_doctor_id = None
        context.selected_doctor_name = None
        context.doctor_query = None
        context.visit_types_seen = False
        context.visit_types = []
        context.visit_type_name = None
        context.selected_appointment_type_id = None
        context.type_query = None
        context.duration_minutes = None
        context.selected_consultation_mode = None
        context.consultation_modes = []
        _drop_slot_and_offers(context)
    elif changed == "consultation_mode":
        _drop_slot_and_offers(context)
    elif changed == "start_time":
        clear_canonical_slot(context)
        _drop_proposal(context)


def get_valid_consultation_modes(
    doctor_offer: list[str] | None,
    type_implied_mode: str | None = None,
) -> list[str]:
    """Modes the patient may actually pick (P2 — real data only).

    The doctor's configured `consultation_types` are the ONLY source of
    mode validity (mirrors `_normalize_consultation_mode` in the
    appointment service: empty offer = accept anything, so fall back to
    all three). When the picked visit type's NAME defines a mode
    ("Video consultation"), that mode is the answer — the mode question
    is skipped, never asked twice.
    """
    valid = [m for m in (doctor_offer or []) if m in ("video", "phone", "in_person")]
    if not valid:
        valid = ["video", "phone", "in_person"]
    if type_implied_mode in ("video", "phone", "in_person"):
        return [type_implied_mode] if type_implied_mode in valid else list(valid)
    return list(valid)


def update_booking_field(
    context: Any,
    field: str,
    *,
    doctor_offer: list[str] | None = None,
    doctor_durations: list[int] | None = None,
) -> list[str]:
    """ONE entry point for every booking-field change (P5).

    The caller has already written the new value onto the context; this
    recomputes dependents, revalidates cross-field compatibility against
    REAL doctor data, clears the pending proposal, and bumps
    `state_revision`. Returns the downstream fields that were cleared,
    so callers (and tests) can see exactly what was invalidated.

    - doctor: re-check picked type duration vs doctor's available
      durations (clears type when incompatible) and picked mode vs the
      doctor's offer (clears mode when not offered); always clears slot.
    - visit_type: a mode-like type ("Video consultation") auto-derives
      the mode (no duplicate question); always clears slot.
    - consultation_mode / date: clears slot + availability.
    """
    cleared: list[str] = []
    if field == "doctor":
        if doctor_durations is not None and getattr(context, "selected_appointment_type_id", None):
            dur = getattr(context, "duration_minutes", None)
            if dur is not None and dur not in list(doctor_durations):
                context.selected_appointment_type_id = None
                context.visit_type_name = None
                context.type_query = None
                context.duration_minutes = None
                cleared.append("visit_type")
        if doctor_offer is not None and getattr(context, "selected_consultation_mode", None):
            if str(context.selected_consultation_mode).lower() not in [
                str(m).lower() for m in doctor_offer
            ]:
                context.selected_consultation_mode = None
                cleared.append("consultation_mode")
        invalidate_on_change(context, "doctor")
        cleared.extend(["slot", "availability", "proposal"])
    elif field == "visit_type":
        implied = implied_mode_from_type_name(str(getattr(context, "visit_type_name", None) or ""))
        if implied is not None:
            # The type IS the mode answer ("Video consultation" -> video):
            # record it so the mode step is satisfied without re-asking.
            context.selected_consultation_mode = implied
        invalidate_on_change(context, "visit_type")
        cleared.extend(["slot", "availability", "proposal"])
    elif field == "consultation_mode":
        invalidate_on_change(context, "consultation_mode")
        cleared.extend(["slot", "availability", "proposal"])
    elif field == "date":
        invalidate_on_change(context, "date")
        cleared.extend(["slot", "availability", "proposal"])
    elif field == "hospital":
        invalidate_on_change(context, "hospital")
        cleared.extend(["doctor", "visit_type", "consultation_mode", "slot", "availability", "proposal"])
    elif field == "start_time":
        # The caller (re)writes the canonical interval; a new time only
        # retires the pending proposal (it named the old slot) and bumps
        # the revision. It never clears the interval just set.
        _drop_proposal(context)
        cleared.append("proposal")
    else:
        _drop_proposal(context)
        cleared.append("proposal")
    bump_revision(context)
    return cleared


# -- readiness --------------------------------------------------------------


def evaluate_readiness(context: Any) -> dict[str, Any]:
    """One deterministic readiness evaluator (§15).

    Booking proposal requires: hospital scope resolvable (selected id OR
    doctor known — global search stays allowed), doctor validated, date
    known, type validated, duration known, mode validated, start known,
    and the interval present in (or consistent with) fetched availability.
    The LLM never decides readiness; it follows `missing`.
    """
    missing: list[str] = []
    fstat = field_status(context)
    # Hospital is a scope, not a blocker, unless the patient named one
    # that never resolved.
    if fstat["hospital"] == "KNOWN":
        missing.append("hospital")
    if fstat["doctor"] != "VALIDATED":
        missing.append("doctor")
    if fstat["date"] != "VALIDATED":
        missing.append("date")
    if fstat["visit_type"] != "VALIDATED":
        missing.append("visit_type")
    if not getattr(context, "duration_minutes", None):
        missing.append("duration")
    if fstat["consultation_mode"] != "VALIDATED":
        missing.append("consultation_mode")
    if fstat["start_time"] != "VALIDATED":
        missing.append("start_time")
    elif getattr(context, "selected_start", None) and getattr(context, "offered_slots", None):
        # Interval must sit inside fetched availability (exact overlap ok).
        ok = any(
            isinstance(s, dict)
            and str(s.get("start", "")) <= str(context.selected_start or "")
            and str(context.selected_end or "") <= str(s.get("end", ""))
            or str(s.get("start", "")) == str(context.selected_start or "")
            for s in (context.offered_slots or [])
        )
        if not ok:
            missing.append("availability")
    return {"ready": not missing, "missing": missing, "status": fstat}


__all__ = [
    "IST",
    "TRACKED_FIELDS",
    "bump_revision",
    "compute_interval_utc",
    "clear_canonical_slot",
    "detect_date_iso",
    "detect_doctor_candidate",
    "detect_hospital_candidate",
    "detect_mode_candidate",
    "detect_time_hhmm",
    "detect_type_candidate",
    "evaluate_readiness",
    "field_status",
    "get_valid_consultation_modes",
    "get_valid_visit_types",
    "implied_mode_from_type_name",
    "invalidate_on_change",
    "is_mode_like_type_name",
    "is_proper_noun_mention",
    "ist_today",
    "match_hospital_offer",
    "match_type_offer",
    "set_canonical_slot",
    "sync_duration_from_types",
    "update_booking_field",
]
