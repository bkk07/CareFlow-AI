import type {
  AIExecution,
  Escalation,
  Integration,
  Operation,
  Reconciliation,
  Workflow,
} from "../types";

export const OPS_SUMMARY = {
  healthy: 1240,
  failed: 4,
  unknown: 2,
  reconciling: 3,
  escalations: 2,
  retryQueue: 3,
};

export const INITIAL_OPERATIONS: Operation[] = [
  {
    id: "OP-8815",
    type: "Create appointment",
    appointment: "APT-1048",
    patient: "James Wilson",
    system: "Mock EHR",
    status: "unknown",
    started: "Today 09:58 AM",
    lastAttempt: "Today 10:02 AM",
    attempts: 2,
    nextRetry: "In 14 min",
    error: "Request timed out after 8s — outcome could not be determined.",
    correlationId: "corr-8815",
    timeline: [
      { label: "Appointment creation requested", state: "done" },
      { label: "External request sent", state: "done" },
      { label: "Request timed out", state: "failed", detail: "No response in 8s" },
      { label: "Outcome unknown", state: "unknown", detail: "Requires verification" },
      { label: "External record lookup", state: "active", detail: "Awaiting operator" },
      { label: "Internal state synchronized", state: "pending" },
      { label: "Appointment confirmed", state: "pending" },
    ],
  },
  {
    id: "OP-8814",
    type: "Create appointment",
    appointment: "APT-1044",
    patient: "Robert Chen",
    system: "Mock EHR",
    status: "recovered",
    started: "Today 08:40 AM",
    lastAttempt: "Today 08:52 AM",
    attempts: 3,
    nextRetry: "—",
    error: "Initial timeout; external record found on verification.",
    correlationId: "corr-8814",
    timeline: [
      { label: "Appointment creation requested", state: "done" },
      { label: "External request sent", state: "done" },
      { label: "Request timed out", state: "failed" },
      { label: "Outcome unknown", state: "unknown" },
      { label: "External record lookup", state: "done", detail: "Found externally" },
      { label: "Internal state synchronized", state: "done" },
      { label: "Appointment confirmed", state: "done" },
    ],
  },
  {
    id: "OP-8811",
    type: "Cancel appointment",
    appointment: "APT-1049",
    patient: "Nina Alvarez",
    system: "Mock EHR",
    status: "failed",
    started: "Yesterday 4:02 PM",
    lastAttempt: "Yesterday 4:20 PM",
    attempts: 2,
    nextRetry: "Paused",
    error: "External system rejected cancellation (validation error).",
    correlationId: "corr-8811",
    timeline: [
      { label: "Cancellation requested", state: "done" },
      { label: "External request sent", state: "done" },
      { label: "External response: rejected", state: "failed", detail: "Validation error" },
      { label: "Requires reconciliation", state: "unknown" },
    ],
  },
  {
    id: "OP-8809",
    type: "Notification",
    appointment: "APT-1045",
    patient: "Aisha Khan",
    system: "Notification service",
    status: "retrying",
    started: "Yesterday 1:15 PM",
    lastAttempt: "Today 07:30 AM",
    attempts: 4,
    nextRetry: "In 32 min",
    error: "Delivery provider throttled requests.",
    correlationId: "corr-8809",
    timeline: [
      { label: "Notification queued", state: "done" },
      { label: "Delivery attempted", state: "failed", detail: "Throttled" },
      { label: "Retry scheduled", state: "active" },
    ],
  },
];

export const INITIAL_RECONCILIATION: Reconciliation[] = [
  { id: "RC-201", operationId: "OP-8815", appointmentId: "APT-1048", externalId: null, error: "Outcome unknown after timeout", attempts: 2, externalStatus: "Unknown", internalState: "Pending", resolution: "open", updated: "10 min ago" },
  { id: "RC-200", operationId: "OP-8811", appointmentId: "APT-1049", externalId: "EHR-55210", error: "Cancel rejected by external system", attempts: 2, externalStatus: "Active", internalState: "Cancelled", resolution: "investigating", updated: "1h ago" },
  { id: "RC-199", operationId: "OP-8814", appointmentId: "APT-1044", externalId: "EHR-55196", error: "Timeout, recovered via verification", attempts: 3, externalStatus: "Confirmed", internalState: "Confirmed", resolution: "resolved", updated: "Yesterday" },
];

