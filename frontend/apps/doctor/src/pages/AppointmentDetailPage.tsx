import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { appointmentDetail, completeAppointment, fetchAppointmentQuestionnaire, markAppointmentNoShow, type AppointmentDetail as ApiDetail } from "../api";
import { formatCompletedAt, formatDateLabel, formatTime, mapAppointmentState } from "../lib/backend";
import { useSchedule } from "../context/ScheduleContext";
import { AppointmentDetailBody } from "../components/appointments/AppointmentDetail";
import { CardSkeleton, EmptyState, ErrorState } from "../components/common/ui";
import type { Appointment, Questionnaire } from "../types";

function toUI(
  detail: ApiDetail,
  fallbackName: string,
  hospital: string,
  promptById?: Map<string, string>,
): { appointment: Appointment; questionnaire: Questionnaire | undefined } {
  const state = mapAppointmentState(detail.state);
  const appointment: Appointment = {
    id: detail.id,
    patient: {
      id: detail.patient_id,
      name: fallbackName,
      age: 0,
      dob: "",
      phone: "",
      communicationPreference: "",
      initials: fallbackName
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join(""),
    },
    dateLabel: formatDateLabel(detail.slot_start),
    dayGroup: "today",
    time: formatTime(detail.slot_start),
    endTime: formatTime(detail.slot_end),
    sortKey: detail.slot_start,
    type: "Visit",
    durationMinutes: 30,
    mode: "in_person",
    status: state,
    questionnaire:
      detail.responses.length === 0
        ? "not_assigned"
        : detail.responses.some((r) => r.completed)
          ? "completed"
          : "in_progress",
    department: "",
    hospital,
  };
  const done = detail.responses.filter((r) => r.completed);
  const questionnaire: Questionnaire | undefined =
    detail.responses.length === 0
      ? undefined
      : {
          id: detail.responses[0].id,
          appointmentId: detail.id,
          patientName: fallbackName,
          name: "Pre-visit questionnaire",
          status:
            done.length > 0 ? "completed" : detail.responses.length > 0 ? "in_progress" : "assigned",
          completedAt: done.length > 0 ? formatCompletedAt(done[done.length - 1].completed_at) : null,
          answers:
            done.length > 0
              ? Object.entries(done[done.length - 1].answers ?? {}).map(([qid, response]) => ({
                  question: promptById?.get(qid) ?? "Question",
                  response: typeof response === "string" ? response : JSON.stringify(response),
                }))
              : [],
        };
  return { appointment, questionnaire };
}

export default function AppointmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { appointments, refresh } = useSchedule();
  const [detail, setDetail] = useState<ApiDetail | null>(null);
  const [prompts, setPrompts] = useState<Map<string, string>>(new Map());
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  async function closeOut(kind: "complete" | "no-show") {
    if (!id || acting) return;
    setActing(true);
    setActionError(null);
    try {
      if (kind === "complete") await completeAppointment(id);
      else await markAppointmentNoShow(id);
      const d = await appointmentDetail(id);
      setDetail(d);
      await refresh().catch(() => undefined);
    } catch {
      setActionError(kind === "complete" ? "Could not complete visit." : "Could not mark no-show.");
    } finally {
      setActing(false);
    }
  }

  useEffect(() => {
    if (!id) {
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(false);
    Promise.all([
      appointmentDetail(id),
      fetchAppointmentQuestionnaire(id).catch(() => null),
    ])
      .then(([d, q]) => {
        if (cancelled) return;
        setDetail(d);
        setPrompts(new Map((q?.questions ?? []).map((x) => [x.id, x.prompt])));
      })
      .catch(() => {
        if (!cancelled) setDetailError(true);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (detailLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <Link to="/today" className="inline-flex items-center gap-1.5 text-[0.85rem] font-bold text-ink-secondary hover:text-healthcare mb-3"><ArrowLeft size={16} /> Back to schedule</Link>
        <CardSkeleton lines={5} />
      </div>
    );
  }
  if (detailError) {
    return (
      <div className="max-w-2xl mx-auto">
        <Link to="/today" className="inline-flex items-center gap-1.5 text-[0.85rem] font-bold text-ink-secondary hover:text-healthcare mb-3"><ArrowLeft size={16} /> Back</Link>
        <ErrorState title="We couldn't load this appointment." body="Check your connection and try again." onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="max-w-2xl mx-auto">
        <Link to="/today" className="inline-flex items-center gap-1.5 text-[0.85rem] font-bold text-ink-secondary hover:text-healthcare mb-3"><ArrowLeft size={16} /> Back</Link>
        <div className="card-base"><EmptyState title="Appointment not found" body="It may have been moved. Return to today's schedule." /></div>
      </div>
    );
  }
  const known = appointments.find((a) => a.id === detail.id);
  const { appointment, questionnaire } = toUI(
    detail,
    known?.patient.name ?? "Patient",
    known?.hospital ?? "My hospital",
    prompts,
  );
  if (known) {
    appointment.type = known.type;
    appointment.mode = known.mode;
    appointment.department = known.department;
    appointment.patient = known.patient;
  }
  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Link to="/today" className="inline-flex items-center gap-1.5 text-[0.85rem] font-bold text-ink-secondary hover:text-healthcare"><ArrowLeft size={16} /> Back to schedule</Link>
        <span className="text-[0.76rem] font-semibold text-ink-faint">{appointment.dateLabel} · {appointment.time} – {appointment.endTime}</span>
      </div>
      <h1 className="page-title sr-only">Appointment with {appointment.patient.name}</h1>
      {actionError && <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{actionError}</p>}
      {(detail.state === "confirmed" || detail.state === "rescheduled") && (
        <div className="flex gap-2">
          <button disabled={acting} onClick={() => void closeOut("complete")} className="flex-1 text-[0.83rem] font-bold bg-success text-white rounded-control py-2.5 disabled:opacity-50 hover:brightness-95 transition">Complete visit</button>
          <button disabled={acting} onClick={() => void closeOut("no-show")} className="flex-1 text-[0.83rem] font-bold bg-white border border-border rounded-control py-2.5 disabled:opacity-50 hover:border-healthcare transition">Mark no-show</button>
        </div>
      )}
      {/* Sectioned clinical scheduling workspace */}
      <section className="card-base p-5 sm:p-6" aria-label="Appointment summary">
        <AppointmentDetailBody appointment={appointment} questionnaire={questionnaire} />
      </section>
      <section className="card-base p-5" aria-label="Record">
        <h2 className="section-title">Record</h2>
        <dl className="mt-2 text-[0.82rem] text-ink-secondary space-y-1">
          <div className="flex justify-between gap-2"><dt>Status</dt><dd className="font-bold text-ink">{detail.state.replace(/_/g, " ")}</dd></div>
          <div className="flex justify-between gap-2"><dt>Last updated</dt><dd className="font-semibold">{new Date(detail.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</dd></div>
          <div className="flex justify-between gap-2"><dt>Timeline events</dt><dd className="font-semibold">{detail.history.length}</dd></div>
        </dl>
      </section>
    </div>
  );
}
