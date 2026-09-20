"""Phase 12 tests: VAD, voice loop, partials rule, barge-in, silence."""

import base64
import json
import threading
import uuid
from datetime import datetime, timedelta

import pytest

from app.ai.agent import orchestrator
from app.core.deps import RequestContext
from app.domain.appointment.models import Appointment
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.main import app
from app.mcp_server.models import CapabilityExecution, Escalation
from app.voice import stt_provider, tts_provider
from app.voice.vad import UtteranceTracker, frame_energy, make_silence, make_tone
from app.voice.web_voice import ws_handler
from app.voice.web_voice.ws_handler import split_sentences
from tests.test_mcp_agent import FakeConnector, scripted, seed_setup

MONDAY = "2026-10-05"


def b64(pcm: bytes) -> str:
    return base64.b64encode(pcm).decode("ascii")


def audio_msg(pcm: bytes) -> str:
    return json.dumps({"type": "audio", "data": b64(pcm)})


class ScriptedSTT(stt_provider.BaseSTT):
    def __init__(self, text="book monday morning"):
        self.text = text
        self.calls = 0

    def transcribe(self, pcm, sample_rate=16000):
        self.calls += 1
        return stt_provider.STTResult(text=self.text)


class FakeTTS(tts_provider.BaseTTS):
    def __init__(self):
        self.calls = []
        self.release = threading.Event()
        self.release.set()

    def synthesize(self, text):
        self.calls.append(text)
        self.release.wait(timeout=10)
        return b"fake-wav:" + text.encode()


@pytest.fixture()
def voice_env(db, monkeypatch):
    stt, tts = ScriptedSTT(), FakeTTS()
    stt_provider.set_stt_provider(stt)
    tts_provider.set_tts_provider(tts)
    ws_handler.set_db_session_factory(lambda: db)
    ws_handler.set_agent_complete(None)
    yield {"stt": stt, "tts": tts}
    stt_provider.set_stt_provider(None)
    tts_provider.set_tts_provider(None)
    ws_handler.set_db_session_factory(None)
    ws_handler.set_agent_complete(None)


def patient_token(client, tag):
    uid = uuid.uuid4().hex[:6]
    email = f"voice-{tag}-{uid}@example.com"
    assert (
        client.post(
            "/auth/register",
            json={"email": email, "password": "correct-horse-42", "role": "patient"},
        ).status_code
        == 201
    )
    tokens = client.post(
        "/auth/login", json={"email": email, "password": "correct-horse-42"}
    ).json()
    return tokens["access_token"]


def read_until(ws, want, limit=20):
    """Collect messages until one of `want` types arrives."""
    seen = []
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        seen.append(msg)
        if msg.get("type") in want:
            return msg, seen
    raise AssertionError(f"never saw {want} in {seen}")


# -- VAD -------------------------------------------------------------------------


def test_vad_hears_tone_not_silence():
    assert frame_energy(make_tone(0.02)) > 300.0
    assert frame_energy(make_silence(0.02)) == 0.0


def test_utterance_partials_and_hangover_end():
    tracker = UtteranceTracker()
    partial, done = tracker.push(make_tone(1.1))
    assert partial is True and done is False
    partial2, done2 = tracker.push(make_silence(0.8))
    assert done2 is True
    assert len(tracker.take()) > 16000


def test_tts_defaults_to_stub_without_external_dependency():
    """Browser chat uses SpeechSynthesis; server TTS stays a stub interface."""
    from app.voice import tts_provider

    tts_provider.set_tts_provider(None)
    assert isinstance(tts_provider.get_tts_provider(), tts_provider.StubTTS)
    with pytest.raises(tts_provider.TTSError):
        tts_provider.get_tts_provider().synthesize("Hello.")
    assert not hasattr(tts_provider, "GroqTTS")


def test_split_sentences():
    assert split_sentences("Hi there. Book Monday? Yes!") == [
        "Hi there.",
        "Book Monday?",
        "Yes!",
    ]


# -- socket auth -------------------------------------------------------------------


