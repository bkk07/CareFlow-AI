import { useEffect, useMemo, useRef, useState } from "react";
import { History, Mic, Navigation, Plus, Send, Trash2, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { postChat } from "../api";
import type { BookingSelection, ChatActionRequest } from "../api";
import { useAuth } from "../context/AuthContext";
import { ChatBubble, TypingIndicator } from "../components/ai/ai";
import { readPosition } from "../lib/helpers";
import {
  ACTIVE_CONV_KEY,
  deleteChat,
  getActiveConversationId,
  listChats,
  loadChatMessages,
  saveChatMessages,
  type StoredChat,
} from "../lib/chatHistory";
import type { ChatMessage } from "../types";

const AI_EXAMPLE_PROMPTS = [
  "I need a cardiologist this week",
  "Something nearby, please",
  "What appointments do I have?",
];

function greetingFor(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const first = name.trim().split(/\s+/)[0];
  return first
    ? `Good ${part}, ${first} — I'm CareFlow, your care coordinator. Tell me what's going on and I'll line up the right doctor close to you.`
    : `Good ${part} — I'm CareFlow, your care coordinator. Tell me what kind of care you're looking for and I'll find options near you.`;
}

export default function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { patient, contact } = useAuth();
  const welcome = useMemo(() => greetingFor(patient.name || contact?.full_name || ""), [patient.name, contact?.full_name]);
  // Active backend conversation id (null until the first reply mints one).
  const [conversationId, setConversationId] = useState<string | null>(() => getActiveConversationId());
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const active = getActiveConversationId();
    if (active) {
      const stored = loadChatMessages(active);
      if (stored) return stored;
    }
    return [{ id: "welcome", from: "ai", text: greetingFor(""), time: "Now" }];
  });
  // Once the profile loads, personalize the untouched welcome message.
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].id === "welcome") {
        return [{ ...prev[0], text: welcome }];
      }
      return prev;
    });
  }, [welcome]);
  const [history, setHistory] = useState<StoredChat[]>(() => listChats());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [staleNotice, setStaleNotice] = useState(false);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [liveGeo, setLiveGeo] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  // Guided booking state: the patient's visit-type pick (powers slot
  // coloring). The day strip renders inside the assistant message itself
  // (only at the date step), driven by each message's bookingStage.
  const [chosenType, setChosenType] = useState<{ name: string; minutes: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    const prompt = (location.state as { prompt?: string } | null)?.prompt;
    if (prompt) {
      void sendPrompt(prompt);
      window.history.replaceState({}, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savedGeo =
    contact?.latitude != null && contact?.longitude != null
      ? { latitude: contact.latitude, longitude: contact.longitude }
      : null;

  async function shareLiveLocation() {
    setLocating(true);
    setGeoError(null);
    try {
      const g = await readPosition();
      setLiveGeo({ latitude: g.latitude, longitude: g.longitude });
    } catch (err) {
      setGeoError(err instanceof Error ? err.message : "Could not read your location.");
    } finally {
      setLocating(false);
    }
  }

  // Persist the active transcript so reloads keep the thread.
  useEffect(() => {
    if (conversationId && messages.length > 0) {
      saveChatMessages(conversationId, messages);
      setHistory(listChats());
    }
  }, [messages, conversationId]);

  function newChat() {
    setThinking(false);
    setDraft("");
    setConversationId(null);
    try {
      localStorage.removeItem(ACTIVE_CONV_KEY);
    } catch {
      /* private mode */
    }
    setMessages([{ id: "welcome", from: "ai", text: welcome, time: "Now" }]);
    setHistory(listChats());
    setHistoryOpen(false);
  }

  function openChat(id: string) {
    const stored = loadChatMessages(id);
    if (!stored) return;
    setThinking(false);
    setConversationId(id);
    try {
      localStorage.setItem(ACTIVE_CONV_KEY, id);
    } catch {
      /* private mode */
    }
    setMessages(stored);
    setHistoryOpen(false);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }));
  }

  function removeChat(id: string) {
    deleteChat(id);
    if (id === conversationId) {
      newChat();
    } else {
      setHistory(listChats());
    }
  }

  async function sendPrompt(text: string, selection?: BookingSelection | null) {
    const clean = text.trim();
    if (!clean || thinking) return;
    setMessages((prev) => [...prev, { id: `p-${Date.now()}`, from: "patient", text: clean, time: "Now" }]);
    setDraft("");
    setThinking(true);
    try {
      // Live GPS wins for this message; otherwise the backend falls back
      // to the saved home location on your profile automatically.
      // A typed selection rides along so taps update the same canonical
      // state a spoken phrase would — the text stays for the transcript.
      const reply = await postChat(clean, conversationId, liveGeo, selection ?? null);
      setConversationId(reply.conversation_id);
      try {
        localStorage.setItem(ACTIVE_CONV_KEY, reply.conversation_id);
      } catch {
        /* private mode */
      }
      const suffix = reply.escalated ? "\n\nI've looped in our care team — someone will follow up with you shortly." : "";
      const fullReply = reply.reply + suffix;
      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`,
        from: "ai",
        text: fullReply,
        time: "Now",
        messageId: reply.message_id ?? null,
        stateRevision: reply.state_revision ?? null,
        doctors: reply.doctors ?? [],
        doctorsTotal: reply.doctors_total ?? 0,
        hasMoreDoctors: reply.has_more_doctors ?? false,
        slots: reply.slots ?? [],
        appointmentTypes: reply.appointment_types ?? [],
        consultationModes: reply.consultation_modes ?? [],
        daySchedule: reply.day_schedule ?? null,
        bookingStage: reply.booking_stage ?? "browse",
        pendingBooking: reply.pending_booking ?? null,
        bookingSummary: (reply.booking_summary ?? null) as ChatMessage["bookingSummary"],
        surface: reply.surface ?? "TEXT",
        title: reply.title ?? null,
        allowExploreMore: reply.allow_explore_more ?? false,
        allowCompare: reply.allow_compare ?? false,
        intent: reply.intent ?? null,
        stage: reply.stage ?? null,
        careContext: (reply.care_context ?? null) as ChatMessage["careContext"],
        quickReplies: reply.quick_replies ?? [],
        compare: (reply.compare ?? null) as ChatMessage["compare"],
        filterChoices: reply.filter_choices ?? [],
        actions: reply.actions ?? [],
        upcomingAppointment: (reply.upcoming_appointment ?? null) as ChatMessage["upcomingAppointment"],
      }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, from: "ai", text: "Sorry about that — I'm having a moment. Could you try again?", time: "Now" },
      ]);
    } finally {
      setThinking(false);
    }
  }

  const isFresh = messages.length <= 1;

  /** Central chat-action dispatcher (P4/P10): every interactive widget
   *  tap arrives here with full widget identity. Before applying:
   *  1. verify the message is still the latest assistant message,
   *  2. verify its stateRevision is current,
   *  3. verify nothing is thinking (avoid overlapping turns).
   *  Stale taps are REFUSED with a user-friendly notice — never applied
   *  silently. Returns true when the action was dispatched. */
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashStaleNotice() {
    setStaleNotice(true);
    if (staleTimer.current) clearTimeout(staleTimer.current);
    staleTimer.current = setTimeout(() => setStaleNotice(false), 4500);
  }

  function handleChatAction(req: ChatActionRequest): boolean {
    const latestAi = [...messages].reverse().find((m) => m.from === "ai" && !m.id.startsWith("e-"));
    if (!latestAi || (latestAi.messageId && req.messageId !== latestAi.messageId)) {
      flashStaleNotice();
      return false;
    }
    if (
      req.stateRevision != null &&
      latestAi.stateRevision != null &&
      req.stateRevision < latestAi.stateRevision
    ) {
      flashStaleNotice();
      return false;
    }
    if (thinking) return false;
    let selection: BookingSelection | null = null;
    if (req.selection) {
      selection = {
        ...req.selection,
        message_id: req.messageId,
        state_revision: req.stateRevision ?? null,
        widget_id: req.widgetId,
      };
      if (selection.field === "appointment_type") {
        const m = messages.flatMap((msg) => msg.appointmentTypes ?? []).find((t) => t.id === selection!.value);
        if (m) setChosenType({ name: m.name, minutes: m.duration_minutes });
      }
    }
    void sendPrompt(req.text, selection);
    return true;
  }

  // Latest content-bearing assistant message owns the active widgets.
  const activeAiId = [...messages].reverse().find((m) => m.from === "ai" && !m.id.startsWith("e-"))?.id;

  return (
    <div className="flex flex-col h-[calc(100dvh-64px)]">
      {/* Slim header — no card, just a divider row */}
      <div className="shrink-0 border-b border-border/70">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-2.5">
          <span className="relative w-8 h-8 rounded-full bg-gradient-to-br from-healthcare to-teal text-white flex items-center justify-center text-[0.85rem] font-extrabold shrink-0" aria-hidden>
            C
            <span className="absolute -bottom-0 -right-0 w-2.5 h-2.5 rounded-full bg-success border-2 border-background" title="Online" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-navy text-[0.9rem] leading-tight truncate">CareFlow</p>
            <p className="text-ink-faint text-[0.72rem] leading-tight">Online · remembers your profile &amp; location</p>
          </div>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            title="Chat history"
            aria-label="Chat history"
            aria-pressed={historyOpen}
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-secondary hover:text-healthcare hover:bg-background transition shrink-0"
          >
            <History size={16} />
          </button>
          <button
            onClick={newChat}
            title="Start a new chat"
            aria-label="Start a new chat"
            className="inline-flex items-center gap-1 text-[0.72rem] font-bold text-navy bg-background border border-border rounded-full px-2.5 py-1.5 hover:border-healthcare hover:text-healthcare transition shrink-0"
          >
            <Plus size={13} /> New chat
          </button>
          {liveGeo ? (
            <span className="inline-flex items-center gap-1.5 text-[0.72rem] font-bold text-teal-dark bg-teal-soft/70 border border-teal/25 rounded-full pl-2.5 pr-1.5 py-1">
              📍 {liveGeo.latitude.toFixed(2)}, {liveGeo.longitude.toFixed(2)}
              <button
                onClick={() => setLiveGeo(null)}
                aria-label="Clear live location"
                className="w-5 h-5 rounded-full hover:bg-white/70 flex items-center justify-center"
              >
                <X size={12} />
              </button>
            </span>
          ) : savedGeo ? (
            <button
              onClick={() => navigate("/profile")}
              title="Home location saved — tap to change in Profile"
              className="inline-flex items-center gap-1 text-[0.72rem] font-bold text-navy bg-background border border-border rounded-full px-2.5 py-1 hover:border-healthcare hover:text-healthcare transition"
            >
              📍 Home set
            </button>
          ) : (
            <button
              onClick={() => void shareLiveLocation()}
              disabled={locating}
              className="inline-flex items-center gap-1 text-[0.72rem] font-bold text-healthcare hover:underline disabled:opacity-60"
            >
              <Navigation size={12} /> {locating ? "Locating…" : "Use my location"}
            </button>
          )}
        </div>
        {geoError && (
          <p role="alert" className="text-center text-[0.72rem] font-semibold text-danger pb-1.5 px-4">
            {geoError}
          </p>
        )}
      </div>

      {/* Messages + persistent care-context panel (ChatShell) */}
      <div className="flex-1 overflow-y-auto relative" aria-live="polite">
        {/* Conversation history sidebar */}
        {historyOpen && (
          <div
            className="absolute inset-y-0 left-0 z-20 w-72 max-w-[85%] bg-white border-r border-border shadow-card flex flex-col"
            role="dialog"
            aria-label="Chat history"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="font-bold text-navy text-[0.88rem]">Chat history</p>
              <button
                onClick={() => setHistoryOpen(false)}
                aria-label="Close chat history"
                className="w-7 h-7 rounded-full flex items-center justify-center text-ink-faint hover:text-healthcare hover:bg-background transition"
              >
                <X size={15} />
              </button>
            </div>
            <div className="p-3 border-b border-border">
              <button
                onClick={newChat}
                className="w-full inline-flex items-center justify-center gap-1.5 text-[0.82rem] font-bold bg-navy text-white rounded-control px-3 py-2 hover:bg-healthcare transition"
              >
                <Plus size={14} /> New chat
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {history.length === 0 && (
                <p className="text-[0.8rem] text-ink-faint px-3 py-4 text-center">
                  No saved chats yet — your conversations will appear here.
                </p>
              )}
              {history.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1 rounded-control px-2 py-2 transition ${
                    c.id === conversationId ? "bg-healthcare-faint border border-healthcare/30" : "hover:bg-background border border-transparent"
                  }`}
                >
                  <button
                    onClick={() => openChat(c.id)}
                    className="flex-1 min-w-0 text-left"
                    title={c.title}
                  >
                    <span className="block text-[0.82rem] font-semibold text-navy truncate">{c.title}</span>
                    <span className="block text-[0.7rem] text-ink-faint">
                      {new Date(c.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {" · "}
                      {new Date(c.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </button>
                  <button
                    onClick={() => removeChat(c.id)}
                    title="Delete this chat"
                    aria-label={`Delete chat: ${c.title}`}
                    className="w-7 h-7 rounded-full hidden group-hover:flex items-center justify-center text-ink-faint hover:text-danger hover:bg-background transition shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex gap-6 items-start">
          <div className="flex-1 min-w-0 space-y-6">
          {savedGeo && !liveGeo && (
            <p className="text-center text-[0.72rem] text-ink-faint">
              Ranking nearby care by your saved location ·{" "}
              <button onClick={() => void shareLiveLocation()} disabled={locating} className="font-bold text-healthcare hover:underline disabled:opacity-60">
                {locating ? "reading…" : "use live location instead"}
              </button>
            </p>
          )}
          {!savedGeo && !liveGeo && (
            <p className="text-center text-[0.72rem] text-ink-faint">
              Tip:{" "}
              <button onClick={() => navigate("/profile")} className="font-bold text-healthcare hover:underline">
                save your location in Profile
              </button>{" "}
              for exact nearby results.
            </p>
          )}
          {staleNotice && (
            <p role="alert" className="text-center text-[0.76rem] font-semibold text-navy bg-healthcare-faint border border-healthcare/30 rounded-control px-3 py-2">
              That selection is from an earlier step — it wasn&apos;t changed. Please use the latest message below.
            </p>
          )}
          {messages.map((m) => (
            <ChatBubble
              key={m.id}
              message={m}
              active={m.from !== "ai" || m.id === activeAiId}
              onAction={(widgetId, action, text, selection) =>
                handleChatAction({
                  messageId: m.messageId ?? m.id,
                  widgetId,
                  action,
                  text,
                  selection: selection ?? null,
                  stateRevision: m.stateRevision ?? null,
                })
              }
              onSend={(text) => void sendPrompt(text)}
              daySlotMinutes={chosenType?.minutes ?? null}
            />
          ))}
          {thinking && <TypingIndicator name="CareFlow is typing…" />}
          <div ref={bottomRef} />
          </div>
        </div>
      </div>

      {/* Composer — sticky bottom, centered, ChatGPT-style pill */}
      <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-4 sm:px-6 pt-2 pb-[72px] md:pb-1">
        <div className="max-w-3xl mx-auto">
          {isFresh && !thinking && (
            <div className="flex gap-1.5 overflow-x-auto pb-2.5" aria-label="Suggested messages">
              {AI_EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => void sendPrompt(p)}
                  className="shrink-0 text-[0.76rem] font-medium border border-border bg-white rounded-full px-3 py-1.5 text-ink-secondary hover:border-healthcare hover:text-healthcare transition"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendPrompt(draft);
            }}
            className="flex items-center gap-1.5 rounded-[26px] border border-border bg-white pl-5 pr-2 py-2 shadow-subtle focus-within:border-healthcare focus-within:ring-2 focus-within:ring-healthcare/15 transition"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message CareFlow…"
              aria-label="Message CareFlow"
              className="flex-1 min-w-0 bg-transparent outline-none text-[0.93rem] py-1.5 placeholder:text-ink-faint"
            />
            <button
              type="button"
              aria-label="Voice input"
              onClick={() => navigate("/voice")}
              className="w-9 h-9 rounded-full flex items-center justify-center text-ink-faint hover:text-healthcare hover:bg-background transition shrink-0"
            >
              <Mic size={17} />
            </button>
            <button
              type="submit"
              disabled={!draft.trim() || thinking}
              aria-label="Send message"
              className="w-9 h-9 rounded-full bg-navy text-white flex items-center justify-center hover:bg-healthcare transition shrink-0 disabled:opacity-30 disabled:hover:bg-navy"
            >
              <Send size={15} />
            </button>
          </form>
          <p className="text-center text-[0.7rem] text-ink-faint pt-1.5">
            CareFlow helps with scheduling and admin only — never diagnosis or treatment advice.
          </p>
        </div>
      </div>
    </div>
  );
}
