import { useState } from "react";
import axios from "axios";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

interface Turn {
  from: "you" | "agent";
  text: string;
}

interface ChatReply {
  conversation_id: string;
  reply: string;
  iterations: number;
  escalated: boolean;
}

function storedToken(): string | null {
  return localStorage.getItem("careflow_patient_token");
}

function authHeaders() {
  return { Authorization: `Bearer ${storedToken()}` };
}

/** Plain text chat against POST /chat. Dev-only debug surface. */
export default function ChatDebug() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!storedToken()) {
    return (
      <section>
        <h2>Chat (debug)</h2>
        <p>Sign in to chat with the scheduling assistant.</p>
      </section>
    );
  }

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
    setTurns((prev) => [...prev, { from: "you", text: message }]);
    try {
      const { data } = await axios.post<ChatReply>(
        `${API_BASE}/chat`,
        { message, conversation_id: conversationId },
        { headers: authHeaders() },
      );
      setConversationId(data.conversation_id);
      const suffix = data.escalated ? " (escalated to a human)" : "";
      setTurns((prev) => [
        ...prev,
        { from: "agent", text: `${data.reply}${suffix}` },
      ]);
    } catch (err) {
      const detail =
        axios.isAxiosError(err) && err.response
          ? `${err.response.status}: ${JSON.stringify(err.response.data)}`
          : "Could not reach the assistant.";
      setError(detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Chat (debug)</h2>
      <p style={{ color: "#666" }}>
        Dev-only text chat with the scheduling assistant. Try &ldquo;I need a
        cardiologist this week&rdquo;.
      </p>
      {conversationId && (
        <p style={{ color: "#666" }}>
          Conversation: <code>{conversationId}</code>{" "}
          <button type="button" onClick={() => {
            setConversationId(null);
            setTurns([]);
          }}>
            New conversation
          </button>
        </p>
      )}
      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: "4px",
          padding: "1rem",
          minHeight: "12rem",
          marginBottom: "1rem",
        }}
      >
        {turns.length === 0 && <p style={{ color: "#999" }}>No messages yet.</p>}
        {turns.map((turn, i) => (
          <p key={i}>
            <strong>{turn.from === "you" ? "You" : "Assistant"}:</strong>{" "}
            {turn.text}
          </p>
        ))}
      </div>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          placeholder="Type a message"
          style={{ width: "24rem", marginRight: "0.5rem" }}
          disabled={busy}
        />
        <button type="button" onClick={() => void send()} disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </section>
  );
}
