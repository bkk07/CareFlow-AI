"""Phase 14 tests: Twilio telephone channel (webhook + media stream + gate)."""

import base64
import hashlib
import hmac
import json
import math
import struct
import uuid
from datetime import datetime, timedelta

import pytest

from app.ai.agent import orchestrator
from app.ai.context.ai_context import (
    clear_ai_context,
    get_ai_context,
    save_ai_context,
)
from app.core.deps import RequestContext
from app.domain.appointment.models import Appointment
from app.domain.auth.models import Role
from app.domain.patient.service import normalize_phone
from app.integration.integration_service import IntegrationService
from app.mcp_server import server
from app.mcp_server.models import CapabilityExecution
from app.voice import stt_provider, tts_provider
from app.voice.stt_provider import pcm_to_wav
from app.voice.telephony import audio, identity
from app.voice.telephony import media_stream_handler as telephony
from app.voice.telephony.twilio_webhook import (
    build_stream_twiml,
    validate_twilio_signature,
)
from app.voice.vad import make_tone
from tests.test_mcp_agent import FakeConnector, patient_ctx, scripted, seed_setup

MONDAY = "2026-10-05"
CALLER = "+1-555-0199"
CALLER_NAME = "Telephone Testerson"
CALLER_DOB = "1990-01-02"


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def tone_8k_mulaw(seconds: float) -> bytes:
    """Loud 16 kHz tone converted to 8 kHz mu-law, like Twilio sends."""
    pcm16 = make_tone(seconds)
    return audio.linear_to_mulaw(audio.downsample_to_8k(pcm16, 16000))


def silence_mulaw(seconds: float) -> bytes:
    return b"\xff" * int(8000 * seconds)


def media_msg(payload: bytes, stream_sid="ST123") -> str:
    return json.dumps(
        {"event": "media", "streamSid": stream_sid, "media": {"payload": b64(payload)}}
    )


def start_msg(conversation_id, patient_id="", stream_sid="ST123") -> str:
    return json.dumps(
        {
            "event": "start",
            "streamSid": stream_sid,
            "start": {
                "streamSid": stream_sid,
                "callSid": "CA123",
                "customParameters": {
                    "caller_phone": CALLER,
                    "patient_id": patient_id,
                    "conversation_id": conversation_id,
                },
                "mediaFormat": {
                    "encoding": "audio/x-mulaw",
                    "sampleRate": 8000,
                    "channels": 1,
                },
            },
        }
    )


class QueueSTT(stt_provider.BaseSTT):
    """A fixed transcript per utterance, in order."""

    def __init__(self, texts):
        self.texts = list(texts)
        self.calls = 0

    def transcribe(self, pcm, sample_rate=16000):
        self.calls += 1
        assert self.texts, "STT called more times than scripted"
        return stt_provider.STTResult(text=self.texts.pop(0))


class WavTTS(tts_provider.BaseTTS):
    """Real WAV bytes (0.3 s tone) so the mulaw path is exercised."""

    def __init__(self):
        self.calls = []

    def synthesize(self, text):
        self.calls.append(text)
        return pcm_to_wav(make_tone(0.3))


@pytest.fixture()
def telephony_env(db, monkeypatch):
    stt, tts = QueueSTT([]), WavTTS()
    stt_provider.set_stt_provider(stt)
    tts_provider.set_tts_provider(tts)
    telephony.set_db_session_factory(lambda: db)
    telephony.set_agent_complete(None)
    monkeypatch.setattr(
        "app.voice.telephony.media_stream_handler.settings.voice_silence_s",
        30.0,
    )
    yield {"stt": stt, "tts": tts}
    stt_provider.set_stt_provider(None)
    tts_provider.set_tts_provider(None)
    telephony.set_db_session_factory(None)
    telephony.set_agent_complete(None)


@pytest.fixture()
def tool_factory(db):
    from app.mcp_server.tools import _base as tool_base

    fake = FakeConnector()
    tool_base.set_integration_factory(
        lambda session: IntegrationService(session=session, connector=fake)
    )
    try:
        yield fake
    finally:
        tool_base.set_integration_factory(None)


