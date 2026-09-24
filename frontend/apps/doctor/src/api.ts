import axios from "axios";

const _viteEnv = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;
const _viteApiUrl = _viteEnv?.VITE_API_URL;
if (!_viteApiUrl && !_viteEnv?.DEV) {
  throw new Error(
    "VITE_API_URL is not configured. Set it to the backend base URL (e.g. https://<backend-host>).",
  );
}
// Local development default (matches .env.example). Production builds
// must provide VITE_API_URL — see the check above.
const baseURL = _viteApiUrl ?? "http://localhost:8000";

export const api = axios.create({ baseURL });

const TOKEN_KEY = "careflow_doctor_token";
const REFRESH_KEY = "careflow_doctor_refresh";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

export function setAccessToken(token: string | null) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    safeSet(TOKEN_KEY, token);
  } else {
    delete api.defaults.headers.common["Authorization"];
    safeRemove(TOKEN_KEY);
    safeRemove(REFRESH_KEY);
  }
}

export function restoreAccessToken(): string | null {
  const token = safeGet(TOKEN_KEY);
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  }
  return token;
}

function saveTokens(access: string, refresh: string) {
  setAccessToken(access);
  safeSet(REFRESH_KEY, refresh);
}

// Silent refresh: on 401 try one refresh with the stored refresh token
// (2-day expiry) before surfacing the error, so users are not bounced
// to login while their refresh token is still valid.
let refreshInFlight: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    const rt = safeGet(REFRESH_KEY);
    if (!rt) return null;
    refreshInFlight = (async () => {
      try {
        const { data } = await axios.post(`${baseURL}/auth/refresh`, {
          refresh_token: rt,
        });
        saveTokens(data.access_token, data.refresh_token);
        return data.access_token as string;
      } catch {
        setAccessToken(null);
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error?.config;
    const status = error?.response?.status;
    const url: string = original?.url ?? "";
    if (
      status === 401 &&
      original &&
      !original._retry &&
      !url.includes("/auth/login") &&
      !url.includes("/auth/refresh")
    ) {
      original._retry = true;
      const fresh = await refreshAccessToken();
      if (fresh) {
        original.headers = original.headers ?? {};
        original.headers["Authorization"] = `Bearer ${fresh}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

export async function probeBackend(timeoutMs = 4000): Promise<boolean> {
  try {
    await api.get("/health", { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
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
  photo_url: string | null;
  specialty_id: string | null;
  department_id: string | null;
  qualifications: Record<string, unknown>;
  experience_years: number;
  languages: string[];
  consultation_types: string[];
  default_duration_minutes: number;
  available_durations: number[];
  external_provider_id: string | null;
  user_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DoctorSelfUpdate {
  name?: string;
  photo_url?: string | null;
  qualifications?: Record<string, unknown>;
  experience_years?: number;
  languages?: string[];
  consultation_types?: string[];
  default_duration_minutes?: number;
  available_durations?: number[];
}

export interface DoctorAppointment {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_email: string | null;
  patient_phone: string | null;
  doctor_id: string;
  appointment_type_id: string;
  appointment_type_name: string;
  slot_start: string;
  slot_end: string;
  state: string;
  consultation_mode: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentHistoryEntry {
  id: string;
  appointment_id: string;
  from_state: string;
  to_state: string;
  actor_user_id: string | null;
  actor_system: string | null;
  reason: string | null;
  correlation_id: string;
  created_at: string;
}

export interface AppointmentDetail {
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
  correlation_id: string;
  created_at: string;
  updated_at: string;
  history: AppointmentHistoryEntry[];
  /** Questionnaire responses side-loaded for the detail view. */
  responses: QuestionnaireResponse[];
}

export interface AvailabilityRule {
  id: string;
  doctor_id: string;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  recurrence: string;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string;
}

export interface BlockedSlot {
  id: string;
  doctor_id: string;
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
  live_appointments: DoctorAppointment[];
}

export interface QuestionnaireResponse {
  id: string;
  appointment_id: string;
  questionnaire_id: string;
  answers: Record<string, unknown>;
  completed: boolean;
  completed_at: string | null;
  flagged?: boolean;
  escalation_id?: string | null;
}

export interface DoctorQuestionPrompt {
  id: string;
  prompt: string;
}

export interface DoctorQuestionnaireItem {
  appointment_id: string;
  patient_id: string;
  patient_name: string;
  slot_start: string;
  slot_end: string;
  state: string;
  responses: QuestionnaireResponse[];
  questions?: DoctorQuestionPrompt[];
  has_questionnaire?: boolean;
}

export interface AppointmentQuestionnaire {
  questionnaire: { id: string; name: string };
  questions: { id: string; prompt: string }[];
}

export interface BackendNotification {
  id: string;
  channel: string;
  type: string;
  status: string;
  subject: string | null;
  body: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
  is_read?: boolean;
  read_at?: string | null;
}

export interface Slot {
  start: string;
  end: string;
}

export async function login(email: string, password: string): Promise<void> {
  const { data } = await api.post("/auth/login", { email, password });
  saveTokens(data.access_token, data.refresh_token);
}

export async function me(): Promise<CurrentUser> {
  const { data } = await api.get("/auth/me");
  return data;
}

export async function myProfile(): Promise<DoctorProfile> {
  return (await api.get("/doctors/me")).data;
}

export async function updateMyProfile(
  patch: DoctorSelfUpdate,
): Promise<DoctorProfile> {
  return (await api.put("/doctors/me", patch)).data;
}

export async function myAppointments(
  range: "today" | "upcoming" = "upcoming",
): Promise<DoctorAppointment[]> {
  return (await api.get("/doctors/me/appointments", { params: { range } })).data;
}

export async function appointmentDetail(id: string): Promise<AppointmentDetail> {
  // GET /appointments/{id} already embeds `history`; responses ride along
  // so the detail view renders without extra lookups.
  const [detail, responses] = await Promise.all([
    api.get(`/appointments/${id}`).then((r) => r.data),
    questionnaireResponses(id).catch(() => [] as QuestionnaireResponse[]),
  ]);
  return { ...detail, responses };
}

export async function myCalendar(): Promise<DoctorCalendar> {
  const data = (await api.get("/doctors/me/calendar")).data;
  return {
    calendar: data.calendar,
    rules: data.rules,
    blocks: data.blocks,
    // /doctors/me/calendar names the live list `live_appointments`
    live_appointments: data.live_appointments ?? data.live ?? [],
  };
}

export async function listRules(
  hospitalId: string,
  doctorId: string,
): Promise<AvailabilityRule[]> {
  return (
    await api.get(`/hospitals/${hospitalId}/doctors/${doctorId}/availability-rules`)
  ).data;
}

export async function createRule(
  hospitalId: string,
  doctorId: string,
  body: {
    day_of_week: number | null;
    start_time: string;
    end_time: string;
    recurrence?: string;
  },
): Promise<AvailabilityRule> {
  return (
    await api.post(
      `/hospitals/${hospitalId}/doctors/${doctorId}/availability-rules`,
      { recurrence: "weekly", ...body },
    )
  ).data;
}

export async function deleteRule(
  hospitalId: string,
  doctorId: string,
  ruleId: string,
): Promise<void> {
  await api.delete(
    `/hospitals/${hospitalId}/doctors/${doctorId}/availability-rules/${ruleId}`,
  );
}

export async function listBlocks(
  hospitalId: string,
  doctorId: string,
): Promise<BlockedSlot[]> {
  return (
    await api.get(`/hospitals/${hospitalId}/doctors/${doctorId}/blocked-slots`)
  ).data;
}

export async function createBlock(
  hospitalId: string,
  doctorId: string,
  body: { start_datetime: string; end_datetime: string; reason?: string },
): Promise<BlockedSlot> {
  return (
    await api.post(
      `/hospitals/${hospitalId}/doctors/${doctorId}/blocked-slots`,
      body,
    )
  ).data;
}

export async function deleteBlock(
  hospitalId: string,
  doctorId: string,
  blockId: string,
): Promise<void> {
  await api.delete(
    `/hospitals/${hospitalId}/doctors/${doctorId}/blocked-slots/${blockId}`,
  );
}

export async function updateCalendar(
  hospitalId: string,
  doctorId: string,
  isActive: boolean,
): Promise<Calendar> {
  return (
    await api.put(`/hospitals/${hospitalId}/doctors/${doctorId}/calendar`, {
      is_active: isActive,
    })
  ).data;
}

export async function questionnaireResponses(
  appointmentId: string,
): Promise<QuestionnaireResponse[]> {
  return (await api.get(`/appointments/${appointmentId}/questionnaire/responses`))
    .data;
}

export async function questionnaireInbox(): Promise<DoctorQuestionnaireItem[]> {
  return (await api.get("/doctors/me/questionnaire-responses")).data;
}

export async function fetchAppointmentQuestionnaire(
  appointmentId: string,
): Promise<AppointmentQuestionnaire | null> {
  return (await api.get(`/appointments/${appointmentId}/questionnaire`)).data;
}

export async function fetchNotifications(): Promise<BackendNotification[]> {
  return (await api.get("/notifications")).data;
}

export async function fetchNotification(id: string): Promise<BackendNotification> {
  return (await api.get(`/notifications/${id}`)).data;
}

export async function markNotificationRead(id: string): Promise<BackendNotification> {
  return (await api.post(`/notifications/${id}/read`)).data;
}

export async function markAllNotificationsRead(): Promise<{ marked: number }> {
  return (await api.post("/notifications/read-all")).data;
}

export async function deleteNotification(id: string): Promise<void> {
  await api.delete(`/notifications/${id}`);
}

export async function completeAppointment(id: string): Promise<void> {
  await api.post(`/appointments/${id}/complete`, { reason: null });
}

export async function markAppointmentNoShow(id: string): Promise<void> {
  await api.post(`/appointments/${id}/no-show`, { reason: null });
}
