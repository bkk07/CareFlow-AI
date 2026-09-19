import type {
  AIActivityEntry,
  Appointment,
  Department as ApiDepartment,
  DoctorDetail,
  Escalation as ApiEscalation,
  Hospital,
  Operation as ApiOperation,
  Questionnaire as ApiQuestionnaire,
  QuestionnaireDetail,
  ReconciliationRecord as ApiReconciliation,
  Specialty as ApiSpecialty,
  StaffMember as ApiStaff,
  AppointmentType as ApiType,
  WorkflowExecution,
} from "../api";
import type {
  Appointment as UIAppointment,
  AppointmentStatus,
  Department,
  Doctor,
  Escalation,
  Operation,
  Questionnaire,
  Reconciliation,
  Specialty,
  StaffMember,
  AppointmentType as UIType,
  Workflow,
} from "../types";

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

/** Backend departments/specialties carry no counts or status — the portal
 *  derives counts client-side and treats every row as active. */
export function mapDepartment(d: ApiDepartment, specialties: number, doctors: number): Department {
  return {
    id: d.id,
    name: d.name,
    specialties,
    doctors,
    status: "active",
    updated: formatDate(d.updated_at),
  };
}

export function mapSpecialty(s: ApiSpecialty, doctors: number, departmentName: string): Specialty {
  return {
    id: s.id,
    name: s.name,
    department: departmentName,
    doctors,
    status: "active",
  };
}

export function mapAppointmentType(t: ApiType): UIType {
  return {
    id: t.id,
    name: t.name,
    description: `${t.duration_minutes} min visit`,
    duration: t.duration_minutes,
    mode: "In person",
    status: "active",
  };
}

export function mapDoctor(
  d: DoctorDetail,
  specialtyName: string,
  departmentName: string,
  hospitalName: string,
  appointmentsWeek: number,
): Doctor {
  const quals =
    typeof d.qualifications === "object" && d.qualifications !== null
      ? Object.values(d.qualifications).join(", ")
      : "";
  return {
    id: d.id,
    name: d.name,
    photo: d.photo_url ?? "",
    specialty: specialtyName || "General",
    department: departmentName || "General",
    experience: d.experience_years,
    modes: d.consultation_types.length > 0 ? d.consultation_types : ["In person"],
    durations: (d.available_durations ?? []).length > 0
      ? [...new Set(d.available_durations)].sort((a, b) => a - b)
      : [d.default_duration_minutes],
    status: d.status as Doctor["status"],
    availability: d.status === "active" ? "Active" : d.status === "invited" ? "—" : "Paused",
    appointmentsWeek,
    qualifications: quals,
    languages: d.languages,
    hospital: hospitalName,
    loginEmail: d.login_email ?? null,
  };
}

export function mapAppointment(
  a: Appointment,
  doctorName: string,
  specialty: string,
  hospitalName: string,
  typeName: string,
): UIAppointment {
  return {
    // Full backend id (pages slice for display); cancel needs the UUID.
    id: a.id,
    patient: a.patient_id.slice(0, 8),
    doctor: doctorName,
    specialty,
    hospital: hospitalName,
    date: formatDate(a.slot_start),
    time: formatTime(a.slot_start),
    type: typeName,
    status: appointmentStatus(a.state),
    questionnaire: "none",
    created: formatDate(a.created_at),
  };
}

const Q_TYPE_LABEL: Record<string, string> = {
  yes_no: "Yes/No",
  choice: "Single choice",
  multi_choice: "Multiple choice",
  numeric: "Numeric",
  date: "Date",
  short_text: "Short text",
  long_text: "Long text",
  structured: "Structured field",
};

export function mapQuestionnaire(
  q: ApiQuestionnaire,
  detail: QuestionnaireDetail | null,
): Questionnaire {
  const fields = (detail?.questions ?? []).map((f) => ({
    question: f.prompt,
    type: Q_TYPE_LABEL[f.type] ?? f.type,
    required: f.required,
    options: f.options ?? undefined,
  }));
  return {
    id: q.id,
    name: q.name,
    specialty: q.scope === "hospital" ? "All specialties" : q.scope,
    doctor: "All doctors",
    type: "Pre-visit",
    status: q.is_active ? "active" : "inactive",
    questions: (detail?.questions ?? []).length,
    updated: formatDate(q.created_at),
    fields,
  };
}

export function mapAIExecution(e: AIActivityEntry): {
  id: string;
  time: string;
  tool: string;
  status: string;
  latency: number;
  correlation: string;
  actor: string | null;
  error: string | null;
} {
  return {
    id: e.id,
    time: formatDateTime(e.created_at),
    tool: e.tool_name,
    status: e.status,
    latency: e.latency_ms,
    correlation: e.correlation_id,
    actor: e.actor_user_id,
    error: e.error,
  };
}

