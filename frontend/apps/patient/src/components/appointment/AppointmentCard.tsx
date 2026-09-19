import { motion } from "framer-motion";
import { CalendarDays, Clock, MapPin, Video, Phone, Building2 } from "lucide-react";
import type { Appointment } from "../../types";
import { consultationModeLabel } from "../../lib/helpers";
import { Button, SafeImage, StatusBadge } from "../common/ui";

function ModeIcon({ mode }: { mode: Appointment["consultationMode"] }) {
  if (mode === "video") return <Video size={14} />;
  if (mode === "phone") return <Phone size={14} />;
  return <Building2 size={14} />;
}

export function AppointmentCard({
  appointment,
  onView,
  onReschedule,
  onCancel,
  compact,
}: {
  appointment: Appointment;
  onView: () => void;
  onReschedule?: () => void;
  onCancel?: () => void;
  compact?: boolean;
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