export const INITIAL_ESCALATIONS: Escalation[] = [
  { id: "ES-31", title: "Unknown outcome needs review", priority: "critical", appointment: "APT-1048", issue: "Creation outcome unknown after 2 attempts", assignee: "Unassigned", created: "25 min ago", status: "new" },
  { id: "ES-30", title: "Cancel rejected externally", priority: "high", appointment: "APT-1049", issue: "External record still active", assignee: "Ops — Mara", created: "2h ago", status: "investigating" },
  { id: "ES-29", title: "Reminder delivery delayed", priority: "medium", appointment: "APT-1045", issue: "Notification throttled", assignee: "Ops — Dev", created: "Yesterday", status: "waiting" },
];

export const AI_ACTIVITY: AIExecution[] = [
  { id: "ex1", time: "10:41 AM", conversation: "conv-8f21", hospital: "City General", intent: "Book appointment", capability: "create_appointment", status: "success", durationMs: 812, escalated: false },
  { id: "ex2", time: "10:38 AM", conversation: "conv-8f1e", hospital: "City General", intent: "Check availability", capability: "check_availability", status: "success", durationMs: 340, escalated: false },
  { id: "ex3", time: "10:22 AM", conversation: "conv-8f0a", hospital: "Riverside", intent: "Find doctor", capability: "search_doctors", status: "success", durationMs: 410, escalated: false },
  { id: "ex4", time: "09:57 AM", conversation: "conv-8e99", hospital: "City General", intent: "Book appointment", capability: "create_appointment", status: "error", durationMs: 8012, escalated: true },
  { id: "ex5", time: "09:31 AM", conversation: "conv-8e71", hospital: "City General", intent: "Reschedule", capability: "reschedule_appointment", status: "success", durationMs: 690, escalated: false },
  { id: "ex6", time: "09:02 AM", conversation: "conv-8e55", hospital: "City General", intent: "Questionnaire", capability: "submit_questionnaire", status: "success", durationMs: 388, escalated: false },
];

export const INTEGRATIONS: Integration[] = [
  { id: "int-ehr", name: "Mock EHR", env: "Staging", status: "degraded", lastSync: "2 minutes ago", requests: 1240, success: 1198, failures: 12, verifications: 1180, retries: 22, unknown: 2 },
];

export const WORKFLOWS: Workflow[] = [
  { id: "w1", name: "Appointment confirmation", trigger: "Appointment booked", status: "active", lastRun: "10 min ago", success: 342, failed: 2, steps: ["Appointment Booked", "Assign Questionnaire", "Send Notification", "Reminder", "Appointment Completed"] },
  { id: "w2", name: "Questionnaire reminder", trigger: "24h before visit", status: "active", lastRun: "1h ago", success: 198, failed: 5, steps: ["Due check", "Send reminder", "Escalate if incomplete"] },
  { id: "w3", name: "Synchronization workflow", trigger: "External write", status: "failing", lastRun: "25 min ago", success: 120, failed: 8, steps: ["External request", "Verify", "Synchronize", "Notify"] },
  { id: "w4", name: "Cancellation notification", trigger: "Appointment cancelled", status: "paused", lastRun: "2 days ago", success: 88, failed: 1, steps: ["Cancel event", "Notify patient", "Release slot"] },
];

export const VOLUME_7D = [
  { day: "Mon", appointments: 46, success: 44 },
  { day: "Tue", appointments: 52, success: 50 },
  { day: "Wed", appointments: 48, success: 45 },
  { day: "Thu", appointments: 58, success: 55 },
  { day: "Fri", appointments: 44, success: 41 },
  { day: "Sat", appointments: 18, success: 17 },
  { day: "Sun", appointments: 12, success: 12 },
];

export const STATUS_BREAKDOWN = [
  { name: "Confirmed", value: 168 },
  { name: "Completed", value: 74 },
  { name: "Pending", value: 18 },
  { name: "Rescheduled", value: 9 },
  { name: "Cancelled", value: 9 },
];
