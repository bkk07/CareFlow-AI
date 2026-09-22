import { motion } from "framer-motion";
import { Building2, CalendarCheck, Phone, User, Video } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { ChatMessage } from "../../types";
import type { BookingSelection } from "../../api";
import { formatSlotDate, formatSlotTime } from "../../lib/backend";
import { doctorImage } from "../../lib/images";
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

export function ChatBubble({ message, onSend, onSelect, onPickType, onPickMode, daySlotMinutes }: {
  message: ChatMessage;
  onSend?: (text: string) => void;
  /** Typed tap: text for the transcript + selection for canonical state. */
  onSelect?: (text: string, selection: BookingSelection) => void;
  /** Visit-type tap: records minutes for slot coloring, then sends the name. */
  onPickType?: (id: string, name: string, minutes: number) => void;
  /** How-to-meet tap: sends the mode label for the assistant to record. */
  onPickMode?: (mode: string, label: string) => void;
  /** Chosen visit length — day slots that can't fit it render taken. */
  daySlotMinutes?: number | null;
}) {
  const send = (text: string, selection?: BookingSelection) => {
    if (selection && onSelect) onSelect(text, selection);
    else onSend?.(text);
  };
  const isPatient = message.from === "patient";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex gap-2.5 ${isPatient ? "flex-row-reverse" : ""}`}
    >
      <span
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border text-[0.8rem] font-extrabold ${
          isPatient ? "bg-navy text-white border-navy" : "bg-gradient-to-br from-healthcare to-teal text-white border-healthcare/30"
        }`}
        aria-hidden
      >
        {isPatient ? <User size={15} /> : "C"}
      </span>
      <div className={`min-w-0 flex-1 ${isPatient ? "flex flex-col items-end" : ""}`}>
        {isPatient ? (
          <div className="inline-block max-w-[85%] sm:max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-md text-[0.9rem] leading-relaxed bg-navy text-white">
            {message.text}
          </div>
        ) : (
          <div className="text-[0.93rem] leading-relaxed text-ink">
            <AssistantMarkdown text={message.text} />
          </div>
        )}
        {message.careContext && !isPatient && (
          <CareContextCard context={message.careContext} onSend={onSend} />
        )}
        {message.doctors && message.doctors.length > 0 && (
          <div className="mt-2.5 space-y-2 text-left">
            {message.title && (
              <p className="text-[0.8rem] font-bold text-navy">{message.title}</p>
            )}
            {message.doctors.map((d) => (
              <LiveDoctorCard key={d.id} doctor={d} onSelect={send} />
            ))}
            {message.allowCompare && message.doctors.length > 1 && (
              <button
                type="button"
                onClick={() => onSend?.("Compare them")}
                className="w-full text-[0.8rem] font-bold text-navy bg-white border border-border rounded-control px-3 py-2 hover:border-healthcare transition"
              >
                Compare these doctors
              </button>
            )}
            {message.hasMoreDoctors && (
              <MoreDoctorsButton
                total={message.doctorsTotal ?? 0}
                shown={message.doctors.length}
                onSend={onSend}
              />
            )}
          </div>
        )}
        {message.compare && (message.compare.doctors?.length ?? 0) >= 2 && (
          <DoctorCompare compare={message.compare} onSelect={send} />
        )}
        {message.slots && message.slots.length > 0 && (
          <SlotChips slots={message.slots} onSend={onSend} onSelect={send} />
        )}
        {message.appointmentTypes && message.appointmentTypes.length > 0 && (
          <TypeSelect types={message.appointmentTypes} onPick={onPickType} onSend={onSend} onSelect={send} />
        )}
        {message.consultationModes && message.consultationModes.length > 0 && (
          <ModeChips modes={message.consultationModes} onPick={onPickMode} onSend={onSend} onSelect={send} />
        )}
        {message.daySchedule && (
          <DaySlots
            schedule={message.daySchedule}
            durationMinutes={daySlotMinutes ?? 30}
            onSend={onSend}
            onSelect={send}
          />
        )}
        {message.bookingStage === "pick_date" && (
          <DateStrip onSend={onSend} onSelect={send} />
        )}
        {message.pendingBooking && (
          <ConfirmPanel pending={message.pendingBooking} onSend={onSend} />
        )}
        {message.filterChoices && message.filterChoices.length > 0 && (
          <FilterChoices choices={message.filterChoices} onSend={onSend} />
        )}
        {message.upcomingAppointment && (
          <BookingSuccess upcoming={message.upcomingAppointment} onSend={onSend} />
        )}
        {message.quickReplies && message.quickReplies.length > 0 && !isPatient && (
          <QuickReplies replies={message.quickReplies} onSend={onSend} />
        )}
        <p className="text-[0.7rem] text-ink-faint mt-1">{message.time}</p>
      </div>
    </motion.div>
  );
}

