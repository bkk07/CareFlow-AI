import { useState } from "react";
import { useWebRTCAudio } from "../voice/useWebRTCAudio";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

function storedToken(): string | null {
  return localStorage.getItem("careflow_patient_token");
}

/** Voice booking surface (dev). Needs mic access + a served backend. */
export default function VoiceChat() {
  const { state, events, error, connect, disconnect, interrupt } =
    useWebRTCAudio(API_BASE);
  const [authError, setAuthError] = useState<string | null>(null);

  if (!storedToken()) {
    return (
      <section>
        <h2>Voice (dev)</h2>
        <p>Sign in to talk with the scheduling assistant.</p>
      </section>
    );
  }

  async function start() {
    setAuthError(null);
    const token = storedToken();
    if (!token) {
      setAuthError("No token found.");
      return;
    }
    await connect(token);
  }

  const finals = events.filter((e) => e.kind === "final" || e.kind === "agent_text");

  return (
    <section>
      <h2>Voice (dev)</h2>
      <p style={{ color: "#666" }}>
        Talk to book — the assistant hears you through the same scheduling
        tools as text chat. Say &ldquo;stop&rdquo; or press Interrupt to cut
        it off mid-reply.
      </p>
      <p>
        Status: <strong>{state}</strong>
      </p>
      {(error ?? authError) && (
        <p style={{ color: "red" }}>{error ?? authError}</p>
      )}
      <div style={{ marginBottom: "1rem" }}>
        {state === "idle" || state === "ended" ? (
          <button type="button" onClick={() => void start()}>
            Start talking
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={interrupt}
              style={{ marginRight: "0.5rem" }}
            >
              Interrupt
            </button>
            <button type="button" onClick={disconnect}>
              Hang up
            </button>
          </>
        )}
      </div>
      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: "4px",
          padding: "1rem",
          minHeight: "8rem",
        }}
      >
        {finals.length === 0 && (
          <p style={{ color: "#999" }}>Nothing said yet.</p>
        )}
        {finals.map((event, i) => (
          <p key={i}>
            <strong>{event.kind === "final" ? "You" : "Assistant"}:</strong>{" "}
            {event.text}
          </p>
        ))}
      </div>
    </section>
  );
}
