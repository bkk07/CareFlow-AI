"""STT providers: stub (default) + GROQ Whisper (verified live).

Audio arrives as 16-bit PCM mono at 16 kHz. The GROQ provider wraps it
in a minimal WAV container in-memory (no disk, no new dependencies)
and posts it to the OpenAI-compatible transcriptions endpoint.
"""

import io
import time
import wave
from dataclasses import dataclass

import httpx

from app.core.config import settings

#: 429/5xx are retried with backoff (shared-key rate limits hit hardest
#: exactly when the user is mid-sentence; failing the turn instead would
#: surface as a dead "Voice error" in the UI).
_MAX_ATTEMPTS = 3


def _retryable(exc: httpx.HTTPError) -> bool:
    if isinstance(exc, httpx.TimeoutException):
        return True
    if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None:
        return exc.response.status_code == 429 or 500 <= exc.response.status_code < 600
    return False


@dataclass(frozen=True)
class STTResult:
    text: str
    language: str | None = None


class STTError(Exception):
    pass


class BaseSTT:
    def transcribe(self, pcm: bytes, sample_rate: int = 16000) -> STTResult:
        raise NotImplementedError


class StubSTT(BaseSTT):
    """No-op provider: hears nothing. Tests inject scripted providers."""

    def transcribe(self, pcm: bytes, sample_rate: int = 16000) -> STTResult:
        del pcm, sample_rate
        return STTResult(text="")


def pcm_to_wav(pcm: bytes, sample_rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as container:
        container.setnchannels(1)
        container.setsampwidth(2)
        container.setframerate(sample_rate)
        container.writeframes(pcm)
    return buf.getvalue()


class GroqSTT(BaseSTT):
    """GROQ Whisper (whisper-large-v3-turbo verified 200 live)."""

    def __init__(
        self, api_key: str | None = None, model: str | None = None
    ) -> None:
        self.api_key = api_key or settings.llm_api_key
        self.model = model or settings.stt_model

    def transcribe(self, pcm: bytes, sample_rate: int = 16000) -> STTResult:
        if not self.api_key:
            raise STTError("No LLM/GROQ key configured for STT")
        if len(pcm) < 6400:  # <200ms is never real speech, save the call
            return STTResult(text="")
        last_exc: httpx.HTTPError | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                resp = httpx.post(
                    f"{settings.llm_base_url.rstrip('/')}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    files={"file": ("audio.wav", pcm_to_wav(pcm, sample_rate), "audio/wav")},
                    # temperature=0 = deterministic, far fewer "Thank you."
                    # hallucinations; language=en sharpens English accuracy
                    # the way Gemini's recognizer is biased.
                    data={
                        "model": self.model,
                        "response_format": "json",
                        "temperature": "0",
                        "language": "en",
                    },
                    timeout=60.0,
                )
                resp.raise_for_status()
                break
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt + 1 < _MAX_ATTEMPTS and _retryable(exc):
                    time.sleep(1.0 * (attempt + 1))
                    continue
                raise STTError(f"Whisper request failed: {exc}") from exc
        else:
            raise STTError(f"Whisper request failed: {last_exc}") from last_exc
        data = resp.json()
        return STTResult(
            text=str(data.get("text") or "").strip(),
            language=data.get("language"),
        )


_provider: BaseSTT | None = None


def set_stt_provider(provider: BaseSTT | None) -> None:
    """Test hook: inject a scripted STT provider."""
    global _provider
    _provider = provider


def get_stt_provider() -> BaseSTT:
    if _provider is not None:
        return _provider
    if settings.stt_provider == "groq":
        return GroqSTT()
    return StubSTT()


__all__ = [
    "BaseSTT",
    "GroqSTT",
    "STTError",
    "STTResult",
    "StubSTT",
    "get_stt_provider",
    "pcm_to_wav",
    "set_stt_provider",
]
