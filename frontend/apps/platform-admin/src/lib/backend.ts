import type {
  AIEvaluation,
  ApiHospital,
  Appointment as ApiAppointment,
  AuditEvent as ApiAudit,
  OpsMetrics,
  PlatformAnalytics,
  PlatformDoctor,
  PlatformIntegration,
  PlatformOverview,
  PlatformPatient,
  WorkflowExecution,
} from "../api";
import type {
  Appointment as UIAppointment,
  AppointmentStatus,
  AuditEvent,
  Doctor,
  Hospital,
  Integration,
  Workflow,
} from "../types";

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Backend hospitals carry no directory counts — the portal fills what the
 *  platform lists provide (doctors per hospital) and marks the rest unknown. */
export function mapHospital(
  h: ApiHospital,
  doctorsTotal: number,
  doctorsActive: number,
  appointmentsToday: number,
): Hospital {
  return {
    id: h.id,
    name: h.name,
    location: h.address,
    contact: `${h.contact_email} · ${h.contact_phone}`,
    status: h.status as Hospital["status"],
    departments: 0,
    doctors: doctorsTotal,
    activeDoctors: doctorsActive,
    appointmentsToday,
    submitted: formatDate(h.submitted_at),
  };
}

export function mapDoctor(d: PlatformDoctor, hospitalName: string): Doctor {
  return {
    id: d.id,
    name: d.name,
    photo: "",
    specialty: "—",
    department: "—",
    experience: d.experience_years,
    modes: d.consultation_types ?? [],
    status: d.status as Doctor["status"],
    availability: d.status === "active" ? "Active" : "—",
    appointmentsWeek: 0,
    qualifications: "",
    languages: d.languages ?? [],
    hospital: hospitalName,
  };
}

export function mapPatient(p: PlatformPatient): {
  id: string;
  email: string;
  active: boolean;
  since: string;
} {
  const local = p.email.split("@")[0];
  const masked = `${local.slice(0, 1)}.***@${p.email.split("@")[1] ?? ""}`;
  return {
    id: p.id,
    email: masked,
    active: p.is_active,
    since: formatDate(p.created_at),
  };
}

function appointmentStatus(state: string): AppointmentStatus {
  switch (state) {
    case "confirmed":
    case "pending":
    case "rescheduled":
    case "cancelled":
    case "completed":
    case "sync_pending":
      return state;
    default:
      return "sync_pending";
  }
}

export function mapAppointment(
  a: ApiAppointment,
  hospitalName: string,
  doctorName: string,
): UIAppointment {
  return {
    id: a.id.slice(0, 8).toUpperCase(),
    patient: a.patient_id.slice(0, 8),
    doctor: doctorName,
    specialty: "—",
    hospital: hospitalName,
    date: formatDate(a.slot_start),
    time: formatTime(a.slot_start),
    type: "Visit",
    status: appointmentStatus(a.state),
    questionnaire: "none",
    created: formatDate(a.created_at),
  };
}

export function mapAudit(e: ApiAudit, actorName: string): AuditEvent {
  return {
    id: e.id,
    time: formatDateTime(e.created_at),
    actor: actorName,
    action: e.action,
    resource: `${e.entity_type}:${e.entity_id.slice(0, 8)}`,
    result: "success",
    correlationId: e.correlation_id.slice(0, 13),
  };
}

const WORKFLOW_LABEL: Record<string, string> = {
  "appointment.booked": "Booking notifications",
  "appointment.rescheduled": "Reschedule follow-ups",
  "appointment.cancelled": "Cancellation follow-ups",
  "reminder.sweep": "Visit reminders",
  "reconciliation.sweep": "Reconciliation sweep",
};

export function mapWorkflow(w: WorkflowExecution): Workflow {
  return {
    id: w.id,
    name: WORKFLOW_LABEL[w.event_type] ?? w.event_type,
    trigger: w.event_type,
    status: w.status === "failed" ? "failing" : "active",
    lastRun: formatDateTime(w.updated_at),
    success: w.status === "completed" ? 1 : 0,
    failed: w.status === "failed" ? 1 : 0,
    steps: [`Event ${w.event_type}`, `Attempt ${w.attempt}`, `Appointment ${w.appointment_id ? w.appointment_id.slice(0, 8) : "—"}`],
  };
}

export function mapPlatformIntegration(i: PlatformIntegration): Integration {
  const failed = (i.operations_by_status.failed ?? 0) + (i.operations_by_status.timed_out ?? 0);
  return {
    id: i.hospital_id,
    name: `${i.hospital_name} · Mock EHR`,
    env: "test",
    status: i.open_reconciliations > 0 || failed > 0 ? "degraded" : "connected",
    lastSync: "—",
    requests: i.operations_total,
    success: i.operations_by_status.succeeded ?? 0,
    failures: failed,
    verifications: i.verifications_24h,
    retries: 0,
    unknown: i.operations_by_status.unknown ?? 0,
  };
}

export type {
  AIEvaluation,
  OpsMetrics,
  PlatformAnalytics,
  PlatformOverview,
};
