import type {
  Appointment,
  AvailabilityRule,
  BlockedSlot,
  NotificationItem,
  PatientRef,
  Questionnaire,
} from "../types";

export const PATIENTS: Record<string, PatientRef> = {
  p1: { id: "p1", name: "John Smith", age: 58, dob: "Jun 1967", phone: "+1 (555) 010-2211", communicationPreference: "Phone call", initials: "JS" },
  p2: { id: "p2", name: "Maria Garcia", age: 44, dob: "Feb 1981", phone: "+1 (555) 010-3345", communicationPreference: "Text message", initials: "MG" },
  p3: { id: "p3", name: "Robert Chen", age: 63, dob: "Nov 1962", phone: "+1 (555) 010-7789", communicationPreference: "Email", initials: "RC" },
  p4: { id: "p4", name: "Aisha Khan", age: 36, dob: "Aug 1989", phone: "+1 (555) 010-9912", communicationPreference: "In-app message", initials: "AK" },
  p5: { id: "p5", name: "David Osei", age: 51, dob: "Jan 1974", phone: "+1 (555) 010-4456", communicationPreference: "Phone call", initials: "DO" },
  p6: { id: "p6", name: "Elena Petrova", age: 47, dob: "May 1978", phone: "+1 (555) 010-6678", communicationPreference: "Text message", initials: "EP" },
  p7: { id: "p7", name: "James Wilson", age: 69, dob: "Mar 1956", phone: "+1 (555) 010-1123", communicationPreference: "Phone call", initials: "JW" },
  p8: { id: "p8", name: "Priya Raman", age: 33, dob: "Oct 1992", phone: "+1 (555) 010-8890", communicationPreference: "Email", initials: "PR" },
  p9: { id: "p9", name: "Tom Becker", age: 55, dob: "Jul 1970", phone: "+1 (555) 010-5567", communicationPreference: "Text message", initials: "TB" },
  p10: { id: "p10", name: "Nina Alvarez", age: 41, dob: "Dec 1984", phone: "+1 (555) 010-2234", communicationPreference: "In-app message", initials: "NA" },
  p11: { id: "p11", name: "Samuel Lee", age: 60, dob: "Apr 1965", phone: "+1 (555) 010-7788", communicationPreference: "Phone call", initials: "SL" },
  p12: { id: "p12", name: "Fatima Hassan", age: 39, dob: "Sep 1986", phone: "+1 (555) 010-9901", communicationPreference: "Text message", initials: "FH" },
};

const A = (
  id: string,
  patient: PatientRef,
  dateLabel: string,
  dayGroup: Appointment["dayGroup"],
  time: string,
  endTime: string,
  sortKey: string,
  type: string,
  durationMinutes: number,
  mode: Appointment["mode"],
  status: Appointment["status"],
  questionnaire: Appointment["questionnaire"],
  note?: string,
): Appointment => ({
  id,
  patient,
  dateLabel,
  dayGroup,
  time,
  endTime,
  sortKey,
  type,
  durationMinutes,
  mode,
  status,
  questionnaire,
  department: "Cardiology",
  hospital: "City General Hospital",
  note,
});

export const INITIAL_APPOINTMENTS: Appointment[] = [
  A("a1", PATIENTS.p1, "Today", "today", "09:00 AM", "09:30 AM", "today-0900", "Follow-up consultation", 30, "in_person", "completed", "completed"),
  A("a2", PATIENTS.p2, "Today", "today", "09:30 AM", "10:00 AM", "today-0930", "New consultation", 30, "in_person", "completed", "completed"),
  A("a3", PATIENTS.p3, "Today", "today", "10:00 AM", "10:30 AM", "today-1000", "Follow-up consultation", 30, "video", "completed", "completed"),
  A("a4", PATIENTS.p4, "Today", "today", "10:30 AM", "11:00 AM", "today-1030", "Follow-up consultation", 30, "in_person", "confirmed", "completed", "Patient-provided forms reviewed."),
  A("a5", PATIENTS.p5, "Today", "today", "11:30 AM", "12:00 PM", "today-1130", "Test-result review", 30, "video", "confirmed", "in_progress"),
  A("a6", PATIENTS.p6, "Today", "today", "02:00 PM", "02:30 PM", "today-1400", "New consultation", 30, "in_person", "confirmed", "assigned"),
  A("a7", PATIENTS.p7, "Today", "today", "02:30 PM", "03:00 PM", "today-1430", "Follow-up consultation", 30, "in_person", "pending", "in_progress", "Confirmation being processed."),
  A("a8", PATIENTS.p8, "Today", "today", "03:30 PM", "04:00 PM", "today-1530", "Follow-up consultation", 30, "video", "confirmed", "completed"),
  A("a9", PATIENTS.p9, "Tomorrow", "tomorrow", "09:00 AM", "09:30 AM", "tom-0900", "New consultation", 30, "in_person", "confirmed", "assigned"),
  A("a10", PATIENTS.p10, "Tomorrow", "tomorrow", "10:00 AM", "10:30 AM", "tom-1000", "Follow-up consultation", 30, "video", "confirmed", "completed"),
  A("a11", PATIENTS.p11, "Tomorrow", "tomorrow", "11:00 AM", "11:30 AM", "tom-1100", "Follow-up consultation", 30, "in_person", "rescheduled", "in_progress"),
  A("a12", PATIENTS.p12, "Fri, Sep 25", "week", "09:30 AM", "10:00 AM", "week-01", "Annual review", 45, "in_person", "confirmed", "assigned"),
  A("a13", PATIENTS.p1, "Fri, Sep 25", "week", "11:00 AM", "11:30 AM", "week-02", "Follow-up consultation", 30, "in_person", "confirmed", "not_assigned"),
  A("a14", PATIENTS.p4, "Mon, Sep 28", "later", "10:00 AM", "10:30 AM", "later-01", "Follow-up consultation", 30, "video", "confirmed", "assigned"),
  A("a15", PATIENTS.p7, "Mon, Sep 28", "later", "02:00 PM", "02:30 PM", "later-02", "Test-result review", 30, "in_person", "cancelled", "not_assigned"),
  A("a16", PATIENTS.p3, "Sep 10", "later", "10:00 AM", "10:30 AM", "past-01", "Follow-up consultation", 30, "in_person", "completed", "completed"),
];

