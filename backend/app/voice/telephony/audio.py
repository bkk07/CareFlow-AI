"""G.711 mu-law + resampling for Twilio Media Streams.

Twilio speaks mu-law at 8 kHz; our STT/VAD/TTS pipeline is PCM16 at
16 kHz. No new dependencies: mu-law tables are implemented directly
from the G.711 spec, resampling is linear, and WAV parsing uses the
stdlib `wave` module. (`audioop` is gone on modern Python.)
"""

import io
import struct
import wave

SAMPLE_RATE_TELEPHONY = 8000
SAMPLE_RATE_PIPELINE = 16000
FRAME_BYTES_MULAW = 160  # 20 ms at 8 kHz, Twilio's preferred chunk
MIN_UTTERANCE_BYTES = 6400  # 200 ms at 16 kHz PCM16, mirrors GroqSTT

_BIAS = 0x84
_CLIP = 32635
_SEG_END = (0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF, 0x1FFF, 0x3FFF, 0x7FFF)


class AudioError(Exception):
    pass


def _search(value: int) -> int:
    for i, bound in enumerate(_SEG_END):
        if value <= bound:
            return i
    return 8


def linear_to_mulaw(pcm: bytes) -> bytes:
    """PCM16 LE mono -> mu-law bytes (any sample rate, rate-agnostic)."""
    if len(pcm) % 2:
        pcm += b"\x00"
    out = bytearray()
    for (sample,) in struct.iter_unpack("<h", pcm):
        if sample < 0:
            magnitude = _BIAS - sample
            mask = 0x7F
        else:
            magnitude = sample + _BIAS
            mask = 0xFF
        seg = _search(min(magnitude, _CLIP + _BIAS))
        if seg >= 8:
            out.append(0x7F ^ mask)
        else:
            out.append((((seg << 4) | ((magnitude >> (seg + 3)) & 0xF))) ^ mask)
    return bytes(out)


def mulaw_to_linear(payload: bytes) -> bytes:
    """Mu-law bytes -> PCM16 LE mono bytes (same sample rate)."""
    out = bytearray()
    for byte in payload:
        inv = (~byte) & 0xFF
        mantissa = (inv & 0x0F) << 3
        t = (mantissa + _BIAS) << ((inv & 0x70) >> 4)
        sample = _BIAS - t if (inv & 0x80) else t - _BIAS
        out += struct.pack("<h", max(-32768, min(32767, sample)))
    return bytes(out)


def _samples(pcm: bytes) -> list[int]:
    if len(pcm) % 2:
        pcm += b"\x00"
    return [s for (s,) in struct.iter_unpack("<h", pcm)]


def upsample_8k_to_16k(pcm_8k: bytes) -> bytes:
    """PCM16 mono 8 kHz -> 16 kHz via linear interpolation."""
    src = _samples(pcm_8k)
    if not src:
        return b""
    out = bytearray()
    for i, sample in enumerate(src):
        nxt = src[i + 1] if i + 1 < len(src) else sample
        out += struct.pack("<hh", sample, (sample + nxt) // 2)
    return bytes(out)


def downsample_to_8k(pcm: bytes, sample_rate: int) -> bytes:
    """PCM16 mono at any rate -> 8 kHz (pair averaging = cheap lowpass)."""
    if sample_rate == SAMPLE_RATE_TELEPHONY:
        return pcm if len(pcm) % 2 == 0 else pcm + b"\x00"
    src = _samples(pcm)
    if not src:
        return b""
    ratio = sample_rate / SAMPLE_RATE_TELEPHONY
    out = bytearray()
    pos = 0.0
    while int(pos) < len(src):
        i = int(pos)
        j = min(i + 1, len(src) - 1)
        out += struct.pack("<h", (src[i] + src[j]) // 2)
        pos += ratio
    return bytes(out)


def wav_to_mulaw_8k(wav_bytes: bytes) -> bytes:
    """TTS WAV output (any rate, mono 16-bit) -> mu-law 8 kHz frames."""
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as container:
            if container.getnchannels() != 1 or container.getsampwidth() != 2:
                raise AudioError("TTS audio must be mono 16-bit WAV")
            rate = container.getframerate()
            frames = container.readframes(container.getnframes())
    except (wave.Error, EOFError) as exc:
        raise AudioError(f"TTS audio is not decodable WAV: {exc}") from exc
    if not frames:
        raise AudioError("TTS audio is empty")
    return linear_to_mulaw(downsample_to_8k(frames, rate))


def chunk_frames(data: bytes, size: int = FRAME_BYTES_MULAW) -> list[bytes]:
    """Split outbound audio into fixed Twilio media chunks (zero-padded)."""
    chunks = [data[i : i + size] for i in range(0, len(data), size)]
    if chunks and len(chunks[-1]) < size:
        chunks[-1] = chunks[-1] + bytes(size - len(chunks[-1]))
    return chunks


__all__ = [
    "AudioError",
    "FRAME_BYTES_MULAW",
    "MIN_UTTERANCE_BYTES",
    "SAMPLE_RATE_PIPELINE",
    "SAMPLE_RATE_TELEPHONY",
    "chunk_frames",
    "downsample_to_8k",
    "linear_to_mulaw",
    "mulaw_to_linear",
    "upsample_8k_to_16k",
    "wav_to_mulaw_8k",
]
