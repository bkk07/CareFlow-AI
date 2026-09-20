"""Energy-based voice activity detection over 16-bit PCM mono.

No native dependencies: each 20 ms frame's RMS energy is compared to a
threshold, and an utterance ends after enough consecutive quiet frames
(the hangover). Whisper hallucinates on silence ("Thank you."), so the
VAD gate — never transcribing pure quiet — is load-bearing, not decor.
"""

import math
import struct

SAMPLE_RATE = 16000
FRAME_MS = 20
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
FRAME_BYTES = FRAME_SAMPLES * 2

#: RMS of int16 samples above which a frame counts as speech. Conversational
#: speech at normal mic gain sits well above 500; room tone below 100.
#: Lowered from 300 -> 200: laptop mics with auto-gain + noise suppression
#: (like the frontend now requests) land around 200-400 on quiet speech,
#: and the old threshold silently dropped first syllables / soft voices.
ENERGY_THRESHOLD = 200.0

#: Quiet frames (600 ms) that close an utterance.
HANGOVER_FRAMES = 30

#: Speech frames (~1 s) after which an interim partial is emitted.
PARTIAL_EVERY_FRAMES = 50


def frame_energy(frame: bytes) -> float:
    """RMS energy of one 20 ms int16 frame."""
    if len(frame) < FRAME_BYTES:
        return 0.0
    samples = struct.unpack(f"<{FRAME_SAMPLES}h", frame[:FRAME_BYTES])
    return math.sqrt(sum(s * s for s in samples) / FRAME_SAMPLES)


class UtteranceTracker:
    """Accumulates one utterance; reports partials and end-of-speech."""

    def __init__(
        self,
        energy_threshold: float = ENERGY_THRESHOLD,
        hangover_frames: int = HANGOVER_FRAMES,
        partial_every_frames: int = PARTIAL_EVERY_FRAMES,
    ) -> None:
        self.energy_threshold = energy_threshold
        self.hangover_frames = hangover_frames
        self.partial_every_frames = partial_every_frames
        self.buffer = bytearray()
        self.speech_frames = 0
        self.quiet_frames = 0
        self.in_utterance = False
        self.frames_since_partial = 0

    def push(self, pcm: bytes) -> tuple[bool, bool]:
        """Feed raw PCM; returns (partial_due, utterance_done)."""
        partial_due, done = False, False
        for offset in range(0, len(pcm) - FRAME_BYTES + 1, FRAME_BYTES):
            frame = pcm[offset : offset + FRAME_BYTES]
            speech = frame_energy(frame) >= self.energy_threshold
            if speech:
                if not self.in_utterance:
                    self.in_utterance = True
                    self.speech_frames = 0
                    self.frames_since_partial = 0
                self.buffer.extend(frame)
                self.speech_frames += 1
                self.quiet_frames = 0
                self.frames_since_partial += 1
                if self.frames_since_partial >= self.partial_every_frames:
                    self.frames_since_partial = 0
                    partial_due = True
            elif self.in_utterance:
                self.quiet_frames += 1
                if self.quiet_frames >= self.hangover_frames:
                    done = True
        return partial_due, done

    def take(self) -> bytes:
        """Drain the accumulated utterance and reset."""
        data = bytes(self.buffer)
        self.buffer.clear()
        self.speech_frames = 0
        self.quiet_frames = 0
        self.in_utterance = False
        self.frames_since_partial = 0
        return data

    def peek(self) -> bytes:
        """Return a copy of accumulated audio WITHOUT consuming it.

        Used for interim partials: the buffer is left intact so the
        eventual `take()` still yields the WHOLE utterance. The old
        implementation cleared the buffer here, which truncated the
        first ~1s of every long utterance before the final STT call —
        the main "it doesn't hear what I said" bug.
        """
        self.frames_since_partial = 0
        return bytes(self.buffer)


def make_tone(seconds: float, amplitude: int = 3000, hz: float = 440.0) -> bytes:
    """Test helper: a loud sine wave (always speech to the VAD)."""
    n = int(SAMPLE_RATE * seconds)
    return struct.pack(
        f"<{n}h",
        *[int(amplitude * math.sin(2 * math.pi * hz * i / SAMPLE_RATE)) for i in range(n)],
    )


def make_silence(seconds: float) -> bytes:
    """Test helper: pure quiet (never speech to the VAD)."""
    return bytes(int(SAMPLE_RATE * seconds) * 2)


__all__ = [
    "ENERGY_THRESHOLD",
    "FRAME_BYTES",
    "FRAME_MS",
    "HANGOVER_FRAMES",
    "PARTIAL_EVERY_FRAMES",
    "SAMPLE_RATE",
    "UtteranceTracker",
    "frame_energy",
    "make_silence",
    "make_tone",
]