export function TypingIndicator({ name = "Assistant is typing" }: { name?: string }) {
  return (
    <div className="flex gap-2.5" aria-label={name}>
      <span className="w-8 h-8 rounded-full bg-gradient-to-br from-healthcare to-teal text-white flex items-center justify-center text-[0.8rem] font-extrabold">
        C
      </span>
      <div>
        <p className="text-[0.7rem] font-bold text-healthcare mb-1">{name}</p>
        <div className="bg-white border border-border rounded-2xl rounded-bl-md px-4 py-3 flex gap-1.5 w-fit">
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
    </div>
  );
}

function LiveDoctorCard({
  doctor,
  onSelect,
}: {
  doctor: NonNullable<ChatMessage["doctors"]>[number];
  onSelect?: (text: string, selection: BookingSelection) => void;
}) {
  const navigate = useNavigate();
  const where = [doctor.hospital_name, doctor.hospital_city]
    .filter(Boolean)
    .join(" · ");
  const distance =
    typeof doctor.distance_km === "number"
      ? ` · ${doctor.distance_km.toFixed(1)} km away`
      : "";
  const experience =
    typeof doctor.experience_years === "number" && doctor.experience_years > 0
      ? ` · ${doctor.experience_years} yrs exp`
      : "";
  const modes = (doctor.consultation_types ?? []).filter(Boolean);
  const modeLabel = modes.length > 0
    ? ` · ${modes.map((m) => (m === "in_person" ? "In-person" : m === "video" ? "Video" : "Phone")).join(" / ")}`
    : "";
  const why = (doctor.why_match ?? []).filter(Boolean).slice(0, 3);
  return (
    <div className="bg-white border border-border rounded-card p-3.5 shadow-subtle flex gap-3">
      <SafeImage
        src={doctor.photo_url ?? ""}
        fallbackSrc={doctorImage(doctor.id || doctor.name)}
        alt={doctor.name}
        name={doctor.name}
        className="w-12 h-12 rounded-full border border-border shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-[0.88rem] text-ink">{doctor.name}</p>
        <p className="text-[0.78rem] text-ink-secondary">
          {doctor.specialty ?? "Physician"}
          {where ? ` · ${where}` : ""}
          {experience}
          {distance && <span className="font-bold text-teal-dark">{distance}</span>}
        </p>
        {modeLabel && (
          <p className="text-[0.74rem] text-ink-secondary mt-0.5">{modeLabel.trim().replace(/^·/, "").trim()}</p>
        )}
        {why.length > 0 && (
          <ul className="mt-1.5 space-y-0.5" aria-label={`Why ${doctor.name} matches`}>
            {why.map((w) => (
              <li key={w} className="text-[0.74rem] text-teal-dark font-medium">
                ✓ {w}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          <Button
            size="sm"
            onClick={() =>
              onSelect
                ? onSelect(`${doctor.name}`, { type: "booking_selection", field: "doctor", value: doctor.id })
                : navigate("/book", { state: { doctorId: doctor.id } })
            }
          >
            Choose doctor
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onSelect
                ? onSelect(`Show availability for ${doctor.name}`, { type: "booking_selection", field: "doctor", value: doctor.id })
                : navigate("/book", { state: { doctorId: doctor.id } })
            }
          >
            View availability
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate("/book", { state: { doctorId: doctor.id } })}
          >
            View profile
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Patient-visible care request summary — facts only, never reasoning. */
export function CareContextCard({
  context,
  onSend,
}: {
  context: Record<string, unknown> | null | undefined;
  onSend?: (text: string) => void;
}) {
  if (!context || !onSend) return null;
  const entries: { label: string; value: string }[] = [];
  const get = (k: string) => {
    const v = context[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const concern = get("concern");
  const forWhom = get("for_whom");
  const when = get("when");
  const timePref = get("time_preference");
  const consultation = get("consultation");
  const specialty = get("specialty");
  const gender = get("gender_preference");
  const hospital = get("hospital");
  const doctor = get("doctor_preference");
  if (concern) entries.push({ label: "Concern", value: concern });
  if (forWhom) entries.push({ label: "For", value: forWhom === "self" ? "Myself" : forWhom });
  if (specialty) entries.push({ label: "Care", value: specialty });
  if (when) entries.push({ label: "When", value: timePref ? `${when} · ${timePref}` : when });
  else if (timePref) entries.push({ label: "When", value: timePref });
  if (consultation) entries.push({ label: "Consultation", value: consultation.replace("_", " ") });
  if (gender) entries.push({ label: "Doctor preference", value: `${gender} doctor` });
  if (doctor) entries.push({ label: "Doctor", value: doctor });
  if (hospital) entries.push({ label: "Hospital", value: hospital });
  if (entries.length === 0) return null;
  return (
    <div className="mt-2.5 text-left bg-white border border-border rounded-control p-3" aria-label="Your care request">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[0.74rem] font-extrabold tracking-wide text-ink-secondary uppercase">Your care request</p>
        <button
          type="button"
          onClick={() => onSend("I want to edit my preferences")}
          className="text-[0.74rem] font-bold text-healthcare hover:underline"
        >
          Edit
        </button>
      </div>
      <dl className="space-y-1">
        {entries.map((e) => (
          <div key={e.label} className="flex gap-2 text-[0.8rem]">
            <dt className="text-ink-faint font-semibold min-w-[92px]">{e.label}</dt>
            <dd className="text-navy font-semibold truncate">{e.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** One-tap patient-friendly choices — never a questionnaire blast. */
export function QuickReplies({
  replies,
  onSend,
}: {
  replies: string[];
  onSend?: (text: string) => void;
}) {
  if (!onSend || replies.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5 text-left" aria-label="Suggested replies">
      {replies.slice(0, 6).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onSend(r)}
          className="text-[0.8rem] font-bold bg-white border border-healthcare/40 rounded-full px-3 py-1.5 text-navy hover:bg-healthcare-soft hover:border-healthcare transition"
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/** Intelligent "explore more" — refinements preserving all constraints. */
export function FilterChoices({
  choices,
  onSend,
}: {
  choices: NonNullable<ChatMessage["filterChoices"]>;
  onSend?: (text: string) => void;
}) {
  if (!onSend || choices.length === 0) return null;
  return (
    <div className="mt-2.5 text-left" aria-label="Explore more options">
      <p className="text-[0.75rem] font-bold text-ink-secondary mb-1.5">What would you like to change?</p>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSend(c.prompt)}
            className="text-[0.78rem] font-bold bg-healthcare-faint border border-healthcare/30 rounded-full px-3 py-1.5 text-navy hover:border-healthcare transition"
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Side-by-side comparison of 2-3 doctors from REAL backend data only. */
export function DoctorCompare({
  compare,
  onSelect,
}: {
  compare: NonNullable<ChatMessage["compare"]>;
  onSelect?: (text: string, selection: BookingSelection) => void;
}) {
  const navigate = useNavigate();
  const docs = (compare.doctors ?? []).slice(0, 3);
  if (docs.length < 2) return null;
  const modeName = (m: string) => (m === "in_person" ? "In-person" : m === "video" ? "Video" : "Phone");
  const rows: { label: string; values: string[] }[] = [
    { label: "Specialty", values: docs.map((d) => d.specialty ?? "—") },
    { label: "Experience", values: docs.map((d) => (d.experience_years ? `${d.experience_years} yrs` : "—")) },
    { label: "Hospital", values: docs.map((d) => d.hospital_name ?? "—") },
    {
      label: "Distance",
      values: docs.map((d) => (typeof d.distance_km === "number" ? `${d.distance_km.toFixed(1)} km` : "—")),
    },
    { label: "Modes", values: docs.map((d) => ((d.consultation_types ?? []).map(modeName).join(" / ") || "—")) },
  ];
  return (
    <div className="mt-2.5 text-left bg-white border border-border rounded-control p-3 overflow-x-auto" aria-label="Compare doctors">
      <p className="text-[0.8rem] font-bold text-navy mb-2">Compare doctors</p>
      <table className="w-full text-[0.78rem] border-collapse">
        <thead>
          <tr>
            <th className="text-left font-semibold text-ink-faint pb-1.5 pr-2"> </th>
            {docs.map((d) => (
              <th key={d.id} className="text-left font-bold text-navy pb-1.5 pr-2 min-w-[110px]">{d.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border/60">
              <td className="font-semibold text-ink-faint py-1.5 pr-2">{r.label}</td>
              {r.values.map((v, i) => (
                <td key={i} className="py-1.5 pr-2 text-ink">{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2 mt-2.5">
        {docs.map((d) => (
          <Button
            key={d.id}
            size="sm"
            onClick={() =>
              onSelect
                ? onSelect(`The second one looks good — ${d.name}`, { type: "booking_selection", field: "doctor", value: d.id })
                : navigate("/book", { state: { doctorId: d.id } })
            }
          >
            Choose {d.name.replace(/^Dr\.?\s*/i, "Dr. ")}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Post-booking confirmation living inside the chat (§18). */
export function BookingSuccess({
  upcoming,
  onSend,
}: {
  upcoming: NonNullable<ChatMessage["upcomingAppointment"]>;
  onSend?: (text: string) => void;
}) {
  const navigate = useNavigate();
  if (!onSend) return null;
  return (
    <div className="mt-2.5 text-left bg-success/10 border border-success/30 rounded-control p-3" aria-label="Appointment confirmed">
      <p className="text-[0.83rem] font-bold text-navy">Your appointment is confirmed 🎉</p>
      {upcoming.doctor_name && <p className="text-[0.8rem] text-ink mt-0.5 font-semibold">{upcoming.doctor_name}</p>}
      <p className="text-[0.78rem] text-ink-secondary">What would you like to do next?</p>
      <div className="flex flex-wrap gap-2 mt-2">
        <Button size="sm" onClick={() => navigate("/visits")}>View appointment</Button>
        <Button size="sm" variant="outline" onClick={() => onSend("I want to complete my pre-visit questions")}>
          Complete pre-visit questions
        </Button>
        <Button size="sm" variant="outline" onClick={() => onSend("Help me prepare for my visit")}>
          Prepare for my visit
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
  onSelect,
}: {
  slots: NonNullable<ChatMessage["slots"]>;
  onSend?: (text: string) => void;
  onSelect?: (text: string, selection: BookingSelection) => void;
}) {
  if ((!onSend && !onSelect) || slots.length === 0) return null;
  const send = (text: string, selection: BookingSelection) => {
    if (onSelect) onSelect(text, selection);
    else onSend?.(text);
  };
  return (
    <div className="mt-2.5 text-left" aria-label="Suggested times">
      <p className="text-[0.75rem] font-bold text-ink-secondary mb-1.5">
        Here&apos;s what I found — tap a time that works for you:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {slots.slice(0, 6).map((s) => {
          const label = slotLabel(s.start, s.end);
          return (
            <button
              key={s.start}
              type="button"
              onClick={() => send(`Yes, book ${label}`, { type: "booking_selection", field: "start_time", value: s.start })}
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
      ? { title: "Shall I move it here for you?", confirm: `Yes, move it${slot ? ` to ${slot}` : ""}`, confirmLabel: "Yes, move it", cancelLabel: "Keep current" }
      : pending.kind === "cancel"
        ? { title: "Shall I cancel this for you?", confirm: "Yes, cancel it", confirmLabel: "Yes, cancel", cancelLabel: "Keep it" }
        : { title: "Shall I lock this in for you?", confirm: `Yes, book ${slot ?? "it"}`, confirmLabel: "Yes, book it", cancelLabel: "Not now" };
  const modeLabel =
    pending.consultation_mode === "video"
      ? "Video visit"
      : pending.consultation_mode === "phone"
        ? "Phone visit"
        : pending.consultation_mode === "in_person"
          ? "In-person visit"
          : null;
  return (
    <div className="mt-2.5 text-left bg-healthcare-faint border border-healthcare/25 rounded-control p-3" aria-label="Confirm or decline">
      <p className="text-[0.83rem] font-bold text-navy">{copy.title}</p>
      {slot && pending.kind !== "cancel" && (
        <p className="text-[0.78rem] text-ink-secondary mt-0.5">{slot}</p>
      )}
      {modeLabel && pending.kind !== "cancel" && (
        <p className="text-[0.78rem] font-semibold text-teal-dark mt-0.5">· {modeLabel}</p>
      )}
      <div className="flex gap-2 mt-2">
        <Button size="sm" onClick={() => onSend(copy.confirm)}>
          {copy.confirmLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onSend("No, that's not quite it")}>
          {copy.cancelLabel}
        </Button>
      </div>
    </div>
  );
}

/** Next page of doctors when the patient wants to explore more. */
export function MoreDoctorsButton({
  total,
  onSend,
}: {
  total: number;
  shown: number;
  onSend?: (text: string) => void;
}) {
  if (!onSend) return null;
  return (
    <button
      type="button"
      onClick={() => onSend("Show me more doctors")}
      className="w-full text-[0.82rem] font-bold text-healthcare bg-healthcare-faint border border-healthcare/30 rounded-control px-3 py-2 hover:underline transition"
    >
      Show more doctors{total > 0 ? ` · ${total} options in total` : ""}
    </button>
  );
}

/** Visit-type select bar: every checkup with its minutes, like normal
 * booking. Shown only on turns where the assistant fetched the types. */
export function TypeSelect({
  types,
  onPick,
  onSend,
  onSelect,
}: {
  types: NonNullable<ChatMessage["appointmentTypes"]>;
  onPick?: (id: string, name: string, minutes: number) => void;
  onSend?: (text: string) => void;
  onSelect?: (text: string, selection: BookingSelection) => void;
}) {
  if ((!onPick && !onSend && !onSelect) || types.length === 0) return null;
  return (
    <div className="mt-2.5 text-left" aria-label="Visit types">
      <label
        className="text-[0.75rem] font-bold text-ink-secondary block mb-1.5"
        htmlFor={`visit-type-${types[0].id}`}
      >
        Which kind of visit is this? Every type has its own duration.
      </label>
      <select
        id={`visit-type-${types[0].id}`}
        defaultValue=""
        onChange={(e) => {
          const t = types.find((x) => x.id === e.target.value);
          if (!t) return;
          if (onSelect) onSelect(t.name, { type: "booking_selection", field: "appointment_type", value: t.id });
          else if (onPick) onPick(t.id, t.name, t.duration_minutes);
          else onSend?.(t.name);
        }}
        className="input-base"
      >
        <option value="">Select visit type…</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} · {t.duration_minutes} min
          </option>
        ))}
      </select>
    </div>
  );
}

/** How-to-meet chips (video / phone call / in-person), like normal booking. */
export function ModeChips({
  modes,
  onPick,
  onSend,
  onSelect,
}: {
  modes: string[];
  onPick?: (mode: string, label: string) => void;
  onSend?: (text: string) => void;
  onSelect?: (text: string, selection: BookingSelection) => void;
}) {
  if ((!onPick && !onSend && !onSelect) || modes.length === 0) return null;
  const OPTIONS = [
    { mode: "video", label: "Video visit", Icon: Video },
    { mode: "phone", label: "Phone visit", Icon: Phone },
    { mode: "in_person", label: "In-person visit", Icon: Building2 },
  ].filter((o) => modes.includes(o.mode));
  if (OPTIONS.length === 0) return null;
  return (
    <div className="mt-2.5 text-left" aria-label="Consultation modes">
      <p className="text-[0.75rem] font-bold text-ink-secondary mb-1.5">
        Video, phone, or in-person?
      </p>
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => {
              if (onSelect) onSelect(label, { type: "booking_selection", field: "consultation_mode", value: mode });
              else if (onPick) onPick(mode, label);
              else onSend?.(label);
            }}
            className="inline-flex items-center gap-1.5 text-[0.8rem] font-bold bg-white border border-healthcare/40 rounded-full px-3 py-1.5 text-navy hover:bg-healthcare-soft hover:border-healthcare transition"
          >
            <Icon size={14} className="text-healthcare" />
            {label.replace(" visit", "")}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 7-day strip for picking the visit day, like normal booking. */
export function DateStrip({ onSend, onSelect }: { onSend?: (text: string) => void; onSelect?: (text: string, selection: BookingSelection) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (!onSend && !onSelect) return null;
  const send = (text: string, key: string) => {
    setPicked(key);
    if (onSelect) onSelect(text, { type: "booking_selection", field: "date", value: key });
    else onSend?.(text);
  };
  const days: { key: string; label: string; sub: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    days.push({
      key: `${d.getFullYear()}-${mm}-${dd}`,
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short" }),
      sub: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    });
  }
  return (
    <div className="mt-2.5 text-left" aria-label="Pick a day">
      <p className="text-[0.75rem] font-bold text-ink-secondary mb-1.5">
        Pick a day:
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => send(`${d.label}, ${d.sub}`, d.key)}
            aria-pressed={picked === d.key}
            className={`min-w-[68px] px-2.5 py-2 rounded-control border text-center transition shrink-0 ${
              picked === d.key
                ? "bg-healthcare text-white border-healthcare-dark"
                : "bg-white border-border hover:border-healthcare"
            }`}
          >
            <span className="block text-[0.74rem] font-bold">{d.label}</span>
            <span className={`block text-[0.7rem] ${picked === d.key ? "text-white/85" : "text-ink-secondary"}`}>{d.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function rangeMs(iso: string): number {
  return new Date(iso).getTime();
}

/** Horizontal day timeline with exact interval rendering (§11).
 *
 * Visual track: working hours as the open lane, busy blocks drawn at
 * their EXACT offsets (a 09:15–09:45 booking sits mid-cell, it never
 * blacks out the whole 09:00/09:30 boundary slots visually). Start
 * pills step every 30 minutes for navigation; a start is tappable only
 * when the visit (start + duration) fits inside working hours without
 * overlapping a busy block. Tapping sends a typed start_time selection
 * (UTC ISO) — the same canonical state saying "9:30" would set.
 */
export function DaySlots({
  schedule,
  durationMinutes,
  onSend,
  onSelect,
}: {
  schedule: NonNullable<ChatMessage["daySchedule"]>;
  durationMinutes: number;
  onSend?: (text: string) => void;
  onSelect?: (text: string, selection: BookingSelection) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  if (!onSend && !onSelect) return null;
  const send = (text: string, iso: string) => {
    setPicked(iso);
    if (onSelect) onSelect(text, { type: "booking_selection", field: "start_time", value: iso });
    else onSend?.(text);
  };
  const durMs = Math.max(15, durationMinutes || 30) * 60_000;
  const stepMs = 30 * 60_000;
  const dayLabel = schedule.working_hours[0]
    ? formatSlotDate(schedule.working_hours[0].start)
    : schedule.date;
  const windows = schedule.working_hours
    .map((w) => ({ s: rangeMs(w.start), e: rangeMs(w.end) }))
    .filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e) && w.e > w.s)
    .sort((a, b) => a.s - b.s);
  if (windows.length === 0) {
    return (
      <p className="mt-2.5 text-[0.82rem] text-ink-secondary border border-dashed border-border rounded-control px-3.5 py-2.5">
        The doctor is not available this day — try another day.
      </p>
    );
  }
  const t0 = windows[0].s;
  const t1 = windows[windows.length - 1].e;
  const span = Math.max(1, t1 - t0);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - t0) / span) * 100))}%`;
  const busyBlocks = schedule.busy
    .map((b) => ({ s: rangeMs(b.start), e: rangeMs(b.end) }))
    .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s);
  const hourMarks: number[] = [];
  const firstHour = Math.ceil(t0 / 3_600_000) * 3_600_000;
  for (let h = firstHour; h <= t1; h += 3_600_000) hourMarks.push(h);
  const starts: { iso: string; label: string; free: boolean }[] = [];
  const seen = new Set<string>();
  for (const w of windows) {
    for (let t = w.s; t + stepMs <= w.e + 1_000; t += stepMs) {
      const iso = new Date(t).toISOString();
      if (seen.has(iso)) continue;
      seen.add(iso);
      const end = t + durMs;
      const inside = w.s <= t && end <= w.e + 1_000;
      const clash = busyBlocks.some((b) => t < b.e && b.s < end);
      starts.push({ iso, label: formatSlotTime(iso), free: inside && !clash });
    }
  }
  starts.sort((a, b) => (a.iso < b.iso ? -1 : 1));
  return (
    <div className="mt-2.5 text-left" aria-label={`Available times for ${dayLabel}`}>
      <p className="text-[0.75rem] font-bold text-ink-secondary mb-1.5">
        {dayLabel} · {durationMinutes}-min visit — pick a start time:
      </p>
      {/* Exact-interval track: working lane + true-offset busy blocks */}
      <div className="relative h-12 rounded-control bg-healthcare-faint border border-healthcare/20 overflow-hidden" aria-hidden>
        {busyBlocks.map((b, i) => (
          <div
            key={i}
            title={`${formatSlotTime(new Date(b.s).toISOString())}–${formatSlotTime(new Date(b.e).toISOString())} booked`}
            className="absolute top-1 bottom-1 rounded bg-danger/70 border border-danger-dark"
            style={{ left: pct(b.s), width: `calc(${pct(b.e)} - ${pct(b.s)})` }}
          />
        ))}
        {starts.filter((s) => s.free).map((s) => (
          <div
            key={s.iso}
            className="absolute top-1 bottom-1 w-1 rounded-full bg-healthcare"
            style={{ left: pct(rangeMs(s.iso)) }}
          />
        ))}
      </div>
      <div className="relative h-4 text-[0.65rem] font-semibold text-ink-faint" aria-hidden>
        {hourMarks.map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: pct(h) }}>
            {formatSlotTime(new Date(h).toISOString())}
          </span>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1.5 mt-1">
        {starts.map((s) => (
          <button
            key={s.iso}
            type="button"
            disabled={!s.free}
            aria-pressed={picked === s.iso}
            onClick={() => send(`${dayLabel} at ${s.label}`, s.iso)}
            className={`shrink-0 min-w-[72px] px-2.5 py-2 rounded-control border text-[0.82rem] font-bold transition ${
              picked === s.iso
                ? "bg-healthcare text-white border-healthcare-dark"
                : s.free
                  ? "bg-white text-navy border-healthcare/40 hover:border-healthcare hover:bg-healthcare-soft"
                  : "bg-background text-ink-faint border-border line-through cursor-not-allowed"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="text-[0.7rem] text-ink-faint">
        <span className="inline-block w-2 h-4 rounded bg-danger/70 border border-danger-dark mr-1 align-middle" aria-hidden /> booked
        <span className="inline-block w-1 h-4 rounded-full bg-healthcare ml-2.5 mr-1 align-middle" aria-hidden /> free start
      </p>
    </div>
  );
}

export function VoiceVisualizer({ state }: { state: string }) {  const active = ["listening", "speaking", "thinking"].includes(state);
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
