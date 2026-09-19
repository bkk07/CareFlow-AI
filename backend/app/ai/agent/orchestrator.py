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
- If a tool reports a booking as "parked", tell the user it is held and being confirmed, and offer to check back or escalate.
- If a tool reports "failed" or is unavailable, say so plainly and offer to escalate to a human via transfer_to_human.

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

    if is_clinical_request(text):
        context.remember_turn("assistant", CLINICAL_DECLINE)
        save_ai_context(context)
        return {
            "conversation_id": cid,
            "reply": CLINICAL_DECLINE,
            "iterations": 0,
            "escalated": False,
            "doctors": [],
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
                outcome = client.call(call.get("name", ""), call.get("arguments") or {})
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
    return {
        "conversation_id": cid,
        "reply": reply,
        "iterations": iterations,
        "escalated": escalated,
        "stopped": stopped,
        "doctors": _offered_doctor_cards(db, context),
    }


__all__ = [
    "AINotConfiguredError",
    "CALLER_IDENTITY_REQUIRED",
    "CLINICAL_DECLINE",
    "LOOP_EXHAUSTED",
    "MAX_ITERATIONS",
    "STOPPED",
    "SYSTEM_PROMPT",
    "TELEPHONY_GUARD_PROMPT",
    "TELEPHONY_OPEN_TOOLS",
    "groq_complete",
    "is_clinical_request",
    "run_conversation",
]
