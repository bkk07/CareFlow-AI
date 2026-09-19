import { motion } from "framer-motion";
import { ArrowRight, Building2, Clock, Phone, Video } from "lucide-react";
import { Link } from "react-router-dom";
import { consultationModeLabel } from "../../lib/helpers";
import type { Appointment } from "../../types";
import { Avatar, StatusBadge } from "../common/ui";

function ModeIcon({ mode }: { mode: Appointment["mode"] }) {
  if (mode === "video") return <Video size={13} />;
  if (mode === "phone") return <Phone size={13} />;
  return <Building2 size={13} />;
}

export function questionnaireLabel(q: Appointment["questionnaire"]): string {
  if (q === "completed") return "Questionnaire done";
  if (q === "in_progress") return "Questionnaire in progress";
  if (q === "assigned") return "Questionnaire pending";
  return "No questionnaire";
}

export function AppointmentCard({
  appointment,
  showDate,
}: {
  appointment: Appointment;
  showDate?: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="card-base p-4 hover:shadow-card transition-shadow"
    >
      <div className="flex gap-3">
        <Avatar name={appointment.patient.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="font-bold text-ink leading-tight">
                {appointment.time}
                {showDate && <span className="font-semibold text-ink-secondary"> · {appointment.dateLabel}</span>}
              </p>
              <p className="text-[0.87rem] font-semibold text-ink mt-0.5">{appointment.patient.name}</p>
              <p className="text-[0.8rem] text-ink-secondary">{appointment.type} · {appointment.durationMinutes} min</p>
            </div>
            <StatusBadge status={appointment.status} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[0.76rem]">
            <span className="inline-flex items-center gap-1 font-semibold text-ink-secondary bg-background border border-border rounded-full px-2 py-0.5">
              <ModeIcon mode={appointment.mode} /> {consultationModeLabel(appointment.mode)}
            </span>
            <span className={`inline-flex items-center gap-1 font-semibold rounded-full px-2 py-0.5 border ${
              appointment.questionnaire === "completed"
                ? "bg-success-soft text-success border-success/20"
                : appointment.questionnaire === "not_assigned"
                  ? "bg-background text-ink-faint border-border"
                  : "bg-warning-soft text-warning border-warning/20"
            }`}>
              <Clock size={12} /> {questionnaireLabel(appointment.questionnaire)}
            </span>
          </div>
          <Link
            to={`/appointments/${appointment.id}`}
            className="inline-flex items-center gap-1 text-[0.83rem] font-bold text-healthcare hover:underline mt-2.5"
          >
            View details <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
