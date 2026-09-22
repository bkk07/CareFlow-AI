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
    # Phase 2 canonical booking state: display names ride with canonical
    # IDs (IDs are identity, names are display-only). Query fields hold
    # UNVALIDATED natural-language candidates until a tool result
    # confirms them (hospital_query -> search_hospitals, doctor_query ->
    # search_doctors, type_query -> list_appointment_types).
    selected_hospital_name: str | None = None
    hospital_query: str | None = None
    offered_hospitals: list[dict[str, Any]] = Field(default_factory=list)
    selected_doctor_id: str | None = None
    selected_doctor_name: str | None = None
    doctor_query: str | None = None
    selected_appointment_type_id: str | None = None
    type_query: str | None = None
    # Canonical duration (minutes) resolved from the validated visit type.
    # Never guessed, never asked: appointment_type.duration_minutes only.
    duration_minutes: int | None = None
    # Canonical interval. selected_slot ({start, end} ISO) is the legacy
    # mirror kept for existing readers; selected_start/selected_end are
    # the explicit canonical fields. requested_start is the raw "HH:MM"
    # the patient said, before duration math turns it into an interval.
    selected_slot: dict[str, str] | None = None
    selected_start: str | None = None
    selected_end: str | None = None
    requested_start: str | None = None
    offered_slots: list[dict[str, str]] = Field(default_factory=list)
    offered_doctors: list[dict[str, str]] = Field(default_factory=list)
    # Guided booking flow: the CURRENT page of doctor ids shown as cards
    # (5 at a time) plus the last search filters so "explore more" can
    # fetch the next page. offered_doctors keeps accumulating for
    # "that one" resolution; offered_doctor_page is what gets displayed.
    offered_doctor_page: list[str] = Field(default_factory=list)
    last_search: dict[str, Any] | None = None
    # Visit-type step: list_appointment_types must succeed and the patient
    # must pick a type before availability is checked or anything is
    # booked — durations differ per type, so nothing can be computed
    # without it. Reset whenever a booking completes (next booking = new
    # flow, type must be picked again).
    visit_types_seen: bool = False
    visit_types: list[dict[str, Any]] = Field(default_factory=list)
    visit_type_name: str | None = None
    # How the patient wants to meet: video / phone / in_person. Asked like
    # normal booking asks it; recorded deterministically, passed to booking.
    selected_consultation_mode: str | None = None
    # Whether a booking flow is currently open. Set by search success or
    # any deterministic pick; cleared ONLY by a completed booking. While
    # closed (never started, or already booked), no step widgets render —
    # a later unrelated question never resurrects the flow's UI.
    flow_open: bool = False
    # Last how-to-meet options offered (mirrors visit_types): re-shown only
    # when the mode step is genuinely pending, never blasted every turn.
    consultation_modes: list[str] = Field(default_factory=list)
    # The visit day (YYYY-MM-DD) when the patient already gave it
    # ("tomorrow", "Monday", "Sep 21"). Recorded deterministically so the
    # assistant uses it directly instead of asking for the date again.
    selected_date: str | None = None
    pending_clarification: str | None = None
    # P0 confirm-gate: a proposed booking waiting for the patient's
    # explicit "yes". Set when the assistant attempts create_appointment
    # without confirmation; cleared on successful booking. Loose value
    # type on purpose: working memory must always reload, even if an
    # older writer stored an unexpected shape.
    pending_booking: dict[str, Any] | None = None
    awaiting_confirmation: bool = False
    last_appointment_id: str | None = None
    # --- Concierge layer (additive; all optional so old payloads load) ---
    # High-level conversational understanding. The LLM never invents
    # business truth; these fields only track what the patient SAID plus
    # what tools CONFIRMED, so corrections ("morning is better") merge
    # instead of restarting the flow.
    intent: str | None = None
    goal: str | None = None
    current_task: str | None = None
    stage: str | None = None
    # User-visible care request summary (rendered as CareContextCard).
    # Concern is free text the patient gave ("knee pain"); for_whom is
    # "self" | "mother" | ... ; when_text preserves their words
    # ("tomorrow evening") alongside the resolved selected_date.
    care_request: dict[str, Any] = Field(default_factory=dict)
    # Structured search constraints preserved across turns. Specialty,
    # city, date, time_range (morning/afternoon/evening), consultation
    # mode, gender preference, hospital scope. The LLM must not re-ask
    # for anything already present here.
    search_filters: dict[str, Any] = Field(default_factory=dict)
    # Time-of-day preference in the patient's own words, resolved
    # deterministically ("tomorrow evening" -> evening). Used to rank /
    # filter offered slots; never invented.
    time_range: str | None = None
    # Gender preference as STATED ("female"/"male"/None). The Doctor
    # table carries no gender column, so this is preserved + displayed
    # but never used to invent filtering — search still returns real
    # backend results and the reply says so honestly.
    gender_preference: str | None = None
    # Specialty as stated ("cardiology"/"cardiologist"/...). Grounded by
    # search_doctors synonyms; kept here so "keep everything else" works.
    specialty_preference: str | None = None
    # Last tool outcome summary + last UI surface emitted, so follow-ups
    # like "the second one" / "show me another" resolve against what was
    # actually shown — not against raw history.
    last_tool_result: dict[str, Any] | None = None
    last_ui_surface: str | None = None
    # Doctor ids currently in a comparison view (2-3). Resolved only
    # against offered doctors; never invented.
    compare_ids: list[str] = Field(default_factory=list)
    # Whether the last doctor search still has more pages / refinements.
    allow_explore_more: bool = False
    allow_compare: bool = False
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
