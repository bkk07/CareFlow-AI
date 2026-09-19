"""Twilio Media Streams loop: phone audio through the Phase 12 pipeline.

Protocol (JSON text frames on one Twilio stream socket):
  inbound:  {"event": "connected"|"start"|"media"|"stop"|"mark", ...}
  start:    carries streamSid/callSid plus the webhook's customParameters
            (caller_phone, patient_id, conversation_id).
  media:    {"media": {"payload": "<base64 mu-law 8kHz>"}}
  outbound: {"event": "media", "media": {"payload": ...}} (mu-law 8kHz,
            160-byte / 20 ms chunks) + {"event": "mark"} per sentence.
  outbound: {"event": "clear"} flushes Twilio's playout buffer = barge-in.

Everything else mirrors the web voice loop: VAD-gated STT (partials
never reach the orchestrator), per-sentence TTS, one silence re-prompt
then a human escalation, and the shared AIContext keyed by
conversation_id so "that one" works mid-call.

The one telephony addition is the identity gate upstream: the session
starts UNVERIFIED, and the orchestrator refuses every patient-data
tool until verify_caller_identity flips the flag (see orchestrator).
"""

import asyncio
import base64
import binascii
import json
import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.ai.agent.orchestrator import run_conversation
from app.ai.context.ai_context import get_ai_context, save_ai_context
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.deps import RequestContext
from app.domain.auth.models import Role, User
from app.domain.patient.models import PatientProfile
from app.mcp_server.models import Escalation, EscalationStatus
from app.observability.correlation import (
    for_conversation,
    reset_correlation_id,
    set_correlation_id,
)
from app.voice import stt_provider, tts_provider
from app.voice.session_manager import VoiceSession, end_session, new_session
from app.voice.telephony import audio as telephony_audio
from app.voice.vad import UtteranceTracker
from app.voice.web_voice.ws_handler import split_sentences

logger = logging.getLogger(__name__)

_db_session_factory: Callable[[], Session] | None = None
_agent_complete = None


def set_db_session_factory(factory: Callable[[], Session] | None) -> None:
    """Test hook: telephony turns run on the test session."""
    global _db_session_factory
    _db_session_factory = factory


def set_agent_complete(fn) -> None:
    """Test hook: scripted LLM completion for telephony agent turns."""
    global _agent_complete
    _agent_complete = fn


def _open_session() -> tuple[Session, bool]:
    if _db_session_factory is not None:
        return _db_session_factory(), False
    return SessionLocal(), True


STOP_WORDS = ("stop", "stop talking", "hold on", "wait")

GREETING_KNOWN = (
    "Hello {name}, thanks for calling CareFlow. "
    "For your security, please say your full name and date of birth; "
    "this call may be recorded."
)
GREETING_UNKNOWN = (
    "Thanks for calling CareFlow. "
    "Please say your full name and date of birth so I can find your record; "
    "this call may be recorded."
)
SILENCE_REPROMPT = "Are you still there?"
SILENCE_CLOSING = (
    "I haven't heard you, so I'll end the call here. "
    "The care team will follow up."
)
SILENCE_END_REASON = "silence"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _send(ws: WebSocket, payload: dict) -> None:
    await ws.send_text(json.dumps(payload))


def is_stop_word(text: str) -> bool:
    lowered = text.strip().lower().rstrip(".")
    return lowered in STOP_WORDS


def _first_name(db: Session, patient_id: str | None) -> str:
    if not patient_id:
        return ""
    try:
        pid = uuid.UUID(patient_id)
    except (ValueError, AttributeError, TypeError):
        return ""
    profile = (
        db.query(PatientProfile).filter(PatientProfile.patient_user_id == pid).first()
    )
    if profile is None or not profile.full_name:
        return ""
    return profile.full_name.strip().split()[0]


