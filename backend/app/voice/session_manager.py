"""Voice session manager: WS connection -> AIContext/conversation_id.

Each connection owns one session. The conversation_id is the bridge to
the Phase 9 AIContext (so "that one" keeps working across voice turns);
`interrupted` is the cooperative barge-in flag the agent turn and the
TTS streamer both watch.
"""

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

SESSIONS: dict[str, "VoiceSession"] = {}


@dataclass
class VoiceSession:
    id: str
    conversation_id: str
    user_id: uuid.UUID
    role: str
    hospital_id: uuid.UUID | None
    # Phase 15: the call's correlation id — every tool the caller's turns
    # run shares it, so the voice booking lands in one trace.
    correlation_id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_voice_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    silence_prompts: int = 0
    interrupted: threading.Event = field(default_factory=threading.Event)
    ended: bool = False


def new_session(
    *,
    user_id: uuid.UUID,
    role: str,
    hospital_id: uuid.UUID | None,
    conversation_id: str | None = None,
    correlation_id: uuid.UUID | None = None,
) -> VoiceSession:
    session = VoiceSession(
        id=str(uuid.uuid4()),
        conversation_id=(conversation_id or "").strip() or str(uuid.uuid4()),
        user_id=user_id,
        role=role,
        hospital_id=hospital_id,
        correlation_id=correlation_id or uuid.uuid4(),
    )
    SESSIONS[session.id] = session
    return session


def end_session(session_id: str) -> None:
    SESSIONS.pop(session_id, None)


__all__ = ["SESSIONS", "VoiceSession", "end_session", "new_session"]