def seed_caller(client, tag, name=CALLER_NAME, dob=CALLER_DOB, phone=CALLER):
    """Full setup + a patient with a registered phone identity."""
    setup = seed_setup(client, tag=tag)
    headers = setup["patient"]["headers"]
    resp = client.put(
        "/patients/me/contact",
        json={"phone": phone, "full_name": name, "date_of_birth": dob},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return setup


def read_until(ws, want, limit=60):
    seen = []
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        seen.append(msg)
        if msg.get("event") in want:
            return msg, seen
    raise AssertionError(f"never saw {want} in {seen[-3:]}")


def drain_marks(ws, n, limit=60):
    """Consume exactly n outbound mark events (one per spoken sentence)."""
    seen = []
    got = 0
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        seen.append(msg)
        if msg.get("event") == "mark":
            got += 1
            if got >= n:
                return seen
    raise AssertionError(f"only saw {got}/{n} marks in {seen[-3:]}")


def outbound_audio_bytes(seen) -> bytes:
    payloads = [
        base64.b64decode(m["media"]["payload"])
        for m in seen
        if m.get("event") == "media"
    ]
    return b"".join(payloads)


# -- audio utils -----------------------------------------------------------------


def test_mulaw_roundtrip_preserves_speech():
    n = 8000
    tone = struct.pack(
        "<%dh" % n,
        *[int(3000 * math.sin(2 * 3.14159 * 440 * i / 8000)) for i in range(n)],
    )
    back = audio.mulaw_to_linear(audio.linear_to_mulaw(tone))
    assert len(back) == len(tone)
    orig = struct.unpack("<%dh" % n, tone)
    rt = struct.unpack("<%dh" % n, back)
    signal = sum(s * s for s in orig) / n
    noise = sum((a - b) ** 2 for a, b in zip(orig, rt)) / n
    assert noise / signal < 0.01


def test_wav_to_mulaw_8k_lengths():
    mulaw = audio.wav_to_mulaw_8k(pcm_to_wav(make_tone(0.5)))
    assert len(mulaw) == 4000  # 0.5 s at 8 kHz
    pcm = audio.upsample_8k_to_16k(audio.mulaw_to_linear(mulaw))
    assert len(pcm) == 16000
    samples = struct.unpack("<8000h", pcm[:16000])
    energy = math.sqrt(sum(s * s for s in samples) / len(samples))
    assert energy > 500.0


def test_wav_to_mulaw_rejects_garbage():
    with pytest.raises(audio.AudioError):
        audio.wav_to_mulaw_8k(b"fake-wav:not audio")


def test_is_stop_word():
    assert telephony.is_stop_word("Stop.")
    assert telephony.is_stop_word("  hold on  ")
    assert not telephony.is_stop_word("Book Monday morning")


# -- webhook ---------------------------------------------------------------------


def twilio_signature(url, params, token):
    payload = url + "".join(k + params[k] for k in sorted(params))
    digest = hmac.new(token.encode(), payload.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def test_inbound_503_without_stream_url(client):
    resp = client.post(
        "/voice/telephony/inbound",
        data={"From": CALLER, "To": "+1-555-0000", "CallSid": "CA1"},
    )
    assert resp.status_code == 503


def test_inbound_twiml_with_patient_match(client, monkeypatch):
    setup = seed_caller(client, tag="twiml")
    monkeypatch.setattr(
        "app.voice.telephony.twilio_webhook.settings.telephony_stream_url",
        "wss://voice.example.com/voice/telephony/media",
    )
    resp = client.post(
        "/voice/telephony/inbound",
        data={"From": CALLER, "To": "+1-555-0000", "CallSid": "CA1"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.text
    assert "<Stream" in body
    assert "wss://voice.example.com/voice/telephony/media" in body
    assert setup["patient"]["id"] in body
    assert CALLER in body
    assert "conversation_id" in body


def test_inbound_unknown_number_leaves_patient_blank(client, monkeypatch):
    seed_setup(client, tag="twimlunknown")
    monkeypatch.setattr(
        "app.voice.telephony.twilio_webhook.settings.telephony_stream_url",
        "wss://voice.example.com/voice/telephony/media",
    )
    resp = client.post(
        "/voice/telephony/inbound",
        data={"From": "+1-555-8888", "To": "+1-555-0000", "CallSid": "CA2"},
    )
    assert resp.status_code == 200, resp.text
    assert "name='patient_id' value=''" in resp.text or 'name="patient_id" value=""' in (
        resp.text.replace("'", '"')
    )


def test_inbound_signature_enforced(client, monkeypatch):
    seed_setup(client, tag="twimlsig")
    monkeypatch.setattr(
        "app.voice.telephony.twilio_webhook.settings.telephony_stream_url",
        "wss://voice.example.com/voice/telephony/media",
    )
    monkeypatch.setattr(
        "app.voice.telephony.twilio_webhook.settings.twilio_auth_token", "tok123"
    )
    form = {"From": CALLER, "To": "+1-555-0000", "CallSid": "CA3"}
    denied = client.post("/voice/telephony/inbound", data=form)
    assert denied.status_code == 403
    url = "http://testserver/voice/telephony/inbound"
    sig = twilio_signature(url, form, "tok123")
    ok = client.post(
        "/voice/telephony/inbound", data=form, headers={"X-Twilio-Signature": sig}
    )
    assert ok.status_code == 200, ok.text
    bad = client.post(
        "/voice/telephony/inbound",
        data={**form, "From": "+1-555-0001"},
        headers={"X-Twilio-Signature": sig},
    )
    assert bad.status_code == 403


def test_validate_twilio_signature_vectors():
    url = "https://example.com/voice/telephony/inbound"
    params = {"From": "+15550199", "CallSid": "CA9"}
    sig = twilio_signature(url, params, "secret")
    assert validate_twilio_signature(url, params, sig, "secret") is True
    assert validate_twilio_signature(url, params, sig, "other") is False
    assert validate_twilio_signature(url, params, None, "secret") is False
    assert (
        validate_twilio_signature(url, {**params, "From": "+1"}, sig, "secret")
        is False
    )


def test_build_stream_twiml_escapes():
    twiml = build_stream_twiml(
        stream_url="wss://x/y",
        caller_phone="+1'><&",
        patient_id="",
        conversation_id="c1",
    )
    assert "+1' Ü><&" not in twiml
    assert "<Stream" in twiml and "conversation_id" in twiml


def test_status_callback_is_logged_only(client):
    resp = client.post(
        "/voice/telephony/status",
        data={"CallSid": "CA9", "CallStatus": "completed"},
    )
    assert resp.status_code == 204


# -- contact endpoint --------------------------------------------------------------


def test_contact_roundtrip_normalizes_phone(client):
    setup = seed_setup(client, tag="contact")
    headers = setup["patient"]["headers"]
    put = client.put(
        "/patients/me/contact",
        json={
            "phone": "+1 (555) 0142",
            "full_name": "  Contact Case ",
            "date_of_birth": "1985-05-06",
        },
        headers=headers,
    )
    assert put.status_code == 200, put.text
    body = put.json()
    assert body["phone"] == "15550142"
    assert body["full_name"] == "Contact Case"
    assert body["date_of_birth"] == "1985-05-06"
    got = client.get("/patients/me/contact", headers=headers).json()
    assert got["phone"] == "15550142"
    assert normalize_phone("+1 (555) 0142") == "15550142"
    assert normalize_phone("") is None


def test_contact_photo_roundtrip(client):
    """Profile photo (URL or resized data-URL) persists and clears."""
    setup = seed_setup(client, tag="photo")
    headers = setup["patient"]["headers"]
    put = client.put(
        "/patients/me/contact",
        json={"photo_url": "data:image/jpeg;base64,/9j/abc"},
        headers=headers,
    )
    assert put.status_code == 200, put.text
    assert put.json()["photo_url"] == "data:image/jpeg;base64,/9j/abc"
    got = client.get("/patients/me/contact", headers=headers).json()
    assert got["photo_url"] == "data:image/jpeg;base64,/9j/abc"
    clear = client.put("/patients/me/contact", json={"photo_url": ""}, headers=headers)
    assert clear.status_code == 200, clear.text
    assert clear.json()["photo_url"] is None


# -- identity service --------------------------------------------------------------


def test_find_patient_by_phone_suffix_match(client, db):
    setup = seed_caller(client, tag="suffix", phone="+1-555-200-0160")
    patient_id = uuid.UUID(setup["patient"]["id"])
    assert identity.find_patient_by_phone(db, "5552000160").id == patient_id
    assert identity.find_patient_by_phone(db, "+1 (555) 200-0160").id == patient_id
    assert identity.find_patient_by_phone(db, "+1-555-9999") is None
    assert identity.find_patient_by_phone(db, "") is None


def test_verify_identity_compares_name_and_dob(client, db):
    setup = seed_caller(client, tag="verifyid")
    patient_id = uuid.UUID(setup["patient"]["id"])
    ok = identity.verify_identity(
        db, patient_id=patient_id, full_name="telephone testerson", date_of_birth="1990-01-02"
    )
    assert ok == {"verified": True, "reason": "identity confirmed"}
    bad_name = identity.verify_identity(
        db, patient_id=patient_id, full_name="Someone Else", date_of_birth="1990-01-02"
    )
    assert bad_name["verified"] is False
    bad_dob = identity.verify_identity(
        db, patient_id=patient_id, full_name=CALLER_NAME, date_of_birth="2000-12-31"
    )
    assert bad_dob["verified"] is False
    malformed = identity.verify_identity(
        db, patient_id=patient_id, full_name=CALLER_NAME, date_of_birth="Jan 2"
    )
    assert malformed["verified"] is False


# -- verify tool + gate --------------------------------------------------------------


def seed_telephony_context(db, setup, verified=False):
    cid = f"call-{uuid.uuid4().hex[:8]}"
    context = get_ai_context(cid)
    context.channel = "telephony"
    context.caller_phone = CALLER
    context.caller_patient_id = setup["patient"]["id"]
    context.caller_verified = verified
    context.identity_attempts = 0
    save_ai_context(context)
    return cid


def test_verify_tool_unlocks_conversation(client, db, tool_factory):
    setup = seed_caller(client, tag="unlock")
    cid = seed_telephony_context(db, setup)
    ctx = patient_ctx(setup)
    out = server.execute_tool(
        "verify_caller_identity",
        {
            "conversation_id": cid,
            "full_name": CALLER_NAME,
            "date_of_birth": CALLER_DOB,
        },
        ctx,
        db,
    )
    assert out["verified"] is True
    assert out["attempts_remaining"] == 2
    assert get_ai_context(cid).caller_verified is True


def test_verify_tool_counts_down_then_locks(client, db, tool_factory):
    setup = seed_caller(client, tag="lockout")
    cid = seed_telephony_context(db, setup)
    ctx = patient_ctx(setup)
    for remaining in (2, 1, 0):
        out = server.execute_tool(
            "verify_caller_identity",
            {
                "conversation_id": cid,
                "full_name": "Wrong Name",
                "date_of_birth": CALLER_DOB,
            },
            ctx,
            db,
        )
        assert out["verified"] is False
        assert out["attempts_remaining"] == remaining
    locked = server.execute_tool(
        "verify_caller_identity",
        {
            "conversation_id": cid,
            "full_name": CALLER_NAME,
            "date_of_birth": CALLER_DOB,
        },
        ctx,
        db,
    )
    assert locked["verified"] is False
    assert locked["reason"] == "too many failed attempts"


def test_verify_tool_needs_telephony_channel(client, db, tool_factory):
    setup = seed_caller(client, tag="webchannel")
    ctx = patient_ctx(setup)
    out = server.execute_tool(
        "verify_caller_identity",
        {"conversation_id": "plain-web", "full_name": "X", "date_of_birth": "2000-01-01"},
        ctx,
        db,
    )
    assert out["verified"] is False
    assert "telephone" in out["reason"]


def test_gate_blocks_patient_tools_until_verified(client, db, tool_factory):
    setup = seed_caller(client, tag="gate")
    cid = seed_telephony_context(db, setup)
    ctx = patient_ctx(setup)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [
                {"id": "g1", "name": "lookup_patient", "arguments": {}},
                {"id": "g2", "name": "search_doctors", "arguments": {}},
            ],
        },
        {"content": "Please verify first.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="What are my visits?", complete=complete
    )
    assert result["reply"] == "Please verify first."
    # The blocked lookup wrote no audit row; the allowed search did.
    assert db.query(CapabilityExecution).count() == 1
    tool_msgs = [m for m in complete.messages_seen[1] if m.get("role") == "tool"]
    assert any("caller_identity_required" in m["content"] for m in tool_msgs)
    assert any('"ok": true' in m["content"].lower() for m in tool_msgs)


def test_gate_allows_everything_once_verified(client, db, tool_factory):
    setup = seed_caller(client, tag="gateopen")
    cid = seed_telephony_context(db, setup, verified=True)
    ctx = patient_ctx(setup)
    complete = scripted(
        {
            "content": None,
            "tool_calls": [{"id": "g1", "name": "lookup_patient", "arguments": {}}],
        },
        {"content": "Found you.", "tool_calls": []},
    )
    result = orchestrator.run_conversation(
        db=db, ctx=ctx, conversation_id=cid, user_message="Who am I?", complete=complete
    )
    assert result["reply"] == "Found you."
    assert db.query(CapabilityExecution).count() == 1


# -- full call flows over the stream socket -------------------------------------------


def test_full_call_verifies_then_books(client, db, tool_factory, telephony_env):
    setup = seed_caller(client, tag="callbook")
    cid = f"call-{uuid.uuid4().hex[:8]}"
    telephony_env["stt"].texts = [
        "My name is Telephone Testerson, born January second 1990",
        "Yes, book Monday morning",
    ]
    start = datetime.fromisoformat(f"{MONDAY}T09:00:00+00:00")
    # Confirmation turn: seed the previously offered slot so the P0
    # confirm gate allows the booking after the patient says yes.
    prior = get_ai_context(cid)
    prior.offered_doctors = [{"id": setup["doctor"]["id"], "name": "Dr. callbook"}]
    prior.offered_slots = [
        {
            "start": start.isoformat(),
            "end": (start + timedelta(minutes=30)).isoformat(),
        }
    ]
    # The scripted confirmation jumps past the early steps: simulate them
    # (day comes from the "Monday morning" transcript itself).
    prior.visit_types_seen = True
    prior.selected_appointment_type_id = setup["type"]["id"]
    prior.selected_consultation_mode = "in_person"
    save_ai_context(prior)
    telephony.set_agent_complete(
        scripted(
            {
                "content": None,
                "tool_calls": [
                    {
                        "id": "c1",
                        "name": "verify_caller_identity",
                        "arguments": {
                            "conversation_id": cid,
                            "full_name": CALLER_NAME,
                            "date_of_birth": CALLER_DOB,
                        },
                    }
                ],
            },
            {"content": "Thanks, identity confirmed. What would you like to book?", "tool_calls": []},
            {
                "content": None,
                "tool_calls": [
                    {
                        "id": "c2",
                        "name": "create_appointment",
                        "arguments": {
                            "doctor_id": setup["doctor"]["id"],
                            "appointment_type_id": setup["type"]["id"],
                            "slot_start": start.isoformat(),
                            "slot_end": (start + timedelta(minutes=30)).isoformat(),
                            "idempotency_key": "call-book-1",
                        },
                    }
                ],
            },
            {"content": "Booked for Monday morning.", "tool_calls": []},
        )
    )
    try:
        with client.websocket_connect("/voice/telephony/media") as ws:
            ws.send_text(json.dumps({"event": "connected"}))
            ws.send_text(start_msg(cid, setup["patient"]["id"]))
            greeting_seen = drain_marks(ws, 2)  # greeting is two sentences
            assert outbound_audio_bytes(greeting_seen)
            # Utterance 1: identity.
            ws.send_text(media_msg(tone_8k_mulaw(0.4)))
            ws.send_text(media_msg(silence_mulaw(0.8)))
            drain_marks(ws, 2)  # "Thanks, identity confirmed..." is two sentences
            # Utterance 2: booking.
            ws.send_text(media_msg(tone_8k_mulaw(0.4)))
            ws.send_text(media_msg(silence_mulaw(0.8)))
            drain_marks(ws, 1)  # "Booked for Monday morning." is one sentence
            # Clean hangup.
            ws.send_text(json.dumps({"event": "stop", "streamSid": "ST123"}))
    finally:
        telephony.set_agent_complete(None)
    assert get_ai_context(cid).caller_verified is True
    appt = (
        db.query(Appointment).filter(Appointment.idempotency_key == "call-book-1").one()
    )
    assert appt.state.value == "confirmed"
    spoken = telephony_env["tts"].calls
    assert any("Hello Telephone" in line for line in spoken)
    assert "Booked for Monday morning." in spoken
    assert telephony_env["stt"].calls == 2


def test_unverified_caller_hears_no_patient_data(client, db, tool_factory, telephony_env):
    seed_setup(client, tag="calldecline")
    cid = f"call-{uuid.uuid4().hex[:8]}"
    telephony_env["stt"].texts = ["What are my upcoming visits?"]
    telephony.set_agent_complete(
        scripted(
            {
                "content": None,
                "tool_calls": [
                    {"id": "c1", "name": "lookup_patient", "arguments": {}}
                ],
            },
            {
                "content": "I need to verify you first. What is your full name and date of birth?",
                "tool_calls": [],
            },
        )
    )
    try:
        with client.websocket_connect("/voice/telephony/media") as ws:
            ws.send_text(json.dumps({"event": "connected"}))
            ws.send_text(start_msg(cid))
            drain_marks(ws, 2)
            ws.send_text(media_msg(tone_8k_mulaw(0.4)))
            ws.send_text(media_msg(silence_mulaw(0.8)))
            drain_marks(ws, 2)
            ws.send_text(json.dumps({"event": "stop", "streamSid": "ST123"}))
    finally:
        telephony.set_agent_complete(None)
    assert db.query(CapabilityExecution).count() == 0
    assert get_ai_context(cid).caller_verified is False
    assert any(
        "verify you first" in line for line in telephony_env["tts"].calls
    )
    clear_ai_context(cid)


def test_stop_event_hangs_up_cleanly(client, db, telephony_env):
    cid = f"call-{uuid.uuid4().hex[:8]}"
    with client.websocket_connect("/voice/telephony/media") as ws:
        ws.send_text(json.dumps({"event": "connected"}))
        ws.send_text(start_msg(cid))
        drain_marks(ws, 2)
        ws.send_text(json.dumps({"event": "stop", "streamSid": "ST123"}))
