"""Scheduling assistant orchestrator: system prompt + tool-calling loop.

The safety boundary is encoded twice: the system prompt instructs the
model, and a deterministic pre-check declines purely clinical messages
before any tool runs, so the boundary holds even if the model is
confused. The loop has a hard iteration cap so a confused request can
never spin forever.
"""

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.ai.context.ai_context import get_ai_context, save_ai_context
from app.ai.mcp_client.client import AgentToolClient
from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.domain.hospital_config.models import Specialty
from app.domain.patient.models import PatientProfile

SYSTEM_PROMPT = """You are CareFlow, a warm and attentive human care coordinator inside the CareFlow AI app. You help patients find doctors, check real availability, and book / move / cancel visits. You must NEVER diagnose, prescribe, recommend treatment, or state clinical conclusions the patient didn't say themselves. If asked to do any of these, decline kindly and offer to connect them with a human or continue with scheduling.

Talk like a thoughtful human, not a bot:
- Be warm, brief, and conversational — usually 1-2 short sentences, one question at a time. Never send a wall of text.
- When the patient's name is given below, use their first name naturally now and then ("Got it, Priya — ..."), not in every reply.
- Always acknowledge what they just said before acting ("That sounds uncomfortable — let's get you seen soon.", "Perfect, Monday morning it is.").
- Vary your wording; never repeat the same template twice in a row.
- Use plain everyday language. No jargon, no internal ids, no markdown tables — the app renders doctor and time cards for you.
- When you suggest nearby care, say so naturally with distance/city ("Dr. Rao at Riverside is just ~2 km from you in Chennai").
- If they say "near me" and no location is listed below, ask once for their area or to tap "Use my location" — then carry on.
- Remember what they told you (preferred times, doctors, places) and refer back to it like a person would ("Still prefer evenings?").
- On voice/phone calls keep it to one short spoken sentence, then wait silently for their answer.

How you work:
- Chat users are already signed in — never ask them to verify identity
  (no name / date-of-birth checks; those apply to telephone calls only,
  where you are explicitly told so).
- Use the provided tools for every fact (hospitals, doctors, slots, bookings). Never invent ids, times, or bookings.
- The conversation context lists doctors and slots you already offered. When the user says "that one",
  "the first", "the morning one", or similar, resolve it against the offered lists in the context — do not re-ask.
- Booking needs a doctor, an appointment type, an exact slot, and an idempotency key (generate a random UUID string).
- If the patient names a visit mode (in person / video / phone), pass it as
  consultation_mode on create_appointment; otherwise leave it out.
- If a tool reports a booking as "parked", tell the user warmly it is held and being confirmed, and offer to check back or connect them with someone.
- If a tool reports "failed" or is unavailable, say so plainly and kindly, and offer to connect them with a human via transfer_to_human.
- Location: when the patient profile below lists home or live coordinates and they ask for nearby care ("near me", "close by", "nearest"), pass latitude+longitude to search_hospitals/search_doctors so results come back nearest-first with distances. Prefer the live message location over the saved one when both are present. When only a city is known, pass city instead. Never ask the user to type coordinates.

Greetings and small talk (hi, hello, hey, thanks, bye, ok):
- Reply with a brief warm greeting and nothing else — no tools, no doctor/hospital/slot mentions.
- NEVER mention appointments, questionnaires, doctors, hospitals, or slots unless the patient asked about them AND a tool result returned them in THIS turn.
- NEVER invent appointments, doctors, or questionnaires. The patient's own name is not a doctor's name. Only discuss bookings, doctors, or questionnaires that appear in a tool result from THIS turn — never from memory of earlier context alone.

Multi-step booking (mandatory — never book in one shot):
1. Find options first: search_doctors, list_appointment_types, check_availability.
2. Then PROPOSE exactly one option in plain words — doctor name, hospital,
   date and time (e.g. "Dr. Rao at Riverside, Monday Oct 6 at 9:00 AM") —
   and ask "Shall I book this? Reply yes to confirm." On voice/phone
   calls, keep this to one short spoken sentence and then wait silently
   for the patient's yes or no.
3. Call create_appointment ONLY after the patient replies with an explicit
   confirmation (yes / confirm / book it / go ahead) for that exact
   option. If the tool reports confirmation is still needed, propose again
   instead of retrying the booking.
4. The same confirm-first rule applies to moves and cancellations:
   propose the new time ("Shall I move it to Tuesday 10:30 AM?") or name
   the booking to cancel ("Shall I cancel Thursday 2 PM with Dr. Rao?")
   and wait for yes. If the patient says no (or "cancel that", "never
   mind"), drop the proposal and offer alternatives instead.

Guided booking flow (follow this order every time):
1. DOCTORS: call search_doctors with limit=5, offset=0. Present up to five
   cards briefly ("Here are a few good options near you…") and add one
   line: "Not quite right? Say 'show me more' and I'll keep looking."
   If they ask to explore more ("more", "show more", "other doctors",
   "next"), repeat the SAME filters with offset raised by 5 — the context
   JSON carries last_search {filters, offset, total} so you never lose the
   thread. Only page while offset+shown < total; when nothing is left, say
   warmly that's everything and offer to change specialty, city, or day.
2. DOCTOR: when they name one of the offered doctors ("Dr. Rao", "the
   second one"), the choice is recorded automatically — acknowledge it
   warmly ("Great choice — Dr. Rao at Riverside.") and ask which day suits
   them. A day strip appears in the app for them to tap.
3. DATE: if the context already carries selected_date (the patient gave
   the day in their message — "tomorrow", "Monday", "Sep 21"), use it
   directly for get_day_schedule/check_availability and NEVER ask for the
   date again. Only when no day is known anywhere (message, selected_date,
   history) ask which day suits them — a day strip with a calendar appears
   in the app for them to tap. When they pick a day, call
   get_day_schedule for that doctor and date (resolve "Monday",
   "tomorrow", "Oct 6" against today's date above; pass YYYY-MM-DD). The
   app shows the day's timeline with tappable start times. Ask: "What time
   suits you? Tap a time or just tell me."
4. TYPE: every visit type has its own duration — never assume 30 minutes.
   Call list_appointment_types with the chosen doctor's hospital_id (it is
   in the earlier search_doctors result on that doctor) and ask in plain
   words ("Is this a routine check-up or something specific?") — the app
   shows every type with its minutes in a select bar. Match their words to
   the closest type name yourself; never expose ids. A deterministic guard
   refuses check_availability/create_appointment until this step is done —
   if you see visit_type_required, follow it instead of retrying.
5. TIME: once the patient has PICKED the type (context visit_type_name)
   plus doctor + day + start time, compute end = start + that type's
   duration_minutes — never a guessed number. Sanity-check it against the
   day schedule you already fetched (inside working hours? overlapping a
   busy block?). Then PROPOSE exactly one option with the full range ("Dr.
   Rao, Monday Oct 6, 9:30–10:00 AM — shall I book it? Reply yes to
   confirm."). If the type is still unknown, go back to step 4 first —
   never propose a range.
6. CONFIRM & BOOK: only after explicit yes, call create_appointment. If it
   reports a conflict / taken slot, say so warmly ("Ah — that time was
   just taken"), and immediately offer the nearest free starts from the
   same day schedule, then propose one and wait for yes again. Never
   report "confirmed" unless the tool outcome is confirmed.

How you present results (the chat UI renders cards itself):
- When you recommend doctors, name up to five briefly with hospital + city
  (e.g. "Dr. Fatima Sheikh — Riverside Medical Center, Chennai") and NEVER
  paste a markdown table of doctors; the UI shows doctor cards automatically.
- NEVER ask the user for internal ids (UUIDs, appointment-type ids, doctor
  ids). Resolve them with tools: list_appointment_types for the hospital's
  visit types, search_doctors for doctor ids, get_context for ids you already
  offered. If the visit type is unclear, ask in plain words ("routine
  check-up or a specific consultation?") and pick the closest match yourself.
- Resolve relative dates yourself ("tomorrow", "this week") against today's
  date above; never ask the user to compute a date.

Pre-visit questionnaires:
- Collect answers ONLY through get_questionnaire/submit_questionnaire for the patient's own appointment.
- Ask ONLY the fetched questions, in order, using their exact prompts. Never invent extra clinical questions, no matter what the user asks.
- Never mark the questionnaire complete until submit_questionnaire reports completed=true; keep asking the missing_required ones.
- If a submit reports flagged=true, a human escalation already exists — say the care team will review it and do not interpret the answer.
"""

