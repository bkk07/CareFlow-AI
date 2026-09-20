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


#: Floor below which the adaptive threshold never drops: typical room
#: tone sits under 100 RMS, so 120 keeps silence silent while still
#: hearing soft voices (~150 RMS) that a fixed 200 threshold drops.
MIN_ADAPTIVE_THRESHOLD = 120.0

#: Additive margin over the tracked noise floor. A multiplier would chase
#: a steady signal upward (floor → signal level, threshold → 3x signal:
#: a soft continuous voice could never cross it). Margin hears from the
#: very first frame instead of needing silence to calibrate downward.
FLOOR_MARGIN = 80.0


class UtteranceTracker:
    """Accumulates one utterance; reports partials and end-of-speech.

    Adaptive mode (default) tracks the room's noise floor from quiet
    frames and sets the speech threshold to floor + FLOOR_MARGIN
    (never below MIN_ADAPTIVE_THRESHOLD). Fixed-threshold laptop mics
    with auto-gain miss soft voices entirely — the assistant then "hears
    nothing" no matter how clearly the user speaks. Pass adaptive=False
    for the legacy fixed threshold (tests, telephony parity).
    """

    def __init__(
        self,
        energy_threshold: float = ENERGY_THRESHOLD,
        hangover_frames: int = HANGOVER_FRAMES,
        partial_every_frames: int = PARTIAL_EVERY_FRAMES,
        adaptive: bool = True,
    ) -> None:
        self.energy_threshold = energy_threshold
        self.hangover_frames = hangover_frames
        self.partial_every_frames = partial_every_frames
        self.adaptive = adaptive
        self.noise_floor = 40.0
        self.buffer = bytearray()
        self.speech_frames = 0
        self.quiet_frames = 0
        self.in_utterance = False
        self.frames_since_partial = 0
        self.total_frames = 0

    @property
    def threshold(self) -> float:
        if not self.adaptive:
            return self.energy_threshold
        return max(MIN_ADAPTIVE_THRESHOLD, self.noise_floor + FLOOR_MARGIN)

    def push(self, pcm: bytes) -> tuple[bool, bool]:
        """Feed raw PCM; returns (partial_due, utterance_done)."""
        partial_due, done = False, False
        for offset in range(0, len(pcm) - FRAME_BYTES + 1, FRAME_BYTES):
            frame = pcm[offset : offset + FRAME_BYTES]
            energy = frame_energy(frame)
            speech = energy >= self.threshold
            self.total_frames += 1
            if not speech and self.adaptive:
                # Quiet frame: fold it into the noise floor (slow EMA so
                # a loud room doesn't yank the threshold mid-sentence).
                # Speech frames never move the floor: a steady soft voice
                # must not calibrate itself out of audibility.
                self.noise_floor += 0.05 * (min(energy, 800.0) - self.noise_floor)
                self.noise_floor = max(30.0, min(700.0, self.noise_floor))
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
        self.total_frames = 0
        return data

    def stats(self) -> dict[str, float]:
        """Diagnostic snapshot for server logs (no audio content)."""
        return {
            "buffer_bytes": float(len(self.buffer)),
            "speech_frames": float(self.speech_frames),
            "total_frames": float(self.total_frames),
            "threshold": float(self.threshold),
            "noise_floor": float(self.noise_floor),
        }

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
    "MIN_ADAPTIVE_THRESHOLD",
    "PARTIAL_EVERY_FRAMES",
    "SAMPLE_RATE",
    "UtteranceTracker",
    "frame_energy",
    "make_silence",
    "make_tone",
]
