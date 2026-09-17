import type {
  Appointment,
  AppointmentType,
  Department,
  Doctor,
  Questionnaire,
  Specialty,
  StaffMember,
} from "../types";

export const CURRENT_HOSPITAL = {
  id: "h-city",
  name: "City General Hospital",
  status: "approved" as const,
  description: "480-bed multi-specialty hospital with 24/7 emergency care and a high-volume outpatient wing.",
  address: "1200 Medical Center Drive, Springfield",
  contact: "ops@citygeneral.org · +1 (555) 010-4000",
  website: "www.citygeneral.org",
};

export const HOSPITAL_METRICS = {
  doctors: 42,
  activeDoctors: 36,
  today: 58,
  upcoming: 214,
  departments: 8,
  questionnaires: 12,
  aiSuccess: 97.2,
  openOps: 3,
};

export const INITIAL_DEPARTMENTS: Department[] = [
  { id: "dep-card", name: "Cardiology", specialties: 3, doctors: 9, status: "active", updated: "Sep 12" },
  { id: "dep-neuro", name: "Neurology", specialties: 2, doctors: 6, status: "active", updated: "Sep 10" },
  { id: "dep-ortho", name: "Orthopedics", specialties: 2, doctors: 7, status: "active", updated: "Sep 08" },
  { id: "dep-derm", name: "Dermatology", specialties: 1, doctors: 4, status: "active", updated: "Aug 30" },
  { id: "dep-peds", name: "Pediatrics", specialties: 2, doctors: 8, status: "active", updated: "Aug 28" },
  { id: "dep-radio", name: "Radiology", specialties: 1, doctors: 5, status: "inactive", updated: "Aug 15" },
];

export const INITIAL_SPECIALTIES: Specialty[] = [
  { id: "sp-card", name: "Cardiology", department: "Cardiology", doctors: 9, status: "active" },
  { id: "sp-interv", name: "Interventional Cardiology", department: "Cardiology", doctors: 3, status: "active" },
  { id: "sp-neuro", name: "Neurology", department: "Neurology", doctors: 6, status: "active" },
  { id: "sp-ortho", name: "Orthopedics", department: "Orthopedics", doctors: 7, status: "active" },
  { id: "sp-derm", name: "Dermatology", department: "Dermatology", doctors: 4, status: "active" },
  { id: "sp-peds", name: "Pediatrics", department: "Pediatrics", doctors: 8, status: "active" },
];

export const INITIAL_TYPES: AppointmentType[] = [
  { id: "t1", name: "Initial Consultation", description: "First visit for a new concern", duration: 30, mode: "In person", status: "active" },
  { id: "t2", name: "Follow-up", description: "Review after a previous visit", duration: 20, mode: "In person / Video", status: "active" },
  { id: "t3", name: "Video Consultation", description: "Remote appointment via secure link", duration: 25, mode: "Video", status: "active" },
  { id: "t4", name: "Telephone Consultation", description: "Phone-based review", duration: 15, mode: "Phone", status: "active" },
  { id: "t5", name: "Annual Review", description: "Comprehensive yearly review", duration: 45, mode: "In person", status: "inactive" },
];

