import axios from "axios";

const baseURL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

export const api = axios.create({ baseURL });

const TOKEN_KEY = "careflow_patient_token";

export function setAccessToken(token: string | null) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    delete api.defaults.headers.common["Authorization"];
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function restoreAccessToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  return token;
}

export function apiError(e: unknown): string {
  if (typeof e === "object" && e !== null && "response" in e) {
    const r = (e as { response?: { data?: { detail?: unknown }; status?: number } })
      .response;
    if (r?.data?.detail) return `Error ${r.status ?? ""}: ${JSON.stringify(r.data.detail)}`;
  }
  return "Request failed";
}

export interface CurrentUser {
  id: string;
  email: string;
  role: string;
  hospital_id: string | null;
  created_at: string;
}

export interface Hospital {
  id: string;
  name: string;
}

export interface DoctorResult {
  id: string;
  name: string;
  hospital_id: string;
  hospital_name: string;
  specialty: string | null;
}

export interface Specialty {
  id: string;
  name: string;
}

export interface AppointmentType {
  id: string;
  name: string;
  duration_minutes: number;
}

export interface Slot {
  start: string;
  end: string;
}

export interface Appointment {
  id: string;
  hospital_id: string;
  patient_id: string;
  doctor_id: string;
  appointment_type_id: string;
  slot_start: string;
  slot_end: string;
  state: string;
  external_id: string | null;
  idempotency_key: string;
}

export interface HistoryEntry {
  id: string;
  from_state: string;
  to_state: string;
  reason: string | null;
  created_at: string;
}

export interface AppointmentDetail extends Appointment {
  history: HistoryEntry[];
}

export interface Preferences {
  patient_user_id: string;
  preferred_doctor_id: string | null;
  preferred_hospital_id: string | null;
  preferred_appointment_type_id: string | null;
  preferred_time_of_day: string | null;
  preferred_consultation_mode: string | null;
  updated_at: string;
}

