import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Navigation, Send, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { postChat } from "../api";
import type { BookingSelection } from "../api";
import { useAuth } from "../context/AuthContext";
import { ChatBubble, TypingIndicator } from "../components/ai/ai";
import { readPosition } from "../lib/helpers";
import type { ChatMessage } from "../types";

const CONV_KEY = "careflow_patient_conversation";

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
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      from: "ai",
      text: welcome,
      time: "Now",
    },
  ]);
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

  async function sendPrompt(text: string, selection?: BookingSelection | null) {
    const clean = text.trim();
    if (!clean || thinking) return;
    setMessages((prev) => [...prev, { id: `p-${Date.now()}`, from: "patient", text: clean, time: "Now" }]);
    setDraft("");
    setThinking(true);
    try {
      const conversationId = localStorage.getItem(CONV_KEY);
      // Live GPS wins for this message; otherwise the backend falls back
      // to the saved home location on your profile automatically.
      // A typed selection rides along so taps update the same canonical
      // state a spoken phrase would — the text stays for the transcript.
      const reply = await postChat(clean, conversationId, liveGeo, selection ?? null);
      try {
        localStorage.setItem(CONV_KEY, reply.conversation_id);
      } catch {
        /* private mode */
      }
      const suffix = reply.escalated ? "\n\nI've looped in our care team — someone will follow up with you shortly." : "";
      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`,
        from: "ai",
        text: reply.reply + suffix,
        time: "Now",
        doctors: reply.doctors ?? [],
        doctorsTotal: reply.doctors_total ?? 0,
        hasMoreDoctors: reply.has_more_doctors ?? false,
        slots: reply.slots ?? [],
        appointmentTypes: reply.appointment_types ?? [],
        consultationModes: reply.consultation_modes ?? [],
        daySchedule: reply.day_schedule ?? null,
        bookingStage: reply.booking_stage ?? "browse",
        pendingBooking: reply.pending_booking ?? null,
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

  function pickType(id: string, name: string, minutes: number) {
    setChosenType({ name, minutes });
    void sendPrompt(name, { type: "booking_selection", field: "appointment_type", value: id });
  }

  function pickMode(mode: string, label: string) {
    void sendPrompt(label, { type: "booking_selection", field: "consultation_mode", value: mode });
  }

  function sendSelection(text: string, selection: BookingSelection) {
    if (selection.field === "appointment_type") {
      const m = messages.flatMap((msg) => msg.appointmentTypes ?? []).find((t) => t.id === selection.value);
      if (m) setChosenType({ name: m.name, minutes: m.duration_minutes });
    }
    void sendPrompt(text, selection);
  }

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

      {/* Messages — full-bleed scroll area, centered column like ChatGPT */}
      <div className="flex-1 overflow-y-auto" aria-live="polite">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
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
          {messages.map((m) => (
            <ChatBubble
              key={m.id}
              message={m}
              onSend={(text) => void sendPrompt(text)}
              onSelect={(text, selection) => sendSelection(text, selection)}
              onPickType={(id, name, minutes) => pickType(id, name, minutes)}
              onPickMode={(mode, label) => pickMode(mode, label)}
              daySlotMinutes={chosenType?.minutes ?? null}
            />
          ))}
          {thinking && <TypingIndicator name="CareFlow is typing…" />}
          <div ref={bottomRef} />
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
