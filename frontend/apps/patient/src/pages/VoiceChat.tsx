import { useState } from "react";
import { useWebRTCAudio } from "../voice/useWebRTCAudio";
import { restoreAccessToken } from "../api";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

/** Voice booking surface (dev). Needs mic access + a served backend. */
export default function VoiceChat() {
  const { state, events, error, connect, disconnect, interrupt } =
    useWebRTCAudio(API_BASE);
  const [authError, setAuthError] = useState<string | null>(null);

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

  return (
    <div className="card">
      <h2>Talk to book</h2>
      <p className="muted">
        The assistant hears you through the same scheduling tools as text chat.
        Say “stop” or press Interrupt to cut it off mid-reply.
      </p>
      <p>
        Status: <span className="pill">{state.replace("_", " ")}</span>
      </p>
      {(error ?? authError) && <p className="error">{error ?? authError}</p>}
      <div style={{ marginBottom: "1rem" }}>
        {state === "idle" || state === "ended" ? (
          <button className="btn btn-primary" type="button" onClick={() => void start()}>
            Start talking
          </button>
        ) : (
          <>
            <button className="btn" type="button" onClick={interrupt}>
              Interrupt
            </button>{" "}
            <button className="btn" type="button" onClick={disconnect}>
              Hang up
            </button>
          </>
        )}
      </div>
      <div className="chat-log">
        {finals.length === 0 && <p className="muted">Nothing said yet.</p>}
        {finals.map((event, i) => (
          <div
            key={i}
            className={`chat-bubble ${event.kind === "final" ? "me" : "agent"}`}
          >
            {event.text}
          </div>
        ))}
      </div>
    </div>
  );
}
