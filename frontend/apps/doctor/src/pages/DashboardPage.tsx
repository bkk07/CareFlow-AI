import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowRight, CalendarCheck, CheckCircle2, ClipboardList, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSchedule } from "../context/ScheduleContext";
import { AppointmentCard } from "../components/appointments/AppointmentCard";
import { Avatar, StatusBadge } from "../components/common/ui";

export default function DashboardPage() {
  const { doctor } = useAuth();
  const { appointments, questionnaires, live, loading, accepting } = useSchedule();
  const today = useMemo(() => appointments.filter((a) => a.dayGroup === "today"), [appointments]);
  const completed = today.filter((a) => a.status === "completed").length;
  const next = useMemo(() => today.find((a) => ["confirmed", "pending"].includes(a.status)), [today]);
  const weekCount = appointments.filter((a) => ["today", "tomorrow", "week"].includes(a.dayGroup)).length;
  const pendingForms = questionnaires.filter((q) => q.status !== "completed").length;
  const acceptingShown = live ? accepting : doctor.acceptingAppointments;

  const cards = [
    { label: "Today's appointments", value: String(today.length), icon: CalendarCheck, tint: "bg-healthcare-soft text-healthcare" },
    { label: "Next appointment", value: next ? next.time : "—", icon: Clock, tint: "bg-teal-soft text-teal-dark" },
    { label: "Completed today", value: String(completed), icon: CheckCircle2, tint: "bg-success-soft text-success" },
    { label: "Upcoming this week", value: String(weekCount), icon: ClipboardList, tint: "bg-navy-soft text-navy" },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = doctor.name.replace("Dr. ", "").split(" ")[0];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">{greeting}, Dr. {firstName}</h1>
          <p className="page-sub mt-1">Here&apos;s your schedule and appointment activity for today.</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[0.78rem] font-bold rounded-full px-3 py-1.5 border ${acceptingShown ? "bg-success-soft text-success border-success/20" : "bg-slate-100 text-ink-secondary border-border"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
          {acceptingShown ? "Accepting appointments" : "Not accepting appointments"}
        </span>
      </div>

      {live && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
          {loading ? "Syncing with your live schedule…" : "Live schedule from your hospital"}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {cards.map((c, i) => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.28 }} className="card-base p-4">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.tint}`}><c.icon size={17} /></span>
            <p className="text-[1.35rem] font-extrabold text-navy mt-2 leading-none">{c.value}</p>
            <p className="text-[0.76rem] font-semibold text-ink-secondary mt-1">{c.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
        <section aria-label="Today's schedule">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="section-title">Today&apos;s schedule</h2>
            <Link to="/today" className="text-[0.82rem] font-bold text-healthcare hover:underline inline-flex items-center gap-1">Full day <ArrowRight size={14} /></Link>
          </div>
          <div className="space-y-2.5">
            {today.slice(0, 5).map((a) => (
              <AppointmentCard key={a.id} appointment={a} />
            ))}
            {today.length === 0 && (
              <p className="text-sm text-ink-secondary card-base p-4">No appointments today — your schedule is clear.</p>
            )}
          </div>
        </section>

        <div className="space-y-3">
          {next && (
            <section className="card-base p-5 border-healthcare/25" aria-label="Next appointment" style={{ borderTop: "3px solid #1769AA" }}>
              <p className="text-[0.72rem] font-bold uppercase tracking-widest text-healthcare">Next appointment</p>
              <div className="flex items-center gap-3 mt-2">
                <Avatar name={next.patient.name} />
                <div>
                  <p className="font-extrabold text-navy">{next.time}</p>
                  <p className="text-sm font-bold text-ink">{next.patient.name}</p>
                  <p className="text-[0.8rem] text-ink-secondary">{next.type} · {next.durationMinutes} min</p>
                </div>
              </div>
              <div className="mt-2"><StatusBadge status={next.questionnaire} /></div>
              <div className="flex gap-2 mt-3">
                <Link to={`/appointments/${next.id}`} className="flex-1 text-center text-[0.83rem] font-bold bg-navy text-white rounded-control py-2.5 hover:bg-navy-deep transition">View appointment</Link>
                <Link to="/questionnaires" className="flex-1 text-center text-[0.83rem] font-bold bg-white border border-border rounded-control py-2.5 hover:border-healthcare hover:text-healthcare transition">View questionnaire</Link>
              </div>
            </section>
          )}
          <section className="card-base p-5" aria-label="Questionnaires">
            <h2 className="section-title">Pre-visit forms</h2>
            <p className="text-[0.8rem] text-ink-secondary mt-0.5">{pendingForms} need attention · {questionnaires.filter((q) => q.status === "completed").length} completed</p>
            <ul className="mt-3 space-y-2">
              {questionnaires.slice(0, 3).map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-2 text-sm border border-border rounded-control px-3 py-2">
                  <span className="min-w-0"><span className="font-bold text-ink block truncate text-[0.83rem]">{q.patientName}</span><span className="text-[0.75rem] text-ink-secondary">{q.name}</span></span>
                  <StatusBadge status={q.status} />
                </li>
              ))}
            </ul>
            <Link to="/questionnaires" className="block text-center text-[0.83rem] font-bold text-healthcare hover:underline mt-3">All questionnaires</Link>
          </section>
        </div>
      </div>
    </div>
  );
}
