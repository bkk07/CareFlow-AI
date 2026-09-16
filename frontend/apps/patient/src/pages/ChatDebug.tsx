import { useState } from "react";
import { api, apiError } from "../api";

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

/** Plain text chat against POST /chat. Dev-only debug surface. */
export default function ChatDebug() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
    setTurns((prev) => [...prev, { from: "you", text: message }]);
    try {
      const { data } = await api.post<ChatReply>("/chat", {
        message,
        conversation_id: conversationId,
      });
      setConversationId(data.conversation_id);
      const suffix = data.escalated ? " (escalated to a human)" : "";
      setTurns((prev) => [...prev, { from: "agent", text: `${data.reply}${suffix}` }]);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Assistant chat</h2>
      <p className="muted">
        Book, reschedule, or ask scheduling questions in plain language. Try
        “I need a cardiologist this week”.
      </p>
      {conversationId && (
        <p className="muted">
          Conversation: <code>{conversationId.slice(0, 8)}</code>{" "}
          <button
            className="btn"
            type="button"
            onClick={() => {
              setConversationId(null);
              setTurns([]);
            }}
          >
            New conversation
          </button>
        </p>
      )}
      <div className="chat-log">
        {turns.length === 0 && <p className="muted">No messages yet.</p>}
        {turns.map((turn, i) => (
          <div key={i} className={`chat-bubble ${turn.from === "you" ? "me" : "agent"}`}>
            {turn.text}
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div>
        <input
          className="input"
          style={{ width: "24rem", maxWidth: "100%" }}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          placeholder="Type a message"
          disabled={busy}
        />
        <button className="btn btn-primary" type="button" onClick={() => void send()} disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
