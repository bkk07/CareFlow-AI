"""Concierge conversational layer: intent, preferences, references, surfaces.

Sits ON TOP of the existing deterministic booking state (booking_state.py)
and the existing MCP capability boundary. Nothing here touches the DB or
EHR directly — it only reads/writes AIContext fields and builds
user-facing summaries from real tool results.

Principles implemented:
- Understand before asking (extract everything present in one message).
- Ask only for missing information (readiness drives the next question).
- Persistent context (corrections merge, never restart).
- Conversational references ("second one", "morning is better", ...).
- Explainable recommendations (only from real data).
- Patient-controlled conversation (start over / change / go back / ...).
"""

from __future__ import annotations

import re
from typing import Any

# -- Conversation stages (adaptive; conversations skip freely) --------------
STAGES = (
    "GREETING",
    "UNDERSTANDING",
    "COLLECTING_CONTEXT",
    "DISCOVERING_CARE",
    "SHOWING_DOCTORS",
    "COMPARING_DOCTORS",
    "SELECTING_DOCTOR",
    "SELECTING_DATE",
    "SELECTING_APPOINTMENT_TYPE",
    "SELECTING_MODE",
    "SELECTING_TIME",
    "REVIEWING_BOOKING",
    "AWAITING_CONFIRMATION",
    "BOOKING",
    "BOOKING_SUCCESS",
    "POST_BOOKING",
    "RESCHEDULING",
    "CANCELLING",
    "QUESTIONNAIRE",
    "ESCALATION",
)

INTENTS = (
    "FIND_CARE",
    "BOOK_APPOINTMENT",
    "MANAGE_APPOINTMENT",
    "RESCHEDULE",
    "CANCEL",
    "QUESTIONNAIRE",
    "GENERAL_HELP",
    "ESCALATE",
)

# -- UI surfaces (frontend contract; backend never sends impl details) ------
SURFACES = (
    "TEXT",
    "QUICK_REPLIES",
    "CARE_CONTEXT",
    "DOCTOR_RESULTS",
    "DOCTOR_COMPARE",
    "FILTER_CHOICES",
    "DAY_PICKER",
    "SLOT_PICKER",
    "APPOINTMENT_TYPE",
    "CONSULTATION_MODE",
    "BOOKING_REVIEW",
    "BOOKING_SUCCESS",
    "UPCOMING_APPOINTMENT",
    "QUESTIONNAIRE",
    "ERROR",
    "ESCALATION",
)

_SPECIALTY_MAP = {
    "cardiologist": "Cardiology",
    "cardiology": "Cardiology",
    "heart": "Cardiology",
    "dermatologist": "Dermatology",
    "dermatology": "Dermatology",
    "skin": "Dermatology",
    "neurologist": "Neurology",
    "neurology": "Neurology",
    "orthopedist": "Orthopedics",
    "orthopedic": "Orthopedics",
    "orthopaedic": "Orthopedics",
    "orthopedics": "Orthopedics",
    "bones": "Orthopedics",
    "joints": "Orthopedics",
    "knee": "Orthopedics",
    "pediatrician": "Pediatrics",
    "pediatrics": "Pediatrics",
    "gynecologist": "Gynecology",
    "gynaecologist": "Gynecology",
    "gynecology": "Gynecology",
    "psychiatrist": "Psychiatry",
    "psychiatry": "Psychiatry",
    "ophthalmologist": "Ophthalmology",
    "ophthalmology": "Ophthalmology",
    "eye": "Ophthalmology",
    "dentist": "Dental",
    "dental": "Dental",
    "physician": "General Medicine",
    "general": "General Medicine",
}

_TIME_RANGE_PATTERNS = (
    ("morning", re.compile(r"\bmorning\b|\b\d{1,2}\s*am\b|\bbefore\s+(noon|12)\b")),
    ("afternoon", re.compile(r"\bafternoon\b|\bafter\s*noon\b|\b\d{1,2}\s*pm\b")),
    ("evening", re.compile(r"\bevening\b|\bnight\b|\btonight\b|\bafter\s*(5|6|office)")),
)