MAX_ITERATIONS = 8

CLINICAL_PATTERNS = [
    r"\bdiagnos\w*",
    r"\bprescri\w*",
    r"\bdosage\b",
    r"\bwhat dose\b",
    r"\bwhat does\b.*\bmean\b",
    r"\bwhat do\b.*\bmean\b",
    r"\bshould i (take|stop|start)\b",
    r"\bshould i (worry|be worried)\b",
    r"\bis .* serious\b",
    r"\bhow (do|should) i treat\b",
    r"\bhow to treat\b",
    r"\binterpret\b.*\b(result|test|report|ecg|ekg|blood)\b",
    r"\brecommend\b.*\b(medication|drug|treatment|antibiotic)\b",
]
_CLINICAL_RE = re.compile("|".join(CLINICAL_PATTERNS), re.IGNORECASE)

_SCHEDULING_HINTS = (
    "book",
    "appointment",
    "schedul",
    "availab",
    "cancel",
    "reschedul",
    "slot",
    "checkup",
    "check-up",
    "need a ",
    "find a ",
    "see a ",
)

CLINICAL_DECLINE = (
    "I hear you — and I wish I could help with that directly. I'm only "
    "able to help with scheduling and admin things, so I can't give medical "
    "advice or diagnoses. I can connect you with someone on our care team, "
    "or we can keep going with scheduling — what feels best to you?"
)

LOOP_EXHAUSTED = (
    "I'm having trouble completing that request. I've escalated it for "
    "human review — someone from the care team will follow up."
)

STOPPED = "Okay, I've stopped — what would you like to do instead?"


TELEPHONY_GUARD_PROMPT = """
This is a TELEPHONE call. The caller has no login, so identity is
unproven until verify_caller_identity reports verified=true:
- First, ask for their FULL NAME and DATE OF BIRTH (open questions —
  never guess or read back stored values).
- Then call verify_caller_identity with the conversation_id from the
  context JSON below. Until it reports verified=true you MUST NOT
  discuss, look up, book, move, cancel, or message about ANY patient's
  care — offer general help (find doctors, check public availability)
  or transfer_to_human instead.
- After THREE failed verifications, stop asking and transfer_to_human.
"""

#: Unverified phone callers may only use these. Everything else —
#: every tool that reads or mutates a specific patient's data — is
#: refused deterministically below, not just by the prompt above.
TELEPHONY_OPEN_TOOLS = frozenset(
    {
        "verify_caller_identity",
        "transfer_to_human",
        "search_hospitals",
        "search_doctors",
        "check_availability",
        "get_context",
    }
)

CALLER_IDENTITY_REQUIRED = (
    "caller_identity_required: this is a telephone call and the caller "
    "has not verified their identity yet. Ask for their full name and "
    "date of birth, then call verify_caller_identity. Do not discuss "
    "any patient details until it reports verified=true."
)


def _telephony_gate(context, name: str) -> dict | None:
    """Refusal outcome for patient-data tools on unverified calls."""
    if context.channel != "telephony" or context.caller_verified:
        return None
    if name in TELEPHONY_OPEN_TOOLS:
        return None
    return {"ok": False, "error": CALLER_IDENTITY_REQUIRED}


def _refresh_verification(context, name: str, outcome: dict) -> None:
    """verify_caller_identity saves its own copy of the context; pull the
    flag back into the turn's copy so later calls in the SAME turn are
    already unlocked."""
    if name != "verify_caller_identity":
        return
    result = outcome.get("result") if isinstance(outcome, dict) else None
    if not isinstance(result, dict) or not result.get("verified"):
        return
    fresh = get_ai_context(context.conversation_id)
    context.caller_verified = fresh.caller_verified
    context.caller_patient_id = fresh.caller_patient_id
    context.identity_attempts = fresh.identity_attempts


# -- P0 confirm gate: patient-friendly multi-step booking --------------------
# Mutating scheduling calls only run after the patient explicitly confirms
# the exact proposed option. A fresh request ("I need a cardiologist")
# must first produce a proposal; only a follow-up confirmation ("yes",
# "confirm", "book it", ...) unlocks the mutation — and only for the
# previously offered option.

MUTATING_TOOLS = (
    "create_appointment",
    "reschedule_appointment",
    "cancel_appointment",
)

CONFIRM_PATTERNS = (
    r"\byes\b",
    r"\bconfirm\w*",
    r"\bbook (it|that|this|the|that one|it in|me)\b",
    r"\bgo ahead\b",
    r"\bproceed\b",
    r"\bthat works\b",
    r"\bsounds good\b",
    r"\bplease (book|confirm|proceed|go ahead)\b",
    r"\block (it|that|this) in\b",
    r"\bhold (that|it|that time|that slot)\b",
)

_CONFIRM_RE = re.compile("|".join(CONFIRM_PATTERNS), re.IGNORECASE)

