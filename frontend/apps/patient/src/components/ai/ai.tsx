import { motion } from "framer-motion";
import { Bot, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DOCTORS } from "../../mock/data";
import type { ChatMessage } from "../../types";
import { Button, SafeImage } from "../common/ui";

export function ChatBubble({ message }: { message: ChatMessage }) {
  const isPatient = message.from === "patient";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex gap-2.5 ${isPatient ? "flex-row-reverse" : ""}`}
    >
      <span
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
          isPatient ? "bg-navy text-white border-navy" : "bg-teal-soft text-teal-dark border-teal/20"
        }`}
        aria-hidden
      >
        {isPatient ? <User size={15} /> : <Bot size={15} />}
      </span>
      <div className={`max-w-[82%] sm:max-w-[75%] ${isPatient ? "text-right" : ""}`}>
        <div
          className={`inline-block text-left px-4 py-2.5 rounded-2xl text-[0.9rem] leading-relaxed ${
            isPatient
              ? "bg-navy text-white rounded-br-md"
              : "bg-white border border-border shadow-subtle rounded-bl-md"
          }`}
        >
          {message.text}
        </div>
        {message.cards && message.cards.length > 0 && (
          <div className="mt-2.5 space-y-2 text-left">
            {message.cards.map((c, i) => {
              if (c.kind === "doctor") {
                const d = DOCTORS.find((x) => x.id === c.doctorId);
                if (!d) return null;
                return <DoctorResultCard key={i} doctorId={d.id} />;
              }
              return <AvailabilityCard key={i} doctorId={c.doctorId} />;
            })}
          </div>
        )}
        <p className="text-[0.7rem] text-ink-faint mt-1">{message.time}</p>
      </div>
    </motion.div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex gap-2.5" aria-label="Assistant is typing">
      <span className="w-8 h-8 rounded-full bg-teal-soft text-teal-dark border border-teal/20 flex items-center justify-center">
        <Bot size={15} />
      </span>
      <div className="bg-white border border-border rounded-2xl rounded-bl-md px-4 py-3 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-ink-faint"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </div>
  );
}

function DoctorResultCard({ doctorId }: { doctorId: string }) {
  const navigate = useNavigate();
  const d = DOCTORS.find((x) => x.id === doctorId)!;
  return (
    <div className="bg-white border border-border rounded-card p-3.5 shadow-subtle flex gap-3">
      <SafeImage src={d.photo} alt={d.name} name={d.name} className="w-12 h-12 rounded-full border border-border shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-[0.88rem] text-ink">{d.name}</p>
        <p className="text-[0.78rem] text-ink-secondary">{d.specialty} · {d.hospitalName}</p>
        <p className="text-[0.78rem] font-semibold text-success mt-0.5">{d.nextAvailable}</p>
        <Button size="sm" className="mt-2" onClick={() => navigate("/book", { state: { doctorId: d.id } })}>
          Select
        </Button>
      </div>
    </div>
  );
}

function AvailabilityCard({ doctorId }: { doctorId: string }) {
  const navigate = useNavigate();
  const d = DOCTORS.find((x) => x.id === doctorId)!;
  const slots = ["Tomorrow · 2:30 PM", "Tomorrow · 4:30 PM", "Fri · 10:00 AM"];
  return (
    <div className="bg-white border border-border rounded-card p-3.5 shadow-subtle">
      <p className="font-bold text-[0.88rem] text-ink">Available appointments found</p>
      <p className="text-[0.78rem] text-ink-secondary">{d.name} · {d.hospitalName}</p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {slots.map((s) => (
          <button
            key={s}
            onClick={() => navigate("/book", { state: { doctorId: d.id } })}
            className="text-[0.78rem] font-semibold border border-healthcare/30 rounded-full px-2.5 py-1 hover:bg-healthcare-soft hover:border-healthcare transition"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VoiceVisualizer({ state }: { state: string }) {
  const active = ["listening", "speaking", "thinking"].includes(state);
  return (
    <div className="flex items-end justify-center gap-1.5 h-12" aria-hidden>
      {Array.from({ length: 24 }).map((_, i) => (
        <span
          key={i}
          className={`w-1 rounded-full ${active ? "bg-healthcare voice-bar" : "bg-border"}`}
          style={{
            height: active ? `${18 + ((i * 37) % 30)}px` : "8px",
            animationDelay: `${(i % 12) * 0.09}s`,
            animationPlayState: active ? "running" : "paused",
          }}
        />
      ))}
    </div>
  );
}
