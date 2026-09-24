import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWebRTCAudio } from "../voice/useWebRTCAudio";
import { useSpeechSynthesis } from "../voice/useSpeechSynthesis";
import { restoreAccessToken } from "../api";
import { EASE, Page } from "../motion";
import { MicIcon } from "../icons";

const _viteApiUrl = import.meta.env.VITE_API_URL as string | undefined;
if (!_viteApiUrl && !import.meta.env.DEV) {
  throw new Error(
    "VITE_API_URL is not configured. Set it to the backend base URL (e.g. https://<backend-host>).",
  );
}
// Local development default (matches .env.example). Production builds
// must provide VITE_API_URL — see the check above.
const API_BASE = _viteApiUrl ?? "http://localhost:8000";

/** Voice booking surface. Needs mic access + a served backend. */
export default function VoiceChat() {
  const { state, events, error, connect, disconnect, interrupt } =
    useWebRTCAudio(API_BASE);
  const [authError, setAuthError] = useState<string | null>(null);
  // Browser-native speech for streamed agent sentences (queued in order).
  const { enqueue: enqueueSpeech, stop: stopSpeech } = useSpeechSynthesis();
  const spokenCountRef = useRef(0);

  // Speak each new agent sentence; "TTS failed" frames are benign now
  // (the browser speaks the text) and are never shown as errors.
  const ttsFailed = !!error && /tts failed/i.test(error);
  const shownError = (!error || ttsFailed ? null : error) ?? authError;
  useEffect(() => {
    const fresh = events.slice(spokenCountRef.current);
    spokenCountRef.current = events.length;
    for (const e of fresh) {
      if (e.kind === "agent_text" && e.text) enqueueSpeech(e.text);
      else if (e.kind === "unheard") enqueueSpeech("I couldn't quite catch that — please speak a little louder.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  function handleInterrupt() {
    // Barge-in stops browser speech too, not just server playback.
    stopSpeech();
    interrupt();
  }

  function handleHangUp() {
    stopSpeech();
    disconnect();
  }

  async function start() {
    setAuthError(null);
    const token = restoreAccessToken();
    if (!token) {
      setAuthError("No token found.");
      return;
    }
    await connect(token);
  }

  const finals = events.filter((e) => e.kind === "final" || e.kind === "agent_text");
  const live = state !== "idle" && state !== "ended";

  return (
    <Page>
      <div className="card" style={{ textAlign: "center" }}>
        <h2>Talk to book</h2>
        <p className="muted" style={{ maxWidth: 520, margin: "0 auto 1rem" }}>
          The assistant hears you through the same scheduling tools as text chat.
          Say “stop” or press Interrupt to cut it off mid-reply.
        </p>
        <p>
          Status:{" "}
          <motion.span
            key={state}
            className="pill"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
          >
            {state.replace("_", " ")}
          </motion.span>
        </p>
        <AnimatePresence>
          {(shownError) && (
            <motion.p
              className="error"
              style={{ textAlign: "left" }}
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: "1rem" }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            >
              {shownError}
            </motion.p>
          )}
        </AnimatePresence>
        <div style={{ margin: "1.25rem 0" }}>
          <AnimatePresence mode="wait">
            {!live ? (
              <motion.button
                key="mic-idle"
                className="mic-btn"
                type="button"
                aria-label="Start talking"
                onClick={() => void start()}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.3, ease: EASE }}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
              >
                <MicIcon size={30} />
              </motion.button>
            ) : (
              <motion.div
                key="mic-live"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <motion.div
                  className="mic-btn live"
                  aria-hidden
                  animate={{ scale: [1, 1.06, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                >
                  <MicIcon size={30} />
                  <motion.span
                    className="mic-ring"
                    animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                  />
                </motion.div>
                <div className="toolbar" style={{ justifyContent: "center" }}>
                  <motion.button
                    className="btn"
                    type="button"
                    onClick={handleInterrupt}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    Interrupt
                  </motion.button>
                  <motion.button
                    className="btn"
                    type="button"
                    onClick={handleHangUp}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    Hang up
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {!live ? "Tap the mic and start talking" : "Listening… tap Interrupt to cut in"}
          </p>
        </div>
        <div className="chat-log" style={{ textAlign: "left" }}>
          {finals.length === 0 && <p className="muted">Nothing said yet.</p>}
          <AnimatePresence initial={false}>
            {finals.map((event, i) => (
              <motion.div
                key={`${i}-${event.kind}`}
                className={`chat-bubble ${event.kind === "final" ? "me" : "agent"}`}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.28, ease: EASE }}
              >
                {event.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Page>
  );
}
