import { motion } from "framer-motion";
import { CalendarDays, CheckCircle2, ClipboardList, Clock, MapPin, Video, Phone, Building2 } from "lucide-react";
import type { Appointment } from "../../types";
import { consultationModeLabel } from "../../lib/helpers";
import type { QuestionnaireStatus } from "../../lib/questionnaires";
import { doctorImage } from "../../lib/images";
import { Button, SafeImage, StatusBadge } from "../common/ui";

function ModeIcon({ mode }: { mode: Appointment["consultationMode"] }) {
  if (mode === "video") return <Video size={14} />;
  if (mode === "phone") return <Phone size={14} />;
  return <Building2 size={14} />;
}

/** Per-visit pre-visit form — rendered inside the appointment it belongs
 *  to, never as a detached section. Silent unless a form exists. */
export function QuestionnaireStrip({
  status,
  onOpen,
}: {
  status: QuestionnaireStatus;
  onOpen: () => void;
}) {
  if (!status.hasForm) return null;
  if (status.loading) {
    return (
      <div className="mt-3 rounded-xl border border-border bg-background px-3.5 py-3" aria-hidden>
        <div className="skeleton h-4 w-2/5 rounded-md" />
      </div>
    );
  }
  const label = status.completed ? "Review answers" : status.answered > 0 ? `Continue ${status.answered}/${status.total}` : "Start form";
  return (
    <div className="mt-3 rounded-xl border border-healthcare/20 bg-healthcare-faint/60 px-3.5 py-3 flex items-center gap-3">
      <span className="w-9 h-9 rounded-xl bg-white border border-healthcare/20 text-healthcare flex items-center justify-center shrink-0" aria-hidden>
        {status.completed ? <CheckCircle2 size={17} className="text-success" /> : <ClipboardList size={17} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.83rem] font-bold text-ink leading-tight">
          Pre-visit form
          {status.completed ? (
            <span className="ml-2 text-[0.7rem] font-bold text-success bg-success-soft rounded-full px-2 py-0.5">Completed</span>
          ) : status.total > 0 ? (
            <span className="ml-2 text-[0.7rem] font-bold text-healthcare">· {status.answered}/{status.total}</span>
          ) : null}
        </p>
        {!status.completed && status.total > 0 && (
          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white border border-healthcare/15" aria-hidden>
            <span
              className="block h-full rounded-full bg-healthcare transition-all"
              style={{ width: `${Math.round((status.answered / status.total) * 100)}%` }}
            />
          </span>
        )}
        <p className="text-[0.75rem] text-ink-secondary mt-1">
          {status.completed
            ? "Submitted — the care team has your answers."
            : status.answered > 0
              ? "Draft saved — continue where you left off."
              : "Takes a few minutes — the clinic reviews it before your visit."}
        </p>
      </div>
      <Button size="sm" variant={status.completed ? "outline" : "primary"} onClick={onOpen} className="shrink-0">
        {label}
      </Button>
    </div>
  );
}

export function AppointmentCard({
  appointment,
  onView,
  onReschedule,
  onCancel,
  compact,
  questionnaire,
  onQuestionnaire,
}: {
  appointment: Appointment;
  onView: () => void;
  onReschedule?: () => void;
  onCancel?: () => void;
  compact?: boolean;
  /** Pre-visit form status — strip renders only when a form exists. */
  questionnaire?: QuestionnaireStatus | null;
  onQuestionnaire?: () => void;
}) {
  const isLive = ["confirmed", "pending", "rescheduled", "sync_pending"].includes(appointment.status);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`card-base p-4 sm:p-5 ${compact ? "" : "hover:shadow-card transition-shadow"}`}
    >
      <div className="flex gap-3.5">
        <SafeImage
          src={appointment.doctorPhoto}
          fallbackSrc={doctorImage(appointment.doctorId || appointment.doctorName)}
          alt={appointment.doctorName}
          name={appointment.doctorName}
          className="w-14 h-14 rounded-full border border-border shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="font-bold text-ink leading-tight">{appointment.doctorName}</p>
              <p className="text-[0.82rem] text-ink-secondary">
                {appointment.specialty} · {appointment.hospitalName}
              </p>
            </div>
            <StatusBadge status={appointment.status} />
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 mt-2.5 text-[0.85rem] text-ink-secondary">
            <span className="flex items-center gap-1.5">
              <CalendarDays size={14} className="text-healthcare shrink-0" /> {appointment.date}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={14} className="text-healthcare shrink-0" /> {appointment.time} · {appointment.durationMinutes} min
            </span>
            <span className="flex items-center gap-1.5">
              <ModeIcon mode={appointment.consultationMode} /> {consultationModeLabel(appointment.consultationMode)} · {appointment.appointmentType}
            </span>
            <span className="flex items-center gap-1.5 truncate">
              <MapPin size={14} className="text-healthcare shrink-0" /> <span className="truncate">{appointment.location}</span>
            </span>
          </div>
          {!compact && (
            <div className="flex flex-wrap gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={onView}>
                View details
              </Button>
              {isLive && onReschedule && (
                <Button variant="outline" size="sm" onClick={onReschedule}>
                  Reschedule
                </Button>
              )}
              {isLive && onCancel && (
                <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft" onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </div>
          )}
          {questionnaire?.hasForm && onQuestionnaire && (
            <QuestionnaireStrip status={questionnaire} onOpen={onQuestionnaire} />
          )}
        </div>
      </div>
    </motion.article>
  );
}

export function AppointmentTimeline({ stage }: { stage: Appointment["verificationStage"] }) {
  const steps = [
    { id: "created", label: "Booked" },
    { id: "verified", label: "Verified" },
    { id: "confirmed", label: "Confirmed" },
  ] as const;
  const order = ["created", "verified", "confirmed"];
  const idx = order.indexOf(stage);
  return (
    <ol className="flex items-center gap-0 mt-2" aria-label="Appointment progress">
      {steps.map((s, i) => (
        <li key={s.id} className={`flex items-center ${i < steps.length - 1 ? "flex-1" : ""}`}>
          <div className="flex flex-col items-center gap-1">
            <span
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.75rem] font-bold border ${
                i <= idx ? "bg-success text-white border-success" : "bg-white text-ink-faint border-border"
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-[0.72rem] font-semibold ${i <= idx ? "text-success" : "text-ink-faint"}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 mx-1 mb-5 rounded ${i < idx ? "bg-success" : "bg-border"}`} aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}