CONFIRM_REQUIRED = (
    "booking_confirmation_required: the patient has not explicitly confirmed "
    "this exact booking yet. Do NOT call create_appointment again this turn. "
    "Instead, propose exactly one option in plain words — doctor name, "
    "hospital, date and time — and ask 'Shall I book this? Reply yes to "
    "confirm.' Only call create_appointment after the patient replies with "
    "an explicit confirmation (yes / confirm / book it / go ahead) and only "
    "for the previously offered doctor and slot."
)

RESCHEDULE_CONFIRM_REQUIRED = (
    "booking_confirmation_required: the patient has not explicitly confirmed "
    "this move yet. Do NOT call reschedule_appointment again this turn. "
    "Instead, propose the new date and time in plain words and ask 'Shall I "
    "move it there? Reply yes to confirm.' Only call reschedule_appointment "
    "after an explicit confirmation and only for a previously offered slot."
)

CANCEL_CONFIRM_REQUIRED = (
    "booking_confirmation_required: the patient has not explicitly confirmed "
    "this cancellation yet. Do NOT call cancel_appointment again this turn. "
    "Instead, name the appointment (doctor, date, time) in plain words and "
    "ask 'Shall I cancel it? Reply yes to confirm.' Only call "
    "cancel_appointment after an explicit confirmation."
)

# A turn-opening decline drops a stale proposal so a later "yes" cannot
# accidentally confirm it. Narrowly anchored: "cancel my appointment" is a
# request, not a decline, so it must NOT match.
_DECLINE_RE = re.compile(
    r"^(no|nope|don't|do not|never mind|not now|stop)\b|^cancel (that|it|this)\b",
    re.IGNORECASE,
)


def _is_declined(text: str) -> bool:
    return bool(_DECLINE_RE.search((text or "").strip()))


def _is_confirmation(text: str) -> bool:
    return bool(_CONFIRM_RE.search(text or ""))


def _norm_dt(value: object) -> str:
    """Normalize an ISO datetime for offer comparison (tolerant of
    equivalent spellings like +00:00 vs Z). Falls back to str()."""
    try:
        from datetime import datetime as _dt

        text = str(value).strip().replace("Z", "+00:00")
        return _dt.fromisoformat(text).isoformat()
    except (ValueError, TypeError):
        return str(value).strip()


def _known_slot_starts(context) -> set[str]:
    starts = {
        _norm_dt(s.get("start", ""))
        for s in (context.offered_slots or [])
        if isinstance(s, dict) and s.get("start")
    }
    pending = context.pending_booking or {}
    if pending.get("slot_start"):
        starts.add(_norm_dt(pending["slot_start"]))
    return starts


def _known_slot_ends(context) -> set[str]:
    ends = {
        _norm_dt(s.get("end", ""))
        for s in (context.offered_slots or [])
        if isinstance(s, dict) and s.get("end")
    }
    pending = context.pending_booking or {}
    if pending.get("slot_end"):
        ends.add(_norm_dt(pending["slot_end"]))
    return ends


def _slot_known(context, args: dict) -> bool:
    """True when the requested new slot was previously offered (or is the
    recorded pending proposal)."""
    start = _norm_dt(args.get("slot_start", ""))
    end = _norm_dt(args.get("slot_end", ""))
    if not start or start not in _known_slot_starts(context):
        return False
    known_ends = _known_slot_ends(context)
    if end and known_ends and end not in known_ends:
        return False
    return True


def _proposal_matches(context, args: dict) -> bool:
    """True when the requested doctor + slot were previously offered (or
    are the recorded pending proposal) — i.e. this is a confirmation of
    a known option, not a fresh one-shot guess."""
    doctor = str(args.get("doctor_id", "")).strip()
    appt_type = str(args.get("appointment_type_id", "")).strip()

    known_doctors = {
        str(d.get("id", "")).strip()
        for d in (context.offered_doctors or [])
        if isinstance(d, dict) and d.get("id")
    }
    if context.selected_doctor_id:
        known_doctors.add(str(context.selected_doctor_id).strip())
    pending = context.pending_booking or {}
    if pending.get("doctor_id"):
        known_doctors.add(str(pending["doctor_id"]).strip())

    if not doctor or doctor not in known_doctors:
        return False
    if not _slot_known(context, args):
        return False
    # Type must agree with prior selection when one exists; otherwise the
    # offered doctor + slot match is sufficient.
    if context.selected_appointment_type_id and appt_type:
        if appt_type != str(context.selected_appointment_type_id).strip():
            pending_type = str((pending or {}).get("appointment_type_id", "")).strip()
            if appt_type != pending_type:
                return False
    return True


def _ensure_booking_idempotency(args: dict) -> str:
    """Server fallback: the assistant path never fails for a missing key.
    Direct API callers must still send their own key (tool middleware
    enforces it); here we mint one so a model slip cannot break booking."""
    key = args.get("idempotency_key")
    if isinstance(key, str) and key.strip():
        return key.strip()
    fresh = uuid.uuid4().hex
    args["idempotency_key"] = fresh
    return fresh


def _booking_confirmation_gate(context, user_text: str, name: str, args: dict) -> dict | None:
    """Refusal outcome for unconfirmed mutations (None = allowed).

    Covers create / reschedule / cancel: a fresh request must first yield
    a proposal; only an explicit confirmation of a previously offered
    option unlocks the call."""
    if name not in MUTATING_TOOLS:
        return None
    if not isinstance(args, dict):
        args = {}
    if name == "create_appointment":
        _ensure_booking_idempotency(args)
        if _is_confirmation(user_text) and _proposal_matches(context, args):
            return None
        # Remember the attempt as the pending proposal so the confirmation
        # turn can match against it even if the model rephrases.
        context.pending_booking = {
            "kind": "create",
            "doctor_id": str(args.get("doctor_id", "")),
            "appointment_type_id": str(args.get("appointment_type_id", "")),
            "slot_start": str(args.get("slot_start", "")),
            "slot_end": str(args.get("slot_end", "")),
        }
        context.awaiting_confirmation = True
        context.pending_clarification = "booking_confirmation"
        return {"ok": False, "error": CONFIRM_REQUIRED}
    if name == "reschedule_appointment":
        if _is_confirmation(user_text) and _slot_known(context, args):
            return None
        context.pending_booking = {
            "kind": "reschedule",
            "appointment_id": str(args.get("appointment_id", "")),
            "slot_start": str(args.get("slot_start", "")),
            "slot_end": str(args.get("slot_end", "")),
        }
        context.awaiting_confirmation = True
        context.pending_clarification = "booking_confirmation"
        return {"ok": False, "error": RESCHEDULE_CONFIRM_REQUIRED}
    # cancel_appointment: confirmation language alone unlocks it — the
    # appointment was resolved via read-only tools, and the user must still
    # say yes explicitly.
    if _is_confirmation(user_text):
        return None
    context.pending_booking = {
        "kind": "cancel",
        "appointment_id": str(args.get("appointment_id", "")),
    }
    context.awaiting_confirmation = True
    context.pending_clarification = "booking_confirmation"
    return {"ok": False, "error": CANCEL_CONFIRM_REQUIRED}