export interface Notification {
  id: string;
  channel: string;
  type: string;
  status: string;
  subject: string | null;
  body: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface Questionnaire {
  id: string;
  name: string;
  questions: {
    id: string;
    order: number;
    type: string;
    prompt: string;
    options: string[] | null;
    required: boolean;
  }[];
}

export interface QuestionnaireResponse {
  id: string;
  appointment_id: string;
  questionnaire_id: string;
  answers: Record<string, unknown>;
  completed: boolean;
  completed_at: string | null;
}

export function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `key-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export async function login(email: string, password: string): Promise<void> {
  const { data } = await api.post("/auth/login", { email, password });
  setAccessToken(data.access_token);
}

export async function me(): Promise<CurrentUser> {
  return (await api.get("/auth/me")).data;
}

export async function mcpCall<T>(tool: string, input: Record<string, unknown>): Promise<T> {
  const { data } = await api.post("/mcp/call", { tool, input });
  return data.result as T;
}

export async function searchHospitals(query: string): Promise<Hospital[]> {
  const result = await mcpCall<{ hospitals: Hospital[] }>(
    "search_hospitals",
    query ? { query } : {},
  );
  return result.hospitals;
}

export async function searchDoctors(args: {
  hospital_id?: string;
  specialty?: string;
  query?: string;
}): Promise<DoctorResult[]> {
  const input: Record<string, unknown> = {};
  if (args.hospital_id) input.hospital_id = args.hospital_id;
  if (args.specialty) input.specialty = args.specialty;
  if (args.query) input.query = args.query;
  const result = await mcpCall<{ doctors: DoctorResult[] }>("search_doctors", input);
  return result.doctors;
}

export async function listSpecialties(hospitalId: string): Promise<Specialty[]> {
  const { data } = await api.get("/directory/specialties", {
    params: { hospital_id: hospitalId },
  });
  return data.specialties;
}

export async function listAppointmentTypes(hospitalId: string): Promise<AppointmentType[]> {
  const { data } = await api.get("/directory/appointment-types", {
    params: { hospital_id: hospitalId },
  });
  return data.appointment_types;
}

export async function checkAvailability(args: {
  doctor_id: string;
  appointment_type_id: string;
  date_from: string;
  date_to: string;
}): Promise<Slot[]> {
  const result = await mcpCall<{ slots: Slot[] }>("check_availability", {
    doctor_id: args.doctor_id,
    appointment_type_id: args.appointment_type_id,
    date_from: args.date_from,
    date_to: args.date_to,
  });
  return result.slots;
}

export async function probeBackend(timeoutMs = 4000): Promise<boolean> {
  try {
    await api.get("/health", { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export function wsBase(): string {
  return baseURL.replace(/^http/, "ws");
}

export async function registerPatient(email: string, password: string): Promise<void> {
  await api.post("/auth/register", { email, password, role: "patient" });
  await login(email, password);
}

export interface PatientAppointment {
  id: string;
  doctor_id: string;
  doctor_name: string;
  doctor_photo_url: string | null;
  specialty: string | null;
  department: string | null;
  hospital_id: string;
  hospital_name: string;
  appointment_type_id: string;
  appointment_type_name: string;
  duration_minutes: number;
  slot_start: string;
  slot_end: string;
  state: string;
  created_at: string;
  updated_at: string;
}

export interface PatientAppointmentDetail extends PatientAppointment {
  history: HistoryEntry[];
}

export async function fetchMyAppointments(): Promise<PatientAppointment[]> {
  return (await api.get("/patients/me/appointments")).data;
}

export async function fetchMyAppointment(id: string): Promise<PatientAppointmentDetail> {
  return (await api.get(`/patients/me/appointments/${id}`)).data;
}

export async function createAppointment(args: {
  patient_id: string;
  doctor_id: string;
  appointment_type_id: string;
  slot_start: string;
  slot_end: string;
}): Promise<Appointment> {
  return (
    await api.post("/appointments", { ...args, idempotency_key: newKey() })
  ).data;
}

export async function rescheduleAppointment(
  id: string,
  args: { slot_start: string; slot_end: string; reason?: string },
): Promise<Appointment> {
  return (await api.post(`/appointments/${id}/reschedule`, args)).data;
}

export async function cancelAppointment(id: string, reason?: string): Promise<Appointment> {
  return (await api.post(`/appointments/${id}/cancel`, { reason: reason ?? null })).data;
}

export interface Contact {
  patient_user_id: string;
  phone: string | null;
  full_name: string | null;
  date_of_birth: string | null;
  updated_at: string;
}

export async function fetchContact(): Promise<Contact> {
  return (await api.get("/patients/me/contact")).data;
}

export async function saveContact(args: {
  full_name?: string | null;
  phone?: string | null;
  date_of_birth?: string | null;
}): Promise<Contact> {
  return (await api.put("/patients/me/contact", args)).data;
}

export async function updateEmail(email: string): Promise<CurrentUser> {
  return (await api.put("/patients/me", { email })).data;
}

export interface BackendPreferences {
  patient_user_id: string;
  preferred_doctor_id: string | null;
  preferred_hospital_id: string | null;
  preferred_appointment_type_id: string | null;
  preferred_time_of_day: string | null;
  preferred_consultation_mode: string | null;
  updated_at: string;
}

export async function fetchPreferences(): Promise<BackendPreferences> {
  return (await api.get("/patients/me/preferences")).data;
}

export async function savePreferences(
  patch: Partial<
    Pick<
      BackendPreferences,
      | "preferred_doctor_id"
      | "preferred_hospital_id"
      | "preferred_appointment_type_id"
      | "preferred_time_of_day"
      | "preferred_consultation_mode"
    >
  >,
): Promise<BackendPreferences> {
  return (await api.put("/patients/me/preferences", patch)).data;
}

export async function fetchNotifications(): Promise<Notification[]> {
  return (await api.get("/notifications")).data;
}

export interface ChatReply {
  conversation_id: string;
  reply: string;
  iterations: number;
  escalated: boolean;
  stopped: boolean;
}

export async function postChat(message: string, conversationId?: string | null): Promise<ChatReply> {
  return (
    await api.post("/chat", {
      message,
      conversation_id: conversationId ?? null,
    })
  ).data;
}

export async function fetchAppointmentQuestionnaire(
  appointmentId: string,
): Promise<Questionnaire | null> {
  return (await api.get(`/appointments/${appointmentId}/questionnaire`)).data;
}

export interface QuestionnaireSubmitOut {
  id: string;
  appointment_id: string;
  questionnaire_id: string;
  answers: Record<string, unknown>;
  completed: boolean;
  completed_at: string | null;
  flagged: boolean;
  escalation_id: string | null;
}

export async function submitQuestionnaireAnswers(
  appointmentId: string,
  answers: Record<string, unknown>,
): Promise<QuestionnaireSubmitOut> {
  return (
    await api.post(`/appointments/${appointmentId}/questionnaire/responses`, {
      answers,
    })
  ).data;
}
