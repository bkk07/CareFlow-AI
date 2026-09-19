import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, MicOff, Navigation, RotateCcw, Square, X } from "lucide-react";
import { VoiceVisualizer } from "../components/ai/ai";
import { useWebRTCAudio } from "../voice/useWebRTCAudio";
import { wsBase } from "../api";
import { useAppState } from "../context/AppStateContext";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/common/ui";
import { readPosition } from "../lib/helpers";

type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "interrupted" | "completed" | "error";

const STATUS_TEXT: Record<VoiceState, string> = {
  idle: "Tap to start",
  listening: "Listening…",
  thinking: "CareFlow AI is thinking…",
  speaking: "Speaking…",
  interrupted: "Interrupted",
  completed: "Done — tap to talk again",
  error: "Something went wrong",
};

const DEMO_SCRIPT: { state: VoiceState; text: string; wait: number }[] = [
  { state: "listening", text: "“I need a cardiologist this week…”", wait: 2200 },
  { state: "thinking", text: "Finding cardiology availability…", wait: 1800 },
  { state: "speaking", text: "“I found Dr. Sarah Johnson, tomorrow at 4:30 PM. Should I hold that time for you?”", wait: 3200 },
  { state: "completed", text: "Simulated turn complete. No microphone or network was used.", wait: 0 },
];

