"""Redis-backed structured conversation context (architecture §4).

`AIContext` is the agent's working memory: what it has already found,
selected, or is still clarifying — so "that one" resolves from memory
instead of being re-asked every turn. Durable preferences are NOT kept
here; `update_preferences` persists those to Postgres.

Storage tries Redis (`REDIS_URL`) and falls back to a process-local
dict with the same TTL semantics, so tests and single-process dev
work without infrastructure.
"""

import json
import time
from typing import Any

from pydantic import BaseModel, Field

from app.core.config import settings

_KEY_PREFIX = "careflow:ai-context:"
_HISTORY_LIMIT = 20

_fallback: dict[str, tuple[str, float]] = {}


class AIContext(BaseModel):
    conversation_id: str
    user_id: str | None = None
    selected_hospital_id: str | None = None
    selected_doctor_id: str | None = None
    selected_appointment_type_id: str | None = None
    selected_slot: dict[str, str] | None = None
    offered_slots: list[dict[str, str]] = Field(default_factory=list)
    offered_doctors: list[dict[str, str]] = Field(default_factory=list)
    pending_clarification: str | None = None
    # P0 confirm-gate: a proposed booking waiting for the patient's
    # explicit "yes". Set when the assistant attempts create_appointment
    # without confirmation; cleared on successful booking.
    pending_booking: dict[str, str] | None = None
    awaiting_confirmation: bool = False
    last_appointment_id: str | None = None
    history: list[dict[str, str]] = Field(default_factory=list)
    # Phase 14 telephony: "web" everywhere else; "telephony" unlocks
    # patient-data tools only after the caller proves identity out loud.
    channel: str = "web"
    caller_phone: str | None = None
    caller_patient_id: str | None = None
    caller_verified: bool = False
    identity_attempts: int = 0

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump()

    def remember_turn(self, role: str, text: str) -> None:
        self.history.append({"role": role, "text": text[:2000]})
        del self.history[: -_HISTORY_LIMIT]


_fallback: dict[str, tuple[str, float]] = {}
_client = None


def _redis():
    """Shared client; a failed ping drops it so the next call retries."""
    global _client
    if _client is None:
        try:
            import redis  # local import: optional at runtime, required in prod
        except ImportError:
            return None
        candidate = redis.Redis.from_url(settings.redis_url, socket_timeout=2)
        try:
            candidate.ping()
        except Exception:
            return None
        _client = candidate
        return _client
    try:
        _client.ping()
    except Exception:
        _client = None
        return None
    return _client


def _key(conversation_id: str) -> str:
    return f"{_KEY_PREFIX}{conversation_id.strip()}"


def get_ai_context(conversation_id: str) -> AIContext:
    cid = conversation_id.strip()
    if not cid:
        raise ValueError("conversation_id must not be empty")
    client = _redis()
    if client is not None:
        raw = client.get(_key(cid))
        if raw:
            return AIContext(**json.loads(raw))
        return AIContext(conversation_id=cid)
    now = time.time()
    hit = _fallback.get(cid)
    if hit is not None:
        raw, expires = hit
        if expires > now:
            return AIContext(**json.loads(raw))
        del _fallback[cid]
    return AIContext(conversation_id=cid)


def save_ai_context(context: AIContext) -> None:
    raw = context.model_dump_json()
    ttl = max(settings.ai_context_ttl_s, 60)
    client = _redis()
    if client is not None:
        client.set(_key(context.conversation_id), raw, ex=ttl)
        return
    _fallback[context.conversation_id] = (raw, time.time() + ttl)


def clear_ai_context(conversation_id: str) -> None:
    cid = conversation_id.strip()
    client = _redis()
    if client is not None:
        client.delete(_key(cid))
        return
    _fallback.pop(cid, None)


__all__ = ["AIContext", "clear_ai_context", "get_ai_context", "save_ai_context"]
