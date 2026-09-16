"""TTS providers: stub (default) + GROQ Orpheus (endpoint-correct).

The GROQ TTS class targets the documented Orpheus endpoint, but at the
time of writing the model requires extra org terms acceptance, so live
calls 400 — the stub stays the default until that is accepted. The
voice loop streams sentence-by-sentence regardless of provider.
"""

import httpx

from app.core.config import settings


class TTSError(Exception):
    pass


class BaseTTS:
    def synthesize(self, text: str) -> bytes:
        """Return WAV audio bytes for one sentence."""
        raise NotImplementedError


class StubTTS(BaseTTS):
    """No-op provider: synthesis unavailable. Tests inject fakes."""

    def synthesize(self, text: str) -> bytes:
        del text
        raise TTSError("No TTS provider configured (TTS_PROVIDER=stub)")


class GroqTTS(BaseTTS):
    """GROQ Orpheus English TTS (documented endpoint; needs terms accepted)."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        voice: str | None = None,
    ) -> None:
        self.api_key = api_key or settings.llm_api_key
        self.model = model or settings.tts_model
        self.voice = voice or settings.tts_voice

    def synthesize(self, text: str) -> bytes:
        if not self.api_key:
            raise TTSError("No LLM/GROQ key configured for TTS")
        if not text.strip():
            raise TTSError("Nothing to synthesize")
        try:
            resp = httpx.post(
                f"{settings.llm_base_url.rstrip('/')}/audio/speech",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "input": text,
                    "voice": self.voice,
                    "response_format": "wav",
                },
                timeout=120.0,
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise TTSError(f"TTS request failed: {exc}") from exc
        return resp.content


_provider: BaseTTS | None = None


def set_tts_provider(provider: BaseTTS | None) -> None:
    """Test hook: inject a scripted TTS provider."""
    global _provider
    _provider = provider


def get_tts_provider() -> BaseTTS:
    if _provider is not None:
        return _provider
    if settings.tts_provider == "groq":
        return GroqTTS()
    return StubTTS()


__all__ = [
    "BaseTTS",
    "GroqTTS",
    "TTSError",
    "StubTTS",
    "get_tts_provider",
    "set_tts_provider",
]
