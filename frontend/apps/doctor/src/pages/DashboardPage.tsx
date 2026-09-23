import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowRight, CalendarCheck, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSchedule } from "../context/ScheduleContext";
import { AppointmentCard } from "../components/appointments/AppointmentCard";
import { Avatar, CardSkeleton, EmptyState, ErrorState, LiveBadge, StatusBadge } from "../components/common/ui";

function isPendingStatus(s: string): boolean {
  return ["pending", "requested", "sync_pending", "rescheduled"].includes(s);
}

export default function DashboardPage() {
  const { doctor } = useAuth();
  const { appointments, questionnaires, loading, error, refresh, accepting, rules } = useSchedule();

  const today = useMemo(
    () => appointments.filter((a) => a.dayGroup === "today").sort((x, y) => x.sortKey.localeCompare(y.sortKey)),
    [appointments],
  );
  const confirmed = today.filter((a) => a.status === "confirmed").length;
  const pending = today.filter((a) => isPendingStatus(a.status)).length;
  const completed = today.filter((a) => a.status === "completed").length;
  const next = useMemo(() => today.find((a) => ["confirmed", "pending", "requested", "rescheduled", "sync_pending"].includes(a.status)), [today]);
  const pendingToday = useMemo(() => today.filter((a) => isPendingStatus(a.status)).slice(0, 3), [today]);
  const upcomingNext = useMemo(
    () => appointments.filter((a) => a.dayGroup !== "today").sort((x, y) => x.sortKey.localeCompare(y.sortKey)).slice(0, 3),
    [appointments],
  );
  const pendingForms = questionnaires.filter((q) => q.status !== "completed");
  const openDays = rules.filter((r) => r.enabled).length;

  const stats = [
    { label: "Appointments", value: String(today.length) },
    { label: "Confirmed", value: String(confirmed) },
    { label: "Pending", value: String(pending) },
    { label: "Completed", value: String(completed) },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = doctor.name.replace(/^Dr\.\s*/i, "").split(" ")[0];
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-5">
      {/* 1. Who am I */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">{greeting}{firstName ? `, Dr. ${firstName}` : ""}</h1>
          <p className="page-sub mt-1">{dateLabel} · Here&apos;s what&apos;s on your schedule today.</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[0.78rem] font-bold rounded-full px-3 py-1.5 border ${accepting ? "bg-success-soft text-success border-success/20" : "bg-slate-100 text-ink-secondary border-border"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
          {accepting ? "Accepting appointments" : "Not accepting appointments"}
        </span>
      </div>

      <LiveBadge loading={loading} />
      {error && <ErrorState title="We couldn't load today's schedule." body={error} onRetry={() => void refresh()} />}

      {loading && appointments.length === 0 && !error && (
        <div className="space-y-2.5">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </div>
      )}

      {(!loading || appointments.length > 0) && !error && (
        <>
          {/* Compact TODAY summary — real counts only */}
          <section aria-label="Today at a glance" className="card-base px-5 py-4">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[0.72rem] font-bold uppercase tracking-widest text-healthcare">Today</p>
              <span className="text-[0.76rem] text-ink-secondary font-semibold">{dateLabel}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {stats.map((s) => (
                <div key={s.label} className="flex items-baseline gap-2">
                  <dd className="text-[1.4rem] font-extrabold text-navy tabular-nums leading-none">{s.value}</dd>
                  <dt className="text-[0.78rem] font-semibold text-ink-secondary">{s.label}</dt>
                </div>
              ))}
            </dl>
          </section>

          <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
            {/* 2. Today's schedule — dominant */}
            <section aria-label="Today's schedule">
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="section-title">Today&apos;s schedule</h2>
                <Link to="/today" className="text-[0.82rem] font-bold text-healthcare hover:underline inline-flex items-center gap-1">
                  Full day <ArrowRight size={14} />
                </Link>
              </div>
              {today.length === 0 ? (
                <div className="card-base">
                  <EmptyState
                    title="No appointments scheduled."
                    body="Your day is clear. New bookings will appear here."
                    action={<Link to="/availability" className="inline-flex items-center justify-center text-[0.83rem] font-bold bg-white border border-border rounded-control px-4 py-2.5 hover:border-healthcare hover:text-healthcare transition">View availability</Link>}
                  />
                </div>
              ) : (
                <ol className="space-y-2.5" aria-label="Today appointments timeline">
                  {today.slice(0, 6).map((a, i) => (
                    <motion.li
                      key={a.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, delay: Math.min(i * 0.04, 0.2) }}
                      className="flex gap-3"
                    >
                      <span className="hidden sm:block w-16 pt-4 text-[0.75rem] font-bold text-ink-faint tabular-nums shrink-0 text-right">{a.time}</span>
                      <span className="hidden sm:flex flex-col items-center shrink-0 pt-3" aria-hidden>
                        <span className={`w-2.5 h-2.5 rounded-full ${a.status === "completed" ? "bg-success" : a.status === "confirmed" ? "bg-healthcare" : a.status === "cancelled" ? "bg-border" : "bg-warning"}`} />
                        {i < Math.min(today.length, 6) - 1 && <span className="w-px flex-1 bg-border mt-1" />}
                      </span>
                      <div className="flex-1 min-w-0"><AppointmentCard appointment={a} /></div>
                    </motion.li>
                  ))}
                </ol>
              )}

              {/* 4. Pending appointments needing attention */}
              {pendingToday.length > 0 && (
                <div className="mt-4">
                  <h3 className="section-title mb-2">Pending confirmation <span className="text-ink-faint font-semibold text-[0.8rem]">· {pending}</span></h3>
                  <div className="space-y-2">
                    {pendingToday.map((a) => (
                      <Link key={a.id} to={`/appointments/${a.id}`} className="flex items-center gap-3 bg-warning-soft/50 border border-warning/25 rounded-control px-3.5 py-2.5 hover:border-warning transition">
                        <span className="text-[0.8rem] font-extrabold text-navy tabular-nums shrink-0">{a.time}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.85rem] font-bold text-ink truncate">{a.patient.name}</span>
                          <span className="block text-[0.75rem] text-ink-secondary">{a.type}</span>
                        </span>
                        <StatusBadge status={a.status} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Right rail: 3 → 7 in hierarchy order */}
            <div className="space-y-3">
              {/* 3. Next appointment */}
              {next ? (
                <section className="card-base p-5" aria-label="Next appointment" style={{ borderTop: "3px solid #1769AA" }}>
                  <p className="text-[0.72rem] font-bold uppercase tracking-widest text-healthcare">Next appointment</p>
                  <div className="flex items-center gap-3 mt-2">
                    <Avatar name={next.patient.name} />
                    <div className="min-w-0">
                      <p className="font-extrabold text-navy text-[1.05rem] tabular-nums">{next.time}</p>
                      <p className="text-sm font-bold text-ink truncate">{next.patient.name}</p>
                      <p className="text-[0.8rem] text-ink-secondary">{next.type} · {next.durationMinutes} min</p>
                    </div>
                  </div>
                  <div className="mt-2.5"><StatusBadge status={next.questionnaire} /></div>
                  <Link to={`/appointments/${next.id}`} className="block text-center text-[0.85rem] font-bold bg-navy text-white rounded-control py-2.5 mt-3 hover:bg-navy-deep transition">
                    Open appointment
                  </Link>
                </section>
              ) : (
                <section className="card-base p-5" aria-label="Next appointment">
                  <p className="text-[0.72rem] font-bold uppercase tracking-widest text-healthcare">Next appointment</p>
                  <p className="text-[0.88rem] font-semibold text-ink mt-2">No more appointments scheduled today.</p>
                </section>
              )}

              {/* 5. Questionnaires */}
              <section className="card-base p-5" aria-label="Questionnaires">
                <div className="flex items-center justify-between">
                  <h2 className="section-title">Pre-visit forms</h2>
                  <ClipboardList size={16} className="text-ink-faint" />
                </div>
                <p className="text-[0.8rem] text-ink-secondary mt-0.5">
                  {pendingForms.length === 0 ? "No questionnaires require your attention." : `${pendingForms.length} need${pendingForms.length === 1 ? "s" : ""} attention`}
                </p>
                {questionnaires.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {questionnaires.slice(0, 3).map((q) => (
                      <li key={q.id} className="flex items-center justify-between gap-2 text-sm border border-border rounded-control px-3 py-2">
                        <span className="min-w-0">
                          <span className="font-bold text-ink block truncate text-[0.83rem]">{q.patientName}</span>
                          <span className="text-[0.75rem] text-ink-secondary">{q.name}</span>
                        </span>
                        <StatusBadge status={q.status} />
                      </li>
                    ))}
                  </ul>
                )}
                <Link to="/questionnaires" className="block text-center text-[0.83rem] font-bold text-healthcare hover:underline mt-3">Review questionnaires</Link>
              </section>

              {/* 6. Availability status */}
              <section className="card-base p-5" aria-label="Availability status">
                <h2 className="section-title">Availability</h2>
                <p className="text-[0.8rem] text-ink-secondary mt-0.5">
                  {openDays === 0 ? "No working days open." : `Open ${openDays} day${openDays === 1 ? "" : "s"} a week.`}
                  {" "}{accepting ? "Booking is on." : "Booking is paused."}
                </p>
                <Link to="/availability" className="block text-center text-[0.83rem] font-bold bg-white border border-border rounded-control py-2.5 mt-3 hover:border-healthcare hover:text-healthcare transition">
                  Manage availability
                </Link>
              </section>

              {/* 7. Coming next */}
              <section aria-label="Coming next">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="section-title">Coming next</h2>
                  <Link to="/calendar" className="text-[0.82rem] font-bold text-healthcare hover:underline inline-flex items-center gap-1">
                    View calendar <ArrowRight size={14} />
                  </Link>
                </div>
                {upcomingNext.length === 0 ? (
                  <p className="text-sm text-ink-secondary card-base p-4">Your upcoming schedule is clear.</p>
                ) : (
                  <div className="space-y-2">
                    {upcomingNext.map((a) => (
                      <Link key={a.id} to={`/appointments/${a.id}`} className="flex items-center gap-3 card-base px-3.5 py-2.5 hover:shadow-card transition">
                        <span className="w-10 h-10 rounded-xl bg-healthcare-soft text-healthcare flex items-center justify-center shrink-0" aria-hidden>
                          <CalendarCheck size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.85rem] font-bold text-ink truncate">{a.patient.name}</span>
                          <span className="block text-[0.75rem] text-ink-secondary">{a.dateLabel} · {a.time} · {a.type}</span>
                        </span>
                        <StatusBadge status={a.status} />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
