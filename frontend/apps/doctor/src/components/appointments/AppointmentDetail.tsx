import { CalendarDays, CheckCircle2, Clock, FileText } from "lucide-react";
import type { Appointment, Questionnaire } from "../../types";
import { consultationModeLabel } from "../../lib/helpers";
import { Avatar, StatusBadge } from "../common/ui";
import { Button } from "../common/ui";
import { Link } from "react-router-dom";

export function AppointmentTimeline({ status }: { status: Appointment["status"] }) {
  const steps = ["Requested", "Confirmed", "Completed"];
  const idx = status === "completed" ? 2 : status === "cancelled" ? 1 : 1;
  return (
    <ol className="flex items-center gap-0" aria-label="Appointment progress">
      {steps.map((s, i) => (
        <li key={s} className={`flex items-center ${i < steps.length - 1 ? "flex-1" : ""}`}>
          <div className="flex flex-col items-center gap-1">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.72rem] font-bold border ${i <= idx ? "bg-success text-white border-success" : "bg-white text-ink-faint border-border"}`}>
              {i + 1}
            </span>
            <span className={`text-[0.7rem] font-semibold ${i <= idx ? "text-success" : "text-ink-faint"}`}>{s}</span>
          </div>
          {i < steps.length - 1 && <div className={`h-0.5 flex-1 mx-1 mb-5 rounded ${i < idx ? "bg-success" : "bg-border"}`} aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export function QuestionnairePanel({ questionnaire }: { questionnaire: Questionnaire | undefined }) {
  if (!questionnaire || questionnaire.status === "not_assigned") {
    return (
      <div className="bg-background border border-border rounded-control p-4 text-sm">
        <p className="font-bold text-ink flex items-center gap-1.5"><FileText size={15} /> No questionnaire</p>
        <p className="text-ink-secondary mt-1">No pre-visit form is assigned to this appointment.</p>
      </div>
    );
  }
  if (questionnaire.status !== "completed") {
    return (
      <div className="bg-warning-soft border border-warning/25 rounded-control p-4 text-sm">
        <p className="font-bold text-warning flex items-center gap-1.5"><Clock size={15} /> Questionnaire {questionnaire.status.replace("_", " ")}</p>
        <p className="text-ink-secondary mt-1">
          Patient-provided information will appear here when the form is complete.
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[0.8rem] text-ink-secondary flex items-center gap-1.5">
        <CheckCircle2 size={14} className="text-success" /> Completed {questionnaire.completedAt}
      </p>
      <dl className="mt-3 space-y-0 border border-border rounded-control overflow-hidden">
        {questionnaire.answers.map((a, i) => (
          <div key={i} className={`px-4 py-3 text-sm ${i % 2 === 0 ? "bg-white" : "bg-background/60"}`}>
            <dt className="font-semibold text-ink-secondary text-[0.8rem]">{a.question}</dt>
            <dd className="font-semibold text-ink mt-0.5">Patient response: {a.response}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[0.73rem] text-ink-faint mt-2">Shown as patient-provided structured information. No clinical interpretation.</p>
    </div>
  );
}

export function AppointmentDetailBody({ appointment, questionnaire }: { appointment: Appointment; questionnaire: Questionnaire | undefined }) {
  // Only render contact rows the backend actually provides — never placeholders.
  const contactRows: [string, string][] = [];
  if (appointment.patient.phone) contactRows.push(["Contact", appointment.patient.phone]);
  if (appointment.patient.communicationPreference) contactRows.push(["Communication preference", appointment.patient.communicationPreference]);
  const consultationLine = appointment.department
    ? `${consultationModeLabel(appointment.mode)} · ${appointment.department}`
    : consultationModeLabel(appointment.mode);

  return (
    <div className="space-y-5">
      {/* Patient */}
      <div className="flex items-center gap-3.5">
        <Avatar name={appointment.patient.name} size="lg" />
        <div className="min-w-0">
          <h2 className="text-[1.2rem] font-extrabold text-navy leading-tight">{appointment.patient.name}</h2>
          <div className="mt-1.5 flex gap-1.5 flex-wrap"><StatusBadge status={appointment.status} /></div>
        </div>
      </div>

      {appointment.status === "sync_pending" || appointment.status === "pending" ? (
        <p className="text-[0.83rem] bg-healthcare-faint border border-healthcare/20 text-navy rounded-control px-3.5 py-2.5">
          Appointment confirmation is being processed. No action needed.
        </p>
      ) : null}

      <section className="grid sm:grid-cols-2 gap-2 text-sm">
        {[
          { icon: CalendarDays, k: "Date", v: `${appointment.dateLabel} · ${appointment.time} – ${appointment.endTime}` },
          { icon: Clock, k: "Duration", v: `${appointment.type} · ${appointment.durationMinutes} min` },
        ].map((r) => (
          <div key={r.k} className="bg-background border border-border rounded-control px-3.5 py-2.5">
            <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-faint">{r.k}</p>
            <p className="font-bold text-ink mt-0.5 text-[0.87rem]">{r.v}</p>
          </div>
        ))}
        <div className="bg-background border border-border rounded-control px-3.5 py-2.5">
          <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-faint">Consultation</p>
          <p className="font-bold text-ink mt-0.5 text-[0.87rem]">{consultationLine}</p>
        </div>
        {appointment.hospital && (
          <div className="bg-background border border-border rounded-control px-3.5 py-2.5">
            <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-faint">Location</p>
            <p className="font-bold text-ink mt-0.5 text-[0.87rem]">{appointment.hospital}</p>
          </div>
        )}
      </section>

      {contactRows.length > 0 && (
        <section>
          <h3 className="font-bold text-ink text-[0.95rem]">Patient contact</h3>
          <dl className="mt-2 text-sm border border-border rounded-control overflow-hidden">
            {contactRows.map(([k, v], i) => (
              <div key={k} className={`flex justify-between gap-3 px-4 py-2.5 ${i % 2 === 0 ? "bg-white" : "bg-background/60"}`}>
                <dt className="text-ink-secondary">{k}</dt>
                <dd className="font-semibold text-ink text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-ink text-[0.95rem]">Pre-visit questionnaire</h3>
          {questionnaire && <StatusBadge status={questionnaire.status} />}
        </div>
        <div className="mt-2"><QuestionnairePanel questionnaire={questionnaire} /></div>
      </section>

      <section>
        <h3 className="font-bold text-ink text-[0.95rem]">Progress</h3>
        <div className="mt-2"><AppointmentTimeline status={appointment.status} /></div>
      </section>

      <div className="flex gap-2">
        <Link to="/today" className="flex-1"><Button variant="outline" className="w-full">Back to schedule</Button></Link>
        {questionnaire?.status === "completed" && (
          <Link to={`/questionnaires?appointment=${appointment.id}`} className="flex-1"><Button className="w-full">View questionnaire</Button></Link>
        )}
      </div>
    </div>
  );
}
