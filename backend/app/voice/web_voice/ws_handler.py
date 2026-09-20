"""WebSocket voice loop: mic chunks -> STT partials -> agent -> TTS audio.

Protocol (all JSON text frames):
  client -> server: {"type": "audio", "data": "<base64 pcm16 16k mono>"}
  client -> server: {"type": "interrupt"}            # barge-in
  client -> server: {"type": "location", "latitude": 12.93, "longitude": 77.62}
  server -> client: {"type": "ready", ...}
  server -> client: {"type": "partial", "text": ...} # display only, NO tools
  server -> client: {"type": "final", "text": ...}
  server -> client: {"type": "agent_text", "text": ...}   # per sentence
  server -> client: {"type": "audio_out", "data": ...}    # base64 wav
  server -> client: {"type": "state", "state": ...}
  server -> client: {"type": "ended", "reason": ...}

Safety rules enforced here, not just in the prompt:
- Partial transcripts never reach the orchestrator, so no write
  capability can fire off an unconfirmed guess — only reads could, and
  not even those: partials are display-only.
- Barge-in sets the session flag: the TTS streamer stops before the
  next sentence AND the agent loop aborts at its next iteration.
- Silence past the window re-prompts once ("Are you still there?"),
  then ends the session with a human escalation on the second strike.
"""

import asyncio
import base64
import binascii
import json
import re
import uuid
from collections.abc import Callable
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.ai.agent.orchestrator import run_conversation
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.deps import RequestContext
from app.core.security import TokenError, decode_token
from app.domain.auth.models import Role, User
from app.mcp_server.models import Escalation, EscalationStatus
from app.observability.correlation import reset_correlation_id, set_correlation_id
from app.voice import stt_provider, tts_provider
from app.voice.session_manager import VoiceSession, end_session, new_session
from app.voice.vad import UtteranceTracker

_db_session_factory: Callable[[], Session] | None = None
_agent_complete = None


def set_db_session_factory(factory: Callable[[], Session] | None) -> None:
    """Test hook: voice turns run on the test session."""
    global _db_session_factory
    _db_session_factory = factory


def set_agent_complete(fn) -> None:
    """Test hook: scripted LLM completion for voice agent turns."""
    global _agent_complete
    _agent_complete = fn


def _open_session() -> tuple[Session, bool]:
    if _db_session_factory is not None:
        return _db_session_factory(), False
    return SessionLocal(), True


ALLOWED_ROLES = (Role.patient, Role.hospital_admin)

SILENCE_REPROMPT = "Are you still there?"
SILENCE_END_REASON = "silence"
INTERRUPT_END_REASON = "interrupted"


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _store_location(session: VoiceSession, message: dict) -> None:
    """Remember the caller's live GPS for this call's agent turns.

    Same contract as the per-message coordinates on POST /chat: both must
    be present numbers inside WGS84 bounds, otherwise the frame is ignored
    and the saved profile point (if any) keeps applying.
    """
    try:
        lat = float(message.get("latitude"))
        lng = float(message.get("longitude"))
    except (TypeError, ValueError):
        return
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return
    session.latitude = lat
    session.longitude = lng


async def _send(ws: WebSocket, payload: dict) -> None:
    await ws.send_text(json.dumps(payload))


def _authenticate(token: str | None, db: Session) -> RequestContext:
    if not token:
        raise PermissionError("missing token")
    try:
        data = decode_token(token)
    except TokenError as exc:
        raise PermissionError("bad token") from exc
    if data.get("type") != "access":
        raise PermissionError("not an access token")
    try:
        user_id = uuid.UUID(str(data.get("sub")))
    except (ValueError, AttributeError, TypeError) as exc:
        raise PermissionError("bad subject") from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise PermissionError("unknown user")
    if user.role not in ALLOWED_ROLES:
        raise PermissionError("role may not use voice")
    return RequestContext(
        user_id=user.id, role=user.role, hospital_id=user.hospital_id
    )