_FOR_WHOM_PATTERNS = (
    ("mother", re.compile(r"\b(mother|mom|mum|for my (mother|mom|mum))\b")),
    ("father", re.compile(r"\b(father|dad|for my (father|dad))\b")),
    ("child", re.compile(r"\b(child|kid|son|daughter|for my (son|daughter|kid|child))\b")),
    ("spouse", re.compile(r"\b(wife|husband|partner|spouse)\b")),
    ("parent", re.compile(r"\bparent\b")),
)

_CONCERN_HINTS = re.compile(
    r"\b(pain|ache|fever|cough|cold|rash|injury|sprain|headache|migraine|"
    r"diabetes|pressure|thyroid|asthma|allergy|infection|swelling|bleeding|"
    r"checkup|check-up|check up|follow[\s-]?up|consult(ation)?|review)\b",
    re.IGNORECASE,
)


def detect_intent(text: str, context: Any = None) -> str:
    """Best-effort intent from a single message (context refines it)."""
    s = (text or "").strip().lower()
    if not s:
        return "GENERAL_HELP"
    if re.search(r"\breschedul\w*|\bmove (it|my|the)|\bchange (the )?(time|date|day|slot)\b", s):
        return "RESCHEDULE"
    if re.search(r"\bcancel(?! that| it| this\b.{0,10}$)|cancell?ation\b", s) and re.search(
        r"\b(appointment|booking|visit|slot)\b", s
    ):
        return "CANCEL"
    if re.search(r"\bquestionnaire\b|\bpre[\s-]?visit\b|\bform\b", s):
        return "QUESTIONNAIRE"
    if re.search(r"\b(human|person|someone|agent|call me|contact)\b", s) and re.search(
        r"\b(talk|speak|connect|transfer|human)\b", s
    ):
        return "ESCALATE"
    if re.search(r"\bbook\b|\bschedule\b|\bappointment\b|\bvisit\b|\bslot\b", s):
        return "BOOK_APPOINTMENT"
    if re.search(
        r"\b(find|need|looking|search|show|see|doctor|hospital|specialist|"
        r"cardiolog|dermatolog|neuro|ortho|pediatr|gynec|psych|ophthal|dent|physician|"
        r"near me|nearby|close)\b",
        s,
    ):
        return "FIND_CARE"
    # Appointments belonging to the patient ("what appointments do I have")
    if re.search(r"\b(my|upcoming|my appointments|my visits|my bookings)\b", s):
        return "MANAGE_APPOINTMENT"
    prior = str(getattr(context, "intent", None) or "") if context is not None else ""
    if prior in INTENTS:
        return prior
    return "GENERAL_HELP"


def detect_specialty(text: str) -> str | None:
    s = (text or "").strip().lower()
    if not s:
        return None
    for key, canon in _SPECIALTY_MAP.items():
        if re.search(rf"\b{re.escape(key)}\b", s):
            return canon
    return None


def detect_gender_preference(text: str) -> str | None:
    s = (text or "").strip().lower()
    if re.search(r"\bfemale\b|\bwoman\b|\blady\b|\bwomen\b", s):
        return "female"
    if re.search(r"\bmale\b|\bman\b|\bg gentleman\b", s):
        return "male"
    return None


def detect_time_range(text: str) -> str | None:
    s = (text or "").strip().lower()
    if not s:
        return None
    for name, pattern in _TIME_RANGE_PATTERNS:
        if pattern.search(s):
            return name
    return None


def detect_for_whom(text: str) -> str | None:
    s = (text or "").strip().lower()
    for name, pattern in _FOR_WHOM_PATTERNS:
        if pattern.search(s):
            return name
    if re.search(r"\bfor (me|myself)\b|\bi need\b|\bi have\b", s):
        return "self"
    return None