export default function VoicePage() {
  const { live } = useAppState();
  const { accessToken } = useAuth();
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [sessionLive, setSessionLive] = useState(false);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const sentGeoRef = useRef<string | null>(null);
  const timers = useRef<number[]>([]);
  const voice = useWebRTCAudio(wsBase());
  const canGoLive = live && !!accessToken;

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }

  useEffect(() => clearTimers, []);

  async function shareLocation() {
    setLocating(true);
    setGeoError(null);
    try {
      const g = await readPosition();
      setCoords({ latitude: g.latitude, longitude: g.longitude });
    } catch (err) {
      setGeoError(err instanceof Error ? err.message : "Could not read your location.");
    } finally {
      setLocating(false);
    }
  }

  // Push live GPS to the call once the socket is open (resends are idempotent).
  useEffect(() => {
    if (!coords || !sessionLive) return;
    if (voice.state === "idle" || voice.state === "connecting" || voice.state === "ended") return;
    const key = `${coords.latitude.toFixed(5)},${coords.longitude.toFixed(5)}`;
    if (sentGeoRef.current === key) return;
    voice.sendLocation(coords.latitude, coords.longitude);
    sentGeoRef.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.state, coords, sessionLive]);

  // Mirror live session events into the transcript.
  useEffect(() => {
    if (!sessionLive) return;
    const map: Record<string, VoiceState> = {
      connecting: "listening",
      awaiting_speech: "listening",
      listening: "listening",
      thinking: "thinking",
      speaking: "speaking",
      interrupted: "interrupted",
      ended: "completed",
    };
    const mapped = map[voice.state];
    if (mapped) setState(mapped);
    if (voice.error) {
      setState("error");
      setLines((prev) => [...prev.slice(-5), `Voice session error: ${voice.error}`]);
    }
    const fresh = voice.events.filter((e) => e.kind === "final" || e.kind === "agent_text");
    if (fresh.length > 0) {
      setLines((prev) => [...prev.slice(-5), ...fresh.map((e) => (e.kind === "final" ? `You: ${e.text}` : `CareFlow AI: ${e.text}`))].slice(-6));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.state, voice.events, voice.error, sessionLive]);

  function startDemo() {
    voice.disconnect();
    setSessionLive(false);
    clearTimers();
    setLines([]);
    let delay = 0;
    DEMO_SCRIPT.forEach((step) => {
      const t = window.setTimeout(() => {
        setState(step.state);
        setLines((prev) => [...prev.slice(-5), step.text]);
      }, delay);
      timers.current.push(t);
      delay += step.wait;
    });
  }

  function startLive() {
    if (!accessToken) return;
    clearTimers();
    setLines([]);
    sentGeoRef.current = null;
    setSessionLive(true);
    setState("listening");
    voice.connect(accessToken);
  }

  function start() {
    if (canGoLive) startLive();
    else startDemo();
  }

  function interrupt() {
    if (sessionLive) {
      voice.interrupt();
      setLines((prev) => [...prev, "You interrupted — playback stopped."]);
      return;
    }
    clearTimers();
    setState("interrupted");
    setLines((prev) => [...prev, "You interrupted — playback stopped (simulated)."]);
  }

  function stop() {
    voice.disconnect();
    setSessionLive(false);
    clearTimers();
    sentGeoRef.current = null;
    setState("idle");
    setLines([]);
  }

  const liveNow = ["listening", "thinking", "speaking"].includes(state);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center">
        <h1 className="page-title">Voice assistant</h1>
        <p className="page-sub mt-1">
          {canGoLive ? "Live voice session with CareFlow AI — or play a demo turn." : "Frontend simulation — no microphone, WebSocket, or backend is used."}
        </p>
        <p className="text-[0.75rem] text-ink-faint mt-1">
          Live voice is transcribed to schedule your care. Bookings only happen after you say yes to a suggested time.
        </p>
        <div className="flex justify-center mt-2">
          {coords ? (
            <span className="inline-flex items-center gap-1.5 text-[0.74rem] font-bold text-teal-dark bg-teal-soft/70 border border-teal/25 rounded-full pl-2.5 pr-1.5 py-1">
              📍 {coords.latitude.toFixed(3)}, {coords.longitude.toFixed(3)}
              <button
                onClick={() => { setCoords(null); sentGeoRef.current = null; }}
                aria-label="Clear shared location"
                className="w-5 h-5 rounded-full hover:bg-white/70 flex items-center justify-center"
              >
                <X size={12} />
              </button>
            </span>
          ) : (
            <button
              onClick={() => void shareLocation()}
              disabled={locating}
              className="inline-flex items-center gap-1 text-[0.76rem] font-bold text-healthcare hover:underline disabled:opacity-60"
            >
              <Navigation size={13} /> {locating ? "Reading location…" : "Share my location for nearby answers"}
            </button>
          )}
        </div>
        {geoError && (
          <p role="alert" className="text-[0.76rem] font-semibold text-danger mt-1.5">{geoError}</p>
        )}
      </div>

      <div className="card-base p-6 sm:p-8 mt-5 text-center">
        <motion.button
          onClick={() => (liveNow ? interrupt() : start())}
          aria-label={liveNow ? "Interrupt" : "Start talking"}
          whileTap={{ scale: 0.94 }}
          className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center text-white shadow-card transition ${
            liveNow ? "bg-gradient-to-b from-healthcare to-navy" : "bg-gradient-to-b from-teal to-teal-dark"
          }`}
        >
          <Mic size={34} />
          {liveNow && (
            <motion.span
              className="absolute w-24 h-24 rounded-full border-2 border-healthcare"
              animate={{ scale: [1, 1.3], opacity: [0.6, 0] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              aria-hidden
            />
          )}
        </motion.button>

        <AnimatePresence mode="wait">
          <motion.p
            key={state}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="font-bold text-navy mt-4"
            role="status"
          >
            {muted ? "Muted" : STATUS_TEXT[state]}
          </motion.p>
        </AnimatePresence>

        <div className="mt-3">
          <VoiceVisualizer state={muted ? "idle" : state} />
        </div>

        <div className="flex justify-center gap-2 mt-4 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setMuted((v) => !v)}>
            {muted ? <><MicOff size={15} /> Unmute</> : <><Mic size={15} /> Mute</>}
          </Button>
          <Button variant="outline" size="sm" onClick={liveNow ? interrupt : start}>
            <Square size={15} /> {liveNow ? "Stop" : "Start"}
          </Button>
          {canGoLive && (
            <Button variant="ghost" size="sm" onClick={startDemo}>
              <RotateCcw size={15} /> Play demo turn
            </Button>
          )}
          {!canGoLive && (
            <Button variant="ghost" size="sm" onClick={() => { stop(); startDemo(); }}>
              <RotateCcw size={15} /> Restart
            </Button>
          )}
        </div>

        <div className="text-left mt-5 bg-background border border-border rounded-control p-4 min-h-[120px] space-y-2" aria-live="polite">
          {lines.length === 0 ? (
            <p className="text-sm text-ink-faint">
              {canGoLive ? "Nothing said yet. Tap Start for a live session." : "Nothing said yet. Tap Start to play a simulated voice turn."}
            </p>
          ) : (
            lines.map((l, i) => (
              <motion.p key={`${i}-${l}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[0.86rem] text-ink">
                {l}
              </motion.p>
            ))
          )}
        </div>

        <div className="flex justify-center gap-1.5 mt-4 flex-wrap" aria-label="Voice states">
          {(Object.keys(STATUS_TEXT) as VoiceState[]).map((s) => (
            <span key={s} className={`text-[0.7rem] font-bold rounded-full px-2 py-0.5 border ${state === s ? "bg-navy text-white border-navy" : "bg-white text-ink-faint border-border"}`}>
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
