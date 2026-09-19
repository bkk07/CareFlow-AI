import type {
  BackendNotification,
  BlockedSlot as ApiBlock,
  AvailabilityRule as ApiRule,
  DoctorAppointment,
  DoctorProfile,
  DoctorQuestionnaireItem,
} from "../api";
import type {
  Appointment,
  AppointmentStatus,
  AvailabilityRule,
  BlockedSlot,
  Doctor,
  NotificationCategory,
  NotificationItem,
  Questionnaire,
} from "../types";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function dayName(dayOfWeek: number | null): string {
  if (dayOfWeek == null || dayOfWeek < 0 || dayOfWeek > 6) return "One-off";
  return DAY_NAMES[dayOfWeek];
}

/** Backend state -> portal status. Unknown states stay visible as pending. */
export function mapAppointmentState(state: string): AppointmentStatus {
  switch (state) {
    case "confirmed":
    case "rescheduled":
    case "completed":
    case "cancelled":
    case "pending":
    case "sync_pending":
    case "requested":
    case "no_show":
      return state;
    case "reconciliation_required":
    case "failed":
      return "sync_pending";
    default:
      return "pending";
  }
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayGroupFor(startIso: string): Appointment["dayGroup"] {
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return "later";
  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 1);
  const weekEnd = new Date();
  weekEnd.setDate(now.getDate() + 7);
  if (sameDay(d, now)) return "today";
  if (sameDay(d, tomorrow)) return "tomorrow";
  if (d > tomorrow && d <= weekEnd) return "week";
  return "later";
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function initialsFor(name: string): string {
  return name
    .replace(/^(Dr\.\s*)/i, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Enriched backend appointment -> portal Appointment card model. */
export function mapDoctorAppointment(
  a: DoctorAppointment,
  hospitalName: string,
): Appointment {
  const group = dayGroupFor(a.slot_start);
  return {
    id: a.id,
    patient: {
      id: a.patient_id,
      name: a.patient_name || "Patient",
      age: 0,
      dob: "",
      phone: a.patient_phone ?? "",
      communicationPreference: a.patient_email ?? "",
      initials: initialsFor(a.patient_name || "P"),
    },
    dateLabel: formatDateLabel(a.slot_start),
    dayGroup: group,
    time: formatTime(a.slot_start),
    endTime: formatTime(a.slot_end),
    sortKey: a.slot_start,
    type: a.appointment_type_name || "Visit",
    durationMinutes: 30,
    mode: "in_person",
    status: mapAppointmentState(a.state),
    questionnaire: "not_assigned",
    department: "",
    hospital: hospitalName,
  };
}

/** Backend profile -> portal Doctor. Live-backend-only: every field comes
 *  from the API. Reference names (specialty / department / hospital) have no
 *  backend endpoint, so they render empty until the backend provides them.
 */
export function mapDoctorProfile(p: DoctorProfile): Doctor {
  const qualifications =
    typeof p.qualifications === "object" && p.qualifications !== null
      ? Object.values(p.qualifications).join(", ")
      : "";
  const modes = (p.consultation_types ?? []).filter((m): m is Doctor["consultationTypes"][number] =>
    ["in_person", "video", "phone"].includes(m),
  );
  return {
    id: p.id,
    name: p.name,
    specialty: "",
    department: "",
    qualifications,
    experienceYears: p.experience_years,
    languages: p.languages ?? [],
    hospital: "",
    consultationTypes: modes,
    appointmentDuration: p.default_duration_minutes,
    status: (["invited", "active", "inactive", "suspended"].includes(p.status)
      ? p.status
      : "active") as Doctor["status"],
    photo: p.photo_url ?? "",
    acceptingAppointments: true,
  };
}

/** Backend rules -> one row per weekday (missing days render Closed). */
export function mapRules(rules: ApiRule[]): AvailabilityRule[] {
  const byDay = new Map<number, ApiRule>();
  for (const r of rules) {
    if (r.day_of_week != null && !byDay.has(r.day_of_week)) byDay.set(r.day_of_week, r);
  }
  return DAY_NAMES.map((day, idx) => {
    const hit = byDay.get(idx);
    if (!hit) return { id: `day-${idx}`, day, enabled: false, start: "09:00", end: "17:00" };
    return {
      id: hit.id,
      day,
      enabled: true,
      start: hit.start_time.slice(0, 5),
      end: hit.end_time.slice(0, 5),
    };
  });
}

function blockReasonLabel(reason: string): BlockedSlot["reason"] {
  if (reason === "leave") return "Leave";
  return "Administrative work";
}

export function blockReasonToApi(reason: BlockedSlot["reason"]): string {
  return reason === "Leave" ? "leave" : "ad_hoc";
}

/** Backend blocks -> portal BlockedSlot display model. */
export function mapBlocks(blocks: ApiBlock[]): BlockedSlot[] {
  return blocks.map((b) => {
    const s = new Date(b.start_datetime);
    const e = new Date(b.end_datetime);
    const date = Number.isNaN(s.getTime())
      ? b.start_datetime
      : s.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
    return {
      id: b.id,
      date,
      start: Number.isNaN(s.getTime()) ? b.start_datetime : formatTime(b.start_datetime),
      end: Number.isNaN(e.getTime()) ? b.end_datetime : formatTime(b.end_datetime),
      reason: blockReasonLabel(b.reason),
    };
  });
}

const READ_KEY = "careflow_doctor_read";

function readIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function persistRead(id: string) {
  try {
    const ids = readIds();
    ids.add(id);
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode */
  }
}

/** Backend notification -> portal inbox item. Read state stays local. */
export function mapNotification(n: BackendNotification): NotificationItem {
  const known = readIds();
  const type = (n.type ?? "").toLowerCase();
  let category: NotificationCategory = "system";
  if (
    ["booking_confirmation", "cancellation", "reschedule", "reminder", "booking"].some(
      (k) => type.includes(k),
    ) ||
    type.includes("appointment")
  ) {
    category = "appointments";
  } else if (type.includes("questionnaire")) {
    category = "questionnaires";
  }
  const when = new Date(n.created_at);
  const time = Number.isNaN(when.getTime())
    ? ""
    : when.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " · " +
      when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return {
    id: n.id,
    category,
    title: n.subject ?? "CareFlow AI update",
    body: n.body ?? "",
    time,
    unread: !known.has(n.id),
  };
}

/** Aggregated inbox item -> portal Questionnaire card. */
export function mapQuestionnaireItem(item: DoctorQuestionnaireItem): Questionnaire {
  const done = item.responses.filter((r) => r.completed);
  const status =
    done.length > 0 ? "completed" : item.responses.length > 0 ? "in_progress" : "assigned";
  const last = done.length > 0 ? done[done.length - 1] : null;
  const answers =
    last != null
      ? Object.entries(last.answers ?? {}).map(([question, response]) => ({
          question,
          response: typeof response === "string" ? response : JSON.stringify(response),
        }))
      : [];
  return {
    id: item.appointment_id,
    appointmentId: item.appointment_id,
    patientName: item.patient_name,
    name: "Pre-visit questionnaire",
    status,
    completedAt: last?.completed_at
      ? new Date(last.completed_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null,
    answers,
  };
}
