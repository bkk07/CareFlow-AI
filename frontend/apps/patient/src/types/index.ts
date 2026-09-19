export type AppointmentStatus =
  | "confirmed"
  | "pending"
  | "rescheduled"
  | "cancelled"
  | "completed"
  | "sync_pending";

export type ConsultationMode = "in_person" | "video" | "phone";

export interface Hospital {
  id: string;
  name: string;
  location: string;
  image: string;
  departments: string[];
  specialties: string[];
  doctorsCount: number;
  rating: number;
  consultationTypes: ConsultationMode[];
  about: string;
  distanceKm?: number | null;
}

export interface Doctor {
  id: string;
  name: string;
  title: string;
  specialty: string;
  department: string;
  qualifications: string;
  experienceYears: number;
  languages: string[];
  hospitalId: string;
  hospitalName: string;
  photo: string;
  consultationModes: ConsultationMode[];
  rating: number;
  reviewsCount: number;
  nextAvailable: string;
  about: string;
  areasOfPractice: string[];
  distanceKm?: number | null;
}

export interface AppointmentType {
  id: string;
  name: string;
  durationMinutes: number;
}

export interface TimeSlot {
  id: string;
  start: string;
  end: string;
  period: "morning" | "afternoon" | "evening";
  available: boolean;
}

export interface Appointment {
  id: string;
  doctorId: string;
  doctorName: string;
  doctorPhoto: string;
  specialty: string;
  hospitalId: string;
  hospitalName: string;
  department: string;
  date: string;
  time: string;
  slotStart: string;
  slotEnd: string;
  durationMinutes: number;
  consultationMode: ConsultationMode;
  appointmentType: string;
  status: AppointmentStatus;
  location: string;
  verificationStage: "created" | "verified" | "confirmed";
}

export interface QuestionnaireQuestion {
  id: string;
  order: number;
  type:
    | "yes_no"
    | "single_choice"
    | "multi_choice"
    | "numeric"
    | "date"
    | "short_text"
    | "long_text"
    | "structured";
  prompt: string;
  helper?: string;
  options?: string[];
  required: boolean;
  structuredFields?: { key: string; label: string; placeholder?: string }[];
}

export interface Questionnaire {
  id: string;
  name: string;
  appointmentId: string;
  dueLabel: string;
  progress: { done: number; total: number };
  questions: QuestionnaireQuestion[];
  status: "pending" | "in_progress" | "completed";
}

export type NotificationCategory =
  | "appointments"
  | "questionnaires"
  | "assistant"
  | "hospital";

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}

export interface ChatCardDoctor {
  kind: "doctor";
  doctorId: string;
}

export interface ChatCardAvailability {
  kind: "availability";
  doctorId: string;
}

export type ChatCard = ChatCardDoctor | ChatCardAvailability;

export interface ChatMessage {
  id: string;
  from: "patient" | "ai";
  text: string;
  time: string;
  cards?: ChatCard[];
  /** Live doctor cards from the assistant turn (DB-backed, bookable). */
  doctors?: {
    id: string;
    name: string;
    photo_url: string | null;
    hospital_name: string;
    hospital_city: string | null;
    specialty: string | null;
  }[];
}

export interface PatientProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  dob: string;
  gender: string;
  address: string;
  avatar: string;
  memberSince: string;
  bloodGroup: string;
  emergencyContact: string;
}
