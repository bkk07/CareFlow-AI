import type { AuditEvent, Hospital, NotificationItem } from "../types";

export const PLATFORM_METRICS = {
  hospitals: 14,
  pending: 3,
  doctors: 186,
  patients: 12480,
  today: 342,
  aiConversations: 1893,
  openOps: 5,
};

export const ALL_HOSPITALS: Hospital[] = [
  { id: "h-city", name: "City General Hospital", location: "Springfield", contact: "ops@citygeneral.org", status: "approved", departments: 8, doctors: 42, activeDoctors: 36, appointmentsToday: 58, submitted: "Aug 02" },
  { id: "h-river", name: "Riverside Medical Center", location: "Riverside", contact: "admin@riverside.org", status: "approved", departments: 6, doctors: 28, activeDoctors: 25, appointmentsToday: 41, submitted: "Aug 11" },
  { id: "h-green", name: "Green Valley Clinic", location: "Green Valley", contact: "hello@greenvalley.clinic", status: "under_review", departments: 4, doctors: 0, activeDoctors: 0, appointmentsToday: 0, submitted: "Sep 14" },
  { id: "h-north", name: "Northgate Hospital", location: "Northgate", contact: "ops@northgate.health", status: "submitted", departments: 5, doctors: 0, activeDoctors: 0, appointmentsToday: 0, submitted: "Sep 16" },
  { id: "h-lake", name: "Lakeside Care", location: "Lakeside", contact: "team@lakeside.care", status: "draft", departments: 3, doctors: 0, activeDoctors: 0, appointmentsToday: 0, submitted: "—" },
  { id: "h-east", name: "Eastside Clinic", location: "Eastside", contact: "admin@eastside.clinic", status: "rejected", departments: 3, doctors: 0, activeDoctors: 0, appointmentsToday: 0, submitted: "Aug 28" },
];

export const INITIAL_AUDIT: AuditEvent[] = [
  { id: "au1", time: "Today 10:42 AM", actor: "platform.admin@careflow.ai", action: "Hospital approved", resource: "Riverside Medical Center", result: "success", correlationId: "corr-9f21" },
  { id: "au2", time: "Today 09:15 AM", actor: "rachel@citygeneral.org", action: "Doctor activated", resource: "Dr. Priya Nair", result: "success", correlationId: "corr-8a11" },
  { id: "au3", time: "Today 08:02 AM", actor: "system", action: "AI capability executed", resource: "check_availability", result: "success", correlationId: "corr-77c2" },
  { id: "au4", time: "Yesterday 4:20 PM", actor: "ops@careflow.ai", action: "Reconciliation resolved", resource: "OP-8814", result: "success", correlationId: "corr-71de" },
  { id: "au5", time: "Yesterday 2:11 PM", actor: "rachel@citygeneral.org", action: "Appointment cancelled", resource: "APT-1049", result: "success", correlationId: "corr-6bb0" },
  { id: "au6", time: "Yesterday 11:48 AM", actor: "unknown", action: "Configuration changed", resource: "Video visit type", result: "denied", correlationId: "corr-65aa" },
  { id: "au7", time: "Sep 15 3:02 PM", actor: "system", action: "Integration tested", resource: "Mock EHR", result: "success", correlationId: "corr-5f19" },
];

export const ADMIN_NOTIFICATIONS: NotificationItem[] = [
  { id: "n1", title: "New hospital application", body: "Northgate Hospital submitted an application for review.", time: "40 min ago", unread: true },
  { id: "n2", title: "Integration failure", body: "Mock EHR reported 2 failed synchronizations in the last hour.", time: "2h ago", unread: true },
  { id: "n3", title: "Reconciliation required", body: "OP-8815 needs verification — outcome unknown.", time: "3h ago", unread: true },
  { id: "n4", title: "Doctor activated", body: "Dr. Priya Nair is now accepting appointments.", time: "Yesterday", unread: false },
];