async def _speak(
    ws: WebSocket,
    session: VoiceSession,
    stream_sid: str,
    text: str,
) -> bool:
    """Stream one utterance as mu-law chunks; False when interrupted."""
    mark = 0
    for sentence in split_sentences(text):
        if session.interrupted.is_set():
            await _send(ws, {"event": "clear", "streamSid": stream_sid})
            return False
        try:
            mulaw = await asyncio.to_thread(
                telephony_audio.wav_to_mulaw_8k,
                await asyncio.to_thread(
                    tts_provider.get_tts_provider().synthesize, sentence
                ),
            )
        except Exception as exc:
            logger.warning("telephony TTS failed: %s", exc)
            continue
        if session.interrupted.is_set():
            await _send(ws, {"event": "clear", "streamSid": stream_sid})
            return False
        for chunk in telephony_audio.chunk_frames(mulaw):
            await _send(
                ws,
                {
                    "event": "media",
                    "streamSid": stream_sid,
                    "media": {"payload": base64.b64encode(chunk).decode("ascii")},
                },
            )
        mark += 1
        await _send(
            ws, {"event": "mark", "streamSid": stream_sid, "mark": {"name": f"s{mark}"}}
        )
    return True


async def _run_agent_turn(
    ws: WebSocket, session: VoiceSession, stream_sid: str, transcript: str
) -> None:
    session.interrupted.clear()
    db, owned = _open_session()
    try:
        ctx = RequestContext(
            user_id=session.user_id,
            role=Role(session.role),
            hospital_id=session.hospital_id,
            correlation_id=session.correlation_id,
        )
        result = await asyncio.to_thread(
            run_conversation,
            db=db,
            ctx=ctx,
            conversation_id=session.conversation_id,
            user_message=transcript,
            complete=_agent_complete,
            should_stop=session.interrupted.is_set,
        )
        reply = str(result.get("reply") or "")
        if session.interrupted.is_set() and not reply:
            return
    finally:
        if owned:
            db.close()
    if reply:
        await _speak(ws, session, stream_sid, reply)


async def _pump_turn(
    ws: WebSocket,
    session: VoiceSession,
    stream_sid: str,
    tracker: UtteranceTracker,
    text: str,
) -> None:
    """Run the agent turn while still reading the stream.

    The only mid-turn input we act on is the stop word: it sets the
    interrupt flag (the TTS streamer checks it between sentences) and
    flushes Twilio's playout buffer. Anything else spoken mid-turn is
    dropped — same tradeoff as web barge-in, minus the transcript.
    """
    turn = asyncio.create_task(_run_agent_turn(ws, session, stream_sid, text))
    try:
        while not turn.done():
            try:
                raw = await asyncio.wait_for(
                    ws.receive_text(), timeout=settings.voice_silence_s
                )
            except asyncio.TimeoutError:
                continue
            event = _parse(raw)
            if event is None:
                continue
            kind, payload = event
            if kind == "stop":
                turn.cancel()
                return
            if kind != "media":
                continue
            utterance = _feed_audio(tracker, payload)
            if utterance is None:
                continue
            heard = await _transcribe(utterance)
            if heard and is_stop_word(heard):
                session.interrupted.set()
                await _send(ws, {"event": "clear", "streamSid": stream_sid})
        await turn
    except asyncio.CancelledError:
        turn.cancel()
        raise
    finally:
        if not turn.done():
            turn.cancel()


def _parse(raw: str) -> tuple[str, dict] | None:
    try:
        message = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(message, dict):
        return None
    event = message.get("event")
    if event in ("connected", "start", "media", "stop", "mark"):
        return event, message
    return None


def _feed_audio(tracker: UtteranceTracker, message: dict) -> bytes | None:
    """Decode one Twilio media frame into the VAD; utterance or None."""
    try:
        payload = base64.b64decode((message.get("media") or {}).get("payload") or "")
    except (binascii.Error, ValueError):
        return None
    pcm8 = telephony_audio.mulaw_to_linear(payload)
    _partial_due, done = tracker.push(telephony_audio.upsample_8k_to_16k(pcm8))
    if not done:
        return None
    utterance = tracker.take()
    if len(utterance) < telephony_audio.MIN_UTTERANCE_BYTES:
        return None
    return utterance


async def _transcribe(utterance: bytes) -> str:
    try:
        result = await asyncio.to_thread(
            stt_provider.get_stt_provider().transcribe, utterance
        )
    except Exception as exc:
        logger.warning("telephony STT failed: %s", exc)
        return ""
    return (result.text or "").strip()