def test_voice_rejects_bad_token(client, voice_env):
    with client.websocket_connect("/voice/ws?token=nope") as ws:
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "ended"
        assert "auth" in msg["reason"]


def test_hospital_admin_may_use_voice(client, db, voice_env):
    from tests.conftest import approved_hospital

    hosp = approved_hospital(client, tag="vadmin")
    token = hosp["owner"]["Authorization"].split(" ", 1)[1]
    with client.websocket_connect(f"/voice/ws?token={token}") as ws:
        msg, _ = read_until(ws, {"ready"})
        assert "conversation_id" in msg


# -- partials never run tools --------------------------------------------------------


def test_partial_transcript_runs_no_tools(client, db, voice_env):
    token = patient_token(client, "partial")
    with client.websocket_connect(f"/voice/ws?token={token}") as ws:
        msg, _ = read_until(ws, {"ready"})
        assert "conversation_id" in msg
        ws.send_text(audio_msg(make_tone(1.2)))  # partial only, no hangover
        partial, _ = read_until(ws, {"partial"})
        assert partial["text"] == "book monday morning"
    assert voice_env["stt"].calls >= 1
    assert db.query(CapabilityExecution).count() == 0


# -- full booking by voice -------------------------------------------------------------


def test_full_booking_flow_by_voice(client, db, voice_env):
    from app.ai.context.ai_context import get_ai_context, save_ai_context
    from app.mcp_server.tools import _base as tool_base

    setup = seed_setup(client, tag="voicebook")
    fake = FakeConnector()
    stub = lambda session: IntegrationService(session=session, connector=fake)  # noqa: E731
    tool_base.set_integration_factory(stub)
    try:
        start = datetime.fromisoformat(f"{MONDAY}T09:00:00+00:00")
        create_args = {
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start.isoformat(),
            "slot_end": (start + timedelta(minutes=30)).isoformat(),
            "idempotency_key": "voice-book-1",
        }
        ws_handler.set_agent_complete(
            scripted(
                {
                    "content": None,
                    "tool_calls": [
                        {"id": "c1", "name": "create_appointment", "arguments": create_args}
                    ],
                },
                {"content": "Booked for Monday morning.", "tool_calls": []},
            )
        )
        token = setup["patient"]["headers"]["Authorization"].split(" ", 1)[1]
        with client.websocket_connect(f"/voice/ws?token={token}") as ws:
            ready, _ = read_until(ws, {"ready"})
            # Confirmation turn: seed the previously offered slot so the
            # P0 confirm gate allows the booking after the patient says yes.
            prior = get_ai_context(ready["conversation_id"])
            prior.offered_doctors = [
                {"id": setup["doctor"]["id"], "name": "Dr. voicebook"}
            ]
            prior.offered_slots = [
                {
                    "start": create_args["slot_start"],
                    "end": create_args["slot_end"],
                }
            ]
            # The scripted confirmation jumps past the early steps (day
            # comes from the "Monday morning" transcript itself).
            prior.visit_types_seen = True
            prior.selected_appointment_type_id = setup["type"]["id"]
            prior.selected_consultation_mode = "in_person"
            save_ai_context(prior)
            voice_env["stt"].text = "Yes, book Monday morning"
            ws.send_text(audio_msg(make_tone(0.4) + make_silence(0.8)))
            final, seen = read_until(ws, {"final"})
            assert final["text"] == "Yes, book Monday morning"
            agent, seen2 = read_until(ws, {"agent_text"})
            assert "Monday morning" in agent["text"]
            audio, _ = read_until(ws, {"audio_out"})
            assert audio["data"]
    finally:
        tool_base.set_integration_factory(None)
    appt = (
        db.query(Appointment).filter(Appointment.idempotency_key == "voice-book-1").one()
    )
    assert appt.state.value == "confirmed"
    assert voice_env["tts"].calls == ["Booked for Monday morning."]


# -- call location reaches the agent turn ---------------------------------------------


