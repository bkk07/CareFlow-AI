import type {
  DoctorResult,
  Hospital,
  Notification,
  PatientAppointment,
  Questionnaire,
  Slot,
} from "../api";
import type {
  Appointment,
  AppointmentStatus,
  ConsultationMode,
  Doctor,
  NotificationCategory,
  NotificationItem,
  TimeSlot,
  Hospital as UIHospital,
} from "../types";

/** Backend state -> portal status buckets used by the Visits tabs. */
export function mapAppointmentState(state: string): AppointmentStatus {
  switch (state) {
    case "confirmed":
    case "rescheduled":
    case "completed":
    case "cancelled":
    case "pending":
    case "sync_pending":
      return state;
    case "requested":
      return "pending";
    case "failed":
    case "reconciliation_required":
      return "sync_pending";
    case "no_show":
      return "completed";
    default:
      return "pending";
  }
}

export function verificationStageFor(state: string): Appointment["verificationStage"] {
  if (state === "confirmed" || state === "rescheduled" || state === "completed") return "confirmed";
  if (state === "pending") return "verified";
  return "created";
}

export function formatSlotDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const label = sameDay(d, today)
    ? "Today"
    : sameDay(d, tomorrow)
      ? "Tomorrow"
      : d.toLocaleDateString("en-US", { weekday: "short" });
  return `${label}, ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function formatSlotTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function periodFor(iso: string): TimeSlot["period"] {
  const h = new Date(iso).getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

/** Backend appointment (enriched view) -> portal Appointment card model. */
export function mapPatientAppointment(a: PatientAppointment): Appointment {
  const status = mapAppointmentState(a.state);
  const mode = a.consultation_mode === "video" || a.consultation_mode === "phone"
    ? a.consultation_mode
    : "in_person";
  return {
    id: a.id,
    doctorId: a.doctor_id,
    doctorName: a.doctor_name,
    doctorPhoto: a.doctor_photo_url ?? "",
    specialty: a.specialty ?? "General",
    hospitalId: a.hospital_id,
    hospitalName: a.hospital_name,
    department: a.department ?? "",
    date: formatSlotDate(a.slot_start),
    time: formatSlotTime(a.slot_start),
    slotStart: a.slot_start,
    slotEnd: a.slot_end,
    durationMinutes: a.duration_minutes,
    consultationMode: mode,
    appointmentType: a.appointment_type_name,
    status,
    location: `${a.hospital_name}${a.department ? ` · ${a.department}` : ""}`,
    verificationStage: verificationStageFor(a.state),
  };
}

const READ_KEY = "careflow_patient_read";

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

/** Backend notification -> inbox item. Read state is local (no read receipts API). */
export function mapNotification(n: Notification, read?: Set<string>): NotificationItem {
  const known = read ?? readIds();
  const type = (n.type ?? "").toLowerCase();
  let category: NotificationCategory = "hospital";
  if (["booking_confirmation", "cancellation", "reschedule", "reminder"].includes(type)) {
    category = "appointments";
  } else if (type.includes("questionnaire")) {
    category = "questionnaires";
  } else if (type.includes("assistant") || type.includes("ai")) {
    category = "assistant";
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

/** Backend slot -> SlotPicker model. */
export function mapSlot(s: Slot, index: number): TimeSlot {
  return {
    id: `live-${index}-${s.start}`,
    start: formatSlotTime(s.start),
    end: formatSlotTime(s.end),
    period: periodFor(s.start),
    available: true,
  };
}

/** Backend doctor search hit -> Doctor card model (directory has no photos/bios). */
export function mapDoctorResult(d: DoctorResult): Doctor {
  const VALID_MODES: ConsultationMode[] = ["in_person", "video", "phone"];
  const rawModes = Array.isArray(d.consultation_types) ? d.consultation_types : [];
  const modes: ConsultationMode[] = rawModes.filter((m): m is ConsultationMode =>
    (VALID_MODES as string[]).includes(m),
  );
  // Fall back only when the backend sent nothing — otherwise show the
  // doctor's real consultation settings (the "original doctor availability").
  const consultationModes = modes.length > 0 ? modes : (["in_person", "video"] as ConsultationMode[]);
  const durations = Array.isArray(d.available_durations)
    ? [...new Set(d.available_durations.filter((n) => typeof n === "number" && n > 0))].sort((a, b) => a - b)
    : [];
  const where = d.hospital_city ? `${d.hospital_name} · ${d.hospital_city}` : d.hospital_name;
  return {
    id: d.id,
    name: d.name,
    title: d.specialty ?? "Physician",
    specialty: d.specialty ?? "General",
    department: "",
    qualifications: "",
    experienceYears: 0,
    languages: ["English"],
    hospitalId: d.hospital_id,
    hospitalName: d.distance_km != null ? `${where} · ${d.distance_km.toFixed(1)} km away` : where,
    photo: "",
    consultationModes,
    availableDurations: durations,
    rating: 0,
    reviewsCount: 0,
    nextAvailable: "Check availability",
    about: `${d.name}${d.specialty ? ` · ${d.specialty}` : ""} at ${d.hospital_name}.`,
    areasOfPractice: d.specialty ? [d.specialty] : [],
    distanceKm: d.distance_km ?? null,
  };
}

/** Backend hospital search hit -> Hospital card model. */
export function mapHospitalResult(h: Hospital): UIHospital {
  const location = h.distance_km != null
    ? `${h.city ?? ""} · ${h.distance_km.toFixed(1)} km away`.replace(/^ · /, "")
    : (h.city ?? "");
  return {
    id: h.id,
    name: h.name,
    location,
    image: "",
    departments: [],
    specialties: [],
    doctorsCount: 0,
    rating: 0,
    consultationTypes: ["in_person", "video"],
    about: h.name,
    distanceKm: h.distance_km ?? null,
  };
}

/**
 * Coerce portal form answers to backend validation types: yes_no wants a
 * boolean (the form stores "Yes"/"No"), numeric wants a number (inputs give
 * strings). Unknown shapes pass through so the backend still validates.
 */
export function coerceQuestionnaireAnswers(
  form: Questionnaire,
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const q of form.questions) {
    const v = answers[q.id];
    if (v === undefined) continue;
    if (q.type === "yes_no") {
      if (typeof v === "boolean") out[q.id] = v;
      else if (typeof v === "string") {
        const t = v.trim().toLowerCase();
        if (t === "yes" || t === "true") out[q.id] = true;
        else if (t === "no" || t === "false") out[q.id] = false;
        else out[q.id] = v;
      } else out[q.id] = v;
    } else if (q.type === "numeric") {
      if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
        out[q.id] = Number(v);
      } else out[q.id] = v;
    } else {
      out[q.id] = v;
    }
  }
  for (const [k, v] of Object.entries(answers)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}
