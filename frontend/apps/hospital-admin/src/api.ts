import axios from "axios";

const baseURL =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_URL ?? "http://localhost:8000";

export const api = axios.create({ baseURL });

const TOKEN_KEY = "careflow_admin_token";
const REFRESH_KEY = "careflow_admin_refresh";

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

export interface NamedEntity {
  id: string;
  hospital_id: string;
  name: string;
}

export interface AppointmentType extends NamedEntity {
  duration_minutes: number;
  compatible_specialty_ids: string[];
}

export interface Doctor {
  id: string;
  hospital_id: string;
  name: string;
  specialty_id: string | null;
  department_id: string | null;
  experience_years: number;
  default_duration_minutes: number;
  available_durations: number[];
  external_provider_id: string | null;
  status: string;
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
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

export interface AppointmentHistoryEntry {
  id: string;
  from_state: string;
  to_state: string;
  actor_user_id: string | null;
  actor_system: string | null;
  reason: string | null;
  created_at: string;
}

export interface AppointmentDetail extends Appointment {
  history: AppointmentHistoryEntry[];
}

export interface HospitalOverview {
  hospital_id: string;
  doctors_total: number;
  doctors_active: number;
  appointments_this_week: number;
  upcoming_appointments: number;
  pending_reconciliations: number;
}

export interface AIActivityEntry {
  id: string;
  tool_name: string;
  status: string;
  latency_ms: number;
  correlation_id: string;
  actor_user_id: string | null;
  error: string | null;
  created_at: string;
}

export interface IntegrationOperation {
  id: string;
  appointment_id: string;
  operation_type: string;
  status: string;
  attempt_number: number;
  error: string | null;
}

export interface IntegrationStatus {
  hospital_id: string;
  vendor_mappings: number;
  open_reconciliations: number;
  verifications_24h: Record<string, number>;
  recent_operations: IntegrationOperation[];
}

export interface HospitalAnalytics {
  hospital_id: string;
  appointments_total: number;
  appointments_by_state: Record<string, number>;
  bookings_per_day_30d: Record<string, number>;
  tool_success_avg_latency_ms: number | null;
}

export interface ReconciliationRecord {
  id: string;
  hospital_id: string;
  operation_id: string | null;
  appointment_id: string;
  external_id: string | null;
  error: string;
  attempts: number;
  external_status: string | null;
  internal_status: string;
  resolution_status: string;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ReconciliationDetail extends ReconciliationRecord {
  appointment: {
    id: string;
    state: string;
    slot_start: string;
    slot_end: string;
    external_id: string | null;
    idempotency_key: string;
  };
  operations: IntegrationOperation[];
}

export interface PlatformDoctor extends Doctor {
  user_id?: string | null;
}

export interface PlatformPatient {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

export interface AIEvaluation {
  executions_total: number;
  errors_total: number;
  error_rate: number;
  by_tool: {
    tool_name: string;
    calls: number;
    errors: number;
    avg_latency_ms: number | null;
  }[];
}

export interface AuditEvent {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  hospital_id: string | null;
  actor_user_id: string | null;
  correlation_id: string;
  created_at: string;
}

export async function login(email: string, password: string): Promise<void> {
  const { data } = await api.post("/auth/login", { email, password });
  saveTokens(data.access_token, data.refresh_token);
}

export async function me(): Promise<CurrentUser> {
  const { data } = await api.get("/auth/me");
  return data;
}

// -- hospital profile + staff -------------------------------------------------

export interface Hospital {
  id: string;
  name: string;
  address: string;
  contact_email: string;
  contact_phone: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  operating_hours: Record<string, [string, string]> | null;
  review_notes: string | null;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface HospitalRegistration {
  name: string;
  address: string;
  contact_email: string;
  contact_phone: string;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  admin_email: string;
  admin_password: string;
}

export async function registerHospital(body: HospitalRegistration): Promise<Hospital> {
  return (await api.post("/hospitals", body)).data;
}

export async function getHospital(hospitalId: string): Promise<Hospital> {
  return (await api.get(`/hospitals/${hospitalId}`)).data;
}

export async function updateHospital(
  hospitalId: string,
  patch: {
    name?: string;
    address?: string;
    contact_email?: string;
    contact_phone?: string;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    operating_hours?: Record<string, [string, string]> | null;
  },
): Promise<Hospital> {
  return (await api.put(`/hospitals/${hospitalId}`, patch)).data;
}

export async function resubmitHospital(hospitalId: string): Promise<Hospital> {
  return (await api.post(`/hospitals/${hospitalId}/resubmit`)).data;
}

export interface StaffMember {
  id: string;
  email: string;
  role: string;
  hospital_id: string | null;
  is_active: boolean;
  created_at: string;
}

export async function listStaff(hospitalId: string): Promise<StaffMember[]> {
  return (await api.get(`/hospitals/${hospitalId}/staff`)).data;
}

export async function inviteStaff(
  hospitalId: string,
  body: { email: string; password: string },
): Promise<StaffMember> {
  return (await api.post(`/hospitals/${hospitalId}/staff`, body)).data;
}

export async function deactivateStaff(hospitalId: string, userId: string): Promise<void> {
  await api.delete(`/hospitals/${hospitalId}/staff/${userId}`);
}

// -- catalog -------------------------------------------------------------------

export interface Department {
  id: string;
  hospital_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Specialty {
  id: string;
  hospital_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export async function listDepartments(hospitalId: string): Promise<Department[]> {
  return (await api.get(`/hospitals/${hospitalId}/departments`)).data;
}

export async function createDepartment(hospitalId: string, name: string): Promise<Department> {
  return (await api.post(`/hospitals/${hospitalId}/departments`, { name })).data;
}

export async function renameDepartment(
  hospitalId: string,
  id: string,
  name: string,
): Promise<Department> {
  return (await api.put(`/hospitals/${hospitalId}/departments/${id}`, { name })).data;
}

export async function deleteDepartment(hospitalId: string, id: string): Promise<void> {
  await api.delete(`/hospitals/${hospitalId}/departments/${id}`);
}

export async function listSpecialties(hospitalId: string): Promise<Specialty[]> {
  return (await api.get(`/hospitals/${hospitalId}/specialties`)).data;
}

export async function createSpecialty(hospitalId: string, name: string): Promise<Specialty> {
  return (await api.post(`/hospitals/${hospitalId}/specialties`, { name })).data;
}

export async function deleteSpecialty(hospitalId: string, id: string): Promise<void> {
  await api.delete(`/hospitals/${hospitalId}/specialties/${id}`);
}

export async function renameSpecialty(
  hospitalId: string,
  id: string,
  name: string,
): Promise<Specialty> {
  return (await api.put(`/hospitals/${hospitalId}/specialties/${id}`, { name })).data;
}

export async function listAppointmentTypes(hospitalId: string): Promise<AppointmentType[]> {
  return (await api.get(`/hospitals/${hospitalId}/appointment-types`)).data;
}

export async function createAppointmentType(
  hospitalId: string,
  body: { name: string; duration_minutes: number; compatible_specialty_ids?: string[] },
): Promise<AppointmentType> {
  return (await api.post(`/hospitals/${hospitalId}/appointment-types`, body)).data;
}

export async function deleteAppointmentType(hospitalId: string, id: string): Promise<void> {
  await api.delete(`/hospitals/${hospitalId}/appointment-types/${id}`);
}

export async function updateAppointmentType(
  hospitalId: string,
  id: string,
  body: { name: string; duration_minutes: number; compatible_specialty_ids?: string[] },
): Promise<AppointmentType> {
  return (await api.put(`/hospitals/${hospitalId}/appointment-types/${id}`, body)).data;
}

// -- doctors --------------------------------------------------------------------

export interface DoctorDetail extends Doctor {
  photo_url: string | null;
  department_id: string | null;
  qualifications: Record<string, unknown>;
  experience_years: number;
  languages: string[];
  consultation_types: string[];
  default_duration_minutes: number;
  available_durations: number[];
  external_provider_id: string | null;
  user_id: string | null;
  login_email: string | null;
  created_at: string;
  updated_at: string;
}

export async function listDoctors(hospitalId: string): Promise<DoctorDetail[]> {
  return (await api.get(`/hospitals/${hospitalId}/doctors`)).data;
}

export async function createDoctor(
  hospitalId: string,
  body: {
    name: string;
    specialty_id?: string | null;
    department_id?: string | null;
    experience_years?: number;
    languages?: string[];
    consultation_types?: string[];
  },
): Promise<DoctorDetail> {
  return (await api.post(`/hospitals/${hospitalId}/doctors`, body)).data;
}

export async function inviteDoctorLogin(
  hospitalId: string,
  doctorId: string,
  body: { email: string; password: string },
): Promise<DoctorDetail> {
  return (await api.post(`/hospitals/${hospitalId}/doctors/${doctorId}/invite`, body)).data;
}

export async function removeDoctorLogin(hospitalId: string, doctorId: string): Promise<DoctorDetail> {
  return (await api.delete(`/hospitals/${hospitalId}/doctors/${doctorId}/login`)).data;
}

export async function activateDoctor(hospitalId: string, id: string): Promise<DoctorDetail> {
  return (await api.post(`/hospitals/${hospitalId}/doctors/${id}/activate`)).data;
}

export async function deactivateDoctor(hospitalId: string, id: string): Promise<DoctorDetail> {
  return (await api.post(`/hospitals/${hospitalId}/doctors/${id}/deactivate`)).data;
}

export async function suspendDoctor(hospitalId: string, id: string): Promise<DoctorDetail> {
  return (await api.post(`/hospitals/${hospitalId}/doctors/${id}/suspend`)).data;
}

export async function updateDoctor(
  hospitalId: string,
  id: string,
  patch: {
    name?: string;
    specialty_id?: string | null;
    department_id?: string | null;
    experience_years?: number;
    languages?: string[];
    consultation_types?: string[];
    available_durations?: number[];
    photo_url?: string | null;
  },
): Promise<DoctorDetail> {
  return (await api.put(`/hospitals/${hospitalId}/doctors/${id}`, patch)).data;
}

export async function deleteDoctor(hospitalId: string, id: string): Promise<void> {
  await api.delete(`/hospitals/${hospitalId}/doctors/${id}`);
}

// -- appointments ---------------------------------------------------------------

export async function listAppointments(hospitalId: string): Promise<Appointment[]> {
  return (await api.get("/appointments", { params: { hospital_id: hospitalId } })).data;
}

export async function cancelAppointment(id: string, reason?: string): Promise<Appointment> {
  return (await api.post(`/appointments/${id}/cancel`, { reason: reason ?? null })).data;
}

export async function completeAppointment(id: string, reason?: string): Promise<Appointment> {
  return (await api.post(`/appointments/${id}/complete`, { reason: reason ?? null })).data;
}

export async function markNoShow(id: string, reason?: string): Promise<Appointment> {
  return (await api.post(`/appointments/${id}/no-show`, { reason: reason ?? null })).data;
}

export async function confirmAppointment(id: string, reason?: string): Promise<Appointment> {
  return (await api.post(`/appointments/${id}/confirm`, { reason: reason ?? null })).data;
}

export async function getAppointmentDetail(id: string): Promise<AppointmentDetail> {
  return (await api.get(`/appointments/${id}`)).data;
}

// -- questionnaires (authoring) --------------------------------------------------

export interface Questionnaire {
  id: string;
  hospital_id: string;
  name: string;
  scope: string;
  scope_ref_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface QuestionnaireQuestion {
  id: string;
  questionnaire_id: string;
  order: number;
  type: string;
  prompt: string;
  options: string[] | null;
  required: boolean;
}

export interface QuestionnaireDetail {
  questionnaire: Questionnaire;
  questions: QuestionnaireQuestion[];
}

export async function listQuestionnaires(hospitalId: string): Promise<Questionnaire[]> {
  return (await api.get(`/hospitals/${hospitalId}/questionnaires`)).data;
}

export async function createQuestionnaire(
  hospitalId: string,
  body: { name: string; scope?: string; scope_ref_id?: string | null },
): Promise<Questionnaire> {
  return (
    await api.post(`/hospitals/${hospitalId}/questionnaires`, {
      scope: "hospital",
      ...body,
    })
  ).data;
}

export async function getQuestionnaireDetail(
  hospitalId: string,
  id: string,
): Promise<QuestionnaireDetail> {
  return (await api.get(`/hospitals/${hospitalId}/questionnaires/${id}`)).data;
}

export async function updateQuestionnaire(
  hospitalId: string,
  id: string,
  patch: { name?: string; is_active?: boolean },
): Promise<Questionnaire> {
  return (await api.put(`/hospitals/${hospitalId}/questionnaires/${id}`, patch)).data;
}

export async function addQuestion(
  hospitalId: string,
  questionnaireId: string,
  body: { order: number; type: string; prompt: string; options?: string[] | null; required?: boolean },
): Promise<QuestionnaireQuestion> {
  return (
    await api.post(`/hospitals/${hospitalId}/questionnaires/${questionnaireId}/questions`, body)
  ).data;
}

export async function updateQuestion(
  hospitalId: string,
  questionnaireId: string,
  questionId: string,
  patch: { prompt?: string; type?: string; options?: string[] | null; required?: boolean; order?: number },
): Promise<QuestionnaireQuestion> {
  return (
    await api.put(
      `/hospitals/${hospitalId}/questionnaires/${questionnaireId}/questions/${questionId}`,
      patch,
    )
  ).data;
}

export async function deleteQuestion(
  hospitalId: string,
  questionnaireId: string,
  questionId: string,
): Promise<void> {
  await api.delete(
    `/hospitals/${hospitalId}/questionnaires/${questionnaireId}/questions/${questionId}`,
  );
}

export async function deleteQuestionnaire(hospitalId: string, id: string): Promise<void> {
  await api.delete(`/hospitals/${hospitalId}/questionnaires/${id}`);
}

// -- insights --------------------------------------------------------------------

export interface AIActivityResponse {
  hospital_id: string;
  executions: AIActivityEntry[];
}

export async function fetchAIActivity(hospitalId: string): Promise<AIActivityResponse> {
  return (await api.get(`/hospitals/${hospitalId}/ai-activity`)).data;
}

export async function fetchIntegrationStatus(hospitalId: string): Promise<IntegrationStatus> {
  return (await api.get(`/hospitals/${hospitalId}/integration-status`)).data;
}

export async function fetchAnalytics(hospitalId: string): Promise<HospitalAnalytics> {
  return (await api.get(`/hospitals/${hospitalId}/analytics`)).data;
}

export async function fetchOverview(hospitalId: string): Promise<HospitalOverview> {
  return (await api.get(`/hospitals/${hospitalId}/overview`)).data;
}

// -- workflows --------------------------------------------------------------------

export interface WorkflowExecution {
  id: string;
  event_type: string;
  status: string;
  attempt: number;
  appointment_id: string | null;
  correlation_id: string;
  execution_history: unknown[];
  created_at: string;
  updated_at: string;
}

export async function listWorkflows(): Promise<WorkflowExecution[]> {
  return (await api.get("/workflows")).data;
}

// -- operations (retry queue / recovery history) ------------------------------------

export interface Operation {
  id: string;
  appointment_id: string;
  operation_type: string;
  status: string;
  attempt_number: number;
  error: string | null;
  correlation_id: string;
  created_at: string;
}

export async function listOperations(params?: {
  status?: string;
  operation_type?: string;
}): Promise<Operation[]> {
  return (await api.get("/operations", { params })).data;
}

export async function retryOperation(id: string): Promise<{
  operation_id: string;
  appointment_id: string;
  appointment_state: string;
}> {
  return (await api.post(`/operations/${id}/retry`)).data;
}

export async function verifyAppointment(
  appointmentId: string,
): Promise<{ appointment_id: string; outcome: string; mismatches: string[] }> {
  const { data } = await api.post("/mcp/call", {
    tool: "verify_external_appointment",
    input: { appointment_id: appointmentId },
  });
  return data.result;
}

// -- reconciliation ------------------------------------------------------------------

export async function listReconciliations(params?: {
  resolution_status?: string;
}): Promise<ReconciliationRecord[]> {
  return (await api.get("/reconciliation/records", { params })).data;
}

export async function fetchReconciliation(id: string): Promise<ReconciliationDetail> {
  return (await api.get(`/reconciliation/records/${id}`)).data;
}

export async function retryReconciliation(id: string): Promise<ReconciliationDetail> {
  return (await api.post(`/reconciliation/records/${id}/retry`)).data;
}

export async function resolveReconciliation(
  id: string,
  body: { resolution: string; note?: string; final_state?: string },
): Promise<ReconciliationDetail> {
  return (await api.post(`/reconciliation/records/${id}/resolve`, body)).data;
}

// -- escalations -----------------------------------------------------------------------

export interface Escalation {
  id: string;
  conversation_id: string;
  appointment_id: string | null;
  reason: string;
  status: string;
  created_by_user_id: string;
  hospital_id: string | null;
  created_at: string;
}

export async function listEscalations(): Promise<Escalation[]> {
  return (await api.get("/escalations")).data;
}

export async function resolveEscalation(id: string): Promise<Escalation> {
  return (await api.post(`/escalations/${id}/resolve`)).data;
}
