import axios from "axios";

const baseURL =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_URL ?? "http://localhost:8000";

export const api = axios.create({ baseURL });

export function setAccessToken(token: string | null) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    try {
      localStorage.setItem("careflow_platform_token", token);
    } catch {
      /* private mode */
    }
  } else {
    delete api.defaults.headers.common["Authorization"];
    try {
      localStorage.removeItem("careflow_platform_token");
    } catch {
      /* noop */
    }
  }
}

export function restoreAccessToken(): string | null {
  let token: string | null = null;
  try {
    token = localStorage.getItem("careflow_platform_token");
  } catch {
    token = null;
  }
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  }
  return token;
}

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
  photo_url: string | null;
  specialty_id: string | null;
  department_id: string | null;
  qualifications: Record<string, unknown>;
  experience_years: number;
  languages: string[];
  consultation_types: string[];
  default_duration_minutes: number;
  external_provider_id: string | null;
  user_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
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

export interface PlatformDoctor extends Doctor {}

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
  setAccessToken(data.access_token);
}

export async function me(): Promise<CurrentUser> {
  const { data } = await api.get("/auth/me");
  return data;
}

// -- platform directory ----------------------------------------------------------

export interface ApiHospital {
  id: string;
  name: string;
  address: string;
  contact_email: string;
  contact_phone: string;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function listHospitals(status?: string): Promise<ApiHospital[]> {
  return (await api.get("/platform/hospitals", { params: status ? { status } : {} })).data;
}

export async function approveHospital(id: string): Promise<ApiHospital> {
  return (await api.post(`/platform/hospitals/${id}/approve`)).data;
}

export async function rejectHospital(id: string, reason: string): Promise<ApiHospital> {
  return (await api.post(`/platform/hospitals/${id}/reject`, { reason })).data;
}

export async function suspendHospital(id: string): Promise<ApiHospital> {
  return (await api.post(`/platform/hospitals/${id}/suspend`)).data;
}

export async function reinstateHospital(id: string): Promise<ApiHospital> {
  return (await api.post(`/platform/hospitals/${id}/reinstate`)).data;
}

export async function startHospitalReview(id: string): Promise<ApiHospital> {
  return (await api.post(`/platform/hospitals/${id}/start-review`)).data;
}

export async function requestHospitalCorrections(id: string, message: string): Promise<ApiHospital> {
  return (await api.post(`/platform/hospitals/${id}/request-corrections`, { message })).data;
}

export async function listPlatformDoctors(hospitalId?: string): Promise<PlatformDoctor[]> {
  return (
    await api.get("/platform/doctors", { params: hospitalId ? { hospital_id: hospitalId } : {} })
  ).data;
}

export async function listPlatformPatients(): Promise<{ patients: PlatformPatient[] }> {
  return (await api.get("/platform/patients")).data;
}

export async function listPlatformAppointments(params?: {
  hospital_id?: string;
  state?: string;
}): Promise<Appointment[]> {
  return (await api.get("/platform/appointments", { params })).data;
}

export async function fetchAIEvaluation(): Promise<AIEvaluation> {
  return (await api.get("/platform/ai-evaluation")).data;
}

export async function fetchAuditEvents(params?: {
  action?: string;
  hospital_id?: string;
}): Promise<{ events: AuditEvent[] }> {
  return (await api.get("/platform/audit-events", { params })).data;
}

// -- platform aggregates ------------------------------------------------------------

export interface PlatformOverview {
  hospitals_total: number;
  hospitals_by_status: Record<string, number>;
  pending_applications: number;
  doctors_total: number;
  doctors_active: number;
  patients_total: number;
  appointments_today: number;
  open_reconciliations: number;
  open_escalations: number;
}

export async function fetchPlatformOverview(): Promise<PlatformOverview> {
  return (await api.get("/platform/overview")).data;
}

export interface PlatformIntegration {
  hospital_id: string;
  hospital_name: string;
  hospital_status: string;
  vendor_mappings: number;
  open_reconciliations: number;
  operations_total: number;
  operations_by_status: Record<string, number>;
  verifications_24h: number;
}

export async function fetchPlatformIntegrations(): Promise<{
  integrations: PlatformIntegration[];
}> {
  return (await api.get("/platform/integrations")).data;
}

export interface PlatformAnalytics {
  appointments_total: number;
  appointments_by_state: Record<string, number>;
  bookings_per_day_30d: Record<string, number>;
  ai_executions_total: number;
  ai_error_rate: number;
  ai_by_tool: AIEvaluation["by_tool"];
}

export async function fetchPlatformAnalytics(): Promise<PlatformAnalytics> {
  return (await api.get("/platform/analytics")).data;
}

// -- shared reads (workflows, health) ----------------------------------------------------

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

export interface OpsMetrics {
  generated_at: string;
  booking: {
    by_state: Record<string, number>;
    terminal_total: number;
    success_total: number;
    success_rate: number | null;
  };
  reconciliation: { by_status: Record<string, number>; open: number; total: number };
  ai_latency: {
    chat_turn: { count: number; avg_ms: number | null; p50_ms: number | null; p95_ms: number | null; max_ms: number | null };
    per_tool: Record<string, { calls: number; avg_ms: number }>;
  };
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