export const INITIAL_DOCTORS: Doctor[] = [
  { id: "d1", name: "Dr. Sarah Johnson", photo: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=200&q=80", specialty: "Cardiology", department: "Cardiology", experience: 14, modes: ["In person", "Video"], status: "active", availability: "Mon–Fri · 9–5", appointmentsWeek: 32, qualifications: "MD, DM Cardiology", languages: ["English", "Telugu"], hospital: "City General Hospital" },
  { id: "d2", name: "Dr. James Carter", photo: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=200&q=80", specialty: "Dermatology", department: "Dermatology", experience: 11, modes: ["In person", "Video"], status: "active", availability: "Mon–Thu · 9–4", appointmentsWeek: 28, qualifications: "MD, Dermatology", languages: ["English"], hospital: "City General Hospital" },
  { id: "d3", name: "Dr. Priya Nair", photo: "https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=200&q=80", specialty: "Pediatrics", department: "Pediatrics", experience: 9, modes: ["In person", "Video", "Phone"], status: "active", availability: "Mon–Fri · 10–6", appointmentsWeek: 35, qualifications: "MD, Pediatrics", languages: ["English", "Hindi"], hospital: "City General Hospital" },
  { id: "d4", name: "Dr. Michael Chen", photo: "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=200&q=80", specialty: "Orthopedics", department: "Orthopedics", experience: 16, modes: ["In person"], status: "active", availability: "Mon–Fri · 9–3", appointmentsWeek: 24, qualifications: "MD, Orthopedic Surgery", languages: ["English", "Mandarin"], hospital: "City General Hospital" },
  { id: "d5", name: "Dr. Amara Okafor", photo: "https://images.unsplash.com/photo-1651008376811-b90baee60c1f?auto=format&fit=crop&w=200&q=80", specialty: "Neurology", department: "Neurology", experience: 12, modes: ["In person", "Video"], status: "invited", availability: "—", appointmentsWeek: 0, qualifications: "MD, Neurology", languages: ["English", "French"], hospital: "City General Hospital" },
  { id: "d6", name: "Dr. David Miller", photo: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=200&q=80", specialty: "Cardiology", department: "Cardiology", experience: 18, modes: ["In person", "Phone"], status: "inactive", availability: "Paused", appointmentsWeek: 0, qualifications: "MD, Internal Medicine", languages: ["English"], hospital: "City General Hospital" },
  { id: "d7", name: "Dr. Lena Hoffmann", photo: "https://images.unsplash.com/photo-1651008376811-b90baee60c1f?auto=format&fit=crop&w=200&q=80", specialty: "Orthopedics", department: "Orthopedics", experience: 8, modes: ["Video", "In person"], status: "suspended", availability: "Suspended", appointmentsWeek: 0, qualifications: "MD, Sports Medicine", languages: ["English", "German"], hospital: "City General Hospital" },
];

export const INITIAL_APPOINTMENTS: Appointment[] = [
  { id: "APT-1042", patient: "John Smith", doctor: "Dr. Sarah Johnson", specialty: "Cardiology", hospital: "City General Hospital", date: "Today", time: "09:00 AM", type: "Follow-up", status: "completed", questionnaire: "completed", created: "Sep 15" },
  { id: "APT-1043", patient: "Maria Garcia", doctor: "Dr. Sarah Johnson", specialty: "Cardiology", hospital: "City General Hospital", date: "Today", time: "10:30 AM", type: "Initial Consultation", status: "confirmed", questionnaire: "completed", created: "Sep 16" },
  { id: "APT-1044", patient: "Robert Chen", doctor: "Dr. James Carter", specialty: "Dermatology", hospital: "City General Hospital", date: "Today", time: "11:00 AM", type: "Video Consultation", status: "pending", questionnaire: "in_progress", created: "Sep 17" },
  { id: "APT-1045", patient: "Aisha Khan", doctor: "Dr. Priya Nair", specialty: "Pediatrics", hospital: "City General Hospital", date: "Today", time: "02:00 PM", type: "Follow-up", status: "confirmed", questionnaire: "completed", created: "Sep 14" },
  { id: "APT-1046", patient: "David Osei", doctor: "Dr. Michael Chen", specialty: "Orthopedics", hospital: "City General Hospital", date: "Tomorrow", time: "09:30 AM", type: "Initial Consultation", status: "confirmed", questionnaire: "pending", created: "Sep 17" },
  { id: "APT-1047", patient: "Elena Petrova", doctor: "Dr. Sarah Johnson", specialty: "Cardiology", hospital: "City General Hospital", date: "Tomorrow", time: "11:00 AM", type: "Follow-up", status: "rescheduled", questionnaire: "in_progress", created: "Sep 12" },
  { id: "APT-1048", patient: "James Wilson", doctor: "Dr. Amara Okafor", specialty: "Neurology", hospital: "City General Hospital", date: "Fri, Sep 25", time: "10:00 AM", type: "Initial Consultation", status: "sync_pending", questionnaire: "none", created: "Sep 17" },
  { id: "APT-1049", patient: "Nina Alvarez", doctor: "Dr. James Carter", specialty: "Dermatology", hospital: "City General Hospital", date: "Sep 10", time: "02:15 PM", type: "Follow-up", status: "cancelled", questionnaire: "none", created: "Sep 02" },
];

export const INITIAL_QUESTIONNAIRES: Questionnaire[] = [
  {
    id: "q1", name: "Cardiology Pre-visit", specialty: "Cardiology", doctor: "Dr. Sarah Johnson", type: "Follow-up", status: "active", questions: 8, updated: "Sep 12",
    fields: [
      { question: "Is this a follow-up visit?", type: "Yes/No", required: true },
      { question: "Preferred contact method", type: "Single choice", required: true, options: ["Phone", "Text", "Email"] },
      { question: "Documents you will bring", type: "Multiple choice", required: false, options: ["Photo ID", "Insurance", "Medication list"] },
      { question: "Planned arrival time", type: "Short text", required: true },
      { question: "Accessibility needs", type: "Long text", required: false },
    ],
  },
  {
    id: "q2", name: "Pediatrics Intake", specialty: "Pediatrics", doctor: "Dr. Priya Nair", type: "Initial Consultation", status: "active", questions: 6, updated: "Sep 08",
    fields: [
      { question: "Will the child be accompanied by a guardian?", type: "Yes/No", required: true },
      { question: "Preferred language", type: "Single choice", required: true, options: ["English", "Hindi", "Spanish"] },
      { question: "Best callback number", type: "Short text", required: true },
    ],
  },
  {
    id: "q3", name: "Dermatology Prep (draft)", specialty: "Dermatology", doctor: "Dr. James Carter", type: "Video Consultation", status: "draft", questions: 4, updated: "Sep 05",
    fields: [{ question: "Visit preparation notes", type: "Long text", required: false }],
  },
];

export const INITIAL_STAFF: StaffMember[] = [
  { id: "s1", name: "Rachel Adams", role: "Hospital Admin", status: "active", lastActive: "5 min ago" },
  { id: "s2", name: "Tom Becker", role: "Hospital Staff", status: "active", lastActive: "1h ago" },
  { id: "s3", name: "Nina Rao", role: "Operations Staff", status: "active", lastActive: "Yesterday" },
  { id: "s4", name: "Sam Lee", role: "Hospital Staff", status: "invited", lastActive: "Invite sent" },
];
