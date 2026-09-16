import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, apiError } from "../api";
import { EASE, Page } from "../motion";

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

/** Plain text chat against POST /chat. */
export default function ChatDebug() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

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
    <Page>
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
              className="btn btn-sm"
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
        <div className="chat-log" ref={logRef}>
          {turns.length === 0 && !busy && <p className="muted">No messages yet.</p>}
          <AnimatePresence initial={false}>
            {turns.map((turn, i) => (
              <motion.div
                key={`${i}-${turn.from}`}
                className={`chat-bubble ${turn.from === "you" ? "me" : "agent"}`}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.28, ease: EASE }}
              >
                <span className="who">{turn.from === "you" ? "You" : "Assistant"}</span>
                {turn.text}
              </motion.div>
            ))}
            {busy && (
              <motion.div
                key="typing"
                className="chat-bubble agent"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <span className="typing" aria-label="Assistant is typing">
                  <i />
                  <i />
                  <i />
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {error && (
            <motion.p
              className="error"
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: "1rem" }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
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
          <motion.button
            className="btn btn-primary"
            type="button"
            onClick={() => void send()}
            disabled={busy}
            whileHover={busy ? undefined : { scale: 1.04 }}
            whileTap={busy ? undefined : { scale: 0.96 }}
          >
            {busy ? (
              <>
                <span className="spinner" aria-hidden /> Sending…
              </>
            ) : (
              "Send"
            )}
          </motion.button>
        </div>
      </div>
    </Page>
  );
}
