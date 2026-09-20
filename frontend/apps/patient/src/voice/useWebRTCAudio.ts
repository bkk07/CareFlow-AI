/**
 * useWebRTCAudio — mic capture, server-VAD playback, barge-in signal.
 *
 * Audio flows as 16 kHz PCM16 mono: an AudioWorklet downsamples the mic,
 * base64 frames go up the WebSocket, and `audio_out` WAV payloads are
 * queued for playback. Calling `interrupt()` stops every scheduled
 * source immediately AND tells the server to stop generating (barge-in
 * is not a client-side mute: the in-flight TTS stream halts too).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState =
  | "idle"
  | "connecting"
  | "awaiting_speech"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "ended";

export interface VoiceEvent {
  kind: string;
  text?: string;
  state?: string;
  reason?: string;
}

interface UseWebRTCAudio {
  state: VoiceState;
  events: VoiceEvent[];
  error: string | null;
  connect: (token: string, resumeConversationId?: string | null) => void;
  disconnect: () => void;
  interrupt: () => void;
  /** Share live GPS with the call so answers rank nearby care like chat. */
  sendLocation: (latitude: number, longitude: number) => void;
}

const WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Fractional resampler state: keeps phase across process() calls so
    // 44.1kHz / 48kHz mics downsample to exactly 16kHz without drift.
    // Gemini-quality capture needs this — integer-floor stepping drops
    // or duplicates samples and Whisper hears slurred speech.
    this._prev = 0;
    this._phase = 0;
    this._pending = [];
  }
  // Downsample to 16 kHz and emit int16 frames of 320 samples (20 ms).
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    const inRate = sampleRate;
    const outRate = 16000;
    const step = inRate / outRate;
    for (let n = 0; n < channel.length; n++) {
      const cur = channel[n];
      // Emit output samples while the phase falls inside this input step,
      // linearly interpolating between previous and current sample.
      while (this._phase < 1) {
        const sample = this._prev + (cur - this._prev) * this._phase;
        const clamped = Math.max(-1, Math.min(1, sample));
        this._pending.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
        if (this._pending.length === 320) {
          const frame = new Int16Array(this._pending);
          this._pending = [];
          this.port.postMessage(frame.buffer, [frame.buffer]);
        }
        this._phase += step;
      }
      this._phase -= 1;
      this._prev = cur;
    }
    return true;
  }
}
registerProcessor("capture-processor", CaptureProcessor);
`;

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as number[],
    );
  }
  return btoa(binary);
}

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function useWebRTCAudio(apiBase: string): UseWebRTCAudio {
  const [state, setState] = useState<VoiceState>("idle");
  const [events, setEvents] = useState<VoiceEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const playAtRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  const pushEvent = useCallback((event: VoiceEvent) => {
    setEvents((prev) => [...prev.slice(-99), event]);
  }, []);

  const stopPlayback = useCallback(() => {
    for (const source of sourcesRef.current) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
    }
    sourcesRef.current = [];
    playAtRef.current = 0;
  }, []);

  const disconnect = useCallback(() => {
    stopPlayback();
    wsRef.current?.close();
    wsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setState("idle");
  }, [stopPlayback]);

  useEffect(() => disconnect, [disconnect]);

  const playWav = useCallback(
    async (data: string) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const buffer = await ctx.decodeAudioData(decodeBase64(data));
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const at = Math.max(ctx.currentTime, playAtRef.current);
      source.start(at);
      playAtRef.current = at + buffer.duration;
      sourcesRef.current.push(source);
      source.onended = () => {
        sourcesRef.current = sourcesRef.current.filter((s) => s !== source);
      };
    },
    [],
  );

  const connect = useCallback(
    async (token: string, resumeConversationId?: string | null) => {
      setError(null);
      setState("connecting");
      try {
        // Same constraints the big assistants use: echo cancellation +
        // noise suppression + auto gain, so Whisper hears voice not room.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        streamRef.current = stream;
        // Use the device's native sample rate — the worklet resamples to
        // exactly 16 kHz with a fractional accumulator. Forcing 48 kHz
        // here made the browser resample first AND the worklet resample
        // again, which smeared consonants on 44.1 kHz hardware.
        const ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        audioCtxRef.current = ctx;
        const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);

        const wsUrl =
          apiBase.replace(/^http/, "ws") +
          `/voice/ws?token=${encodeURIComponent(token)}` +
          (resumeConversationId
            ? `&resume=${encodeURIComponent(resumeConversationId)}`
            : "");
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (msg) => {
          const payload = JSON.parse(msg.data as string) as {
            type: string;
            text?: string;
            data?: string;
            state?: string;
            reason?: string;
          };
          switch (payload.type) {
            case "ready":
              setState("awaiting_speech");
              break;
            case "partial":
              pushEvent({ kind: "partial", text: payload.text });
              setState("listening");
              break;
            case "final":
              pushEvent({ kind: "final", text: payload.text });
              setState("thinking");
              break;
            case "agent_text":
              pushEvent({ kind: "agent_text", text: payload.text });
              break;
            case "audio_out":
              setState("speaking");
              if (payload.data) void playWav(payload.data);
              break;
            case "state":
              if (payload.state === "idle") setState("awaiting_speech");
              else if (payload.state === "interrupted") setState("interrupted");
              else if (payload.state === "awaiting_speech")
                setState("awaiting_speech");
              break;
            case "error":
              setError(payload.text ?? "Voice error");
              break;
            case "ended":
              pushEvent({ kind: "ended", reason: payload.reason });
              setState("ended");
              break;
            default:
              break;
          }
        };
        ws.onerror = () => setError("Voice connection failed.");
        ws.onclose = () => setState((s) => (s === "ended" ? s : "idle"));

        const mic = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "capture-processor");
        node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "audio", data: encodeBase64(event.data) }));
          }
        };
        mic.connect(node);
        // Keep-alive: Chrome/Safari throttle an AudioWorklet graph whose
        // output goes nowhere, so process() stops and the server hears
        // silence. A zero-gain sink keeps the graph running inaudibly.
        const sink = ctx.createGain();
        sink.gain.value = 0;
        node.connect(sink);
        sink.connect(ctx.destination);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not access the microphone.",
        );
        setState("idle");
      }
    },
    [apiBase, playWav, pushEvent],
  );

  const interrupt = useCallback(() => {
    // Barge-in: kill local playback AND tell the server to stop the
    // in-flight agent turn and TTS stream.
    stopPlayback();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
    setState("interrupted");
  }, [stopPlayback]);

  const sendLocation = useCallback((latitude: number, longitude: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "location", latitude, longitude }));
    }
  }, []);

  return { state, events, error, connect, disconnect, interrupt, sendLocation };
}