def is_clinical_request(text: str) -> bool:
    """A purely clinical message: clinical signals, no scheduling intent."""
    lowered = text.lower()
    if not _CLINICAL_RE.search(lowered):
        return False
    return not any(hint in lowered for hint in _SCHEDULING_HINTS)


# -- Deterministic greeting guard -------------------------------------------
# A bare "Hii" must never reach the model: the stale conversation context
# (old offers, old appointment ids, the patient's own name) used to make
# the model invent appointments and re-attach old doctor cards. Answering
# in code is bulletproof where a prompt rule is not. Anchored full-match
# only, so "Hi, I need a cardiologist" still flows to the agent.

_GREETING_RE = re.compile(
    r"^(?:hi+|hello+|hey+|yo|good\s?(?:morning|afternoon|evening|day)|namaste)\W*$",
    re.IGNORECASE,
)
_THANKS_RE = re.compile(
    r"^(?:thanks?|thank\s?you|thankyou|thx)\W*$", re.IGNORECASE
)
_FAREWELL_RE = re.compile(
    r"^(?:bye+|bye\s?bye|goodbye|good\s?night|see\s?you)\W*$", re.IGNORECASE
)


def greeting_kind(text: str) -> str | None:
    """'hello' | 'thanks' | 'farewell' for bare small-talk, else None."""
    lowered = (text or "").strip().lower()
    if not lowered:
        return None
    if _THANKS_RE.match(lowered):
        return "thanks"
    if _FAREWELL_RE.match(lowered):
        return "farewell"
    if _GREETING_RE.match(lowered):
        return "hello"
    return None


def _greeting_reply(db: Session, ctx: RequestContext, kind: str) -> str:
    """Warm one-liner using the patient's first name when known."""
    first = ""
    if ctx.role == Role.patient:
        profile = (
            db.query(PatientProfile)
            .filter(PatientProfile.patient_user_id == ctx.user_id)
            .first()
        )
        full = ((profile.full_name if profile else None) or "").strip()
        if full:
            first = full.split()[0]
    name = f" {first}" if first else ""
    if kind == "thanks":
        return f"You're most welcome{name}! Anything else I can help with?"
    if kind == "farewell":
        return f"Take care{name}! I'm here whenever you need me."
    return f"Hi{name if name else ' there'}! What can I do for you today?"


CompleteFn = Callable[[list[dict[str, Any]], list[dict[str, Any]]], dict[str, Any]]


class AINotConfiguredError(Exception):
    pass


def _throttle_delay_s(resp: Any, attempt: int = 0) -> float:
    """How long to wait before retrying a throttled/failed model call.

    Honors the vendor's own reset headers (Groq sends `retry-after` and
    `x-ratelimit-reset-tokens` / `x-ratelimit-reset-requests` like
    "652ms", "18.952s", "1m26.4s"); falls back to exponential backoff.
    """
    import re as _re

    for header in (
        "retry-after",
        "x-ratelimit-reset-tokens",
        "x-ratelimit-reset-requests",
    ):
        raw = resp.headers.get(header)
        if not raw:
            continue
        raw = str(raw).strip().lower()
        try:
            return max(1.0, float(raw))
        except (TypeError, ValueError):
            pass
        total = 0.0
        for amount, unit in _re.findall(r"([\d.]+)\s*(ms|s|m|h)", raw):
            try:
                value = float(amount)
            except ValueError:
                continue
            total += value / 1000.0 if unit == "ms" else value * 60.0 if unit == "m" else value * 3600.0 if unit == "h" else value
        if total > 0:
            return max(1.0, total + 1.0)
    return 2.0**attempt or 1.0


def _chat_backend() -> tuple[str, str, str]:
    """Chat model backend: Inception Mercury when configured, else Groq.

    Voice STT/TTS always stay on Groq (they read `llm_api_key`), so this
    only affects text chat / voice agent turns.
    """
    from app.core.config import settings

    if settings.inception_api_key:
        return (
            settings.inception_base_url,
            settings.inception_api_key,
            settings.inception_model,
        )
    if settings.llm_api_key:
        return (settings.llm_base_url, settings.llm_api_key, settings.llm_model)
    raise AINotConfiguredError(
        "No chat model key configured (INCEPTION_API_KEY or "
        "LLM_API_KEY/GROQ_API_KEY); chat requires a configured model"
    )


def groq_complete(
    messages: list[dict[str, Any]], tool_specs: list[dict[str, Any]]
) -> dict[str, Any]:
    """Default chat completion (Inception Mercury, Groq fallback).

    Transient vendor throttling (429) and 5xx get a short bounded retry
    with backoff so a busy moment degrades to a slightly slower reply
    instead of a 502 "assistant unavailable".
    """
    import time

    import httpx

    base_url, api_key, model = _chat_backend()
    payload = {
        "model": model,
        "messages": messages,
        "tools": [
            {"type": "function", "function": spec} for spec in tool_specs
        ],
        "tool_choice": "auto",
    }
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"}
    resp: httpx.Response | None = None
    for attempt in range(4):
        resp = httpx.post(url, headers=headers, json=payload, timeout=60.0)
        if resp.status_code != 429 and resp.status_code < 500:
            break
        if attempt < 3:
            time.sleep(min(_throttle_delay_s(resp, attempt), 30.0))
    assert resp is not None
    resp.raise_for_status()
    message = resp.json()["choices"][0]["message"]
    calls = []
    for call in message.get("tool_calls") or []:
        fn = call.get("function", {})
        import json as _json

        try:
            args = _json.loads(fn.get("arguments") or "{}")
        except ValueError:
            args = {}
        calls.append(
            {
                "id": call.get("id", str(uuid.uuid4())),
                "name": fn.get("name", ""),
                "arguments": args if isinstance(args, dict) else {},
            }
        )
    return {"content": message.get("content"), "tool_calls": calls}