const WORKFLOW_LABEL: Record<string, { name: string; steps: string[] }> = {
  "appointment.booked": {
    name: "Booking notifications",
    steps: ["Appointment confirmed", "Patient notified", "Calendar synced"],
  },
  "appointment.rescheduled": {
    name: "Reschedule follow-ups",
    steps: ["Slot moved", "Patient notified", "Vendor synchronized"],
  },
  "appointment.cancelled": {
    name: "Cancellation follow-ups",
    steps: ["Booking cancelled", "Slot released", "Patient notified"],
  },
  "reminder.sweep": {
    name: "Visit reminders",
    steps: ["Upcoming visits scanned", "Reminders queued", "Notifications sent"],
  },
  "reconciliation.sweep": {
    name: "Reconciliation sweep",
    steps: ["Open cases scanned", "Vendor re-checked", "Queue updated"],
  },
};

export function mapWorkflow(w: WorkflowExecution): Workflow {
  const known = WORKFLOW_LABEL[w.event_type];
  const history = Array.isArray(w.execution_history) ? w.execution_history.length : 0;
  return {
    id: w.id,
    name: known?.name ?? w.event_type,
    trigger: w.event_type,
    status: w.status === "failed" ? "failing" : w.status === "running" ? "active" : "active",
    lastRun: formatDateTime(w.updated_at),
    success: w.status === "completed" ? 1 : 0,
    failed: w.status === "failed" ? 1 : 0,
    steps: known?.steps ?? [`Event ${w.event_type}`, `${history} history entries`, `Attempt ${w.attempt}`],
  };
}

function opStatus(status: string): Operation["status"] {
  switch (status) {
    case "failed":
    case "timed_out":
      return "failed";
    case "unknown":
      return "unknown";
    case "succeeded":
    case "sent":
      return "resolved";
    default:
      return "unknown";
  }
}

export function mapOperation(o: ApiOperation): Operation {
  const st = opStatus(o.status);
  return {
    // Full backend id (pages slice for display); actions need the UUID.
    id: o.id,
    type: o.operation_type,
    appointment: o.appointment_id,
    patient: "—",
    system: "EHR",
    status: st,
    started: formatDateTime(o.created_at),
    lastAttempt: formatDateTime(o.created_at),
    attempts: o.attempt_number,
    nextRetry: st === "failed" ? "In 15 min" : "—",
    error: o.error ?? "",
    timeline: [
      { label: "External request sent", state: "done" as const, detail: o.operation_type },
      {
        label: st === "failed" ? "Request failed" : st === "unknown" ? "Outcome unknown" : "Vendor confirmed",
        state: st === "failed" ? ("failed" as const) : st === "unknown" ? ("unknown" as const) : ("done" as const),
        detail: o.error ?? undefined,
      },
    ],
    correlationId: o.correlation_id,
  };
}

export function mapReconciliation(r: ApiReconciliation): Reconciliation {
  return {
    // Full backend ids (pages slice for display); actions need the UUIDs.
    id: r.id,
    operationId: r.operation_id ?? r.appointment_id,
    appointmentId: r.appointment_id,
    externalId: r.external_id,
    error: r.error,
    attempts: r.attempts,
    externalStatus: r.external_status ?? "—",
    internalState: r.internal_status,
    resolution:
      r.resolution_status === "open"
        ? "open"
        : r.resolution_status === "escalated"
          ? "escalated"
          : "resolved",
    updated: formatDateTime(r.created_at),
    note: r.note,
  };
}

export function mapEscalation(e: ApiEscalation): Escalation {
  return {
    // Full backend id (pages slice for display); resolve needs the UUID.
    id: e.id,
    title: `Escalation ${e.id.slice(0, 8)}`,
    priority: "medium",
    appointment: e.appointment_id ?? "—",
    issue: e.reason,
    assignee: "Unassigned",
    created: formatDateTime(e.created_at),
    status: e.status === "resolved" ? "resolved" : "new",
  };
}

export function mapStaff(s: ApiStaff): StaffMember {
  return {
    id: s.id,
    name: s.email.split("@")[0],
    role: s.role === "hospital_admin" ? "Hospital Admin" : s.role,
    status: s.is_active ? "active" : "deactivated",
    lastActive: s.is_active ? formatDate(s.created_at) : "Deactivated",
  };
}

export function hospitalContact(h: Hospital): { contact: string; website: string } {
  return { contact: `${h.contact_email} · ${h.contact_phone}`, website: "" };
}
