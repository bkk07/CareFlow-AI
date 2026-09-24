"""Scheduling assistant orchestrator: system prompt + tool-calling loop.

The safety boundary is encoded twice: the system prompt instructs the
model, and a deterministic pre-check declines purely clinical messages
before any tool runs, so the boundary holds even if the model is
confused. The loop has a hard iteration cap so a confused request can
never spin forever.
"""

import re
import uuid
from datetime import date as _date
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.ai.agent.booking_state import (
    bump_revision,
    compute_interval_utc,
    detect_date_iso as detect_date_iso_ist,
    detect_doctor_candidate,
    detect_hospital_candidate,
    detect_mode_candidate,
    detect_time_hhmm,
    detect_type_candidate,
    evaluate_readiness,
    get_valid_consultation_modes,
    get_valid_visit_types,
    implied_mode_from_type_name,
    invalidate_on_change,
    is_mode_like_type_name,
    match_hospital_offer,
    match_type_offer,
    set_canonical_slot,
    sync_duration_from_types,
    update_booking_field,
)
from app.ai.agent import concierge_state as concierge
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
- TIMEZONE (critical): every timestamp tools return is a UTC ISO string, but the patient lives on IST (UTC+5:30) and the app shows IST. Slots and day windows carry ready-made start_ist/end_ist/day_ist strings — ALWAYS speak those ("9:00 AM", "Thu, Sep 24"). NEVER read a raw ISO aloud: "03:30+00:00" is 9:00 AM IST, not 3:30 AM. When the patient taps "9:00 AM", map it back to the matching slot's UTC start — never book 09:00 UTC for a 9:00 AM tap.

Greetings and small talk (hi, hello, hey, thanks, bye, ok):
- Reply with a brief warm greeting and nothing else — no tools, no doctor/hospital/slot mentions.
- NEVER mention appointments, questionnaires, doctors, hospitals, or slots unless the patient asked about them AND a tool result returned them in THIS turn.
- NEVER invent appointments, doctors, or questionnaires. The patient's own name is not a doctor's name. Only discuss bookings, doctors, or questionnaires that appear in a tool result from THIS turn — never from memory of earlier context alone.

Stateful conversation (one message = one incremental update):
- Each patient message updates ONLY what it provides: a doctor name sets
  only the doctor, a day sets only the day, a type sets only the type, a
  mode sets only the mode, a time sets only the start time. Never reset,
  re-ask, or restate steps already answered — the context JSON carries
  selected_doctor_id / selected_date / selected_appointment_type_id (and
  visit_type_name) / selected_consultation_mode forward for you.
- Every reply advances exactly ONE step: answer the current message, then
  ask/show ONLY the next missing fact (doctor → day → type → mode →
  time → confirm). The UI renders each step's widget itself at the right
  moment — never paste the whole flow or restate the full summary
  (doctor+day+type+mode+time) except inside the final confirm proposal.
- A correction ("actually Wednesday", "Dr. Smith instead") replaces ONLY
  that value; everything else stands. Availability shown for a previous
  doctor no longer applies after a doctor change — re-check from the
  date step.
- A bare start time ("9 AM") computes end = start + the PICKED type's
  duration (never ask for end time); verify against the fetched day
  schedule and either propose it as available or name the clash plus the
  nearest free starts. A new time replaces only the time.

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

Booking completeness (deterministic — enforced in code, not just here):
NO availability check or booking runs unless ALL six are patient-given:
doctor, slot (start + end), visit day, visit type, consultation mode
(video/phone/in-person). Time and date ride inside the slot; the day
itself must additionally be on record (context selected_date). The picked
mode is auto-filled into a booking that omits it — anything else missing
or mismatched comes back as date_required / type_required /
type_mismatch / mode_required / mode_mismatch: follow that instruction
instead of retrying the call.