def _apply_result_to_context(context, name: str, args: dict, result: dict) -> None:
    payload = result.get("result") if isinstance(result, dict) else None
    if not isinstance(payload, dict):
        return
    if name == "search_doctors" and isinstance(payload.get("doctors"), list):
        page = [
            {"id": d.get("id", ""), "name": d.get("name", "")}
            for d in payload["doctors"][:5]
            if isinstance(d, dict) and d.get("id")
        ]
        # Accumulate for "that one" resolution (bounded); the page alone
        # is what the UI displays.
        seen = {d.get("id") for d in context.offered_doctors if isinstance(d, dict)}
        for d in payload["doctors"]:
            if isinstance(d, dict) and d.get("id") and d["id"] not in seen:
                if len(context.offered_doctors) >= 30:
                    break
                context.offered_doctors.append(
                    {"id": d.get("id", ""), "name": d.get("name", "")}
                )
                seen.add(d["id"])
        context.offered_doctor_page = [d["id"] for d in page]
        filters = {}
        if isinstance(args, dict):
            for key in (
                "hospital_id",
                "specialty",
                "query",
                "city",
                "latitude",
                "longitude",
                "radius_km",
            ):
                if args.get(key) not in (None, ""):
                    filters[key] = args[key]
        try:
            total = int(payload.get("total", len(page)))
        except (TypeError, ValueError):
            total = len(page)
        try:
            offset = int((args or {}).get("offset") or 0)
        except (TypeError, ValueError):
            offset = 0
        context.last_search = {"filters": filters, "offset": offset, "total": total}
    elif name == "check_availability" and isinstance(payload.get("slots"), list):
        context.offered_slots = [
            {"start": s.get("start", ""), "end": s.get("end", "")}
            for s in payload["slots"][:10]
        ]
    elif name == "create_appointment" and payload.get("appointment_id"):
        context.last_appointment_id = payload["appointment_id"]
        context.offered_slots = []
        # Booking done: the proposal is fulfilled, not pending. A future
        # booking is a new flow, so the visit type must be picked again.
        context.pending_booking = None
        context.awaiting_confirmation = False
        context.visit_types_seen = False
        context.visit_type_name = None
        if context.pending_clarification == "booking_confirmation":
            context.pending_clarification = None
    elif name == "reschedule_appointment" and payload.get("appointment_id"):
        context.last_appointment_id = payload["appointment_id"]
        context.offered_slots = []
        context.pending_booking = None
        context.awaiting_confirmation = False
        if context.pending_clarification == "booking_confirmation":
            context.pending_clarification = None
    elif name == "cancel_appointment" and payload.get("appointment_id"):
        # The booking is gone: drop any pending proposal for it.
        context.offered_slots = []
        context.pending_booking = None
        context.awaiting_confirmation = False
        if context.pending_clarification == "booking_confirmation":
            context.pending_clarification = None


def _clear_booking_proposal(context) -> None:
    """Drop a stale proposal (patient declined or moved on)."""
    context.pending_booking = None
    context.awaiting_confirmation = False
    if context.pending_clarification == "booking_confirmation":
        context.pending_clarification = None


_ORDINALS = {
    "first": 0,
    "1st": 0,
    "second": 1,
    "2nd": 1,
    "third": 2,
    "3rd": 2,
    "fourth": 3,
    "4th": 3,
    "fifth": 4,
    "5th": 4,
}


def _norm_name(value: str) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"^dr\.?\s+", "", text)
    return re.sub(r"\s+", " ", text)


def detect_doctor_selection(context, text: str) -> str | None:
    """Deterministic doctor pick from a message naming an offered doctor.

    Matches a full/partial offered name ("Dr. Rao" / "Rao") or an ordinal
    ("first", "second one", "3rd") against the CURRENT page first, then
    the accumulated offers. Returns the doctor id or None. The model still
    confirms the choice out loud; this only records it so the UI can move
    to the date step without another tool round-trip.
    """
    offered = [d for d in (context.offered_doctors or []) if isinstance(d, dict) and d.get("id")]
    if not offered:
        return None
    lowered = f" {(text or '').strip().lower()} "
    for word, idx in _ORDINALS.items():
        hit = re.search(rf"\b{re.escape(word)}(?:\s+one)?\b", lowered)
        # Bare ordinals only count as a pick in short messages ("second",
        # "the first one", "seen by a doctor") — "First, show me the visit
        # types" is a sentence starter, not a pick.
        if hit and (
            hit.group(0).strip().endswith("one")
            or "doctor" in lowered
            or len((text or "").strip()) < 20
        ):
            page = [str(i) for i in (getattr(context, "offered_doctor_page", None) or [])]
            pool = page if page else [str(d.get("id")) for d in offered]
            if 0 <= idx < len(pool):
                return pool[idx]
            return None
    # Longest names first so "Rao Menon" beats a bare "Rao" elsewhere.
    for d in sorted(offered, key=lambda d: len(_norm_name(str(d.get("name", "")))), reverse=True):
        name = _norm_name(str(d.get("name", "")))
        if len(name) >= 3 and name in lowered:
            return str(d.get("id"))
    return None


def detect_type_selection(context, text: str) -> str | None:
    """Deterministic visit-type pick from a message naming a shown type.

    Matches against the types from the last list_appointment_types result
    ("Consult", "routine check-up" ~ "Routine Checkup"). Returns the type
    id or None. Only records the pick; the model still asks/confirms out
    loud and computes end = start + duration.
    """
    types = [t for t in (context.visit_types or []) if isinstance(t, dict) and t.get("id")]
    if not types:
        return None
    lowered = f" {(text or '').strip().lower()} "
    for t in sorted(types, key=lambda t: len(str(t.get("name", ""))), reverse=True):
        name = re.sub(r"\s+", " ", str(t.get("name", "")).strip().lower())
        if len(name) >= 3 and name in lowered:
            return str(t.get("id"))
        # Short form patients actually type ("Consult" for "Consult (Evening)").
        first = name.split(" ", 1)[0] if name else ""
        if len(first) >= 4 and re.search(rf"\b{re.escape(first)}\b", lowered):
            return str(t.get("id"))
    return None


VISIT_TYPE_REQUIRED_CHECK = (
    "visit_type_required: availability depends on the visit length, and the "
    "patient has not picked a visit type yet in this conversation. Do NOT "
    "call check_availability. First call list_appointment_types with the "
    "chosen doctor's hospital_id (from the earlier search_doctors result), "
    "present the options in plain words, and let the patient choose. Only "
    "check availability after they pick."
)

VISIT_TYPE_REQUIRED_BOOK = (
    "visit_type_required: the patient has not picked a visit type yet in "
    "this conversation, so the visit length is unknown — never assume 30 "
    "minutes. Do NOT call create_appointment and do NOT propose a time "
    "range yet. First call list_appointment_types for the doctor's "
    "hospital, present the options in plain words, and let the patient "
    "choose. Only propose and book after they pick."
)


def visit_type_gate(context, name: str) -> dict | None:
    """Refusal outcome until the visit-type step is done (None = allowed).

    Reschedule/cancel keep the original booking's type, so only fresh
    availability checks and bookings are gated.
    """
    if name not in ("check_availability", "create_appointment"):
        return None
    if getattr(context, "visit_types_seen", False):
        return None
    if name == "check_availability":
        return {"ok": False, "error": VISIT_TYPE_REQUIRED_CHECK}
    return {"ok": False, "error": VISIT_TYPE_REQUIRED_BOOK}


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


