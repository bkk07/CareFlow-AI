import axios from "axios";

const baseURL =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_URL ?? "http://localhost:8000";

export const api = axios.create({ baseURL });

export function setAccessToken(token: string | null) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    localStorage.setItem("careflow_admin_token", token);
  } else {
    delete api.defaults.headers.common["Authorization"];
    localStorage.removeItem("careflow_admin_token");
  }
}

export function restoreAccessToken(): string | null {
  const token = localStorage.getItem("careflow_admin_token");
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
  setAccessToken(data.access_token);
}

export async function me(): Promise<CurrentUser> {
  const { data } = await api.get("/auth/me");
  return data;
}