export const QUESTIONNAIRES: Questionnaire[] = [
  {
    id: "q-a4",
    appointmentId: "a4",
    patientName: "Aisha Khan",
    name: "Pre-visit questionnaire",
    status: "completed",
    completedAt: "Yesterday, 6:42 PM",
    answers: [
      { question: "Is this visit a follow-up to a previous cardiology appointment?", response: "Yes" },
      { question: "How would you prefer we contact you about this visit?", response: "In-app message" },
      { question: "Which documents will you bring?", response: "Photo ID, Insurance card, Medication list" },
      { question: "Who should we contact in case of a scheduling change?", response: "Aisha Khan · +1 (555) 010-9912" },
      { question: "Anything about getting to the appointment we should know?", response: "Ground-floor access preferred; arriving 10 minutes early." },
      { question: "Planned arrival time", response: "10:15 AM, coming with spouse" },
    ],
  },
  {
    id: "q-a5",
    appointmentId: "a5",
    patientName: "David Osei",
    name: "Pre-visit questionnaire",
    status: "in_progress",
    completedAt: null,
    answers: [
      { question: "Is this visit a follow-up to a previous cardiology appointment?", response: "Yes" },
      { question: "How would you prefer we contact you about this visit?", response: "Phone call" },
      { question: "Which documents will you bring?", response: "Previous test reports (partial)" },
    ],
  },
  {
    id: "q-a8",
    appointmentId: "a8",
    patientName: "Priya Raman",
    name: "Pre-visit questionnaire",
    status: "completed",
    completedAt: "Today, 7:15 AM",
    answers: [
      { question: "Is this visit a follow-up to a previous cardiology appointment?", response: "No — first visit for this concern" },
      { question: "How would you prefer we contact you about this visit?", response: "Email" },
      { question: "Preferred consultation language", response: "English" },
      { question: "Best callback number", response: "+1 (555) 010-8890" },
      { question: "Anything else the front desk should know?", response: "Video visit; will join from laptop." },
    ],
  },
  {
    id: "q-a6",
    appointmentId: "a6",
    patientName: "Elena Petrova",
    name: "Pre-visit questionnaire",
    status: "assigned",
    completedAt: null,
    answers: [],
  },
];

export const INITIAL_RULES: AvailabilityRule[] = [
  { id: "mon", day: "Monday", enabled: true, start: "09:00", end: "17:00" },
  { id: "tue", day: "Tuesday", enabled: true, start: "09:00", end: "17:00" },
  { id: "wed", day: "Wednesday", enabled: true, start: "09:00", end: "13:00" },
  { id: "thu", day: "Thursday", enabled: true, start: "09:00", end: "17:00" },
  { id: "fri", day: "Friday", enabled: true, start: "09:00", end: "15:00" },
  { id: "sat", day: "Saturday", enabled: false, start: "09:00", end: "13:00" },
  { id: "sun", day: "Sunday", enabled: false, start: "09:00", end: "13:00" },
];

export const INITIAL_BLOCKS: BlockedSlot[] = [
  { id: "b1", date: "Today", start: "12:00 PM", end: "01:00 PM", reason: "Lunch", note: "Daily lunch break" },
  { id: "b2", date: "Today", start: "01:00 PM", end: "01:30 PM", reason: "Administrative work", note: "Charting + inbox" },
  { id: "b3", date: "Tomorrow", start: "12:00 PM", end: "01:00 PM", reason: "Lunch" },
  { id: "b4", date: "Fri, Sep 25", start: "09:00 AM", end: "05:00 PM", reason: "Leave", note: "Conference — no clinic" },
];

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  { id: "n1", category: "appointments", title: "New appointment booked", body: "Elena Petrova booked a new consultation for Today, 02:00 PM.", time: "25 min ago", unread: true },
  { id: "n2", category: "questionnaires", title: "Patient completed questionnaire", body: "Priya Raman completed the pre-visit questionnaire for 03:30 PM.", time: "1h ago", unread: true },
  { id: "n3", category: "appointments", title: "Appointment reminder", body: "Next: Aisha Khan at 10:30 AM — follow-up consultation.", time: "2h ago", unread: true },
  { id: "n4", category: "appointments", title: "Patient cancelled an appointment", body: "James Wilson's Sep 28 visit was cancelled. The slot is now open.", time: "Yesterday", unread: false },
  { id: "n5", category: "system", title: "Schedule update", body: "Friday Sep 25 leave block confirmed — clinic closed.", time: "Yesterday", unread: false },
  { id: "n6", category: "questionnaires", title: "Questionnaire pending", body: "David Osei has partially completed the 11:30 AM pre-visit form.", time: "2 days ago", unread: false },
];