def detect_date_iso(text: str, today=None) -> str | None:
    """Deterministic visit-day extraction ("tomorrow" -> YYYY-MM-DD).

    Handles today/tomorrow/day-after-tomorrow, weekday names ("Monday",
    "next Fri"), month-day ("Sep 21", "21st Sep") and ISO dates.
    Explicit dates win over weekday names, which win over relative words
    ("can't do tomorrow, Friday works" -> Friday). Month-day dates that
    already passed roll to next year. Returns None when no day is given —
    that is when the assistant must ask (the day strip appears for it).
    """
    from datetime import date as _date
    from datetime import timedelta as _td

    today = today or datetime.now(timezone.utc).date()
    s = (text or "").strip().lower()
    if not s:
        return None

    def _iso(d: _date) -> str:
        return d.isoformat()

    # 1) Explicit calendar dates.
    month_names = "|".join(sorted(_MONTHS, key=len, reverse=True))
    m = re.search(rf"\b(\d{{4}})-(\d{{2}})-(\d{{2}})\b", s)
    if m:
        try:
            return _iso(_date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
        except ValueError:
            pass
    m = re.search(rf"\b({month_names})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", s)
    day_first = None
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

    # 2) Weekday names ("Monday", "next Fri" — next occurrence incl. today).
    for name, weekday in _WEEKDAYS.items():
        if re.search(rf"\b(?:next\s+)?{re.escape(name)}\b", s):
            delta = (weekday - today.weekday()) % 7
            return _iso(today + _td(days=delta))

    # 3) Relative words.
    if re.search(r"\bday after tomorrow\b", s):
        return _iso(today + _td(days=2))
    if re.search(r"\btomorrow\b|\btmrw\b", s):
        return _iso(today + _td(days=1))
    if re.search(r"\btoday\b|\btonight\b", s):
        return _iso(today)
    return None


def booking_stage(context, fresh_tools):
    """Where the patient is in the guided booking flow (drives chat UI).

    confirm → an explicit yes/no panel is showing; pick_time → a day
    schedule or slot list just arrived; pick_type → visit types just
    arrived; pick_date → a doctor is chosen and the day strip shows;
    browse → anything else.
    """
    if context.awaiting_confirmation:
        return "confirm"
    if "get_day_schedule" in fresh_tools or "check_availability" in fresh_tools:
        return "pick_time"
    if "list_appointment_types" in fresh_tools:
        return "pick_type"
    if getattr(context, "selected_doctor_id", None):
        return "pick_date"
    return "browse"


def _remember_booking_selection(context, name: str, args: dict, outcome: dict) -> None:
    """Deterministic multi-step memory: remember which doctor/type/slot the
    assistant looked up or booked, so follow-up confirmations and
    'that one' references resolve even if the model forgets. Only
    successful calls are remembered."""
    if not isinstance(args, dict):
        return
    if not isinstance(outcome, dict) or not outcome.get("ok"):
        return
    if name in ("check_availability", "create_appointment"):
        doctor = str(args.get("doctor_id", "")).strip()
        if doctor:
            context.selected_doctor_id = doctor
        appt_type = str(args.get("appointment_type_id", "")).strip()
        if appt_type:
            context.selected_appointment_type_id = appt_type
    if name == "list_appointment_types":
        context.visit_types_seen = True
        result_payload = outcome.get("result") if isinstance(outcome, dict) else None
        types = (
            result_payload.get("appointment_types")
            if isinstance(result_payload, dict)
            else None
        )
        if isinstance(types, list):
            context.visit_types = [
                {
                    "id": str(t.get("id", "")),
                    "name": str(t.get("name", "")),
                    "duration_minutes": t.get("duration_minutes", 0),
                }
                for t in types[:20]
                if isinstance(t, dict) and t.get("id")
            ]
    if name in ("create_appointment", "reschedule_appointment"):
        start = str(args.get("slot_start", "")).strip()
        end = str(args.get("slot_end", "")).strip()
        if start or end:
            context.selected_slot = {"start": start, "end": end}


def _doctor_cards_by_ids(
    db: Session,
    ids: list,
    patient_latitude: float | None = None,
    patient_longitude: float | None = None,
) -> list[dict[str, Any]]:
    """Enriched cards for explicit doctor ids, in the given order."""
    wanted = []
    for pid in ids[:5]:
        try:
            wanted.append(uuid.UUID(str(pid)))
        except (ValueError, AttributeError, TypeError):
            continue
    if not wanted:
        return []
    rows = (
        db.query(
            Doctor,
            Hospital.name,
            Hospital.city,
            Specialty.name,
            Hospital.latitude,
            Hospital.longitude,
        )
        .join(Hospital, Hospital.id == Doctor.hospital_id)
        .outerjoin(Specialty, Specialty.id == Doctor.specialty_id)
        .filter(Doctor.id.in_(wanted))
        .all()
    )
    by_id = {d.id: (d, h_name, h_city, s_name, hlat, hlng) for d, h_name, h_city, s_name, hlat, hlng in rows}
    has_point = (
        patient_latitude is not None
        and patient_longitude is not None
        and -90 <= patient_latitude <= 90
        and -180 <= patient_longitude <= 180
    )
    cards = []
    for oid in wanted:
        hit = by_id.get(oid)
        if hit is None:
            continue
        d, h_name, h_city, s_name, hlat, hlng = hit
        dist = None
        if has_point and hlat is not None and hlng is not None:
            try:
                from app.mcp_server.tools import _geo as _geo_mod

                dist = round(
                    _geo_mod.haversine_km(patient_latitude, patient_longitude, hlat, hlng),
                    2,
                )
            except (TypeError, ValueError):
                dist = None
        cards.append(
            {
                "id": str(d.id),
                "name": d.name,
                "photo_url": d.photo_url,
                "hospital_name": h_name,
                "hospital_city": h_city,
                "specialty": s_name,
                "distance_km": dist,
            }
        )
    return cards


def _offered_doctor_cards(
    db: Session,
    context,
    patient_latitude: float | None = None,
    patient_longitude: float | None = None,
) -> list[dict[str, Any]]:
    """Cards for the CURRENT search page (5), in offered order.

    The chat UI renders these as tappable doctor cards so the reply text
    never needs to carry a doctor table. The full offered list stays in
    memory for "that one" resolution; use _doctor_cards_by_ids directly
    for any other explicit id list (e.g. the chosen doctor).
    """
    page_ids = [
        str(i) for i in (getattr(context, "offered_doctor_page", None) or [])
    ]
    if not page_ids:
        page_ids = [
            str(o.get("id"))
            for o in (context.offered_doctors or [])[:5]
            if isinstance(o, dict) and o.get("id")
        ]
    return _doctor_cards_by_ids(
        db,
        page_ids,
        patient_latitude=patient_latitude,
        patient_longitude=patient_longitude,
    )


def _patient_profile_block(
    profile: PatientProfile | None,
    live_latitude: float | None,
    live_longitude: float | None,
) -> str:
    """Full patient profile for the system prompt (name + location).

    The model uses this to sound like someone who knows the patient —
    first-name warmth plus real nearby-care ranking — without ever
    asking for coordinates in words.
    """
    name = (getattr(profile, "full_name", None) or "").strip() if profile else ""
    city = (getattr(profile, "city", None) or "").strip() if profile else ""
    saved_lat = getattr(profile, "latitude", None) if profile else None
    saved_lng = getattr(profile, "longitude", None) if profile else None
    has_saved = (
        isinstance(saved_lat, (int, float))
        and isinstance(saved_lng, (int, float))
        and -90 <= float(saved_lat) <= 90
        and -180 <= float(saved_lng) <= 180
    )
    has_live = (
        isinstance(live_latitude, (int, float))
        and isinstance(live_longitude, (int, float))
        and -90 <= float(live_latitude) <= 90
        and -180 <= float(live_longitude) <= 180
    )
    # Live message location wins; otherwise the saved home point.
    eff_lat = float(live_latitude) if has_live else (float(saved_lat) if has_saved else None)
    eff_lng = float(live_longitude) if has_live else (float(saved_lng) if has_saved else None)
    lines = ["\nPatient profile (use to personalize — never read back coordinates verbatim):"]
    lines.append(f"- Name: {name or 'not set'} (use their first name warmly now and then when known).")
    lines.append(f"- Saved city: {city or 'not set'}.")
    if has_saved:
        lines.append(f"- Saved home coordinates: {float(saved_lat):.5f}, {float(saved_lng):.5f}.")
    else:
        lines.append("- Saved home coordinates: not set.")
    if has_live:
        lines.append(
            f"- Live location for THIS message: {float(live_latitude):.5f}, {float(live_longitude):.5f} (most accurate — prefer this)."
        )
    if eff_lat is not None and eff_lng is not None:
        lines.append(
            f"- Effective location for nearby search: {eff_lat:.5f}, {eff_lng:.5f}. "
            "When they say 'near me' / 'nearby' / 'close by', pass "
            f"latitude={eff_lat:.5f}, longitude={eff_lng:.5f} to search_hospitals/search_doctors "
            "so results come back nearest-first with distance_km; mention the distance warmly "
            "(e.g. 'just ~2 km from you')."
        )
    elif city:
        lines.append(
            f"- No coordinates yet: when they say 'near me', pass city={city!r} to "
            "search_hospitals/search_doctors and lead with same-city options; mention "
            "the city by name and invite them to tap 'Use my location' for exact distances."
        )
    else:
        lines.append(
            "- No location yet: if they ask for nearby care, ask once for their area "
            "or to tap 'Use my location' in the app, then search."
        )
    return "\n".join(lines)


def run_conversation(
    *,
    db: Session,
    ctx: RequestContext,
    conversation_id: str | None,
    user_message: str,
    complete: CompleteFn | None = None,
    max_iterations: int = MAX_ITERATIONS,
    should_stop: Callable[[], bool] | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict[str, Any]:
    """One chat turn: guard, tool loop, reply. Never raises for tool faults.

    `latitude`/`longitude` is the patient's live location for THIS message
    (from the app's "Use my location" button). It outranks the saved home
    point for nearby ranking but is never persisted here — the profile
    page owns saving.
    """
    cid = (conversation_id or "").strip() or str(uuid.uuid4())
    text = user_message.strip()
    if not text:
        raise ValueError("message must not be empty")
    context = get_ai_context(cid)
    context.user_id = str(ctx.user_id)
    context.remember_turn("user", text)
    # A turn-opening decline ("no", "never mind", "cancel that") drops a
    # stale proposal so a later "yes" cannot accidentally confirm it.
    if (
        context.awaiting_confirmation
        and _is_declined(text)
        and not _is_confirmation(text)
    ):
        _clear_booking_proposal(context)

    # Deterministic doctor pick ("Dr. Rao", "the second one"): recorded
    # before the model runs so the UI can advance to the date step even
    # if the model only acknowledges the choice out loud this turn.
    # Same for the visit-type pick ("Consult"): durations differ per type,
    # so the pick must be on record before anything is timed or booked.
    # Same for the visit day ("tomorrow", "Monday, Oct 6"): when the
    # patient already gave it, it is recorded so the assistant uses it
    # directly instead of asking for the date again.
    if not context.awaiting_confirmation:
        picked = detect_doctor_selection(context, text)
        if picked:
            context.selected_doctor_id = picked
        picked_type = detect_type_selection(context, text)
        if picked_type:
            context.selected_appointment_type_id = picked_type
            for t in context.visit_types or []:
                if isinstance(t, dict) and str(t.get("id")) == picked_type:
                    context.visit_type_name = str(t.get("name", ""))
                    break
    day = detect_date_iso(text)
    if day:
        context.selected_date = day

    if is_clinical_request(text):
        context.remember_turn("assistant", CLINICAL_DECLINE)
        save_ai_context(context)
        return {
            "conversation_id": cid,
            "reply": CLINICAL_DECLINE,
            "iterations": 0,
            "escalated": False,
            "doctors": [],
            "slots": [],
            "pending_booking": None,
        }

    greet = greeting_kind(text)
    if greet is not None:
        # Deterministic: no model call, no tools, no cards — a bare
        # greeting can never surface stale offers or invented appointments.
        # A pending proposal (if any) is kept and still returned so the
        # confirm panel stays on screen.
        greeting_text = _greeting_reply(db, ctx, greet)
        context.remember_turn("assistant", greeting_text)
        save_ai_context(context)
        pending_greet = context.pending_booking if context.awaiting_confirmation else None
        return {
            "conversation_id": cid,
            "reply": greeting_text,
            "iterations": 0,
            "escalated": False,
            "stopped": False,
            "doctors": [],
            "slots": [],
            "pending_booking": pending_greet,
        }

    client = AgentToolClient(db, ctx)
    complete_fn = complete or groq_complete
    today = datetime.now(timezone.utc).date().isoformat()
    system = SYSTEM_PROMPT + f"\nToday is {today} (UTC)."
    if context.channel == "telephony":
        system += TELEPHONY_GUARD_PROMPT
    # Full patient profile (name + city + coordinates) rides every turn so
    # the model sounds like someone who knows them — and ranks "near me"
    # by real distance instead of guessing.
    effective_lat: float | None = None
    effective_lng: float | None = None
    if ctx.role == Role.patient:
        profile = (
            db.query(PatientProfile)
            .filter(PatientProfile.patient_user_id == ctx.user_id)
            .first()
        )
        live_lat = latitude if isinstance(latitude, (int, float)) else None
        live_lng = longitude if isinstance(longitude, (int, float)) else None
        if live_lat is not None and not (-90 <= float(live_lat) <= 90):
            live_lat = None
        if live_lng is not None and not (-180 <= float(live_lng) <= 180):
            live_lng = None
        if live_lat is None or live_lng is None:
            live_lat, live_lng = None, None
        system += _patient_profile_block(profile, live_lat, live_lng)
        saved_lat = getattr(profile, "latitude", None) if profile else None
        saved_lng = getattr(profile, "longitude", None) if profile else None
        if live_lat is not None:
            effective_lat, effective_lng = float(live_lat), float(live_lng)
        elif (
            isinstance(saved_lat, (int, float))
            and isinstance(saved_lng, (int, float))
            and -90 <= float(saved_lat) <= 90
            and -180 <= float(saved_lng) <= 180
        ):
            effective_lat, effective_lng = float(saved_lat), float(saved_lng)
    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": system
            + "\nConversation context (JSON): "
            + context.model_dump_json(),
        }
    ]
    for turn in context.history[-10:]:
        messages.append({"role": turn["role"], "content": turn["text"]})

    escalated = False
    iterations = 0
    reply: str | None = None
    stopped = False
    # Cards shown in the UI must come from THIS turn only. offered_doctors /
    # offered_slots persist in memory across turns (the confirm gate needs
    # them for "yes, book that one"), but re-sending them every turn makes
    # stale doctor cards pop up under unrelated replies like "hi".
    fresh_offers: set[str] = set()
    fresh_tools: set[str] = set()
    turn_results: dict[str, dict[str, Any]] = {}
    while iterations < max_iterations:
        if should_stop is not None and should_stop():
            stopped = True
            break
        iterations += 1
        step = complete_fn(messages, client.specs())
        for call in step.get("tool_calls") or []:
            gated = _telephony_gate(context, call.get("name", ""))
            if gated is not None:
                outcome = gated
            else:
                args = call.get("arguments") or {}
                type_gate = visit_type_gate(context, call.get("name", ""))
                if type_gate is not None:
                    outcome = type_gate
                    _apply_result_to_context(
                        context, call.get("name", ""), args, outcome
                    )
                else:
                    confirm_gate = _booking_confirmation_gate(
                        context, text, call.get("name", ""), args
                    )
                    if confirm_gate is not None:
                        outcome = confirm_gate
                    else:
                        outcome = client.call(call.get("name", ""), args)
                        _remember_booking_selection(
                            context, call.get("name", ""), args, outcome
                        )
                        _refresh_verification(context, call.get("name", ""), outcome)
            if call.get("name") == "transfer_to_human" and outcome.get("ok"):
                escalated = True
            if outcome.get("ok"):
                fresh_tools.add(call.get("name", ""))
                if call.get("name") == "search_doctors":
                    fresh_offers.add("doctors")
                elif call.get("name") == "check_availability":
                    fresh_offers.add("slots")
                elif call.get("name") in ("list_appointment_types", "get_day_schedule"):
                    result_payload = outcome.get("result")
                    if isinstance(result_payload, dict):
                        turn_results[call.get("name", "")] = result_payload
            _apply_result_to_context(
                context, call.get("name", ""), call.get("arguments") or {}, outcome
            )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id", ""),
                    "name": call.get("name", ""),
                    "content": AgentToolClient.encode(outcome),
                }
            )
        content = step.get("content")
        if content:
            reply = content
            messages.append({"role": "assistant", "content": content})
            if not step.get("tool_calls"):
                break
        elif not step.get("tool_calls"):
            break

    if reply is None:
        reply = STOPPED if stopped else LOOP_EXHAUSTED
        messages.append({"role": "assistant", "content": reply})
    context.remember_turn("assistant", reply)
    save_ai_context(context)
    pending = context.pending_booking if context.awaiting_confirmation else None
    last_search = getattr(context, "last_search", None) or {}
    try:
        search_total = int(last_search.get("total", 0))
    except (TypeError, ValueError):
        search_total = 0
    try:
        search_offset = int(last_search.get("offset", 0))
    except (TypeError, ValueError):
        search_offset = 0
    doctors_cards = (
        _offered_doctor_cards(
            db, context, patient_latitude=effective_lat, patient_longitude=effective_lng
        )
        if "doctors" in fresh_offers
        else []
    )
    if not doctors_cards:
        # No fresh search this turn but the booking flow has a chosen
        # doctor: keep their profile card visible so the patient always
        # sees WHO the date/time/type steps are about.
        chosen = getattr(context, "selected_doctor_id", None)
        if chosen:
            doctors_cards = _doctor_cards_by_ids(
                db,
                [str(chosen)],
                patient_latitude=effective_lat,
                patient_longitude=effective_lng,
            )
    has_more = (
        "doctors" in fresh_offers
        and search_total > 0
        and search_offset + len(doctors_cards) < search_total
    )
    return {
        "conversation_id": cid,
        "reply": reply,
        "iterations": iterations,
        "escalated": escalated,
        "stopped": stopped,
        "doctors": doctors_cards,
        "doctors_total": search_total,
        "has_more_doctors": has_more,
        "slots": (
            [
                {"start": s.get("start", ""), "end": s.get("end", "")}
                for s in (context.offered_slots or [])[:10]
                if isinstance(s, dict) and s.get("start")
            ]
            if "slots" in fresh_offers
            else []
        ),
        "appointment_types": [
            {
                "id": str(t.get("id", "")),
                "name": t.get("name", ""),
                "duration_minutes": t.get("duration_minutes", 0),
            }
            for t in (turn_results.get("list_appointment_types", {}).get("appointment_types") or [])
            if isinstance(t, dict) and t.get("id")
        ],
        "day_schedule": turn_results.get("get_day_schedule"),
        "booking_stage": booking_stage(context, fresh_tools),
        "pending_booking": pending,
    }


__all__ = [
    "AINotConfiguredError",
    "CALLER_IDENTITY_REQUIRED",
    "CANCEL_CONFIRM_REQUIRED",
    "CLINICAL_DECLINE",
    "CONFIRM_REQUIRED",
    "LOOP_EXHAUSTED",
    "MAX_ITERATIONS",
    "MUTATING_TOOLS",
    "RESCHEDULE_CONFIRM_REQUIRED",
    "STOPPED",
    "SYSTEM_PROMPT",
    "TELEPHONY_GUARD_PROMPT",
    "TELEPHONY_OPEN_TOOLS",
    "booking_stage",
    "detect_date_iso",
    "detect_doctor_selection",
    "greeting_kind",
    "groq_complete",
    "is_clinical_request",
    "run_conversation",
]