def _escalate_silence(db: Session, session: VoiceSession) -> str:
    row = Escalation(
        conversation_id=session.conversation_id,
        appointment_id=None,
        reason="Phone call ended after repeated silence; needs human follow-up",
        status=EscalationStatus.open,
        created_by_user_id=session.user_id,
        hospital_id=session.hospital_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return str(row.id)


async def _on_silence(
    ws: WebSocket, session: VoiceSession, stream_sid: str
) -> bool:
    """Returns True when the call must end."""
    db, owned = _open_session()
    try:
        session.silence_prompts += 1
        if session.silence_prompts == 1:
            await _speak(ws, session, stream_sid, SILENCE_REPROMPT)
            return False
        escalation_id = await asyncio.to_thread(_escalate_silence, db, session)
        logger.info(
            "telephony call ended silent sid=%s escalation=%s",
            stream_sid,
            escalation_id,
        )
        # Parity with the web channel (ended:silence): tell the caller why
        # the call is ending before hanging up.
        await _speak(ws, session, stream_sid, SILENCE_CLOSING)
        return True
    finally:
        if owned:
            db.close()


async def handle_media_stream(
    ws: WebSocket,
    *,
    silence_window_s: float | None = None,
) -> None:
    await ws.accept()
    start = None
    try:
        while start is None:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=60.0)
            except asyncio.TimeoutError:
                await ws.close(code=1000)
                return
            parsed = _parse(raw)
            if parsed is None:
                continue
            if parsed[0] == "start":
                start = parsed[1]
    except WebSocketDisconnect:
        return
    params = (start.get("start") or {}).get("customParameters") or {}
    stream_sid = start.get("streamSid") or (start.get("start") or {}).get("streamSid") or ""
    caller_phone = str(params.get("caller_phone") or "")
    patient_param = str(params.get("patient_id") or "")
    conversation_id = str(params.get("conversation_id") or "") or uuid.uuid4().hex

    db, owned = _open_session()
    try:
        patient_id: uuid.UUID | None = None
        if patient_param:
            try:
                candidate = uuid.UUID(patient_param)
            except (ValueError, AttributeError, TypeError):
                candidate = None
            if candidate is not None:
                user = db.get(User, candidate)
                if user is not None and user.role == Role.patient and user.is_active:
                    patient_id = user.id
        greeting_name = _first_name(db, str(patient_id) if patient_id else "")
        context = get_ai_context(conversation_id)
        context.user_id = str(patient_id) if patient_id else None
        context.channel = "telephony"
        context.caller_phone = caller_phone or None
        context.caller_patient_id = str(patient_id) if patient_id else None
        context.caller_verified = False
        context.identity_attempts = 0
        save_ai_context(context)
    finally:
        if owned:
            db.close()

    session = new_session(
        user_id=patient_id or uuid.uuid4(),
        role=Role.patient.value,
        hospital_id=None,
        conversation_id=conversation_id,
        # Same derivation the webhook uses: the whole call — webhook,
        # turns, booking — lands in one trace with no shared state.
        correlation_id=for_conversation(conversation_id),
    )
    _tel_token = set_correlation_id(session.correlation_id)
    tracker = UtteranceTracker()
    window = silence_window_s or settings.voice_silence_s
    greeting = (
        GREETING_KNOWN.format(name=greeting_name)
        if patient_id and greeting_name
        else GREETING_UNKNOWN
    )
    try:
        await _speak(ws, session, stream_sid, greeting)
        while not session.ended:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=window)
            except asyncio.TimeoutError:
                if await _on_silence(ws, session, stream_sid):
                    session.ended = True
                continue
            parsed = _parse(raw)
            if parsed is None:
                continue
            kind, message = parsed
            if kind == "stop":
                session.ended = True
                continue
            if kind != "media":
                continue
            session.last_voice_at = _utcnow()
            session.silence_prompts = 0
            utterance = _feed_audio(tracker, message)
            if utterance is None:
                continue
            text = await _transcribe(utterance)
            if not text:
                continue
            if is_stop_word(text):
                session.interrupted.set()
                await _send(ws, {"event": "clear", "streamSid": stream_sid})
                continue
            await _pump_turn(ws, session, stream_sid, tracker, text)
    except WebSocketDisconnect:
        pass
    finally:
        reset_correlation_id(_tel_token)
        end_session(session.id)


__all__ = [
    "GREETING_KNOWN",
    "GREETING_UNKNOWN",
    "STOP_WORDS",
    "handle_media_stream",
    "is_stop_word",
    "set_agent_complete",
    "set_db_session_factory",
]
