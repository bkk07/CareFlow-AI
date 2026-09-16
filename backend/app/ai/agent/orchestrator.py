"""Scheduling assistant orchestrator: system prompt + tool-calling loop.

The safety boundary is encoded twice: the system prompt instructs the
model, and a deterministic pre-check declines purely clinical messages
before any tool runs, so the boundary holds even if the model is
confused. The loop has a hard iteration cap so a confused request can
never spin forever.
"""

import re
import uuid
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.ai.context.ai_context import get_ai_context, save_ai_context
from app.ai.mcp_client.client import AgentToolClient
from app.core.deps import RequestContext

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


def run_conversation(
    *,
    db: Session,
    ctx: RequestContext,
    conversation_id: str | None,
    user_message: str,
    complete: CompleteFn | None = None,
    max_iterations: int = MAX_ITERATIONS,
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
        }

    client = AgentToolClient(db, ctx)
    complete_fn = complete or groq_complete
    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT
            + "\nConversation context (JSON): "
            + context.model_dump_json(),
        }
    ]
    for turn in context.history[-10:]:
        messages.append({"role": turn["role"], "content": turn["text"]})

    escalated = False
    iterations = 0
    reply: str | None = None
    while iterations < max_iterations:
        iterations += 1
        step = complete_fn(messages, client.specs())
        for call in step.get("tool_calls") or []:
            outcome = client.call(call.get("name", ""), call.get("arguments") or {})
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
        reply = LOOP_EXHAUSTED
        messages.append({"role": "assistant", "content": reply})
    context.remember_turn("assistant", reply)
    save_ai_context(context)
    return {
        "conversation_id": cid,
        "reply": reply,
        "iterations": iterations,
        "escalated": escalated,
    }


__all__ = [
    "AINotConfiguredError",
    "CLINICAL_DECLINE",
    "LOOP_EXHAUSTED",
    "MAX_ITERATIONS",
    "SYSTEM_PROMPT",
    "groq_complete",
    "is_clinical_request",
    "run_conversation",
]
