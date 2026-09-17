import { APPOINTMENT_TYPES, DOCTORS, HOSPITALS } from "./data";
import type { Appointment, TimeSlot } from "../types";

/** Tiny async helper to make mock flows feel realistic. */
export function mockDelay<T>(value: T, ms = 450): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface DoctorFilter {
  query?: string;
  specialty?: string;
  hospitalId?: string;
  language?: string;
  mode?: string;
}

export async function mockFindDoctors(filter: DoctorFilter = {}) {
  const q = (filter.query ?? "").toLowerCase().trim();
  const result = DOCTORS.filter((d) => {
    if (filter.specialty && filter.specialty !== "All" && d.specialty !== filter.specialty)
      return false;
    if (filter.hospitalId && filter.hospitalId !== "all" && d.hospitalId !== filter.hospitalId)
      return false;
    if (filter.language && filter.language !== "Any" && !d.languages.includes(filter.language))
      return false;
    if (filter.mode && filter.mode !== "any") {
      const map: Record<string, string> = { in_person: "in_person", video: "video", phone: "phone" };
      if (!d.consultationModes.includes(map[filter.mode] as never)) return false;
    }
    if (!q) return true;
    return (
      d.name.toLowerCase().includes(q) ||
      d.specialty.toLowerCase().includes(q) ||
      d.hospitalName.toLowerCase().includes(q)
    );
  });
  return mockDelay(result, 500);
}

export async function mockFindHospitals(query = "") {
  const q = query.toLowerCase().trim();
  const result = HOSPITALS.filter(
    (h) =>
      !q ||
      h.name.toLowerCase().includes(q) ||
      h.location.toLowerCase().includes(q) ||
      h.specialties.some((s) => s.toLowerCase().includes(q)),
  );
  return mockDelay(result, 400);
}

export async function mockCheckAvailability(doctorId: string, dateKey: string): Promise<TimeSlot[]> {
  const seed = hashCode(`${doctorId}:${dateKey}`);
  const defs: { period: TimeSlot["period"]; times: string[] }[] = [
    { period: "morning", times: ["09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM", "11:15 AM"] },
    { period: "afternoon", times: ["01:00 PM", "01:45 PM", "02:30 PM", "03:15 PM", "04:30 PM"] },
    { period: "evening", times: ["05:15 PM", "06:00 PM", "06:45 PM"] },
  ];
  const slots: TimeSlot[] = [];
  defs.forEach((group, gi) => {
    group.times.forEach((t, ti) => {
      const taken = (seed + gi * 7 + ti * 13) % 4 === 0;
      slots.push({
        id: `${doctorId}-${dateKey}-${gi}-${ti}`,
        start: t,
        end: t,
        period: group.period,
        available: !taken,
      });
    });
  });
  // Guarantee at least a few available
  let opened = 0;
  for (const s of slots) {
    if (!s.available && opened < 4 && (seed + opened) % 2 === 0) {
      s.available = true;
      opened++;
    }
  }
  return mockDelay(slots, 550);
}

export function nextSevenDays(): { key: string; label: string; sub: string }[] {
  const days: { key: string; label: string; sub: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short" });
    const sub = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    days.push({ key, label, sub });
  }
  return days;
}

export function mockBookAppointment(input: {
  doctorId: string;
  dateLabel: string;
  time: string;
  mode: Appointment["consultationMode"];
  typeId: string;
}): Appointment {
  const doctor = DOCTORS.find((d) => d.id === input.doctorId)!;
  const type = APPOINTMENT_TYPES.find((t) => t.id === input.typeId) ?? APPOINTMENT_TYPES[0];
  return {
    id: `a-${Date.now()}`,
    doctorId: doctor.id,
    doctorName: doctor.name,
    doctorPhoto: doctor.photo,
    specialty: doctor.specialty,
    hospitalId: doctor.hospitalId,
    hospitalName: doctor.hospitalName,
    department: doctor.department,
    date: input.dateLabel,
    time: input.time,
    slotStart: `${input.dateLabel} ${input.time}`,
    slotEnd: `${input.dateLabel} ${input.time}`,
    durationMinutes: type.durationMinutes,
    consultationMode: input.mode,
    appointmentType: type.name,
    status: "pending",
    location:
      input.mode === "video"
        ? "Video visit · link arrives 30 min before"
        : `${doctor.hospitalName} · ${doctor.department}`,
    verificationStage: "created",
  };
}

export function consultationModeLabel(mode: string): string {
  if (mode === "video") return "Video";
  if (mode === "phone") return "Phone";
  return "In person";
}

export function formatMockError(kind: "doctors" | "availability" | "booking"): string {
  if (kind === "doctors") return "Unable to load doctors right now.";
  if (kind === "availability") return "Unable to load availability for this day.";
  return "Booking failed. Your slot was not held.";
}
