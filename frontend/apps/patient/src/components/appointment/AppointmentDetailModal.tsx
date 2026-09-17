import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, CalendarDays, CheckCircle2, Clock, Info } from "lucide-react";
import type { Appointment } from "../../types";
import { consultationModeLabel } from "../../mock/services";
import { Button, SafeImage, StatusBadge } from "../common/ui";
import { Modal } from "../common/Modal";
import { AppointmentTimeline } from "./AppointmentCard";
import { QuestionnaireFlow } from "../questionnaire/QuestionnaireFlow";
import { QUESTIONNAIRES } from "../../mock/data";
import { useEffect, useState } from "react";

export function AppointmentDetailModal({
  appointment,
  open,
  onClose,
  onReschedule,
  onCancel,
}: {
  appointment: Appointment | null;
  open: boolean;
  onClose: () => void;
  onReschedule?: (a: Appointment) => void;
  onCancel?: (a: Appointment) => void;
}) {
  const [showQ, setShowQ] = useState(false);
  if (!appointment) return null;
  const live = ["confirmed", "pending", "rescheduled", "sync_pending"].includes(appointment.status);
  const q = QUESTIONNAIRES.find((x) => x.appointmentId === appointment.id) ?? QUESTIONNAIRES[0];

  return (
    <Modal open={open} onClose={() => { setShowQ(false); onClose(); }} title="Appointment details" wide>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <StatusBadge status={appointment.status} />
        <span className="text-[0.8rem] text-ink-secondary">Booking {appointment.id.toUpperCase()}</span>
      </div>

      <div className="flex gap-4 mt-4">
        <SafeImage src={appointment.doctorPhoto} alt={appointment.doctorName} name={appointment.doctorName} className="w-16 h-16 rounded-2xl border border-border" />
        <div>
          <h3 className="text-lg font-extrabold text-navy">{appointment.doctorName}</h3>
          <p className="text-sm text-ink-secondary">{appointment.specialty} · {appointment.department}</p>
          <p className="text-sm text-ink-secondary">{appointment.hospitalName}</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2.5 mt-4 text-sm">
        {[
          { icon: CalendarDays, label: "Date", value: appointment.date },
          { icon: Clock, label: "Time", value: `${appointment.time} · ${appointment.durationMinutes} min` },
        ].map((r) => (
          <div key={r.label} className="bg-background border border-border rounded-control px-3.5 py-2.5">
            <p className="text-[0.72rem] font-bold uppercase tracking-wide text-ink-faint flex items-center gap-1"><r.icon size={12} /> {r.label}</p>
            <p className="font-bold text-ink mt-0.5">{r.value}</p>
          </div>
        ))}
        <div className="bg-background border border-border rounded-control px-3.5 py-2.5">
          <p className="text-[0.72rem] font-bold uppercase tracking-wide text-ink-faint">Consultation</p>
          <p className="font-bold text-ink mt-0.5">{consultationModeLabel(appointment.consultationMode)} · {appointment.appointmentType}</p>
        </div>
        <div className="bg-background border border-border rounded-control px-3.5 py-2.5">
          <p className="text-[0.72rem] font-bold uppercase tracking-wide text-ink-faint">Location</p>
          <p className="font-bold text-ink mt-0.5 text-[0.85rem]">{appointment.location}</p>
        </div>
      </div>

      <div className="mt-4">
        <h4 className="font-bold text-ink text-sm">Progress</h4>
        <AppointmentTimeline stage={appointment.verificationStage} />
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {live && onReschedule && <Button variant="outline" size="sm" onClick={() => onReschedule(appointment)}>Reschedule</Button>}
        {live && onCancel && <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft" onClick={() => onCancel(appointment)}>Cancel</Button>}
        <Button variant="outline" size="sm" onClick={() => setShowQ((v) => !v)}>
          {showQ ? "Hide questionnaire" : "View questionnaire"}
        </Button>
        <Button variant="ghost" size="sm">Add to calendar</Button>
      </div>

      <AnimatePresence>
        {showQ && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-4 border-t border-border pt-4">
              <p className="font-bold text-ink text-sm">{q.name}</p>
              <p className="text-[0.8rem] text-ink-secondary mb-3">{q.dueLabel}</p>
              <QuestionnaireFlow questions={q.questions} onComplete={() => undefined} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}

export function BookingSuccessPanel({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (stage >= 2) return;
    const t = setTimeout(() => setStage((s) => Math.min(2, s + 1)), 1100);
    return () => clearTimeout(t);
  }, [stage]);
  const steps = ["Appointment created", "Healthcare system verified", "Appointment confirmed"];
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 15 }}
        className="w-[72px] h-[72px] mx-auto rounded-full bg-success-soft text-success flex items-center justify-center"
      >
        <CheckCircle2 size={36} />
      </motion.div>
      <h3 className="text-xl font-extrabold text-navy mt-4">Appointment request submitted</h3>
      <p className="text-sm text-ink-secondary mt-1 max-w-md mx-auto">
        Your slot is held while we confirm with the clinic. This is a frontend preview — no real system was contacted.
      </p>
      <ol className="max-w-sm mx-auto mt-5 space-y-2 text-left">
        {steps.map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-control border text-sm font-semibold ${
              i <= stage ? "bg-success-soft border-success/25 text-success" : "bg-background border-border text-ink-faint"
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.7rem] font-bold ${i <= stage ? "bg-success text-white" : "bg-border text-white"}`}>
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <Button onClick={onDone} className="mt-5">View appointment</Button>
      <p className="text-[0.75rem] text-ink-faint mt-3 flex items-center justify-center gap-1"><Info size={13} /> Demo flow — mock confirmation only.</p>
    </motion.div>
  );
}

export function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 text-[0.85rem] font-bold text-ink-secondary hover:text-healthcare transition mb-3">
      <ArrowLeft size={16} /> {label}
    </button>
  );
}