Guided booking flow (follow this order every time):
1. DOCTORS: on a FIRST booking request ("book a cardiologist", "need a
   dermatologist"), ALWAYS call search_doctors first with limit=5,
   offset=0 — never propose a doctor, date, or time in the same turn as
   the request. Present up to five cards briefly ("Here are a few good
   options near you…") and add one line: "Not quite right? Say 'show me
   more' and I'll keep looking."
   If they ask to explore more ("more", "show more", "other doctors",
   "next"), repeat the SAME filters with offset raised by 5 — the context
   JSON carries last_search {filters, offset, total} so you never lose the
   thread. Only page while offset+shown < total; when nothing is left, say
   warmly that's everything and offer to change specialty, city, or day.
2. DOCTOR: when they name one of the offered doctors ("Dr. Rao", "the
   second one" — misspellings like "Badaru" for "Bandaru" are matched
   automatically), the choice is recorded automatically — acknowledge it
   warmly ("Great choice — Dr. Rao at Riverside.") and ask which day suits
   them. A day strip appears in the app for them to tap. A FRESH search
   always resets the chosen doctor/type/mode (new choice, new flow).
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
4. TYPE THEN MODE (two different questions — never merge them):
   Visit TYPE is the purpose (new consultation, follow-up, lab review);
   consultation MODE is how they meet (in-person / video / phone).
   Call list_appointment_types with the chosen doctor's hospital_id (it is
   in the earlier search_doctors result on that doctor) and ask in plain
   words ("Is this a routine check-up or something specific?") — the app
   shows genuine visit types with their minutes in a select bar.
   Mode-named rows ("Video consultation", "Phone visit") are NEVER shown
   as visit types; when the patient picks one by name, the mode is
   recorded automatically and the mode question is SKIPPED, never asked
   again. Otherwise ask next: "...and would you like video, a phone call,
   or an in-person visit?" — the chips shown contain ONLY modes the
   chosen doctor actually offers. Never offer, and never book, any other
   mode (a code gate refuses it with mode_not_offered). Match their words
   to the closest type name yourself; never expose ids. A deterministic
   guard refuses check_availability/create_appointment until the type
   step is done — if you see visit_type_required, follow it instead of
   retrying.
5. TIME: once the patient has PICKED the type (context visit_type_name)
   plus doctor + day + start time, compute end = start + that type's
   duration_minutes — never a guessed number. The start the patient taps
   is an IST label: book the slot whose start_ist matches it (its UTC
   start), and propose using the IST labels ("Dr. Rao, Monday Oct 6,
   9:30–10:00 AM over video — shall I book it? Reply yes to confirm.").
   Name the mode in every proposal. Sanity-check it against the day
   schedule you already fetched (inside working hours? overlapping a busy
   block?). If the type is still unknown, go back to step 4 first —
   never propose a range.
6. CONFIRM & BOOK: only after explicit yes, call create_appointment with
   consultation_mode set to the picked mode (video/phone/in_person — omit
   it only if they truly said "anything"). If it reports a conflict /
   taken slot, say so warmly ("Ah — that time was just taken"), and
   immediately offer the nearest free starts from the same day schedule,
   then propose one and wait for yes again. Never report "confirmed"
   unless the tool outcome is confirmed.

Canonical booking state (Phase 2 — code owns memory, you own language):
- The context JSON is canonical: selected_hospital_id/name, selected_doctor_id/name,
  selected_date (YYYY-MM-DD, IST), selected_appointment_type_id + visit_type_name +
  duration_minutes, selected_consultation_mode, requested_start (HH:MM),
  selected_start/selected_end (UTC ISO interval), offered lists, pending_booking.
  Whatever is already VALID there is truth — never re-ask it, never re-derive it.
- HOSPITAL-FIRST: if selected_hospital_id is set, EVERY doctor search MUST pass
  hospital_id=selected_hospital_id. Never search globally once the hospital is known.
  If the patient names a hospital ("at Apollo"), call search_hospitals first, then
  search_doctors(hospital_id=...) — never the reverse.
- The patient's taps arrive as typed selections AND as words; both update the same
  state. A tapped time is already validated — use its UTC start, don't reinterpret it.
- Booking readiness is computed in code and shown as missing[] in your context notes:
  only propose when missing is empty; otherwise ask ONLY the first missing item.
  Never decide readiness yourself, never compute end times yourself
  (end = start + duration_minutes is done in code).

 Deterministic conversational actions (handled in code — never improvise these):
 - COMPARE ("compare A and B", "compare the first and third", "compare
   them"): resolved against the displayed doctors and answered with a
   real-data table. Acknowledge in ONE line and move to the next missing
   fact — never re-compare in prose, never invent ratings/fees/experience.
 - SUMMARY ("tell me everything about this appointment", "what's
   currently selected"): answered with the structured booking card. Don't
   re-summarize in prose; point at anything still missing instead.
 - A time pick ("11 to 11:30", tapping a slot) only SELECTS the slot.
   Show the updated summary and ask "Would you like me to book it?" —
   then WAIT for an explicit yes. Never write "booked" unless
   create_appointment returned a confirmed outcome.
 - A tap from an older message carries a stale state_revision and is
   rejected in code with a "from an earlier step" notice. Never re-apply
   stale picks yourself.

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

#: Web voice turns (per-turn only, never persisted): the patient is
#: speaking and hearing the reply read aloud in the browser. Unlike the
#: telephone channel there is no identity gate — the caller is already
#: signed in — the model just needs to know it is heard, not read.
WEB_VOICE_PROMPT = """
This turn is a LIVE VOICE call: the patient is speaking to you out loud
and hearing your reply read aloud — never claim you are "chatting via
text" or that you cannot hear them. Keep every reply to short spoken
sentences (no markdown, no lists, no ids); the browser reads exactly
what you write.
"""


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
    # "No, in-person" / "No, video" is a MODE CORRECTION, not a decline:
    # the patient is answering the mode question, not dropping a proposal.
    s = (text or "").strip()
    if re.match(
        r"^(no|nope|nah)\s*,?\s*(in[\s-]?person|video|phone|call)\b",
        s,
        re.IGNORECASE,
    ):
        return False
    return bool(_DECLINE_RE.search(s))


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
        if str(args.get("consultation_mode", "") or "").strip():
            context.pending_booking["consultation_mode"] = str(
                args.get("consultation_mode", "")
            ).strip()
        context.awaiting_confirmation = True
        context.pending_clarification = "booking_confirmation"
        return {"ok": False, "error": CONFIRM_REQUIRED}
    if name == "reschedule_appointment":
        _ensure_booking_idempotency(args)
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
    _ensure_booking_idempotency(args)
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
    if name == "search_hospitals" and isinstance(payload.get("hospitals"), list):
        # Hospital-first constraint: ground the patient's "Apollo" against
        # real results into canonical selected_hospital_id (+ display name).
        # Never a global doctor search after this resolves (prompt §H1).
        hid = match_hospital_offer(context, payload["hospitals"])
        if hid:
            for h in context.offered_hospitals:
                if str(h.get("id")) == hid:
                    context.selected_hospital_id = hid
                    context.selected_hospital_name = str(h.get("name", "")) or None
                    break
            context.flow_open = True
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
        # A fresh search starts a fresh choice: drop the previously picked
        # doctor so a stale selection cannot leak into the new flow's
        # stage, cards, or availability. Type/mode/day records survive a
        # search (same-turn checks need them) and are instead reset when a
        # booking completes. Offers still accumulate for "that one"
        # resolution.
        context.selected_doctor_id = None
        context.selected_doctor_name = None
        context.flow_open = True
        # Cold-start grounding ("Book Dr Rao tomorrow"): the name kept as
        # doctor_query now meets real offers — resolve without re-asking.
        dq = (getattr(context, "doctor_query", None) or "").strip().lower()
        if dq:
            for d in payload["doctors"]:
                if not isinstance(d, dict) or not d.get("id"):
                    continue
                nm = str(d.get("name", "")).lower().lstrip("dr. ").strip()
                if dq in nm or nm in dq or dq.split()[-1] in nm:
                    context.selected_doctor_id = str(d["id"])
                    context.selected_doctor_name = str(d.get("name", "")) or None
                    context.doctor_query = None
                    break
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
        # booking is a new flow, so everything it picked (type, mode, day)
        # resets and must be picked again — never carried over silently.
        # The flow itself closes: later unrelated questions render zero
        # step widgets until a new flow opens.
        context.pending_booking = None
        context.awaiting_confirmation = False
        context.flow_open = False
        context.visit_types_seen = False
        context.visit_type_name = None
        context.selected_appointment_type_id = None
        context.selected_consultation_mode = None
        context.selected_date = None
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


def _apply_typed_selection(context, db: Session, selection: dict[str, Any]) -> str:
    """Apply a typed frontend selection to canonical state (§12, §19).

    Event: {"type": "booking_selection", "field": ..., "value": ...,
    "message_id"?, "state_revision"?, "widget_id"?}.
    Fields: hospital (id), doctor (id), appointment_type (id), date
    (YYYY-MM-DD), start_time (UTC ISO start), consultation_mode
    (video|phone|in_person). Unknown ids are ignored (never trusted
    blindly).

    Returns "applied" | "stale" | "ignored". A tap built against an
    older state_revision (P4) returns "stale" WITHOUT mutating anything —
    the caller renders the stale-step notice instead. Every applied
    change routes through update_booking_field (P5) so dependents,
    proposals, and the revision advance together.
    """
    try:
        sel_rev = selection.get("state_revision", None)
    except AttributeError:
        sel_rev = None
    if sel_rev is not None:
        try:
            if int(sel_rev) < int(getattr(context, "state_revision", 0) or 0):
                return "stale"
        except (TypeError, ValueError):
            pass
    field = str(selection.get("field", "") or "")
    value = selection.get("value", "")
    if field == "hospital" and value:
        try:
            row = db.get(Hospital, uuid.UUID(str(value)))
        except (ValueError, AttributeError, TypeError):
            row = None
        if row is not None and getattr(getattr(row, "status", None), "value", getattr(row, "status", None)) == "approved":
            prev = str(getattr(context, "selected_hospital_id", None) or "")
            context.selected_hospital_id = str(row.id)
            context.selected_hospital_name = getattr(row, "name", None)
            context.hospital_query = None
            context.flow_open = True
            if prev and prev != str(row.id):
                update_booking_field(context, "hospital")
            else:
                bump_revision(context)
            return "applied"
        return "ignored"
    elif field == "doctor" and value:
        pool = [str(d.get("id")) for d in (context.offered_doctors or []) if isinstance(d, dict)]
        if str(value) in pool or not pool:
            try:
                row = db.get(Doctor, uuid.UUID(str(value)))
            except (ValueError, AttributeError, TypeError):
                row = None
            if row is not None:
                prev = str(getattr(context, "selected_doctor_id", None) or "")
                context.selected_doctor_id = str(row.id)
                context.selected_doctor_name = getattr(row, "name", None)
                context.doctor_query = None
                context.flow_open = True
                if prev and prev != str(row.id):
                    update_booking_field(
                        context,
                        "doctor",
                        doctor_offer=list(getattr(row, "consultation_types", None) or []),
                        doctor_durations=list(getattr(row, "available_durations", None) or []),
                    )
                else:
                    bump_revision(context)
                return "applied"
        return "ignored"
    elif field == "appointment_type" and value:
        for t in (getattr(context, "visit_types", None) or []):
            if isinstance(t, dict) and str(t.get("id")) == str(value):
                prev = str(getattr(context, "selected_appointment_type_id", None) or "")
                context.selected_appointment_type_id = str(t["id"])
                context.visit_type_name = str(t.get("name", ""))
                context.type_query = None
                context.flow_open = True
                sync_duration_from_types(context)
                # A mode-like type ("Video consultation") auto-derives the
                # mode inside update_booking_field — never re-asked (P1).
                update_booking_field(context, "visit_type")
                return "applied"
        return "ignored"
    elif field == "consultation_mode" and str(value).lower() in ("video", "phone", "in_person"):
        context.selected_consultation_mode = str(value).lower()
        context.flow_open = True
        update_booking_field(context, "consultation_mode")
        return "applied"
    elif field == "date" and value:
        try:
            _date.fromisoformat(str(value))
            prev = str(getattr(context, "selected_date", None) or "")
            context.selected_date = str(value)
            context.flow_open = True
            if prev and prev != str(value):
                update_booking_field(context, "date")
            else:
                bump_revision(context)
            return "applied"
        except ValueError:
            return "ignored"
    elif field == "start_time" and value:
        # Value is a UTC ISO start; end derives from the picked duration.
        dur = getattr(context, "duration_minutes", None)
        try:
            start_dt = datetime.fromisoformat(str(value))
            if start_dt.tzinfo is None:
                return "ignored"
            if dur:
                end_dt = start_dt + timedelta(minutes=int(dur))
                set_canonical_slot(context, start_dt.isoformat(), end_dt.isoformat())
                context.flow_open = True
                update_booking_field(context, "start_time")
                return "applied"
        except (ValueError, TypeError):
            pass
        return "ignored"
    return "ignored"


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

    Matches a full/partial offered name ("Dr. Rao" / "Rao"), an ordinal
    ("first", "second one", "3rd") against the CURRENT page, then fuzzy
    fallbacks for misspellings ("Badaru Kiran" ~ "Bandaru Kiran"): a
    distinctive token owned by exactly one offered doctor, else close
    edit-distance. Returns the doctor id or None. The model still confirms
    the choice out loud; this only records it so the UI can move to the
    date step without another tool round-trip.
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
    # Fuzzy fallbacks for misspellings ("Badaru Kiran" ~ "Bandaru Kiran"):
    # a distinctive token owned by exactly ONE offered doctor ("kiran"),
    # else close edit-distance on the full name. Ambiguous -> None.
    token_owners: dict[str, str] = {}
    ambiguous: set[str] = set()
    for d in offered:
        for token in _norm_name(str(d.get("name", ""))).split():
            if len(token) < 4:
                continue
            if token in token_owners:
                ambiguous.add(token)
            token_owners[token] = str(d.get("id"))
    words = set(re.findall(r"[a-z]{4,}", lowered))
    uniquely = {
        token_owners[w] for w in words if w in token_owners and w not in ambiguous
    }
    if len(uniquely) == 1:
        return next(iter(uniquely))
    import difflib as _difflib

    message_name = re.sub(r"[^a-z ]", "", lowered).strip()
    best: tuple[float, str] | None = None
    for d in offered:
        name = _norm_name(str(d.get("name", "")))
        if len(name) < 3:
            continue
        score = _difflib.SequenceMatcher(None, message_name, name).ratio()
        if best is None or score > best[0]:
            best = (score, str(d.get("id")))
    if best is not None and best[0] >= 0.6:
        return best[1]
    return None


def detect_type_selection(context, text: str) -> str | None:
    """Deterministic visit-type pick from a message naming a shown type.

    Matches against the PRESENTED types only (get_valid_visit_types: a
    mode-named row like "Video consultation" is not a visit type, so
    saying "video" never picks it as one — the mode detector owns that
    word). Falls back to the full listing only when the catalog holds
    nothing but mode-like rows. Returns the type id or None.
    """
    types = [t for t in get_valid_visit_types(context) if isinstance(t, dict) and t.get("id")]
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


COMPLETENESS_DATE_REQUIRED = (
    "date_required: no visit day is on record yet — availability and "
    "booking both need a concrete day the PATIENT gave (tomorrow, Monday, "
    "Sep 21…). Ask which day suits them (the day strip appears in the app "
    "for them to tap) or use the day they already gave. Never invent one."
)

COMPLETENESS_TYPE_REQUIRED = (
    "type_required: the patient has not picked a visit type yet in this "
    "conversation, so the visit length is unknown. Present the types from "
    "list_appointment_types in plain words and let them choose — never "
    "book or check availability on a guessed type."
)

COMPLETENESS_TYPE_MISMATCH = (
    "type_mismatch: the call uses a different visit type than the one the "
    "patient picked (see context selected_appointment_type_id). Use the "
    "picked type's id, or ask again if they want to change it."
)

COMPLETENESS_MODE_REQUIRED = (
    "mode_required: the patient has not said how they want to meet yet "
    "(video, phone call, or in-person). Ask — the mode chips appear in "
    "the app — and only book after they pick. Never assume a mode."
)

COMPLETENESS_MODE_MISMATCH = (
    "mode_mismatch: the call uses a different consultation mode than the "
    "one the patient picked (see context selected_consultation_mode). "
    "Use the picked mode, or ask again if they want to change it."
)


def booking_completeness(context, name: str, args: dict) -> dict | None:
    """All six booking facts patient-given before anything runs.

    doctor + slot(date/start/end) are proven by the confirm gate's
    known-offer match; this gate proves the rest: a patient-given DAY on
    record, the PICKED visit type (and the call using its id), and the
    PICKED consultation mode (auto-filled into create when the call omits
    it — faithful, never invented). Reschedule/cancel keep the original
    booking's facts, so only fresh checks and bookings are gated.
    """
    if name not in ("check_availability", "create_appointment"):
        return None
    if not isinstance(args, dict):
        args = {}
    if not getattr(context, "selected_date", None):
        return {"ok": False, "error": COMPLETENESS_DATE_REQUIRED}
    picked_type = str(getattr(context, "selected_appointment_type_id", None) or "").strip()
    if not picked_type:
        return {"ok": False, "error": COMPLETENESS_TYPE_REQUIRED}
    arg_type = str(args.get("appointment_type_id", "") or "").strip()
    if not arg_type or arg_type != picked_type:
        return {"ok": False, "error": COMPLETENESS_TYPE_MISMATCH if arg_type else COMPLETENESS_TYPE_REQUIRED}
    if name == "create_appointment":
        picked_mode = str(getattr(context, "selected_consultation_mode", None) or "").strip().lower()
        if not picked_mode:
            return {"ok": False, "error": COMPLETENESS_MODE_REQUIRED}
        arg_mode = str(args.get("consultation_mode", "") or "").strip().lower()
        if arg_mode and arg_mode != picked_mode:
            return {"ok": False, "error": COMPLETENESS_MODE_MISMATCH}
        if not arg_mode:
            args["consultation_mode"] = picked_mode
    return None


def _mode_offer_gate(db: Session, context, name: str, args: dict) -> dict | None:
    """Deterministic mode-vs-doctor validity (P2).

    The picked consultation mode must be offered by the selected doctor
    (mirrors the appointment service's `_normalize_consultation_mode`).
    The mode selector only ever shows valid modes, so this fires only
    when the model invents a combination — caught here, in code, instead
    of surfacing as a 422 several turns later.
    """
    if name != "create_appointment" or not isinstance(args, dict):
        return None
    picked = str(
        args.get("consultation_mode", "")
        or getattr(context, "selected_consultation_mode", "")
        or ""
    ).strip().lower()
    did = str(
        getattr(context, "selected_doctor_id", None) or args.get("doctor_id", "") or ""
    ).strip()
    if not picked or not did:
        return None
    try:
        row = db.get(Doctor, uuid.UUID(did))
    except (ValueError, AttributeError, TypeError):
        return None
    if row is None:
        return None
    offered = [str(m).strip().lower() for m in (getattr(row, "consultation_types", None) or [])]
    if offered and picked not in offered:
        names = {"video": "video", "phone": "phone", "in_person": "in-person"}
        return {
            "ok": False,
            "error": (
                "mode_not_offered: the patient picked "
                f"{names.get(picked, picked)} but {getattr(row, 'name', 'this doctor')} "
                f"offers only {', '.join(names.get(m, m) for m in offered)}. Do NOT "
                "call create_appointment with this combination. Present ONLY the "
                "offered modes and let the patient pick again."
            ),
        }
    return None


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


_CONSULTATION_MODES = (
    ("video", re.compile(r"\bvideo\b|\bvirtual\b|\bvideo\s?call\b")),
    ("phone", re.compile(r"\bphone\b|\bcall\b|\btelephone\b|\bvoice\s?call\b")),
    ("in_person", re.compile(r"\bin[\s-]?person\b|\bnormal\b|\bclinic\b|\bface\s?to\s?face\b|\bphysical\b")),
)


def detect_consultation_mode(text: str) -> str | None:
    """Deterministic how-to-meet pick ("video", "a call", "normal/in-person").

    Earliest mention wins ("video or phone" -> video). A mode word inside
    a proper name ("Telephone Testerson") never counts — it is someone's
    name, not an answer. Returns video | phone | in_person or None. Only
    records the pick; the model still confirms out loud and passes
    consultation_mode on booking.
    """
    from app.ai.agent.booking_state import is_proper_noun_mention as _is_proper

    raw = text or ""
    lowered = f" {raw.strip().lower()} "
    base = 1 + (len(raw) - len(raw.lstrip()))
    first: tuple[int, str] | None = None
    for mode, pattern in _CONSULTATION_MODES:
        for hit in pattern.finditer(lowered):
            start = base + (hit.start() - 1)
            try:
                if _is_proper(raw, start, start + (hit.end() - hit.start())):
                    continue
            except (TypeError, ValueError):
                pass
            if first is None or hit.start() < first[0]:
                first = (hit.start(), mode)
            break
    return first[1] if first else None


def booking_stage(context, fresh_tools):
    """Where the patient is in the guided booking flow (drives chat UI).

    Stateful and missing-aware: each turn reports the FIRST still-missing
    fact (browse → pick_date → pick_type → pick_mode → pick_time), so the
    UI shows ONLY the widget for the step that is actually required next —
    never the whole flow again. Fresh tool results outrank memory: a just
    fetched schedule/types panel is what the patient must react to now.
    A closed flow (never opened, or booking completed) always reports
    browse: unrelated later questions render zero step widgets.
    """
    if context.awaiting_confirmation:
        return "confirm"
    if "get_day_schedule" in fresh_tools or "check_availability" in fresh_tools:
        return "pick_time"
    if "list_appointment_types" in fresh_tools:
        return "pick_type"
    if "search_doctors" in fresh_tools:
        return "browse"
    if not getattr(context, "flow_open", False):
        return "browse"
    if not getattr(context, "selected_doctor_id", None):
        return "browse"
    if not getattr(context, "selected_date", None):
        return "pick_date"
    if not getattr(context, "selected_appointment_type_id", None):
        return "pick_type"
    if not getattr(context, "selected_consultation_mode", None):
        return "pick_mode"
    return "pick_time"


def _remember_booking_selection(context, name: str, args: dict, outcome: dict) -> None:
    """Deterministic multi-step memory: remember which doctor/type/slot the
    assistant looked up or booked, so follow-up confirmations and
    'that one' references resolve even if the model forgets. Only
    successful calls are remembered."""
    if not isinstance(args, dict):
        return
    if not isinstance(outcome, dict) or not outcome.get("ok"):
        return
    if name in ("check_availability", "create_appointment", "get_day_schedule",
                "list_appointment_types"):
        context.flow_open = True
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
    if name == "create_appointment":
        mode = str(args.get("consultation_mode", "") or "").strip().lower()
        if mode in ("video", "phone", "in_person"):
            context.selected_consultation_mode = mode


def _doctor_cards_by_ids(
    db: Session,
    ids: list,
    patient_latitude: float | None = None,
    patient_longitude: float | None = None,
    context=None,
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
        card = {
            "id": str(d.id),
            "name": d.name,
            "photo_url": d.photo_url,
            "hospital_name": h_name,
            "hospital_city": h_city,
            "specialty": s_name,
            "distance_km": dist,
            # Concierge enrichment from REAL rows only (no ratings:
            # the Doctor table carries none, so none are invented).
            "experience_years": int(getattr(d, "experience_years", 0) or 0),
            "consultation_types": list(getattr(d, "consultation_types", None) or []),
            "available_durations": list(getattr(d, "available_durations", None) or []),
        }
        if context is not None:
            try:
                card["why_match"] = concierge.build_why_match(card, context)
            except (AttributeError, TypeError, ValueError):
                card["why_match"] = []
        cards.append(card)
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
        context=context,
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


def _effective_patient_point(db: Session, ctx: RequestContext, latitude, longitude):
    """Live GPS else saved home point (patient role only), validated."""
    live_lat = latitude if isinstance(latitude, (int, float)) else None
    live_lng = longitude if isinstance(longitude, (int, float)) else None
    if live_lat is not None and not (-90 <= float(live_lat) <= 90):
        live_lat = None
    if live_lng is not None and not (-180 <= float(live_lng) <= 180):
        live_lng = None
    if live_lat is None or live_lng is None:
        live_lat, live_lng = None, None
    if ctx.role != Role.patient:
        return None, None
    profile = (
        db.query(PatientProfile)
        .filter(PatientProfile.patient_user_id == ctx.user_id)
        .first()
    )
    if live_lat is not None:
        return float(live_lat), float(live_lng)
    saved_lat = getattr(profile, "latitude", None) if profile else None
    saved_lng = getattr(profile, "longitude", None) if profile else None
    if (
        isinstance(saved_lat, (int, float))
        and isinstance(saved_lng, (int, float))
        and -90 <= float(saved_lat) <= 90
        and -180 <= float(saved_lng) <= 180
    ):
        return float(saved_lat), float(saved_lng)
    return None, None


def _reopen_stage(context, field: str) -> None:
    """'Go back to <stage>' (P8): clear that field and everything below
    it, keep everything above. Never restarts the whole flow."""
    if field == "doctor":
        context.selected_doctor_id = None
        context.selected_doctor_name = None
        context.doctor_query = None
        context.compare_ids = []
        update_booking_field(context, "doctor")
    elif field == "date":
        context.selected_date = None
        update_booking_field(context, "date")
    elif field == "visit_type":
        context.selected_appointment_type_id = None
        context.visit_type_name = None
        context.type_query = None
        context.duration_minutes = None
        update_booking_field(context, "visit_type")
    elif field == "consultation_mode":
        context.selected_consultation_mode = None
        update_booking_field(context, "consultation_mode")


def _summary_prose(summary: dict[str, Any]) -> str:
    """Short human mirror of build_booking_summary (P6/P7)."""
    mode_label = {
        "video": "Video",
        "phone": "Phone",
        "in_person": "In-person",
    }.get(str(summary.get("consultation_mode") or ""), None)
    vt = summary.get("visit_type") or {}
    slot = summary.get("slot") or {}
    lines = ["Here's everything I have for this appointment:"]
    doc = (summary.get("doctor") or {}).get("name")
    hosp = (summary.get("hospital") or {}).get("name")
    lines.append(f"Doctor: {doc or '— not chosen yet'}")
    if hosp:
        lines.append(f"Hospital: {hosp}")
    lines.append(f"Date: {summary.get('date') or '— not chosen yet'}")
    vt_name = vt.get("name")
    dur = vt.get("duration_minutes")
    lines.append(
        f"Visit type: {vt_name + (f' · {dur} min' if dur else '') if vt_name else '— not chosen yet'}"
    )
    lines.append(f"Consultation mode: {mode_label or '— not chosen yet'}")
    if slot.get("start") and slot.get("end"):
        try:
            from app.mcp_server.tools import _time as _time_fmt

            label = (
                f"{_time_fmt.ist_day_label(slot['start'])}, "
                f"{_time_fmt.ist_time_label(slot['start'])}–{_time_fmt.ist_time_label(slot['end'])}"
            )
        except (ImportError, AttributeError, TypeError, ValueError):
            label = f"{slot['start']} – {slot['end']}"
        lines.append(f"Time: {label}")
    else:
        lines.append("Time: — not chosen yet")
    lines.append(f"Status: {summary.get('status', 'Not ready to book')}")
    missing = summary.get("missing") or []
    if missing and summary.get("status") == "Not ready to book":
        lines.append(f"Still needed: {', '.join(missing)}.")
    return "\n".join(lines)


def _structured_turn_response(
    db: Session,
    context,
    cid: str,
    *,
    reply: str,
    surface: str,
    title: str | None = None,
    intent: str | None = None,
    stage: str | None = None,
    doctors: list | None = None,
    slots: list | None = None,
    appointment_types: list | None = None,
    day_schedule: dict | None = None,
    consultation_modes: list | None = None,
    compare: dict | None = None,
    quick_replies: list | None = None,
    filter_choices: list | None = None,
    actions: list | None = None,
    base_rev: int | None = None,
    include_summary: bool = True,
    iterations: int = 0,
    escalated: bool = False,
    stopped: bool = False,
) -> dict[str, Any]:
    """Deterministic reply envelope (compare/summary/stale paths — P3/P6).

    Same ChatOut shape as the LLM path, minus the model call: bumps
    state_revision when this turn made no other mutation, stamps a fresh
    message_id, persists, and returns. Turn-scoped `intent` is reported,
    never stored (the sticky booking intent underneath survives).
    """
    if base_rev is not None:
        try:
            if int(getattr(context, "state_revision", 0) or 0) <= int(base_rev):
                bump_revision(context)
        except (TypeError, ValueError):
            bump_revision(context)
    else:
        bump_revision(context)
    message_id = uuid.uuid4().hex[:12]
    try:
        context.last_message_id = message_id
    except (AttributeError, TypeError, ValueError):
        pass
    readiness = evaluate_readiness(context)
    stage_final = stage or concierge.map_booking_stage_to_concierge(
        booking_stage(context, set()), context
    )
    context.stage = stage_final
    try:
        summary = concierge.build_booking_summary(context) if include_summary else None
    except (AttributeError, TypeError, ValueError):
        summary = None
    if summary is not None and not (
        context.flow_open
        or getattr(context, "selected_doctor_id", None)
        or getattr(context, "selected_date", None)
        or getattr(context, "selected_appointment_type_id", None)
        or getattr(context, "selected_consultation_mode", None)
        or getattr(context, "selected_start", None)
    ):
        summary = None
    try:
        care = concierge.build_care_context(context)
    except (AttributeError, TypeError, ValueError):
        care = {}
    try:
        quick = list(quick_replies) if quick_replies is not None else concierge.quick_replies_for(stage_final, context)
    except (AttributeError, TypeError, ValueError):
        quick = []
    try:
        last_search = getattr(context, "last_search", None) or {}
        search_total = int(last_search.get("total", 0))
    except (TypeError, ValueError):
        search_total = 0
    pending = context.pending_booking if context.awaiting_confirmation else None
    context.remember_turn("assistant", reply)
    save_ai_context(context)
    return {
        "conversation_id": cid,
        "reply": reply,
        "iterations": iterations,
        "escalated": escalated,
        "stopped": stopped,
        "message_id": message_id,
        "state_revision": int(getattr(context, "state_revision", 0) or 0),
        "hospital": {
            "id": getattr(context, "selected_hospital_id", None),
            "name": getattr(context, "selected_hospital_name", None),
        },
        "selected_date": getattr(context, "selected_date", None),
        "selected_start": getattr(context, "selected_start", None),
        "selected_end": getattr(context, "selected_end", None),
        "duration_minutes": getattr(context, "duration_minutes", None),
        "missing_fields": readiness["missing"],
        "doctors": doctors or [],
        "doctors_total": search_total,
        "has_more_doctors": False,
        "slots": slots or [],
        "appointment_types": appointment_types or [],
        "day_schedule": day_schedule,
        "consultation_modes": consultation_modes or [],
        "booking_stage": booking_stage(context, set()),
        "pending_booking": pending,
        "booking_summary": summary,
        "surface": surface,
        "title": title,
        "allow_explore_more": False,
        "allow_compare": bool(compare is not None),
        "intent": intent or getattr(context, "intent", None),
        "stage": stage_final,
        "care_context": care,
        "quick_replies": quick,
        "compare": compare,
        "filter_choices": filter_choices or [],
        "actions": actions or [],
        "upcoming_appointment": None,
        "questionnaire": None,
    }


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
    selection: dict[str, Any] | None = None,
    channel: str | None = None,
) -> dict[str, Any]:
    """One chat turn: guard, tool loop, reply. Never raises for tool faults.

    `latitude`/`longitude` is the patient's live location for THIS message
    (from the app's "Use my location" button). It outranks the saved home
    point for nearby ranking but is never persisted here — the profile
    page owns saving.
    `channel` is the turn's channel for THIS message only ("web_voice"
    from the browser voice loop) and is never persisted: it only adds a
    channel line to this turn's system prompt so the model knows whether
    the patient is reading or hearing the reply. Text chat passes nothing.
    """
    cid = (conversation_id or "").strip() or str(uuid.uuid4())
    text = user_message.strip()
    if not text:
        raise ValueError("message must not be empty")
    context = get_ai_context(cid)
    context.user_id = str(ctx.user_id)
    context.remember_turn("user", text)
    # Revision this turn started from: taps built against an older one
    # are stale widgets and must never mutate (P4).
    base_rev = int(getattr(context, "state_revision", 0) or 0)
    # Turn-scoped conversational actions (P3/P6), resolved BEFORE any
    # fuzzy pick or tool call: compare/summary never mutate booking
    # state and never reach the LLM as free prose.
    try:
        turn_action = concierge.detect_intent(text, context)
    except (AttributeError, TypeError, ValueError):
        turn_action = "GENERAL_HELP"
    _is_compare_turn = turn_action == "COMPARE_DOCTORS"
    _is_summary_turn = turn_action == "SHOW_BOOKING_SUMMARY"
    # Phase 2 typed selection (§12): a tap and a spoken phrase update the
    # SAME canonical state. Selections are authoritative (no fuzzy parse):
    # hospital/doctor/appointment_type/consultation_mode/date/start_time.
    selection_status = "none"
    if isinstance(selection, dict) and selection.get("type") == "booking_selection":
        try:
            selection_status = _apply_typed_selection(context, db, selection)
        except (AttributeError, TypeError, ValueError):
            selection_status = "ignored"
    if selection_status == "stale":
        # P4: an old widget fired after the conversation moved on. Nothing
        # was mutated — say so plainly and show the CURRENT state (the
        # booking_summary payload opens edit mode with [Change] actions).
        stale_reply = (
            "That selection is from an earlier step, so I left your current "
            "booking unchanged. Here's where things stand right now — use "
            "the Change buttons below to edit anything."
        )
        context.remember_turn("assistant", stale_reply)
        return _structured_turn_response(
            db,
            context,
            cid,
            reply=stale_reply,
            surface="BOOKING_REVIEW",
            title="Current appointment",
            intent=getattr(context, "intent", None),
            base_rev=base_rev,
            quick_replies=["Change something", "Start over"],
        )
    # Snapshot for change detection: widgets must reflect what THIS turn
    # did (picked/changed), never re-blast earlier turns' UI.
    selected_doctor_before = str(getattr(context, "selected_doctor_id", None) or "")
    # Concierge merge (§1-5): understand everything present in this one
    # message (specialty, time-of-day, gender preference, for-whom,
    # concern) and preserve it. Corrections merge — never restart.
    try:
        concierge_changed = concierge.update_concierge_context(context, text)
    except (AttributeError, TypeError, ValueError):
        concierge_changed = {}
    # Patient-controlled conversation (§19): "start over" resets the flow
    # but keeps identity; it never deletes durable preferences.
    try:
        _start_over = concierge.detect_start_over(text)
    except (AttributeError, TypeError):
        _start_over = False
    if _start_over:
        context.selected_doctor_id = None
        context.selected_doctor_name = None
        context.selected_date = None
        context.selected_appointment_type_id = None
        context.selected_consultation_mode = None
        context.requested_start = None
        context.selected_start = None
        context.selected_end = None
        context.selected_slot = None
        context.offered_slots = []
        context.offered_doctor_page = []
        context.compare_ids = []
        context.pending_booking = None
        context.awaiting_confirmation = False
        context.flow_open = False
        if getattr(context, "pending_clarification", None) == "booking_confirmation":
            context.pending_clarification = None
        bump_revision(context)
    # Explicit edit commands (P8): "change doctor", "go back to <stage>".
    # These reopen a stage — clearing that field and everything below it
    # while keeping everything above — instead of restarting the flow.
    try:
        _edit_cmd = concierge.detect_change_request(text)
    except (AttributeError, TypeError, ValueError):
        _edit_cmd = None
    if _edit_cmd == "keep":
        pass  # "keep everything else the same": explicit no-op.
    elif _edit_cmd == "doctor":
        if getattr(context, "selected_doctor_id", None):
            context.selected_doctor_id = None
            context.selected_doctor_name = None
            context.doctor_query = None
            context.compare_ids = []
            update_booking_field(context, "doctor")
        context.flow_open = True
    elif _edit_cmd == "hospital":
        if getattr(context, "selected_hospital_id", None):
            context.selected_hospital_id = None
            context.selected_hospital_name = None
            context.hospital_query = None
            update_booking_field(context, "hospital")
        context.flow_open = True
    elif isinstance(_edit_cmd, str) and _edit_cmd.startswith("goback_"):
        _reopen_stage(context, _edit_cmd[len("goback_"):])
        context.flow_open = True
    # A turn-opening decline ("no", "never mind", "cancel that") drops a
    # stale proposal so a later "yes" cannot accidentally confirm it.
    if (
        context.awaiting_confirmation
        and _is_declined(text)
        and not _is_confirmation(text)
    ):
        _clear_booking_proposal(context)
    # A mid-confirm correction ("morning is better", "video is fine",
    # "tomorrow instead") changes the proposal's basis — re-propose
    # instead of booking the stale slot.
    if context.awaiting_confirmation and not _is_confirmation(text):
        try:
            _correction = concierge.detect_change_request(text)
        except (AttributeError, TypeError, ValueError):
            _correction = None
        if _correction in ("time_range", "date", "consultation_mode", "doctor", "visit_type", "hospital", "start_time") or (
            isinstance(_correction, str) and _correction.startswith("goback_")
        ):
            _clear_booking_proposal(context)
        elif concierge_changed.get("time_range"):
            _clear_booking_proposal(context)

    # Deterministic doctor pick ("Dr. Rao", "the second one"): recorded
    # before the model runs so the UI can advance to the date step even
    # if the model only acknowledges the choice out loud this turn.
    # Same for the visit-type pick ("Consult"): durations differ per type,
    # so the pick must be on record before anything is timed or booked.
    # Same for the visit day ("tomorrow", "Monday, Oct 6"): when the
    # patient already gave it, it is recorded so the assistant uses it
    # directly instead of asking for the date again.
    # Phase 2 invalidation snapshots: dependent availability must die
    # when its source changes (never leave a stale slot active).
    doctor_before = str(getattr(context, "selected_doctor_id", None) or "")
    date_before = str(getattr(context, "selected_date", None) or "")
    type_before = str(getattr(context, "selected_appointment_type_id", None) or "")
    hospital_before = str(getattr(context, "selected_hospital_id", None) or "")
    mode_before = str(getattr(context, "selected_consultation_mode", None) or "")
    requested_before = str(getattr(context, "requested_start", None) or "")
    # Summary turns are READ-ONLY (P6/P9): the summary command must never
    # mutate booking state through fuzzy matching. Compare turns suppress
    # only the doctor pick — naming doctors for comparison must not
    # hijack the booking into a selection (P3). Explicit edit commands
    # ("change doctor", "go back to …") suppress fuzzy picks too: the
    # command already stated the intent, and matching its own words
    # ("change DOCTOR" ~ offered "Dr. Chgdoc") would re-pick what was
    # just cleared. Date/time parsing still runs — "make it tomorrow"
    # and "change it to 11:00" carry their new value in words.
    _explicit_edit = (_edit_cmd in ("doctor", "hospital")) or (
        isinstance(_edit_cmd, str) and _edit_cmd.startswith("goback_")
    )
    _fuzzy_allowed = (
        not context.awaiting_confirmation
        and not _is_summary_turn
        and not _explicit_edit
    )
    if _fuzzy_allowed:
        if not _is_compare_turn:
            picked = detect_doctor_selection(context, text)
        else:
            picked = None
        if picked:
            prev_selected = str(getattr(context, "selected_doctor_id", None) or "")
            context.selected_doctor_id = picked
            context.flow_open = True
            for d in context.offered_doctors or []:
                if isinstance(d, dict) and str(d.get("id")) == picked:
                    context.selected_doctor_name = str(d.get("name", "")) or None
                    break
        else:
            # Cold start ("Book Dr Rao tomorrow"): no offers yet, so keep
            # the raw name as a candidate for the post-search resolution.
            cand_doc = detect_doctor_candidate(text)
            if cand_doc and not getattr(context, "selected_doctor_id", None):
                context.doctor_query = cand_doc
        hosp_cand = detect_hospital_candidate(text)
        if hosp_cand:
            context.hospital_query = hosp_cand
            context.flow_open = True
        picked_type = detect_type_selection(context, text)
        if picked_type:
            context.selected_appointment_type_id = picked_type
            context.flow_open = True
            for t in context.visit_types or []:
                if isinstance(t, dict) and str(t.get("id")) == picked_type:
                    context.visit_type_name = str(t.get("name", ""))
                    break
            sync_duration_from_types(context)
        else:
            # Cold start ("... for a follow-up"): keep the semantic
            # candidate until list_appointment_types grounds it.
            cand_type = detect_type_candidate(text)
            if cand_type and not getattr(context, "selected_appointment_type_id", None):
                context.type_query = cand_type
        picked_mode = detect_consultation_mode(text) or detect_mode_candidate(text)
        if picked_mode:
            context.selected_consultation_mode = picked_mode
            context.flow_open = True
        # Deterministic start-time ("at 9:30"): recorded, never re-asked.
        hhmm = detect_time_hhmm(text)
        if hhmm:
            context.requested_start = hhmm
            context.flow_open = True
    # IST date parse (product timezone): "tomorrow" -> selected_date now.
    # A confirmation ("Yes, book it for Monday") affirms the recorded day;
    # it must never shift it (shifting would invalidate the very offers the
    # confirmation needs). Only fill an empty date from confirmations.
    # Summary turns never shift the day either (read-only).
    if not (_is_confirmation(text) and getattr(context, "selected_date", None)) and not _is_summary_turn:
        day = detect_date_iso_ist(text)
        if day:
            context.selected_date = day
    # Ground cold-start type candidates against just-arrived listings.
    if not getattr(context, "selected_appointment_type_id", None) and getattr(
        context, "type_query", None
    ):
        match_type_offer(context)
    # Build the canonical interval once date + time + duration are known.
    # Deterministic code owns interval math; the LLM never computes it.
    if (
        getattr(context, "selected_date", None)
        and getattr(context, "requested_start", None)
        and getattr(context, "duration_minutes", None)
    ):
        try:
            start_iso, end_iso = compute_interval_utc(
                str(context.selected_date),
                str(context.requested_start),
                int(context.duration_minutes),
            )
            set_canonical_slot(context, start_iso, end_iso)
        except (ValueError, TypeError):
            pass
    # Explicit invalidation on what THIS turn changed (P5): every
    # change routes through the single update_booking_field entry point
    # so dependents, proposals, and the revision advance together.
    if str(getattr(context, "selected_hospital_id", None) or "") != hospital_before and hospital_before:
        update_booking_field(context, "hospital")
    if str(getattr(context, "selected_doctor_id", None) or "") != doctor_before and doctor_before:
        _new_offer: list[str] | None = None
        _new_durations: list[int] | None = None
        try:
            _doc_row = db.get(Doctor, uuid.UUID(str(getattr(context, "selected_doctor_id", None))))
        except (ValueError, AttributeError, TypeError):
            _doc_row = None
        if _doc_row is not None:
            _new_offer = list(getattr(_doc_row, "consultation_types", None) or [])
            _new_durations = list(getattr(_doc_row, "available_durations", None) or [])
        update_booking_field(
            context, "doctor", doctor_offer=_new_offer, doctor_durations=_new_durations
        )
    if str(getattr(context, "selected_date", None) or "") != date_before and date_before:
        update_booking_field(context, "date")
    if str(getattr(context, "selected_appointment_type_id", None) or "") != type_before and type_before:
        update_booking_field(context, "visit_type")
    if str(getattr(context, "selected_consultation_mode", None) or "") != mode_before and mode_before:
        update_booking_field(context, "consultation_mode")
    if str(getattr(context, "requested_start", None) or "") != requested_before and requested_before:
        # A new requested time retires the proposal that named the old
        # slot; the canonical interval is rebuilt just below.
        _clear_booking_proposal(context)
        bump_revision(context)
    # A stale comparison view dies on any new search/selection — but a
    # compare turn itself refreshes it (handled deterministically below).
    if not _is_compare_turn:
        try:
            _exploring = concierge.detect_explore_more(text)
        except (AttributeError, TypeError, ValueError):
            _exploring = False
        if not _exploring and getattr(context, "compare_ids", None):
            context.compare_ids = []

    if is_clinical_request(text):
        context.remember_turn("assistant", CLINICAL_DECLINE)
        context.intent = "ESCALATE"
        context.stage = "ESCALATION"
        context.last_ui_surface = "ESCALATION"
        save_ai_context(context)
        return {
            "conversation_id": cid,
            "reply": CLINICAL_DECLINE,
            "iterations": 0,
            "escalated": False,
            "doctors": [],
            "slots": [],
            "pending_booking": None,
            "surface": "ESCALATION",
            "title": None,
            "allow_explore_more": False,
            "allow_compare": False,
            "intent": "ESCALATE",
            "stage": "ESCALATION",
            "care_context": concierge.build_care_context(context),
            "quick_replies": ["Talk to care team", "Find a doctor"],
            "compare": None,
            "filter_choices": [],
            "actions": [{"id": "escalate", "label": "Talk to care team", "kind": "escalate"}],
            "upcoming_appointment": None,
            "questionnaire": None,
        }

    greet = greeting_kind(text)
    if greet is not None:
        # Deterministic: no model call, no tools, no cards — a bare
        # greeting can never surface stale offers or invented appointments.
        # A pending proposal (if any) is kept and still returned so the
        # confirm panel stays on screen.
        greeting_text = _greeting_reply(db, ctx, greet)
        context.remember_turn("assistant", greeting_text)
        if not getattr(context, "intent", None):
            context.intent = "GENERAL_HELP"
        context.stage = "GREETING"
        context.last_ui_surface = "QUICK_REPLIES"
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
            "surface": "QUICK_REPLIES" if not pending_greet else "BOOKING_REVIEW",
            "title": None,
            "allow_explore_more": False,
            "allow_compare": False,
            "intent": getattr(context, "intent", None),
            "stage": "GREETING",
            "care_context": concierge.build_care_context(context),
            "quick_replies": concierge.quick_replies_for("GREETING", context),
            "compare": None,
            "filter_choices": [],
            "actions": [],
            "upcoming_appointment": None,
            "questionnaire": None,
        }

    # Phase 2 hospital-doctor verification: a named doctor must belong to
    # the named hospital. Never silently substitute — return a structured
    # correction with real choices inside the hospital.
    hid_now = str(getattr(context, "selected_hospital_id", None) or "")
    did_now = str(getattr(context, "selected_doctor_id", None) or "")
    if hid_now and did_now:
        try:
            doc_row = db.get(Doctor, uuid.UUID(did_now))
        except (ValueError, AttributeError, TypeError):
            doc_row = None
        if doc_row is None or str(getattr(doc_row, "hospital_id", "")) != hid_now:
            hname = str(getattr(context, "selected_hospital_name", None) or "that hospital")
            context.selected_doctor_id = None
            context.selected_doctor_name = None
            invalidate_on_change(context, "doctor")
            from app.domain.doctor.models import DoctorStatus as _DoctorStatus

            alternates = (
                db.query(Doctor)
                .filter(
                    Doctor.hospital_id == uuid.UUID(hid_now),
                    Doctor.status == _DoctorStatus.active,
                )
                .limit(5)
                .all()
            )
            alt_ids = [str(d.id) for d in alternates]
            cards = _doctor_cards_by_ids(db, alt_ids, context=context) if alt_ids else []
            reply = (
                f"The doctor you named isn't at {hname} — I haven't booked "
                f"anything. Here are doctors who are there; pick one and "
                f"we'll continue with {context.selected_date or 'your day'}."
            )
            context.remember_turn("assistant", reply)
            context.stage = "SHOWING_DOCTORS"
            context.last_ui_surface = "DOCTOR_RESULTS"
            save_ai_context(context)
            return {
                "conversation_id": cid,
                "reply": reply,
                "iterations": 0,
                "escalated": False,
                "stopped": False,
                "doctors": cards,
                "doctors_total": len(cards),
                "has_more_doctors": False,
                "slots": [],
                "appointment_types": [],
                "day_schedule": None,
                "consultation_modes": [],
                "booking_stage": booking_stage(context, set()),
                "pending_booking": None,
                "hospital": {"id": hid_now, "name": getattr(context, "selected_hospital_name", None)},
                "selected_date": getattr(context, "selected_date", None),
                "selected_start": getattr(context, "selected_start", None),
                "selected_end": getattr(context, "selected_end", None),
                "duration_minutes": getattr(context, "duration_minutes", None),
                "missing_fields": ["doctor"],
                "surface": "DOCTOR_RESULTS",
                "title": "Doctors that match your request",
                "allow_explore_more": False,
                "allow_compare": len(cards) > 1,
                "intent": getattr(context, "intent", None) or "FIND_CARE",
                "stage": "SHOWING_DOCTORS",
                "care_context": concierge.build_care_context(context),
                "quick_replies": concierge.quick_replies_for("SHOWING_DOCTORS", context),
                "compare": None,
                "filter_choices": concierge.build_explore_choices(context),
                "actions": [
                    {"id": f"choose:{c['id']}", "label": f"Choose {c['name']}", "kind": "choose_doctor", "doctor_id": c["id"]}
                    for c in cards[:5]
                ],
                "upcoming_appointment": None,
                "questionnaire": None,
            }

    # Deterministic conversational actions (P3/P6): answered from
    # structured state with real data — the LLM never improvises these.
    _eff_lat, _eff_lng = _effective_patient_point(db, ctx, latitude, longitude)
    if _is_compare_turn:
        _cmp_ids = concierge.resolve_compare_ids(context, text)
        context.compare_ids = _cmp_ids
        if len(_cmp_ids) >= 2:
            _cmp_cards = _doctor_cards_by_ids(
                db,
                _cmp_ids[:3],
                patient_latitude=_eff_lat,
                patient_longitude=_eff_lng,
                context=context,
            )
            if len(_cmp_cards) >= 2:
                _cmp_table = concierge.build_compare_table(_cmp_cards)
                _cmp_names = " and ".join(c["name"] for c in _cmp_cards)
                _cmp_reply = (
                    f"Here's a quick comparison of {_cmp_names} — "
                    "every field below comes from our live directory, nothing guessed. "
                    "Which one would you like to go with?"
                )
                context.remember_turn("assistant", _cmp_reply)
                return _structured_turn_response(
                    db,
                    context,
                    cid,
                    reply=_cmp_reply,
                    surface="DOCTOR_COMPARE",
                    title="Compare your options",
                    intent="COMPARE_DOCTORS",
                    stage="COMPARING_DOCTORS",
                    compare=_cmp_table,
                    quick_replies=["Check availability", "Show me more doctors"],
                    actions=[
                        {
                            "id": f"choose:{c['id']}",
                            "label": f"Choose {c['name']}",
                            "kind": "choose_doctor",
                            "doctor_id": c["id"],
                        }
                        for c in _cmp_cards
                    ],
                    base_rev=base_rev,
                )
        # Fewer than two comparable doctors on screen: say so plainly
        # and offer a way forward instead of improvising a comparison.
        _cmp_fallback = (
            "I can compare doctors side by side — right now I only have "
            "one option on screen. Want me to find more doctors to compare, "
            "or is there a specific doctor you'd like me to include?"
        )
        context.remember_turn("assistant", _cmp_fallback)
        return _structured_turn_response(
            db,
            context,
            cid,
            reply=_cmp_fallback,
            surface="TEXT",
            intent="COMPARE_DOCTORS",
            stage="SHOWING_DOCTORS",
            quick_replies=["Show me more doctors", "Start over"],
            actions=[
                {"id": "explore_more", "label": "Show me more", "kind": "explore_more"}
            ],
            base_rev=base_rev,
        )
    if _is_summary_turn:
        _summary = concierge.build_booking_summary(context)
        _sum_reply = _summary_prose(_summary)
        _sum_actions = [
            {"id": c["id"], "label": c["label"], "kind": "change", "prompt": c["prompt"]}
            for c in (_summary.get("changes") or [])
        ]
        if _summary.get("can_confirm"):
            _sum_actions.append(
                {"id": "confirm_booking", "label": "Confirm booking", "kind": "confirm"}
            )
            _sum_quick = ["Confirm booking", "Change something"]
        else:
            _sum_quick = ["Change something", "Start over"]
        context.remember_turn("assistant", _sum_reply)
        return _structured_turn_response(
            db,
            context,
            cid,
            reply=_sum_reply,
            surface="BOOKING_REVIEW",
            title="Appointment summary",
            intent="SHOW_BOOKING_SUMMARY",
            stage="REVIEWING_BOOKING",
            quick_replies=_sum_quick,
            actions=_sum_actions,
            base_rev=base_rev,
        )

    client = AgentToolClient(db, ctx)
    complete_fn = complete or groq_complete
    from app.ai.agent.booking_state import ist_today as _ist_today

    today = _ist_today().isoformat()
    system = SYSTEM_PROMPT + f"\nToday is {today} (IST, UTC+5:30)."
    # Deterministic readiness: the model follows `missing`, never decides.
    readiness = evaluate_readiness(context)
    system += (
        "\nBooking readiness (computed, authoritative): ready="
        + ("true" if readiness["ready"] else "false")
        + " missing=["
        + ", ".join(readiness["missing"])
        + "]. Ask ONLY the first missing item, nothing else."
    )
    # Concierge layer (additive guidance — safety gates above still own
    # truth; this only shapes tone, memory use, and choice presentation).
    try:
        _concierge_notes = []
        _intent_now = str(getattr(context, "intent", None) or "")
        _spec_now = str(getattr(context, "specialty_preference", None) or "")
        _tr_now = str(getattr(context, "time_range", None) or "")
        _gen_now = str(getattr(context, "gender_preference", None) or "")
        if _intent_now:
            _concierge_notes.append(f"Concierge intent={_intent_now}.")
        if _spec_now:
            _concierge_notes.append(
                f"Specialty preference={_spec_now}: pass it to search_doctors "
                "(specialty or query) — never ask for it again."
            )
        if _tr_now:
            _concierge_notes.append(
                f"Time preference={_tr_now}: prefer those slots when presenting, "
                "but never hide other availability."
            )
        if _gen_now:
            _concierge_notes.append(
                "Gender preference=" + _gen_now + ": acknowledge it warmly, keep it "
                "visible, but NEVER invent genders — doctor profiles carry no "
                "gender field, so present real results and let them choose."
            )
        _concierge_notes.append(
            "Concierge tone: calm, concise, reassuring, human. Name up to five "
            "doctors briefly with hospital + city; explain each pick in one "
            "short line grounded in the tool result (specialty / mode / "
            "distance / hospital). Never paste ids, tables, or tool names. "
            "When they seem unsure ('not sure', 'see someone'), ask ONE small "
            "question with a few friendly choices and never diagnose. "
            "'Show me more / another' keeps ALL current filters and pages "
            "forward (offset+5). 'Compare' compares the shown doctors only. "
            "Corrections ('morning is better', 'video is fine', 'tomorrow "
            "instead') change ONLY that value. After a confirmed booking, "
            "celebrate briefly and offer: view appointment, pre-visit "
            "questions, prepare for visit."
        )
        if _concierge_notes:
            system += "\n" + " ".join(_concierge_notes)
    except (AttributeError, TypeError, ValueError):
        pass
    if hid_now:
        system += (
            "\nHospital scope is SET (id=" + hid_now + "): every search_doctors "
            "call MUST pass hospital_id=" + hid_now + "."
        )
    if context.channel == "telephony":
        system += TELEPHONY_GUARD_PROMPT
    # Web voice turns hear the reply read aloud; text chat passes no
    # channel and is unchanged. Per-turn only — never written to context.
    if channel == "web_voice":
        system += WEB_VOICE_PROMPT
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
                outcome = visit_type_gate(context, call.get("name", ""))
                if outcome is None:
                    outcome = booking_completeness(
                        context, call.get("name", ""), args
                    )
                if outcome is None:
                    outcome = _booking_confirmation_gate(
                        context, text, call.get("name", ""), args
                    )
                if outcome is None:
                    outcome = _mode_offer_gate(
                        db, context, call.get("name", ""), args
                    )
                if outcome is None:
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
    # Valid how-to-meet options (P1/P2): the chosen doctor's REAL offer,
    # intersected with what the picked visit type implies. A mode-like
    # type ("Video consultation") ANSWERS the mode question itself — the
    # mode is recorded, never re-asked. Anything else shows ONLY valid
    # modes; an invented combination dies in _mode_offer_gate instead of
    # failing as a 422 several turns later.
    _type_implied_mode = implied_mode_from_type_name(
        str(getattr(context, "visit_type_name", None) or "")
    )
    _doc_offer_modes: list[str] | None = None
    _chosen_doc = getattr(context, "selected_doctor_id", None)
    if _chosen_doc:
        try:
            _doc_row_modes = db.get(Doctor, uuid.UUID(str(_chosen_doc)))
        except (ValueError, AttributeError, TypeError):
            _doc_row_modes = None
        if _doc_row_modes is not None:
            _doc_offer_modes = list(getattr(_doc_row_modes, "consultation_types", None) or [])
    _valid_modes = get_valid_consultation_modes(_doc_offer_modes, _type_implied_mode)
    if (
        _type_implied_mode
        and _type_implied_mode in _valid_modes
        and not getattr(context, "selected_consultation_mode", None)
    ):
        context.selected_consultation_mode = _type_implied_mode
        context.flow_open = True
    fresh_modes: list[str] = []
    if "list_appointment_types" in fresh_tools:
        context.consultation_modes = list(_valid_modes)
        # Chips only when the mode is genuinely undecided — never the
        # duplicate question after a mode-defining type (P1).
        if not getattr(context, "selected_consultation_mode", None):
            fresh_modes = list(_valid_modes)
    context.remember_turn("assistant", reply)
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
        # No fresh search this turn: show the chosen doctor's card ONLY
        # when this turn picked or changed them — never re-blast earlier
        # turns' cards under unrelated replies.
        chosen = getattr(context, "selected_doctor_id", None)
        chosen_now = str(chosen or "")
        if chosen_now and chosen_now != selected_doctor_before:
            doctors_cards = _doctor_cards_by_ids(
                db,
                [chosen_now],
                patient_latitude=effective_lat,
                patient_longitude=effective_lng,
                context=context,
            )
    has_more = (
        "doctors" in fresh_offers
        and search_total > 0
        and search_offset + len(doctors_cards) < search_total
    )
    # Fresh panels outrank memory; stored panels re-appear ONLY when
    # their step is genuinely pending again (state-dependent UI, never
    # re-blasted). Stored types/modes come from context.visit_types /
    # context.consultation_modes recorded on their original turns.
    stage = booking_stage(context, fresh_tools)
    fresh_types = [
        {
            "id": str(t.get("id", "")),
            "name": t.get("name", ""),
            "duration_minutes": t.get("duration_minutes", 0),
        }
        for t in (turn_results.get("list_appointment_types", {}).get("appointment_types") or [])
        if isinstance(t, dict) and t.get("id")
    ]
    stored_types = [
        {
            "id": str(t.get("id", "")),
            "name": t.get("name", ""),
            "duration_minutes": t.get("duration_minutes", 0),
        }
        for t in (getattr(context, "visit_types", None) or [])
        if isinstance(t, dict) and t.get("id")
    ]
    stored_modes = [
        m for m in (getattr(context, "consultation_modes", None) or [])
        if m in ("video", "phone", "in_person")
    ]
    # Presented visit types (P1): mode-named rows are hidden from the
    # visit-type question — unless the catalog holds nothing else (still
    # genuinely bookable). Grounding/booking still use the full listing.
    def _presentable_types(
        rows: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        genuine = [
            t for t in rows if not is_mode_like_type_name(str(t.get("name", "")))
        ]
        return genuine or rows

    fresh_types = _presentable_types(fresh_types)
    stored_types = _presentable_types(stored_types)
    readiness_out = evaluate_readiness(context)
    # --- Concierge envelope (§10-12): typed surface + explainability ----
    # Rank fresh slots by the patient's time-of-day preference (morning/
    # afternoon/evening) without hiding anything.
    _raw_slots = (
        [
            {"start": s.get("start", ""), "end": s.get("end", "")}
            for s in (context.offered_slots or [])[:10]
            if isinstance(s, dict) and s.get("start")
        ]
        if "slots" in fresh_offers
        else []
    )
    try:
        _slots = concierge.filter_slots_by_time_range(
            _raw_slots, getattr(context, "time_range", None)
        )
    except (AttributeError, TypeError, ValueError):
        _slots = _raw_slots
    _day_schedule = turn_results.get("get_day_schedule")
    if _day_schedule:
        # P10: ONE authoritative time selector per turn. The day timeline
        # subsumes the slot chips — showing both invites double picks.
        _slots = []
    _concierge_stage = concierge.map_booking_stage_to_concierge(stage, context)
    # A freshly confirmed booking moves to BOOKING_SUCCESS/POST_BOOKING.
    _just_booked = "create_appointment" in fresh_tools and not pending
    if _just_booked:
        _concierge_stage = "BOOKING_SUCCESS"
    elif escalated:
        _concierge_stage = "ESCALATION"
    context.stage = _concierge_stage
    if not getattr(context, "intent", None):
        try:
            context.intent = concierge.detect_intent(text, context)
        except (AttributeError, TypeError):
            context.intent = "GENERAL_HELP"
    _care = concierge.build_care_context(context)
    _quick = concierge.quick_replies_for(_concierge_stage, context)
    # "I'm not sure" / ambiguous care: offer gentle specialty choices.
    try:
        _unsure = concierge.detect_unsure(text) or concierge.detect_ambiguous_care(text)
    except (AttributeError, TypeError):
        _unsure = False
    if _unsure and not doctors_cards:
        _quick = ["General health", "Heart / chest", "Skin", "Bones / joints", "Something else"]
    # P7: a picked slot is a SELECTION, not a confirmation. Once every
    # other field is ready, offer the explicit choice — never auto-book.
    if (
        _concierge_stage == "SELECTING_TIME"
        and readiness_out["ready"]
        and not pending
        and not _just_booked
    ):
        _quick = ["Confirm booking", "Change something"]
    # Comparison view: real cards only (2-3).
    _compare = None
    if getattr(context, "compare_ids", None) and len(getattr(context, "compare_ids", None) or []) >= 2:
        try:
            _cmp_cards = _doctor_cards_by_ids(
                db,
                list(getattr(context, "compare_ids", None) or [])[:3],
                patient_latitude=effective_lat,
                patient_longitude=effective_lng,
                context=context,
            )
            if len(_cmp_cards) >= 2:
                _compare = concierge.build_compare_table(_cmp_cards)
        except (AttributeError, TypeError, ValueError):
            _compare = None
    # Surface selection: fresh panels win; confirmation wins over all.
    if pending:
        _surface = "BOOKING_REVIEW"
        _title = "Review your booking"
    elif _just_booked:
        _surface = "BOOKING_SUCCESS"
        _title = "Your appointment is confirmed"
        _quick = ["View appointment", "Complete pre-visit questions", "Prepare for my visit"]
    elif _compare is not None:
        _surface = "DOCTOR_COMPARE"
        _title = "Compare your options"
    elif "doctors" in fresh_offers and doctors_cards:
        _surface = "DOCTOR_RESULTS"
        _title = "Doctors that match your request"
    elif turn_results.get("get_day_schedule"):
        _surface = "SLOT_PICKER"
        _title = "Pick a time that works for you"
    elif "slots" in fresh_offers and _slots:
        _surface = "SLOT_PICKER"
        _title = "Available times"
    elif fresh_types or stage == "pick_type":
        _surface = "APPOINTMENT_TYPE"
        _title = "What kind of visit is this?"
    elif fresh_modes or stage == "pick_mode":
        _surface = "CONSULTATION_MODE"
        _title = "How would you like to meet?"
    elif stage == "pick_date":
        _surface = "DAY_PICKER"
        _title = "Which day suits you?"
    elif _unsure:
        _surface = "QUICK_REPLIES"
        _title = None
    elif escalated:
        _surface = "ESCALATION"
        _title = None
    else:
        _surface = "TEXT"
        _title = None
    _allow_explore = bool(has_more or (doctors_cards and _surface in ("DOCTOR_RESULTS", "DOCTOR_COMPARE")))
    _allow_compare = bool(len(doctors_cards) > 1 or (_compare is not None))
    context.allow_explore_more = _allow_explore
    context.allow_compare = _allow_compare
    context.last_ui_surface = _surface
    try:
        context.last_tool_result = {
            "fresh_tools": sorted(fresh_tools),
            "doctors": len(doctors_cards),
            "slots": len(_slots),
        }
    except (TypeError, ValueError):
        context.last_tool_result = {"fresh_tools": sorted(fresh_tools)}
    # Post-booking next actions live inside the chat (§18).
    _appt_id = getattr(context, "last_appointment_id", None)
    _upcoming = None
    if _just_booked and _appt_id:
        _upcoming = {
            "appointment_id": str(_appt_id),
            "doctor_name": getattr(context, "selected_doctor_name", None),
            "date": getattr(context, "selected_date", None),
            "slot_start": getattr(context, "selected_start", None),
            "slot_end": getattr(context, "selected_end", None),
        }
    _actions: list[dict[str, Any]] = []
    if doctors_cards and _surface in ("DOCTOR_RESULTS", "DOCTOR_COMPARE"):
        for c in doctors_cards[:5]:
            _actions.append({"id": f"choose:{c['id']}", "label": f"Choose {c['name']}", "kind": "choose_doctor", "doctor_id": c["id"]})
        if _allow_explore:
            _actions.append({"id": "explore_more", "label": "Show me more", "kind": "explore_more"})
        if _allow_compare:
            _actions.append({"id": "compare", "label": "Compare them", "kind": "compare"})
    if pending:
        _actions.append({"id": "confirm_booking", "label": "Yes, book it", "kind": "confirm"})
        _actions.append({"id": "decline_booking", "label": "Not now", "kind": "decline"})
    if _just_booked and _appt_id:
        _actions.append({"id": "view_appointment", "label": "View appointment", "kind": "view_appointment", "appointment_id": str(_appt_id)})
        _actions.append({"id": "questionnaire", "label": "Complete pre-visit questions", "kind": "questionnaire", "appointment_id": str(_appt_id)})
        _actions.append({"id": "prepare_visit", "label": "Prepare for my visit", "kind": "prepare_visit"})
    _filter_choices = concierge.build_explore_choices(context) if _allow_explore else []
    # Booking summary rides every open-flow turn (P6/P7): the UI renders
    # the structured card with [Change] actions next to the widgets, so a
    # slot pick visibly becomes "selected, awaiting confirmation".
    try:
        _summary_out = concierge.build_booking_summary(context)
    except (AttributeError, TypeError, ValueError):
        _summary_out = None
    if _summary_out is not None and not (
        getattr(context, "flow_open", False)
        or getattr(context, "selected_doctor_id", None)
        or getattr(context, "selected_date", None)
        or getattr(context, "selected_appointment_type_id", None)
        or getattr(context, "selected_consultation_mode", None)
        or getattr(context, "selected_start", None)
    ):
        _summary_out = None
    # Widget versioning (P4/P9): stamp the revision these widgets were
    # built against plus a fresh message id. Taps citing an older
    # revision are rejected in _apply_typed_selection.
    try:
        if int(getattr(context, "state_revision", 0) or 0) <= int(base_rev):
            bump_revision(context)
    except (TypeError, ValueError):
        bump_revision(context)
    _message_id = uuid.uuid4().hex[:12]
    try:
        context.last_message_id = _message_id
    except (AttributeError, TypeError, ValueError):
        pass
    save_ai_context(context)
    return {
        "conversation_id": cid,
        "reply": reply,
        "iterations": iterations,
        "escalated": escalated,
        "stopped": stopped,
        "message_id": _message_id,
        "state_revision": int(getattr(context, "state_revision", 0) or 0),
        "hospital": {
            "id": getattr(context, "selected_hospital_id", None),
            "name": getattr(context, "selected_hospital_name", None),
        },
        "selected_date": getattr(context, "selected_date", None),
        "selected_start": getattr(context, "selected_start", None),
        "selected_end": getattr(context, "selected_end", None),
        "duration_minutes": getattr(context, "duration_minutes", None),
        "missing_fields": readiness_out["missing"],
        "doctors": doctors_cards,
        "doctors_total": search_total,
        "has_more_doctors": has_more,
        "slots": _slots,
        "appointment_types": fresh_types or (stored_types if stage == "pick_type" else []),
        "day_schedule": turn_results.get("get_day_schedule"),
        "consultation_modes": fresh_modes or (stored_modes if stage == "pick_mode" else []),
        "booking_stage": stage,
        "pending_booking": pending,
        "booking_summary": _summary_out,
        "surface": _surface,
        "title": _title,
        "allow_explore_more": _allow_explore,
        "allow_compare": _allow_compare,
        "intent": getattr(context, "intent", None),
        "stage": _concierge_stage,
        "care_context": _care,
        "quick_replies": _quick,
        "compare": _compare,
        "filter_choices": _filter_choices,
        "actions": _actions,
        "upcoming_appointment": _upcoming,
        "questionnaire": None,
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
    "WEB_VOICE_PROMPT",
    "booking_stage",
    "detect_consultation_mode",
    "detect_date_iso",
    "detect_doctor_selection",
    "evaluate_readiness",
    "greeting_kind",
    "groq_complete",
    "is_clinical_request",
    "run_conversation",
]
