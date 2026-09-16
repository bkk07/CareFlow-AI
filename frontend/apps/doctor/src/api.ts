import axios from "axios";

const baseURL =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_URL ?? "http://localhost:8000";

export const api = axios.create({ baseURL });

export function setAccessToken(token: string | null) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    localStorage.setItem("careflow_doctor_token", token);
  } else {
    delete api.defaults.headers.common["Authorization"];
    localStorage.removeItem("careflow_doctor_token");
  }
}

export function restoreAccessToken(): string | null {
  const token = localStorage.getItem("careflow_doctor_token");
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  }
  return token;
}

export interface CurrentUser {
  id: string;
  email: string;
  role: string;
  hospital_id: string | null;
}

export interface DoctorProfile {
  id: string;
  hospital_id: string;
  name: string;
  status: string;
}

export interface Appointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  slot_start: string;
  slot_end: string;
  state: string;
  external_id: string | null;
}

export interface AvailabilityRule {
  id: string;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  recurrence: string;
}

export interface BlockedSlot {
  id: string;
  start_datetime: string;
  end_datetime: string;
  reason: string;
}

export interface Calendar {
  id: string;
  doctor_id: string;
  is_active: boolean;
}

export interface DoctorCalendar {
  calendar: Calendar;
  rules: AvailabilityRule[];
  blocks: BlockedSlot[];
  live_appointments: Appointment[];
}

export interface QuestionnaireResponse {
  id: string;
  appointment_id: string;
  questionnaire_id: string;
  answers: Record<string, unknown>;
  completed: boolean;
  completed_at: string | null;
}

export async function login(email: string, password: string): Promise<void> {
  const { data } = await api.post("/auth/login", { email, password });
  setAccessToken(data.access_token);
}

export async function me(): Promise<CurrentUser> {
  const { data } = await api.get("/auth/me");
  return data;
}