def detect_concern(text: str) -> str | None:
    """Short patient-stated concern; never a diagnosis (echo only)."""
    s = (text or "").strip()
    if not s or len(s) > 160:
        return None
    if not _CONCERN_HINTS.search(s):
        return None
    # Keep it short and verbatim-ish: strip booking scaffolding.
    cleaned = re.sub(
        r"\b(i need|i want|book|appointment|doctor|tomorrow|today|morning|"
        r"afternoon|evening|please|for me|for my \w+)\b",
        " ",
        s,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .,;:")
    if len(cleaned) < 3:
        return s[:120]
    return cleaned[:120]


def detect_compare_request(text: str) -> bool:
    s = (text or "").strip().lower()
    return bool(
        re.search(r"\bcompar\w*\b|\bwhich (one|doctor) is better\b|\bdifference between\b", s)
    )


def detect_explore_more(text: str) -> bool:
    s = (text or "").strip().lower()
    return bool(
        re.search(
            r"\b(show me more|show more|more (doctors|options|choices)|"
            r"other doctors|another doctor|show me another|next( page| ones)?|"
            r"explore more)\b",
            s,
        )
    )


def detect_show_another(text: str) -> bool:
    s = (text or "").strip().lower()
    return bool(re.search(r"\banother\b|\bdifferent\b|\bother options?\b", s))


def detect_start_over(text: str) -> bool:
    s = (text or "").strip().lower()
    return bool(re.search(r"^\s*(start over|restart|fresh start|forget (it|everything))\b", s))


def detect_go_back(text: str) -> bool:
    s = (text or "").strip().lower()
    return bool(re.search(r"\bgo back\b|\bprevious\b|\bback\b", s))


def detect_edit_preferences(text: str) -> bool:
    s = (text or "").strip().lower()
    return bool(
        re.search(r"\bedit (my )?preferences?\b|\bchange (my )?preferences?\b|\bmy preferences\b", s)
    )


def detect_change_request(text: str) -> str | None:
    """'change doctor/time/hospital/mode/type/date' -> which field, else None."""
    s = (text or "").strip().lower()
    m = re.search(
        r"\bchange\b.{0,20}\b(doctor|time|slot|hospital|mode|video|in[\s-]?person|phone|type|visit|date|day)\b",
        s,
    )
    if not m:
        # "tomorrow instead", "morning is better", "video is fine"
        if re.search(r"\binstead\b|\bbetter\b|\bis fine\b|\bworks\b", s):
            if re.search(r"\bmorning\b|\bafternoon\b|\bevening\b", s):
                return "time_range"
            if re.search(r"\bvideo\b|\bphone\b|\bin[\s-]?person\b", s):
                return "consultation_mode"
            if re.search(r"\btomorrow\b|\btoday\b|\bmonday\b|\btuesday\b|\bwednesday\b"
                         r"|\bthursday\b|\bfriday\b|\bsaturday\b|\bsunday\b", s):
                return "date"
        return None
    word = m.group(1)
    if word in ("time", "slot"):
        return "time_range"
    if word in ("video", "phone") or "person" in word or word == "mode":
        return "consultation_mode"
    if word in ("type", "visit"):
        return "visit_type"
    if word in ("date", "day"):
        return "date"
    return word  # doctor | hospital


def detect_unsure(text: str) -> bool:
    s = (text or "").strip().lower()
    return bool(
        re.search(
            r"\b(not sure|don't know|dont know|confused|which (doctor|specialist|speciality)|"
            r"who should i see|what (doctor|specialist))\b",
            s,
        )
    )


def detect_ambiguous_care(text: str) -> bool:
    """'I need to see someone tomorrow' — care intent, no specialty/concern."""
    s = (text or "").strip().lower()
    if detect_specialty(text) or detect_concern(text):
        return False
    return bool(
        re.search(r"\b(see (someone|a doctor|somebody)|need (a doctor|help|care)|"
                  r"not feeling well|something (is )?wrong)\b", s)
    )


def update_concierge_context(context: Any, text: str) -> dict[str, Any]:
    """Merge one message into AIContext concierge fields. Returns what changed.

    Never clears existing values unless the message explicitly changes
    them — "morning is better" updates time_range only; specialty, date,
    and other preferences stand.
    """
    changed: dict[str, Any] = {}
    s = (text or "").strip()
    if not s:
        return changed

    intent = detect_intent(s, context)
    if intent != getattr(context, "intent", None):
        # Escalate/cancel/reschedule intents always win; FIND_CARE must
        # not clobber an in-flight booking intent mid-flow.
        current = str(getattr(context, "intent", None) or "")
        if intent in ("RESCHEDULE", "CANCEL", "ESCALATE", "QUESTIONNAIRE"):
            context.intent = intent
            changed["intent"] = intent
        elif not current or current == "GENERAL_HELP":
            context.intent = intent
            changed["intent"] = intent
        elif intent in ("FIND_CARE", "BOOK_APPOINTMENT") and current in (
            "FIND_CARE",
            "BOOK_APPOINTMENT",
        ):
            context.intent = intent
            changed["intent"] = intent

    specialty = detect_specialty(s)
    if specialty:
        context.specialty_preference = specialty
        filters = dict(getattr(context, "search_filters", None) or {})
        filters["specialty"] = specialty
        context.search_filters = filters
        changed["specialty"] = specialty

    gender = detect_gender_preference(s)
    if gender:
        context.gender_preference = gender
        filters = dict(getattr(context, "search_filters", None) or {})
        filters["gender_preference"] = gender
        context.search_filters = filters
        changed["gender_preference"] = gender

    trange = detect_time_range(s)
    if trange:
        context.time_range = trange
        filters = dict(getattr(context, "search_filters", None) or {})
        filters["time_range"] = trange
        context.search_filters = filters
        changed["time_range"] = trange

    for_whom = detect_for_whom(s)
    concern = detect_concern(s)
    care = dict(getattr(context, "care_request", None) or {})
    if for_whom and care.get("for_whom") != for_whom:
        care["for_whom"] = for_whom
        changed["for_whom"] = for_whom
    if concern and not care.get("concern"):
        care["concern"] = concern
        changed["concern"] = concern
    if care != getattr(context, "care_request", None):
        context.care_request = care

    # Mirror date/mode/hospital into search_filters for "keep everything".
    if getattr(context, "selected_date", None):
        filters = dict(getattr(context, "search_filters", None) or {})
        if filters.get("date") != context.selected_date:
            filters["date"] = context.selected_date
            context.search_filters = filters
    if getattr(context, "selected_consultation_mode", None):
        filters = dict(getattr(context, "search_filters", None) or {})
        if filters.get("consultation_mode") != context.selected_consultation_mode:
            filters["consultation_mode"] = context.selected_consultation_mode
            context.search_filters = filters
    if getattr(context, "selected_hospital_id", None):
        filters = dict(getattr(context, "search_filters", None) or {})
        if filters.get("hospital_id") != context.selected_hospital_id:
            filters["hospital_id"] = context.selected_hospital_id
            context.search_filters = filters

    context.goal = context.goal or ("find and book care" if intent in ("FIND_CARE", "BOOK_APPOINTMENT") else None)
    return changed


def build_care_context(context: Any) -> dict[str, Any]:
    """User-visible summary: concise facts + preferences only. No reasoning."""
    care = dict(getattr(context, "care_request", None) or {})
    filters = dict(getattr(context, "search_filters", None) or {})
    specialty = (
        getattr(context, "specialty_preference", None)
        or filters.get("specialty")
    )
    summary: dict[str, Any] = {
        "concern": care.get("concern"),
        "for_whom": care.get("for_whom") or ("self" if specialty or getattr(context, "selected_date", None) else None),
        "when": getattr(context, "selected_date", None) or filters.get("date"),
        "when_text": care.get("when_text"),
        "time_preference": getattr(context, "time_range", None) or filters.get("time_range"),
        "consultation": getattr(context, "selected_consultation_mode", None)
        or filters.get("consultation_mode"),
        "doctor_preference": getattr(context, "selected_doctor_name", None)
        or care.get("doctor_preference"),
        "specialty": specialty,
        "gender_preference": getattr(context, "gender_preference", None)
        or filters.get("gender_preference"),
        "hospital": getattr(context, "selected_hospital_name", None),
    }
    # Drop empties; frontend renders only what is known + [Edit].
    out = {k: v for k, v in summary.items() if v not in (None, "", [])}
    has_anything = bool(out)
    out["_empty"] = not has_anything
    return out


def build_why_match(doctor: dict[str, Any], context: Any) -> list[str]:
    """Explainable reasons supported ONLY by actual data. No invention."""
    reasons: list[str] = []
    filters = dict(getattr(context, "search_filters", None) or {})
    specialty = (getattr(context, "specialty_preference", None) or filters.get("specialty") or "").strip().lower()
    doc_specialty = str(doctor.get("specialty") or "").strip()
    if specialty and doc_specialty and specialty in doc_specialty.lower():
        reasons.append(f"Matches your selected specialty ({doc_specialty})")
    elif doc_specialty and not specialty:
        reasons.append(f"Specialty: {doc_specialty}")
    mode = (getattr(context, "selected_consultation_mode", None) or filters.get("consultation_mode") or "").strip().lower()
    offered = [str(m).strip().lower() for m in (doctor.get("consultation_types") or []) if str(m).strip()]
    if mode and offered and mode in offered:
        label = {"video": "video", "phone": "phone", "in_person": "in-person"}.get(mode, mode)
        reasons.append(f"Offers {label} consultation as you preferred")
    hospital = str(getattr(context, "selected_hospital_name", None) or "").strip()
    if hospital and str(doctor.get("hospital_name") or "").strip() == hospital:
        reasons.append(f"Available at your preferred hospital ({hospital})")
    dist = doctor.get("distance_km")
    if isinstance(dist, (int, float)):
        reasons.append(f"About {dist:.1f} km from your location")
    exp = doctor.get("experience_years")
    if isinstance(exp, (int, float)) and exp:
        reasons.append(f"{int(exp)} years of experience")
    when = getattr(context, "selected_date", None) or filters.get("date")
    if when:
        reasons.append("Checked against real availability for your day")
    return reasons[:4]


def filter_slots_by_time_range(slots: list[dict[str, Any]], time_range: str | None) -> list[dict[str, Any]]:
    """Rank slots matching morning/afternoon/evening first (IST labels).

    Slots carry ready-made IST strings (start_ist like "9:00 AM") from
    check_availability; fall back to UTC hour+5:30 when labels are absent.
    Never drops non-matching slots — concierge ranks, it does not hide.
    """
    if not time_range or not slots:
        return slots
    tr = time_range.strip().lower()
    windows = {"morning": (5, 12), "afternoon": (12, 17), "evening": (17, 23)}
    lo, hi = windows.get(tr, (0, 24))

    def _hour(s: dict[str, Any]) -> int | None:
        label = str(s.get("start_ist") or "").strip().upper()
        m = re.search(r"(\d{1,2})(?::(\d{2}))?\s*(AM|PM)", label)
        if m:
            h = int(m.group(1)) % 12
            if m.group(3) == "PM":
                h += 12
            return h
        try:
            from datetime import datetime as _dt

            iso = str(s.get("start", "")).replace("Z", "+00:00")
            dt = _dt.fromisoformat(iso)
            # UTC -> IST
            h = (dt.hour + 5) % 24
            if dt.minute + 30 >= 60:
                h = (h + 1) % 24
            return h
        except (ValueError, TypeError):
            return None

    matching = [s for s in slots if (_hour(s) is not None and lo <= _hour(s) < hi)]
    others = [s for s in slots if s not in matching]
    return matching + others if matching else slots


def build_compare_table(doctors: list[dict[str, Any]]) -> dict[str, Any]:
    """2-3 doctor comparison from REAL backend data only."""
    rows = []
    for d in doctors[:3]:
        rows.append(
            {
                "id": str(d.get("id", "")),
                "name": str(d.get("name", "")),
                "specialty": d.get("specialty"),
                "experience_years": d.get("experience_years"),
                "hospital_name": d.get("hospital_name"),
                "hospital_city": d.get("hospital_city"),
                "distance_km": d.get("distance_km"),
                "consultation_types": list(d.get("consultation_types") or []),
                "available_durations": list(d.get("available_durations") or []),
            }
        )
    return {"doctors": rows, "count": len(rows)}


def build_explore_choices(context: Any) -> list[dict[str, Any]]:
    """Useful refinements preserving all other constraints (never a raw dump)."""
    filters = dict(getattr(context, "search_filters", None) or {})
    choices = [
        {"id": "earlier", "label": "Earlier availability", "prompt": "Show me earlier availability, keeping everything else the same."},
        {"id": "different_hospital", "label": "Different hospital", "prompt": "Show me options at a different hospital, keeping everything else the same."},
        {"id": "more_experienced", "label": "More experienced", "prompt": "Show me more experienced doctors, keeping everything else the same."},
        {"id": "closer", "label": "Closer location", "prompt": "Show me something closer, keeping everything else the same."},
        {"id": "video", "label": "Video consultation", "prompt": "Video is fine — keeping everything else the same."},
        {"id": "more", "label": "Show more doctors", "prompt": "Show me more doctors, keeping everything else the same."},
    ]
    # If a video preference is already set, offer in-person instead.
    if (filters.get("consultation_mode") or "").strip().lower() == "video":
        choices[4] = {"id": "in_person", "label": "In-person visit", "prompt": "In-person is fine — keeping everything else the same."}
    return choices


def quick_replies_for(stage: str | None, context: Any = None) -> list[str]:
    """Small patient-friendly choice sets — never a 5-question blast."""
    s = (stage or "").strip()
    if s in ("SELECTING_MODE", "pick_mode"):
        return ["Video visit", "Phone visit", "In-person visit"]
    if s in ("SELECTING_DATE", "pick_date"):
        return ["Today", "Tomorrow", "This weekend"]
    if s in ("SHOWING_DOCTORS", "DISCOVERING_CARE"):
        return ["Compare them", "Show me more", "Something closer"]
    if s in ("AWAITING_CONFIRMATION", "confirm", "REVIEWING_BOOKING"):
        return ["Yes, book it", "Not now"]
    if s in ("BOOKING_SUCCESS", "POST_BOOKING"):
        return ["View appointment", "Complete pre-visit questions", "Prepare for my visit"]
    if s in ("UNDERSTANDING", "COLLECTING_CONTEXT", "GREETING"):
        return ["General health", "Heart / chest", "Skin", "Bones / joints", "Something else"]
    return []


def map_booking_stage_to_concierge(booking_stage: str | None, context: Any = None) -> str:
    mapping = {
        "browse": "DISCOVERING_CARE",
        "pick_date": "SELECTING_DATE",
        "pick_type": "SELECTING_APPOINTMENT_TYPE",
        "pick_mode": "SELECTING_MODE",
        "pick_time": "SELECTING_TIME",
        "confirm": "AWAITING_CONFIRMATION",
    }
    base = mapping.get((booking_stage or "").strip(), "UNDERSTANDING")
    if getattr(context, "awaiting_confirmation", False):
        return "AWAITING_CONFIRMATION"
    if getattr(context, "compare_ids", None):
        return "COMPARING_DOCTORS"
    return base


__all__ = [
    "INTENTS",
    "STAGES",
    "SURFACES",
    "build_care_context",
    "build_compare_table",
    "build_explore_choices",
    "build_why_match",
    "detect_ambiguous_care",
    "detect_change_request",
    "detect_compare_request",
    "detect_concern",
    "detect_edit_preferences",
    "detect_explore_more",
    "detect_for_whom",
    "detect_gender_preference",
    "detect_go_back",
    "detect_intent",
    "detect_show_another",
    "detect_specialty",
    "detect_start_over",
    "detect_time_range",
    "detect_unsure",
    "filter_slots_by_time_range",
    "map_booking_stage_to_concierge",
    "quick_replies_for",
    "update_concierge_context",
]
