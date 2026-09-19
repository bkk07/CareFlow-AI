import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { appointmentDetail, type AppointmentDetail as ApiDetail } from "../api";
import { formatDateLabel, formatTime, mapAppointmentState } from "../lib/backend";
import { useSchedule } from "../context/ScheduleContext";
import { AppointmentDetailBody } from "../components/appointments/AppointmentDetail";
import { CardSkeleton, EmptyState, ErrorState } from "../components/common/ui";
import type { Appointment, Questionnaire } from "../types";

function toUI(
  detail: ApiDetail,
  fallbackName: string,
  hospital: string,
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
          completedAt: done.length > 0 ? (done[done.length - 1].completed_at ?? "") : null,
          answers:
            done.length > 0
              ? Object.entries(done[done.length - 1].answers ?? {}).map(([question, response]) => ({
                  question,
                  response: typeof response === "string" ? response : JSON.stringify(response),
                }))
              : [],
        };
  return { appointment, questionnaire };
}

export default function AppointmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { appointments } = useSchedule();
  const [detail, setDetail] = useState<ApiDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    if (!id) {
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(false);
    appointmentDetail(id)
      .then((d) => {
        if (!cancelled) setDetail(d);
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
      <div className="card-base p-5 sm:p-6">
        <AppointmentDetailBody appointment={appointment} questionnaire={questionnaire} />
      </div>
    </div>
  );
}
