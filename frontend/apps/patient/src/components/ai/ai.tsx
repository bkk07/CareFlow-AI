import { motion } from "framer-motion";
import { Bot, CalendarCheck, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { ChatMessage } from "../../types";
import { formatSlotDate, formatSlotTime } from "../../lib/backend";
import { Button, SafeImage } from "../common/ui";

/** AI replies are markdown (+ LaTeX math); patient messages stay plain text. */
function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ ...props }) => (
            // eslint-disable-next-line jsx-a11y/anchor-has-content
            <a {...props} target="_blank" rel="noreferrer" className="underline" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function ChatBubble({ message, onSend }: { message: ChatMessage; onSend?: (text: string) => void }) {
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
          {isPatient ? message.text : <AssistantMarkdown text={message.text} />}
        </div>
        {message.doctors && message.doctors.length > 0 && (
          <div className="mt-2.5 space-y-2 text-left">
            {message.doctors.map((d) => (
              <LiveDoctorCard key={d.id} doctor={d} />
            ))}
          </div>
        )}
        {message.slots && message.slots.length > 0 && (
          <SlotChips slots={message.slots} onSend={onSend} />
        )}
        {message.pendingBooking && (
          <ConfirmPanel pending={message.pendingBooking} onSend={onSend} />
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

function LiveDoctorCard({
  doctor,
}: {
  doctor: NonNullable<ChatMessage["doctors"]>[number];
}) {
  const navigate = useNavigate();
  const where = [doctor.hospital_name, doctor.hospital_city]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="bg-white border border-border rounded-card p-3.5 shadow-subtle flex gap-3">
      <SafeImage
        src={doctor.photo_url ?? ""}
        alt={doctor.name}
        name={doctor.name}
        className="w-12 h-12 rounded-full border border-border shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-[0.88rem] text-ink">{doctor.name}</p>
        <p className="text-[0.78rem] text-ink-secondary">
          {doctor.specialty ?? "Physician"}
          {where ? ` · ${where}` : ""}
        </p>
        <Button
          size="sm"
          className="mt-2"
          onClick={() => navigate("/book", { state: { doctorId: doctor.id } })}
        >
          View availability
        </Button>
      </div>
    </div>
  );
}

function slotLabel(start: string, end: string): string {
  return `${formatSlotDate(start)} · ${formatSlotTime(start)} – ${formatSlotTime(end)}`;
}

/** Tappable offered slots. Tapping only sends a confirmation message —
 *  nothing books until the assistant confirms on the next turn. */
export function SlotChips({
  slots,
  onSend,
}: {
  slots: NonNullable<ChatMessage["slots"]>;
  onSend?: (text: string) => void;
}) {
  if (!onSend || slots.length === 0) return null;
  return (
    <div className="mt-2.5 text-left" aria-label="Suggested times">
      <p className="text-[0.75rem] font-bold text-ink-secondary mb-1.5">
        Tap a time to confirm it:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {slots.slice(0, 6).map((s) => {
          const label = slotLabel(s.start, s.end);
          return (
            <button
              key={s.start}
              type="button"
              onClick={() => onSend(`Yes, book ${label}`)}
              className="inline-flex items-center gap-1.5 text-[0.8rem] font-bold bg-white border border-healthcare/40 rounded-full px-3 py-1.5 text-navy hover:bg-healthcare-soft hover:border-healthcare transition"
            >
              <CalendarCheck size={14} className="text-healthcare" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Explicit yes/no for a pending proposal (book / move / cancel). */
export function ConfirmPanel({
  pending,
  onSend,
}: {
  pending: NonNullable<ChatMessage["pendingBooking"]>;
  onSend?: (text: string) => void;
}) {
  if (!onSend) return null;
  const slot =
    pending.slot_start != null
      ? slotLabel(pending.slot_start, pending.slot_end ?? pending.slot_start)
      : null;
  const copy =
    pending.kind === "reschedule"
      ? { title: "Confirm the move?", confirm: `Yes, move it${slot ? ` to ${slot}` : ""}`, confirmLabel: "Confirm move", cancelLabel: "Keep current" }
      : pending.kind === "cancel"
        ? { title: "Cancel this appointment?", confirm: "Yes, cancel it", confirmLabel: "Yes, cancel", cancelLabel: "Keep it" }
        : { title: "Confirm this booking?", confirm: `Yes, book ${slot ?? "it"}`, confirmLabel: "Confirm booking", cancelLabel: "Not now" };
  return (
    <div className="mt-2.5 text-left bg-healthcare-faint border border-healthcare/25 rounded-control p-3" aria-label="Confirm or decline">
      <p className="text-[0.83rem] font-bold text-navy">{copy.title}</p>
      {slot && pending.kind !== "cancel" && (
        <p className="text-[0.78rem] text-ink-secondary mt-0.5">{slot}</p>
      )}
      <div className="flex gap-2 mt-2">
        <Button size="sm" onClick={() => onSend(copy.confirm)}>
          {copy.confirmLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onSend("No, don't do that")}>
          {copy.cancelLabel}
        </Button>
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