def _escalate_silence(db: Session, session: VoiceSession) -> str:
    row = Escalation(
        conversation_id=session.conversation_id,
        appointment_id=None,
        reason="Voice session ended after repeated silence; needs human follow-up",
        status=EscalationStatus.open,
        created_by_user_id=session.user_id,
        hospital_id=session.hospital_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return str(row.id)


async def _speak(
    ws: WebSocket, session: VoiceSession, text: str, *, state: str
) -> bool:
    """Stream one utterance sentence-by-sentence; False when interrupted."""
    for sentence in split_sentences(text):
        if session.interrupted.is_set():
            return False
        await _send(ws, {"type": "agent_text", "text": sentence})
        try:
            audio = await asyncio.to_thread(
                tts_provider.get_tts_provider().synthesize, sentence
            )
        except Exception as exc:
            await _send(ws, {"type": "error", "error": f"TTS failed: {exc}"})
            return True
        if session.interrupted.is_set():
            return False
        await _send(
            ws,
            {
                "type": "audio_out",
                "data": base64.b64encode(audio).decode("ascii"),
            },
        )
    await _send(ws, {"type": "state", "state": state})
    return True


async def _run_agent_turn(
    ws: WebSocket, session: VoiceSession, transcript: str
) -> None:
    """One confirmed utterance through the orchestrator, then TTS."""
    session.interrupted.clear()
    db, owned = _open_session()
    try:
        ctx = RequestContext(
            user_id=session.user_id,
            role=Role(session.role),
            hospital_id=session.hospital_id,
            correlation_id=session.correlation_id,
        )
        # The shared AIContext is keyed by conversation_id, so cross-turn
        # references ("that one") resolve exactly like in text chat. The
        # call's live GPS rides along too, so voice answers rank nearby
        # care and greet by name just like chat does.
        result = await asyncio.to_thread(
            run_conversation,
            db=db,
            ctx=ctx,
            conversation_id=session.conversation_id,
            user_message=transcript,
            complete=_agent_complete,
            should_stop=session.interrupted.is_set,
            latitude=session.latitude,
            longitude=session.longitude,
        )
        reply = str(result.get("reply") or "")
        if session.interrupted.is_set() and not reply:
            return
    finally:
        if owned:
            db.close()
    if reply:
        await _speak(ws, session, reply, state="idle")


async def _pump_turn(ws: WebSocket, session: VoiceSession, text: str) -> None:
    """Run the agent turn while still pumping incoming messages.

    Without this, a barge-in sent mid-turn would queue unprocessed until
    the turn finished — the exact failure the plan calls out. Here the
    interrupt flag lands while the model iterates or TTS streams, so
    both actually stop.
    """
    turn = asyncio.create_task(_run_agent_turn(ws, session, text))
    try:
        while not turn.done():
            try:
                raw = await asyncio.wait_for(
                    ws.receive_text(), timeout=settings.voice_silence_s
                )
            except asyncio.TimeoutError:
                continue  # agent speaking is not user silence; keep waiting
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if message.get("type") == "interrupt":
                session.interrupted.set()
                await _send(ws, {"type": "state", "state": "interrupted"})
            elif message.get("type") == "location":
                _store_location(session, message)
            elif message.get("type") == "audio":
                session.last_voice_at = _utcnow()
                session.silence_prompts = 0
        await turn
    except asyncio.CancelledError:
        turn.cancel()
        raise
    finally:
        # A disconnect mid-turn must not orphan the agent task talking
        # to a dead socket.
        if not turn.done():
            turn.cancel()


async def _on_silence(ws: WebSocket, session: VoiceSession) -> bool:
    """Returns True when the session must end."""
    db, owned = _open_session()
    try:
        session.silence_prompts += 1
        if session.silence_prompts == 1:
            await _speak(ws, session, SILENCE_REPROMPT, state="awaiting_speech")
            return False
        escalation_id = await asyncio.to_thread(_escalate_silence, db, session)
        await _send(
            ws,
            {
                "type": "ended",
                "reason": SILENCE_END_REASON,
                "escalation_id": escalation_id,
            },
        )
        return True
    finally:
        if owned:
            db.close()


async def handle_voice_socket(
    ws: WebSocket,
    token: str | None,
    resume_conversation_id: str | None = None,
    *,
    silence_window_s: float | None = None,
    vad: UtteranceTracker | None = None,
) -> None:
    await ws.accept()
    db, owned = _open_session()
    try:
        try:
            ctx = _authenticate(token, db)
        except PermissionError as exc:
            await _send(ws, {"type": "ended", "reason": f"auth: {exc}"})
            await ws.close(code=4401)
            return
    finally:
        if owned:
            db.close()

    session = new_session(
        user_id=ctx.user_id,
        role=ctx.role.value,
        hospital_id=ctx.hospital_id,
        conversation_id=resume_conversation_id,
    )
    # WebSockets skip the correlation middleware, so the call pins its
    # own id here; agent turns below inherit it through the session.
    _ws_token = set_correlation_id(session.correlation_id)
    tracker = vad or UtteranceTracker()
    window = silence_window_s or settings.voice_silence_s
    await _send(
        ws,
        {
            "type": "ready",
            "session_id": session.id,
            "conversation_id": session.conversation_id,
        },
    )
    try:
        while not session.ended:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=window)
            except asyncio.TimeoutError:
                if await _on_silence(ws, session):
                    session.ended = True
                continue
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            kind = message.get("type")
            if kind == "interrupt":
                session.interrupted.set()
                await _send(ws, {"type": "state", "state": "interrupted"})
            elif kind == "location":
                _store_location(session, message)
            elif kind == "audio":
                session.last_voice_at = _utcnow()
                session.silence_prompts = 0
                try:
                    pcm = base64.b64decode(message.get("data") or "")
                except (binascii.Error, ValueError):
                    continue
                partial_due, done = tracker.push(pcm)
                if partial_due and not done:
                    # Interim display only: partials NEVER reach the
                    # orchestrator, so no capability fires off a guess.
                    # peek() is non-destructive, so the final take()
                    # below still gets the whole utterance.
                    interim = tracker.peek()
                    if len(interim) < 6400:
                        pass
                    else:
                        try:
                            text = await asyncio.to_thread(
                                stt_provider.get_stt_provider().transcribe, interim
                            )
                        except Exception:
                            text = None
                        if text is not None and text.text.strip():
                            await _send(ws, {"type": "partial", "text": text.text.strip()})
                if done:
                    utterance = tracker.take()
                    if len(utterance) < 6400:
                        continue
                    try:
                        result = await asyncio.to_thread(
                            stt_provider.get_stt_provider().transcribe, utterance
                        )
                    except Exception as exc:
                        # Never kill the call on one bad STT chunk —
                        # Gemini keeps listening too; surface and continue.
                        await _send(ws, {"type": "error", "error": f"STT failed: {exc}"})
                        continue
                    text = result.text.strip()
                    if not text:
                        continue
                    await _send(ws, {"type": "final", "text": text})
                    await _pump_turn(ws, session, text)
    except WebSocketDisconnect:
        pass
    finally:
        reset_correlation_id(_ws_token)
        end_session(session.id)


__all__ = [
    "ALLOWED_ROLES",
    "handle_voice_socket",
    "set_agent_complete",
    "set_db_session_factory",
    "split_sentences",
]
