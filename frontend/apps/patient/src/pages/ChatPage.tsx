import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, Send, ShieldCheck, WifiOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { AI_EXAMPLE_PROMPTS, DOCTORS } from "../mock/data";
import { mockDelay } from "../mock/services";
import { postChat } from "../api";
import { useAppState } from "../context/AppStateContext";
import { ChatBubble, TypingIndicator } from "../components/ai/ai";
import { Button } from "../components/common/ui";
import type { ChatMessage } from "../types";

const CONV_KEY = "careflow_patient_conversation";

function scriptedReply(input: string): { text: string; cards?: ChatMessage["cards"] } {
  const q = input.toLowerCase();
  if (q.includes("cardio")) {
    return {
      text: "I can help you find available cardiology appointments. Which hospital or location would you prefer? Here are two options with availability this week:",
      cards: [{ kind: "doctor", doctorId: "d1" }, { kind: "availability", doctorId: "d1" }],
    };
  }
  if (q.includes("dermat")) {
    return {
      text: "Here is a dermatology option with availability today. Select it to check times:",
      cards: [{ kind: "doctor", doctorId: "d2" }],
    };
  }
  if (q.includes("sarah") || q.includes("follow")) {
    return {
      text: "I found Dr. Sarah Johnson (Cardiology, City General Hospital). Her next opening is tomorrow at 4:30 PM. Would you like to see her availability?",
      cards: [{ kind: "availability", doctorId: "d1" }],
    };
  }
  if (q.includes("appointment") && (q.includes("have") || q.includes("my") || q.includes("what"))) {
    return {
      text: "You have 2 upcoming visits: Cardiology with Dr. Sarah Johnson on Thu, Sep 24 at 4:30 PM (Confirmed), and a video visit with Dr. Priya Nair on Mon, Sep 28 at 10:00 AM (Pending). You can manage them under Appointments.",
    };
  }
  if (q.includes("pediatr") || q.includes("child")) {
    return {
      text: "For pediatrics, Dr. Priya Nair at Riverside Medical Center has openings tomorrow at 10:00 AM:",
      cards: [{ kind: "doctor", doctorId: "d3" }],
    };
  }
  return {
    text: "I can help with appointments, doctors, hospitals, questionnaires, and other administrative tasks. Could you tell me the specialty you need and your preferred days? For example, try “I need a cardiologist this week”.",
    cards: [
      { kind: "doctor", doctorId: DOCTORS[0].id },
      { kind: "doctor", doctorId: DOCTORS[1].id },
    ],
  };
}

export default function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { live } = useAppState();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      from: "ai",
      text: "Hi, I'm CareFlow AI — your healthcare scheduling assistant. Tell me what kind of care you're looking for and I'll find options.",
      time: "Now",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [degraded, setDegraded] = useState(false);
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

  async function sendPrompt(text: string) {
    const clean = text.trim();
    if (!clean || thinking) return;
    setMessages((prev) => [...prev, { id: `p-${Date.now()}`, from: "patient", text: clean, time: "Now" }]);
    setDraft("");
    setThinking(true);
    // Live path: real assistant turn (books, checks availability, escalates).
    if (live) {
      try {
        const conversationId = localStorage.getItem(CONV_KEY);
        const reply = await postChat(clean, conversationId);
        try {
          localStorage.setItem(CONV_KEY, reply.conversation_id);
        } catch {
          /* private mode */
        }
        const suffix = reply.escalated ? "\n\nI've flagged this for the care team to follow up." : "";
        setMessages((prev) => [...prev, { id: `a-${Date.now()}`, from: "ai", text: reply.reply + suffix, time: "Now" }]);
        setThinking(false);
        return;
      } catch {
        // AI unavailable (no model key, offline): fall through to scripted demo.
        setDegraded(true);
      }
    }
    await mockDelay(null, 1100);
    const reply = scriptedReply(clean);
    setMessages((prev) => [...prev, { id: `a-${Date.now()}`, from: "ai", text: reply.text, time: "Now", cards: reply.cards }]);
    setThinking(false);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="card-base overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-gradient-to-r from-navy to-healthcare text-white">
          <h1 className="font-extrabold">CareFlow AI</h1>
          <p className="text-white/85 text-[0.83rem]">Healthcare scheduling assistant{live && !degraded ? " · live" : " · demo"}</p>
        </div>
        <div className="px-4 py-3 bg-healthcare-faint border-b border-healthcare/15 flex items-start gap-2 text-[0.8rem] text-navy">
          <ShieldCheck size={15} className="shrink-0 mt-0.5 text-healthcare" />
          I can help with appointments, doctors, hospitals, questionnaires, and other administrative tasks.
        </div>
        {degraded && (
          <p className="px-4 py-2.5 bg-warning-soft border-b border-warning/25 flex items-start gap-2 text-[0.78rem] text-ink font-medium">
            <WifiOff size={14} className="shrink-0 mt-0.5" />
            Live assistant unavailable right now — showing demo replies.
          </p>
        )}

        <div className="px-4 sm:px-5 py-5 space-y-4 min-h-[380px] max-h-[56vh] overflow-y-auto bg-background/50" aria-live="polite">
          {messages.map((m) => (
            <ChatBubble key={m.id} message={m} />
          ))}
          {thinking && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        <div className="px-4 py-3 border-t border-border">
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {AI_EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => void sendPrompt(p)}
                className="text-[0.76rem] font-medium border border-border rounded-full px-2.5 py-1 text-ink-secondary hover:border-healthcare hover:text-healthcare transition"
              >
                {p}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendPrompt(draft);
            }}
            className="flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about appointments, doctors, availability…"
              aria-label="Message CareFlow AI"
              className="input-base flex-1"
            />
            <button
              type="button"
              aria-label="Voice input"
              onClick={() => navigate("/voice")}
              className="w-11 h-11 rounded-control border border-border flex items-center justify-center text-healthcare hover:border-healthcare shrink-0"
            >
              <Mic size={18} />
            </button>
            <Button type="submit" disabled={!draft.trim() || thinking} aria-label="Send message">
              <Send size={16} />
            </Button>
          </form>
        </div>
      </div>

      <AnimatePresence>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-[0.75rem] text-ink-faint mt-3">
          CareFlow AI helps with scheduling and admin only — never diagnosis or treatment advice.
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
