import type { Doctor } from "../types";

export const CURRENT_DOCTOR: Doctor = {
  id: "doc-sarah",
  name: "Dr. Sarah Johnson",
  specialty: "Cardiology",
  department: "Cardiology",
  qualifications: "MD, DM Cardiology",
  experienceYears: 12,
  languages: ["English", "Telugu", "Hindi"],
  hospital: "City General Hospital",
  photo:
    "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=300&q=80",
  consultationTypes: ["in_person", "video"],
  appointmentDuration: 30,
  status: "active",
  acceptingAppointments: true,
};

export function doctorInitials(name: string): string {
  return name
    .replace(/^(Dr\.\s*)/i, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
