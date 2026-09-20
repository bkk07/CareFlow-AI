"""TTS providers: stub (server-side interface only).

Browser text chat now uses the Web Speech API (`window.speechSynthesis`)
client-side and never calls this module — no external TTS request is
made for chat replies. This module keeps the server-side interface
(`BaseTTS` / `StubTTS` / `get_tts_provider` / `set_tts_provider`) intact
because the WebSocket voice loop and the telephony media loop still
import it. The external Groq Orpheus implementation has been removed.
"""


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


_provider: BaseTTS | None = None


def set_tts_provider(provider: BaseTTS | None) -> None:
    """Test hook: inject a scripted TTS provider."""
    global _provider
    _provider = provider


def get_tts_provider() -> BaseTTS:
    if _provider is not None:
        return _provider
    return StubTTS()


__all__ = [
    "BaseTTS",
    "TTSError",
    "StubTTS",
    "get_tts_provider",
    "set_tts_provider",
]
