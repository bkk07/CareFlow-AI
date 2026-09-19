export type Role = "hospital" | "platform" | "operations";

export type HospitalStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "suspended";

export interface Hospital {
  id: string;
  name: string;
  location: string;
  contact: string;
  status: HospitalStatus;
  departments: number;
  doctors: number;
  activeDoctors: number;
  appointmentsToday: number;
  submitted: string;
}

export interface Department {
  id: string;
  name: string;
  specialties: number;
  doctors: number;
  status: "active" | "inactive";
  updated: string;
}

export interface Specialty {
  id: string;
  name: string;
  department: string;
  doctors: number;
  status: "active" | "inactive";
}

export interface AppointmentType {
  id: string;
  name: string;
  description: string;
  duration: number;
  mode: string;
  status: "active" | "inactive";
}

export type DoctorStatus = "invited" | "active" | "inactive" | "suspended";

export interface Doctor {
  id: string;
  name: string;
  photo: string;
  specialty: string;
  department: string;
  experience: number;
  modes: string[];
  status: DoctorStatus;
  availability: string;
  appointmentsWeek: number;
  qualifications: string;
  languages: string[];
  hospital: string;
  loginEmail: string | null;
}

export type AppointmentStatus =
  | "confirmed"
  | "pending"
  | "rescheduled"
  | "cancelled"
  | "completed"
  | "sync_pending";

export interface Appointment {
  id: string;
  patient: string;
  doctor: string;
  specialty: string;
  hospital: string;
  date: string;
  time: string;
  type: string;
  status: AppointmentStatus;
  questionnaire: "completed" | "in_progress" | "pending" | "none";
  created: string;
}

export interface Questionnaire {
  id: string;
  name: string;
  specialty: string;
  doctor: string;
  type: string;
  status: "active" | "draft" | "inactive";
  questions: number;
  updated: string;
  fields: { question: string; type: string; required: boolean; options?: string[] }[];
}

export interface AIExecution {
  id: string;
  time: string;
  conversation: string;
  hospital: string;
  intent: string;
  capability: string;
  status: "success" | "error" | "escalated";
  durationMs: number;
  escalated: boolean;
}

export interface Integration {
  id: string;
  name: string;
  env: string;
  status: "connected" | "degraded" | "disconnected" | "error";
  lastSync: string;
  requests: number;
  success: number;
  failures: number;
  verifications: number;
  retries: number;
  unknown: number;
}

export interface Workflow {
  id: string;
  name: string;
  trigger: string;
  status: "active" | "paused" | "failing";
  lastRun: string;
  success: number;
  failed: number;
  steps: string[];
}

export type OpStatus = "failed" | "retrying" | "recovered" | "needs_reconciliation" | "unknown" | "verifying" | "resolved" | "escalated";

export interface Operation {
  id: string;
  type: string;
  appointment: string;
  patient: string;
  system: string;
  status: OpStatus;
  started: string;
  lastAttempt: string;
  attempts: number;
  nextRetry: string;
  error: string;
  timeline: { label: string; state: "done" | "failed" | "unknown" | "pending" | "active"; detail?: string }[];
  correlationId: string;
}

export interface Reconciliation {
  id: string;
  operationId: string;
  appointmentId: string;
  externalId: string | null;
  error: string;
  attempts: number;
  externalStatus: string;
  internalState: string;
  resolution: "open" | "investigating" | "resolved" | "escalated";
  updated: string;
  /** Backend resolution note (live only). */
  note?: string | null;
}

export interface Escalation {
  id: string;
  title: string;
  priority: "critical" | "high" | "medium";
  appointment: string;
  issue: string;
  assignee: string;
  created: string;
  status: "new" | "investigating" | "waiting" | "resolved" | "escalated";
}

export interface AuditEvent {
  id: string;
  time: string;
  actor: string;
  action: string;
  resource: string;
  result: "success" | "denied" | "failed";
  correlationId: string;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  status: "active" | "invited" | "deactivated";
  lastActive: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}
