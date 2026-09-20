export type AppointmentStatus =
  | "requested"
  | "pending"
  | "confirmed"
  | "rescheduled"
  | "cancelled"
  | "completed"
  | "no_show"
  | "sync_pending";

export type ConsultationMode = "in_person" | "video" | "phone";

export type QuestionnaireState = "not_assigned" | "assigned" | "in_progress" | "completed";

export type DoctorStatus = "invited" | "active" | "inactive" | "suspended";

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  department: string;
  qualifications: string;
  experienceYears: number;
  languages: string[];
  hospital: string;
  photo: string;
  consultationTypes: ConsultationMode[];
  appointmentDuration: number;
  appointmentDurations: number[];
  status: DoctorStatus;
  acceptingAppointments: boolean;
}

export interface PatientRef {
  id: string;
  name: string;
  age: number;
  dob: string;
  phone: string;
  communicationPreference: string;
  initials: string;
}

export interface Appointment {
  id: string;
  patient: PatientRef;
  dateLabel: string;
  dayGroup: "today" | "tomorrow" | "week" | "later";
  time: string;
  endTime: string;
  sortKey: string;
  type: string;
  durationMinutes: number;
  mode: ConsultationMode;
  status: AppointmentStatus;
  questionnaire: QuestionnaireState;
  department: string;
  hospital: string;
  note?: string;
}

export interface QuestionnaireAnswer {
  question: string;
  response: string;
}

export interface Questionnaire {
  id: string;
  appointmentId: string;
  patientName: string;
  name: string;
  status: QuestionnaireState;
  completedAt: string | null;
  answers: QuestionnaireAnswer[];
}

export interface AvailabilityRule {
  id: string;
  day: string;
  enabled: boolean;
  start: string;
  end: string;
}

export interface BlockedSlot {
  id: string;
  date: string;
  start: string;
  end: string;
  reason: "Lunch" | "Meeting" | "Leave" | "Administrative work" | "Personal time";
  note?: string;
  /** Raw ISO bounds (local render source for the schedule grid). */
  startIso: string;
  endIso: string;
}

export type NotificationCategory = "appointments" | "questionnaires" | "system";

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}
