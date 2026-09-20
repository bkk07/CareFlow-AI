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
        <ErrorState title="Could not load appointment" body="Check your connection and try again." onRetry={() => window.location.reload()} />
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
    <div className="max-w-2xl mx-auto">
      <Link to="/today" className="inline-flex items-center gap-1.5 text-[0.85rem] font-bold text-ink-secondary hover:text-healthcare mb-3"><ArrowLeft size={16} /> Back to schedule</Link>
      {actionError && <p role="alert" className="text-[0.83rem] font-semibold text-danger mb-3">{actionError}</p>}
      {(detail.state === "confirmed" || detail.state === "rescheduled") && (
        <div className="flex gap-2 mb-3">
          <button disabled={acting} onClick={() => void closeOut("complete")} className="flex-1 text-[0.83rem] font-bold bg-success text-white rounded-control py-2 disabled:opacity-50">Complete visit</button>
          <button disabled={acting} onClick={() => void closeOut("no-show")} className="flex-1 text-[0.83rem] font-bold bg-white border border-border rounded-control py-2 disabled:opacity-50">Mark no-show</button>
        </div>
      )}
      <div className="card-base p-5 sm:p-6">
        <AppointmentDetailBody appointment={appointment} questionnaire={questionnaire} />
      </div>
    </div>
  );
}