def test_voice_location_reaches_agent_turn(client, db, voice_env):
    """{"type": "location"} rides the turn like POST /chat coordinates."""
    token = patient_token(client, "voiceloc")
    seen = {}

    def _capture(messages, specs):
        seen["system"] = messages[0]["content"]
        return {"content": "Noted near you.", "tool_calls": []}

    ws_handler.set_agent_complete(_capture)
    with client.websocket_connect(f"/voice/ws?token={token}") as ws:
        read_until(ws, {"ready"})
        ws.send_text(
            json.dumps({"type": "location", "latitude": 12.9352, "longitude": 77.6245})
        )
        ws.send_text(audio_msg(make_tone(0.4) + make_silence(0.8)))
        final, _ = read_until(ws, {"final"})
        assert final["text"] == "book monday morning"
        agent, _ = read_until(ws, {"agent_text"})
        assert "Noted near you." in agent["text"]
    assert "12.93520" in seen["system"]
    assert "77.62450" in seen["system"]


def test_voice_bad_location_is_ignored(client, db, voice_env):
    """Malformed coordinates never break the turn; the model still answers."""
    token = patient_token(client, "voicelocbad")
    ws_handler.set_agent_complete(
        scripted({"content": "Still here.", "tool_calls": []})
    )
    with client.websocket_connect(f"/voice/ws?token={token}") as ws:
        read_until(ws, {"ready"})
        ws.send_text(json.dumps({"type": "location", "latitude": 200, "longitude": "x"}))
        ws.send_text(json.dumps({"type": "location"}))
        ws.send_text(audio_msg(make_tone(0.4) + make_silence(0.8)))
        read_until(ws, {"final"})
        agent, _ = read_until(ws, {"agent_text"})
        assert "Still here." in agent["text"]


# -- barge-in ----------------------------------------------------------------------------


def test_barge_in_stops_tts_stream(client, db, voice_env):
    token = patient_token(client, "barge")
    ws_handler.set_agent_complete(
        scripted({"content": "First. Second. Third.", "tool_calls": []})
    )
    voice_env["tts"].release.clear()  # TTS blocks until the test releases it
    with client.websocket_connect(f"/voice/ws?token={token}") as ws:
        read_until(ws, {"ready"})
        ws.send_text(audio_msg(make_tone(0.4) + make_silence(0.8)))
        read_until(ws, {"final"})
        first, _ = read_until(ws, {"agent_text"})
        assert first["text"] == "First."
        ws.send_text(json.dumps({"type": "interrupt"}))
        voice_env["tts"].release.set()  # let the blocked synth finish
        state, seen = read_until(ws, {"state"})
        assert state["state"] == "interrupted"
        assert [m for m in seen if m.get("type") == "audio_out"] == []
    assert voice_env["tts"].calls == ["First."]


# -- silence -------------------------------------------------------------------------------


def test_silence_reprompts_once_then_escalates(client, db, voice_env, monkeypatch):
    from app.core.config import settings

    token = patient_token(client, "silent")
    monkeypatch.setattr(settings, "voice_silence_s", 0.2)
    with client.websocket_connect(f"/voice/ws?token={token}") as ws:
        read_until(ws, {"ready"})
        ended, seen = read_until(ws, {"ended"}, limit=30)
        assert ended["reason"] == "silence"
        assert "escalation_id" in ended
        # The single re-prompt was actually spoken through the TTS path.
        assert any(
            m.get("type") == "agent_text" and "still there" in (m.get("text") or "")
            for m in seen
        )
    row = db.get(Escalation, uuid.UUID(ended["escalation_id"]))
    assert row is not None
    assert "silence" in row.reason


# -- orchestrator stop -----------------------------------------------------------------------


def test_orchestrator_should_stop_aborts_loop(db, voice_env):
    import uuid as _uuid

    ctx = RequestContext(user_id=_uuid.uuid4(), role=Role.patient, hospital_id=None)
    calls = []

    def _complete(messages, specs):
        calls.append(True)
        return {"content": "never", "tool_calls": []}

    result = orchestrator.run_conversation(
        db=db,
        ctx=ctx,
        conversation_id="conv-stop",
        user_message="Book something",
        complete=_complete,
        should_stop=lambda: True,
    )
    assert result["reply"] == orchestrator.STOPPED
    assert result["stopped"] is True
    assert calls == []
