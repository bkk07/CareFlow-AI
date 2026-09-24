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

const TOKEN_KEY = "careflow_ops_token";
const REFRESH_KEY = "careflow_ops_refresh";

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

// -- operations console ---------------------------------------------------------------

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

export interface OpsReconciliation {
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

export async function listReconciliations(params?: {
  resolution_status?: string;
}): Promise<OpsReconciliation[]> {
  return (await api.get("/reconciliation/records", { params })).data;
}

export async function retryReconciliation(id: string): Promise<unknown> {
  return (await api.post(`/reconciliation/records/${id}/retry`)).data;
}

export async function resolveReconciliation(
  id: string,
  body: { resolution: string; note?: string; final_state?: string },
): Promise<unknown> {
  return (await api.post(`/reconciliation/records/${id}/resolve`, body)).data;
}

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

export interface OpsMetrics {
  generated_at: string;
  booking: {
    by_state: Record<string, number>;
    terminal_total: number;
    success_total: number;
    success_rate: number | null;
  };
  reconciliation: { by_status: Record<string, number>; open: number; total: number };
  workflow: {
    workflows_by_status: Record<string, number>;
    notifications_by_status: Record<string, number>;
    open_escalations: number;
    escalation_statuses: Record<string, number>;
  };
}

export async function fetchMetrics(): Promise<OpsMetrics> {
  return (await api.get("/observability/metrics")).data;
}
