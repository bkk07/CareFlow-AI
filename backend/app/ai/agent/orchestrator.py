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

SYSTEM_PROMPT = """You are an administrative scheduling assistant for CareFlow AI. You may: find hospitals/doctors,
check availability, book/reschedule/cancel, ask approved pre-visit questions,
record responses, escalate to a human. You must NEVER diagnose, prescribe,
recommend treatment, or state clinical conclusions the patient didn't say
themselves. If asked to do any of these, decline and offer to escalate to a
human or continue with scheduling.

How you work:
- Use the provided tools for every fact (hospitals, doctors, slots, bookings). Never invent ids, times, or bookings.
- The conversation context lists doctors and slots you already offered. When the user says "that one",
  "the first", "the morning one", or similar, resolve it against the offered lists in the context — do not re-ask.
- Booking needs a doctor, an appointment type, an exact slot, and an idempotency key (generate a random UUID string).
- If the patient names a visit mode (in person / video / phone), pass it as
  consultation_mode on create_appointment; otherwise leave it out.
- If a tool reports a booking as "parked", tell the user it is held and being confirmed, and offer to check back or escalate.
- If a tool reports "failed" or is unavailable, say so plainly and offer to escalate to a human via transfer_to_human.

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

How you present results (the chat UI renders cards itself):
- When you recommend doctors, name each one briefly with hospital + city
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
    "I'm only able to help with scheduling and administrative tasks — "
    "I can't give medical advice, diagnoses, or treatment recommendations. "
    "I can escalate this to a human on our care team, or we can continue "
    "with scheduling. What would you like to do?"
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


CompleteFn = Callable[[list[dict[str, Any]], list[dict[str, Any]]], dict[str, Any]]


class AINotConfiguredError(Exception):
    pass


def groq_complete(
    messages: list[dict[str, Any]], tool_specs: list[dict[str, Any]]
) -> dict[str, Any]:
    """Default completion via a GROQ-hosted OpenAI-compatible endpoint."""
    import httpx

    from app.core.config import settings

    if not settings.llm_api_key:
        raise AINotConfiguredError(
            "No LLM key configured (LLM_API_KEY or GROQ_API_KEY); "
            "chat requires a configured model"
        )
    resp = httpx.post(
        f"{settings.llm_base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {settings.llm_api_key}"},
        json={
            "model": settings.llm_model,
            "messages": messages,
            "tools": [
                {"type": "function", "function": spec} for spec in tool_specs
            ],
            "tool_choice": "auto",
        },
        timeout=60.0,
    )
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


def _apply_result_to_context(context, name: str, result: dict) -> None:
    payload = result.get("result") if isinstance(result, dict) else None
    if not isinstance(payload, dict):
        return
    if name == "search_doctors" and isinstance(payload.get("doctors"), list):
        context.offered_doctors = [
            {"id": d.get("id", ""), "name": d.get("name", "")}
            for d in payload["doctors"][:10]
        ]
    elif name == "check_availability" and isinstance(payload.get("slots"), list):
        context.offered_slots = [
            {"start": s.get("start", ""), "end": s.get("end", "")}
            for s in payload["slots"][:10]
        ]
    elif name == "create_appointment" and payload.get("appointment_id"):
        context.last_appointment_id = payload["appointment_id"]
        context.offered_slots = []
        # Booking done: the proposal is fulfilled, not pending.
        context.pending_booking = None
        context.awaiting_confirmation = False
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
    if name in ("create_appointment", "reschedule_appointment"):
        start = str(args.get("slot_start", "")).strip()
        end = str(args.get("slot_end", "")).strip()
        if start or end:
            context.selected_slot = {"start": start, "end": end}


def _offered_doctor_cards(db: Session, context) -> list[dict[str, Any]]:
    """Cards for the doctors the turn offered, in offered order.

    The chat UI renders these as tappable doctor cards so the reply text
    never needs to carry a doctor table.
    """
    ids = []
    for offered in context.offered_doctors or []:
        try:
            ids.append(uuid.UUID(str(offered.get("id"))))
        except (ValueError, AttributeError, TypeError):
            continue
    if not ids:
        return []
    rows = (
        db.query(Doctor, Hospital.name, Hospital.city, Specialty.name)
        .join(Hospital, Hospital.id == Doctor.hospital_id)
        .outerjoin(Specialty, Specialty.id == Doctor.specialty_id)
        .filter(Doctor.id.in_(ids))
        .all()
    )
    by_id = {d.id: (d, h_name, h_city, s_name) for d, h_name, h_city, s_name in rows}
    cards = []
    for oid in ids:
        hit = by_id.get(oid)
        if hit is None:
            continue
        d, h_name, h_city, s_name = hit
        cards.append(
            {
                "id": str(d.id),
                "name": d.name,
                "photo_url": d.photo_url,
                "hospital_name": h_name,
                "hospital_city": h_city,
                "specialty": s_name,
            }
        )
    return cards


def run_conversation(
    *,
    db: Session,
    ctx: RequestContext,
    conversation_id: str | None,
    user_message: str,
    complete: CompleteFn | None = None,
    max_iterations: int = MAX_ITERATIONS,
    should_stop: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """One chat turn: guard, tool loop, reply. Never raises for tool faults."""
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

    client = AgentToolClient(db, ctx)
    complete_fn = complete or groq_complete
    today = datetime.now(timezone.utc).date().isoformat()
    system = SYSTEM_PROMPT + f"\nToday is {today} (UTC)."
    if context.channel == "telephony":
        system += TELEPHONY_GUARD_PROMPT
    if ctx.role == Role.patient:
        profile = (
            db.query(PatientProfile)
            .filter(PatientProfile.patient_user_id == ctx.user_id)
            .first()
        )
        if profile is not None and profile.city:
            system += (
                f"\nThe patient's saved city is {profile.city}. When they say "
                f"'near me' or ask for nearby care, pass city={profile.city!r} "
                "to search_hospitals/search_doctors and lead with same-city "
                "options; mention the city by name so they can correct it."
            )
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
            _apply_result_to_context(context, call.get("name", ""), outcome)
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
    return {
        "conversation_id": cid,
        "reply": reply,
        "iterations": iterations,
        "escalated": escalated,
        "stopped": stopped,
        "doctors": _offered_doctor_cards(db, context),
        "slots": [
            {"start": s.get("start", ""), "end": s.get("end", "")}
            for s in (context.offered_slots or [])[:10]
            if isinstance(s, dict) and s.get("start")
        ],
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
    "groq_complete",
    "is_clinical_request",
    "run_conversation",
]
