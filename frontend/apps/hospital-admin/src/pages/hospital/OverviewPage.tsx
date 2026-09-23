import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  LifeBuoy,
  Settings,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, EmptyState, StatusBadge, TableSkeleton } from "../../components/common/ui";
import { CountBar, HealthDot, InlineEmpty, SectionHeader } from "../../components/common/ops";
import type { AppointmentStatus } from "../../types";

type AttentionItem = {
  key: string;
  tone: "red" | "amber";
  title: string;
  desc: string;
  time: string;
  to: string;
  action: string;
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

const APPT_TABS = ["all", "confirmed", "pending", "completed", "cancelled"] as const;
type ApptTab = (typeof APPT_TABS)[number];

export default function HospitalOverviewPage() {
  const {
    appointments, doctors, departments, specialties, questionnaires, hospital,
    overview, analytics, integration, aiExecutions, workflows,
    live, loading, syncing, backendError, refreshAll,
    operations, reconciliations, escalations,
  } = useAdmin();

  const [tab, setTab] = useState<ApptTab>("all");
  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (live && !loading && !syncing) setUpdated(new Date());
  }, [live, loading, syncing]);

  const hospitalName = hospital?.name ?? (loading ? "Loading…" : "Hospital");
  const approved = (hospital?.status ?? "") === "approved";

  /* ------------------------------ derived ------------------------------ */
  const today = useMemo(() => appointments.filter((a) => a.date === "Today"), [appointments]);
  const todayByStatus = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of today) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [today]);
  const filteredToday = useMemo(
    () => (tab === "all" ? today : today.filter((a) => a.status === tab)),
    [today, tab],
  );

  const activeDocs = useMemo(() => doctors.filter((d) => d.status === "active"), [doctors]);
  const doctorsActive = overview?.doctors_active ?? activeDocs.length;
  const doctorsTotal = overview ? overview.doctors_total : doctors.length;
  const upcoming = overview?.upcoming_appointments ?? appointments.length;
  const openRecs = useMemo(() => reconciliations.filter((r) => r.resolution === "open"), [reconciliations]);
  const badOps = useMemo(() => operations.filter((o) => ["failed", "unknown"].includes(o.status)), [operations]);
  const openEsc = useMemo(() => escalations.filter((e) => e.status !== "resolved"), [escalations]);
  const openIssues = badOps.length + openRecs.length + openEsc.length;

  const aiSuccess = useMemo(() => aiExecutions.filter((e) => e.status === "success").length, [aiExecutions]);
  const aiErrors = useMemo(() => aiExecutions.filter((e) => e.status === "error").length, [aiExecutions]);
  const aiLatency = useMemo(() => {
    if (aiExecutions.length === 0) return null;
    return Math.round(aiExecutions.reduce((s, e) => s + e.latency, 0) / aiExecutions.length);
  }, [aiExecutions]);
  const topTools = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of aiExecutions) counts.set(e.tool, (counts.get(e.tool) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [aiExecutions]);

  const verifications = integration?.verifications_24h ?? {};
  const verifiedMatched = Object.entries(verifications)
    .filter(([k]) => k === "matched")
    .reduce((s, [, n]) => s + n, 0);
  const verifiedMismatched = Object.entries(verifications)
    .filter(([k]) => k !== "matched")
    .reduce((s, [, n]) => s + n, 0);

  const wfActive = useMemo(() => workflows.filter((w) => w.status !== "failing").length, [workflows]);
  const wfFailing = useMemo(() => workflows.filter((w) => w.status === "failing").length, [workflows]);

  const deptBars = useMemo(() => {
    const rows = departments.map((d) => ({ name: d.name, count: d.doctors }));
    const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
    return { rows: rows.slice(0, 6), max, total: departments.length };
  }, [departments]);

  const stateBars = useMemo(() => {
    const by = analytics?.appointments_by_state ?? {};
    const entries = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = entries.reduce((m, [, n]) => Math.max(m, n), 0);
    return { entries, max, total: analytics?.appointments_total ?? null };
  }, [analytics]);

  const trend = useMemo(() => {
    const daily = analytics?.bookings_per_day_30d ?? {};
    const days: { day: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ day: key.slice(5), count: daily[key] ?? 0 });
    }
    const max = days.reduce((m, d) => Math.max(m, d.count), 0);
    return { days, max };
  }, [analytics]);

  const attention = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    if (hospital && !approved) {
      items.push({
        key: "setup",
        tone: "amber",
        title: "Hospital setup incomplete",
        desc: `Status is ${hospital.status.replace("_", " ")} — finish setup to go live.`,
        time: "",
        to: "/setup",
        action: "Continue setup",
      });
    }
    if (live && doctorsActive === 0 && doctorsTotal > 0) {
      items.push({
        key: "doctors",
        tone: "amber",
        title: "No active doctors",
        desc: `${doctorsTotal} doctor${doctorsTotal === 1 ? "" : "s"} on record, none active — availability is unpublished.`,
        time: "",
        to: "/doctors",
        action: "Review doctors",
      });
    }
    for (const r of openRecs.slice(0, 2)) {
      items.push({
        key: `rec-${r.id}`,
        tone: "red",
        title: "Reconciliation required",
        desc: r.error || `Appointment ${r.appointmentId.slice(0, 8)} needs review.`,
        time: r.updated,
        to: "/ops/reconciliation",
        action: "Review",
      });
    }
    for (const o of badOps.slice(0, 3)) {
      items.push({
        key: `op-${o.id}`,
        tone: o.status === "failed" ? "red" : "amber",
        title: o.status === "failed" ? "Integration operation failed" : "Unknown operation outcome",
        desc: `${o.type} · ${o.error || "no error detail"} · ${o.attempts} attempt${o.attempts === 1 ? "" : "s"}`,
        time: o.started,
        to: "/ops",
        action: "Review",
      });
    }
    for (const e of openEsc.slice(0, 2)) {
      items.push({
        key: `esc-${e.id}`,
        tone: "amber",
        title: "AI escalation open",
        desc: e.issue,
        time: e.created,
        to: "/ops/escalations",
        action: "Review",
      });
    }
    return items.slice(0, 6);
  }, [hospital, approved, live, doctorsActive, doctorsTotal, openRecs, badOps, openEsc]);

  const events = useMemo(() => {
    const rows: { key: string; title: string; desc: string; time: string }[] = [];
    for (const o of operations.slice(0, 3)) {
      rows.push({ key: `op-${o.id}`, title: `${o.type} · ${o.status}`, desc: o.error || "EHR operation", time: o.started });
    }
    for (const r of reconciliations.slice(0, 2)) {
      rows.push({ key: `rec-${r.id}`, title: `Reconciliation ${r.resolution}`, desc: r.error || `Appointment ${r.appointmentId.slice(0, 8)}`, time: r.updated });
    }
    for (const e of escalations.slice(0, 2)) {
      rows.push({ key: `esc-${e.id}`, title: "AI escalation", desc: e.issue, time: e.created });
    }
    return rows.slice(0, 6);
  }, [operations, reconciliations, escalations]);

  const isInitial = loading && !hospital && appointments.length === 0;
  const showError = backendError && !isInitial && !hospital && appointments.length === 0;

  /* -------------------------------- render -------------------------------- */
  if (isInitial) {
    return (
      <div className="space-y-4" aria-label="Loading hospital overview">
        <div className="skeleton h-9 w-64 rounded-lg" />
        <div className="skeleton h-4 w-96 rounded" />
        <div className="card-base p-4">
          <div className="flex gap-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-9 flex-1 rounded-full" />)}</div>
        </div>
        <TableSkeleton rows={4} cols={4} />
        <TableSkeleton rows={5} cols={4} />
      </div>
    );
  }

  if (showError) {
    return (
      <div className="card-base p-8 text-center" role="alert">
        <h1 className="text-[1.25rem] font-bold text-navy">Unable to load hospital overview</h1>
        <p className="text-ink-secondary text-[0.88rem] mt-2">We couldn&apos;t retrieve the latest hospital data.</p>
        <Button className="mt-5" onClick={() => void refreshAll()}>Retry</Button>
      </div>
    );
  }

  const statusLabel = (s: AppointmentStatus) => s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const trendPoints = trend.days.map((d, i) => `${(i / 29) * 260},${86 - (trend.max > 0 ? (d.count / trend.max) * 76 : 0)}`).join(" ");

  return (
    <div className="space-y-4">
      {/* ---------- 1 · command header ---------- */}
      <section className="flex items-start justify-between gap-3 flex-wrap" aria-label="Command header">
        <div className="min-w-0">
          <p className="text-[0.72rem] font-semibold text-ink-secondary">{todayLabel()}</p>
          <h1 className="text-[1.45rem] sm:text-[1.7rem] font-extrabold text-navy tracking-tight leading-tight mt-0.5">
            {greeting()}, {hospitalName}
          </h1>
          <p className="text-[0.85rem] text-ink-secondary mt-1 flex items-center gap-2 flex-wrap">
            Here is what&apos;s happening across your hospital today.
            {live && (
              <span className="inline-flex items-center gap-1.5 text-[0.72rem] font-bold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-full px-2.5 py-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${syncing || loading ? "bg-teal-dark animate-pulse" : "bg-success"}`} aria-hidden />
                {syncing || loading ? "Syncing…" : updated ? `Updated ${updated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Live"}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to="/doctors" className="inline-flex items-center gap-1.5 bg-healthcare hover:bg-healthcare-dark text-white text-[0.83rem] font-bold rounded-control px-4 py-2.5 transition-colors duration-150">
            <UserPlus size={15} /> Add Doctor
          </Link>
          <Link to="/appointments" className="inline-flex items-center gap-1.5 bg-white hover:border-healthcare hover:text-healthcare text-navy text-[0.83rem] font-bold border border-border rounded-control px-4 py-2.5 transition-colors duration-150">
            Manage Appointments
          </Link>
        </div>
      </section>

      {backendError && (
        <p role="status" className="text-[0.8rem] font-semibold text-warning bg-warning-soft border border-warning/25 rounded-xl px-3.5 py-2.5">
          Background sync had an issue — showing the last loaded data.
        </p>
      )}

      {/* ---------- 2 · health strip ---------- */}
      <section className="card-base px-4 py-3" aria-label="Hospital health">
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
          <li className="flex items-center gap-2 text-[0.8rem]">
            <HealthDot tone={approved ? "green" : "amber"} />
            <span className="text-ink-secondary font-medium">Hospital</span>
            <span className="font-bold text-navy">{approved ? "Operational" : (hospital?.status?.replace("_", " ") ?? "—")}</span>
          </li>
          <li className="flex items-center gap-2 text-[0.8rem]">
            <HealthDot tone={!live ? "gray" : openRecs.length > 0 ? "amber" : "green"} />
            <span className="text-ink-secondary font-medium">Integration</span>
            <span className="font-bold text-navy">{!live ? "Connecting" : openRecs.length > 0 ? "Degraded" : "Connected"}</span>
          </li>
          <li className="flex items-center gap-2 text-[0.8rem]">
            <HealthDot tone={!live ? "gray" : doctorsActive > 0 ? "green" : "amber"} />
            <span className="text-ink-secondary font-medium">Scheduling</span>
            <span className="font-bold text-navy">{!live ? "…" : doctorsActive > 0 ? "Healthy" : "No active doctors"}</span>
          </li>
          <li className="flex items-center gap-2 text-[0.8rem]">
            <HealthDot tone={aiExecutions.length === 0 ? "gray" : aiErrors > 0 ? "red" : "green"} />
            <span className="text-ink-secondary font-medium">AI Assistant</span>
            <span className="font-bold text-navy">{aiExecutions.length === 0 ? "No activity" : aiErrors > 0 ? `${aiErrors} error${aiErrors === 1 ? "" : "s"}` : "Operational"}</span>
          </li>
          <li className="flex items-center gap-2 text-[0.8rem] ml-auto">
            <HealthDot tone={openIssues > 0 ? "amber" : "green"} />
            <span className="text-ink-secondary font-medium">Open issues</span>
            <Link to="/ops" className="font-bold text-navy hover:text-healthcare tabular-nums">{openIssues}</Link>
          </li>
        </ul>
      </section>

      {/* ---------- 3 · key metrics ---------- */}
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-2.5" aria-label="Key metrics">
        <div className="card-base p-4">
          <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-faint">Today&apos;s appointments</p>
          <p className="text-[1.7rem] font-extrabold text-navy tabular-nums leading-tight mt-1">{today.length}</p>
          <p className="text-[0.74rem] text-ink-secondary mt-0.5 tabular-nums">
            {todayByStatus.confirmed ?? 0} confirmed · {todayByStatus.pending ?? 0} pending
            {(todayByStatus.completed ?? 0) > 0 && <> · {todayByStatus.completed} completed</>}
            {(todayByStatus.cancelled ?? 0) > 0 && <> · {todayByStatus.cancelled} cancelled</>}
            {(todayByStatus.sync_pending ?? 0) + (todayByStatus.rescheduled ?? 0) > 0 && <> · {(todayByStatus.sync_pending ?? 0) + (todayByStatus.rescheduled ?? 0)} syncing</>}
          </p>
        </div>
        <div className="card-base p-4">
          <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-faint">Upcoming</p>
          <p className="text-[1.7rem] font-extrabold text-navy tabular-nums leading-tight mt-1">{upcoming}</p>
          <p className="text-[0.74rem] text-ink-secondary mt-0.5">scheduled visits</p>
        </div>
        <div className="card-base p-4">
          <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-faint">Active doctors</p>
          <p className="text-[1.7rem] font-extrabold text-navy tabular-nums leading-tight mt-1">
            {doctorsActive}<span className="text-[1rem] font-bold text-ink-faint"> / {doctorsTotal}</span>
          </p>
          <p className="text-[0.74rem] text-ink-secondary mt-0.5">active / total</p>
        </div>
        <div className={`card-base p-4 ${openIssues > 0 ? "border-warning/40" : ""}`}>
          <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-faint">Open issues</p>
          <p className={`text-[1.7rem] font-extrabold tabular-nums leading-tight mt-1 ${openIssues > 0 ? "text-warning" : "text-success"}`}>{openIssues}</p>
          <p className="text-[0.74rem] text-ink-secondary mt-0.5 tabular-nums">
            {badOps.length} ops · {openRecs.length} reconciliation · {openEsc.length} escalations
          </p>
        </div>
      </section>

      {/* ---------- 4 · attention ---------- */}
      <section className="card-base p-4 sm:p-5" aria-label="Attention required">
        <SectionHeader
          title="Attention required"
          sub={attention.length > 0 ? `${attention.length} item${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} review` : undefined}
          action={attention.length > 0 ? { label: "Open operations", to: "/ops" } : undefined}
        />
        {attention.length === 0 ? (
          <InlineEmpty title="All clear" body="All hospital operations are synchronized." />
        ) : (
          <ul className="mt-3 divide-y divide-border/70">
            {attention.map((a) => (
              <li key={a.key} className="py-2.5 flex items-center gap-3">
                <AlertTriangle size={16} className={a.tone === "red" ? "text-danger shrink-0" : "text-warning shrink-0"} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[0.86rem] text-ink">{a.title}</p>
                  <p className="text-[0.78rem] text-ink-secondary truncate">{a.desc}{a.time ? ` · ${a.time}` : ""}</p>
                </div>
                <Link to={a.to} className="inline-flex items-center gap-1 text-[0.78rem] font-bold text-healthcare hover:underline shrink-0">
                  {a.action} <ArrowRight size={13} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid xl:grid-cols-[1.5fr_1fr] gap-4">
        <div className="space-y-4 min-w-0">
          {/* ---------- 5 · today's operations ---------- */}
          <section className="card-base p-4 sm:p-5" aria-label="Today's appointments">
            <SectionHeader title="Today's operations" sub={`${today.length} appointment${today.length === 1 ? "" : "s"} on today's schedule`} action={{ label: "View all", to: "/appointments" }} />
            <div className="flex gap-1.5 mt-3 overflow-x-auto no-scrollbar" role="tablist" aria-label="Filter by status">
              {APPT_TABS.map((t) => {
                const count = t === "all" ? today.length : (todayByStatus[t] ?? 0);
                return (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`px-3 py-1.5 rounded-full text-[0.76rem] font-bold whitespace-nowrap border transition-colors duration-150 ${tab === t ? "bg-navy text-white border-navy" : "bg-white text-ink-secondary border-border hover:border-healthcare hover:text-healthcare"}`}
                  >
                    {t === "all" ? "All" : statusLabel(t as AppointmentStatus)} · {count}
                  </button>
                );
              })}
            </div>
            {loading && today.length === 0 ? (
              <TableSkeleton rows={4} cols={4} />
            ) : filteredToday.length === 0 ? (
              <div className="py-6 px-4 text-center">
                <p className="font-bold text-ink text-[0.88rem]">{tab === "all" ? "No appointments are scheduled for today." : `No ${statusLabel(tab as AppointmentStatus).toLowerCase()} appointments today.`}</p>
                <Link to="/appointments" className="inline-block mt-2 text-[0.8rem] font-bold text-healthcare hover:underline">View appointments</Link>
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-border/70">
                {filteredToday.slice(0, 6).map((a) => (
                  <li key={a.id} className="py-2.5 flex items-center gap-3 text-sm">
                    <span className="w-[64px] shrink-0 font-bold tabular-nums text-navy text-[0.83rem]">{a.time}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-bold block truncate text-[0.86rem]">{a.patient} <span className="font-medium text-ink-faint">· {a.doctor}</span></span>
                      <span className="text-ink-secondary text-[0.76rem] truncate block">{a.specialty}{a.specialty && a.type ? " · " : ""}{a.type}</span>
                    </span>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- bookings trend + status ---------- */}
          <section className="grid sm:grid-cols-2 gap-4">
            <div className="card-base p-4 sm:p-5">
              <SectionHeader title="Bookings per day" sub="Last 30 days" action={{ label: "Analytics", to: "/analytics" }} />
              {analytics ? (
                <svg viewBox="0 0 260 90" className="w-full h-24 mt-3" role="img" aria-label="Bookings per day over the last 30 days">
                  <polyline points={trendPoints} fill="none" stroke="#1769AA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  {trend.days.map((d, i) =>
                    d.count > 0 && i % 5 === 0 ? (
                      <circle key={d.day} cx={(i / 29) * 260} cy={86 - (trend.max > 0 ? (d.count / trend.max) * 76 : 0)} r="2.5" fill="#1769AA" />
                    ) : null,
                  )}
                </svg>
              ) : (
                <p className="text-[0.8rem] text-ink-secondary py-5 text-center">{loading ? "Loading…" : "No booking history yet."}</p>
              )}
            </div>
            <div className="card-base p-4 sm:p-5">
              <SectionHeader title="Appointments by state" sub={stateBars.total !== null ? `${stateBars.total} total` : "All appointments"} />
              {stateBars.entries.length === 0 ? (
                <p className="text-[0.8rem] text-ink-secondary py-5 text-center">{loading ? "Loading…" : "No appointments recorded yet."}</p>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {stateBars.entries.map(([state, count]) => (
                    <CountBar key={state} label={state.replace("_", " ")} count={count} max={stateBars.max} tone={state === "confirmed" || state === "completed" ? "bg-success" : state === "cancelled" || state === "failed" ? "bg-danger" : state === "pending" || state === "sync_pending" || state === "reconciliation_required" ? "bg-warning" : "bg-healthcare"} />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-4 min-w-0">
          {/* ---------- 6 · capacity ---------- */}
          <section className="card-base p-4 sm:p-5" aria-label="Hospital capacity">
            <SectionHeader title="Care team capacity" sub={`${doctorsActive} active · ${departments.length} departments · ${specialties.length} specialties`} action={{ label: "Doctors", to: "/doctors" }} />
            {deptBars.rows.length === 0 ? (
              <p className="text-[0.8rem] text-ink-secondary py-4 text-center">{loading ? "Loading…" : "No departments configured yet."}</p>
            ) : (
              <div className="mt-3 space-y-2.5">
                {deptBars.rows.map((r) => (
                  <CountBar key={r.name} label={r.name} count={r.count} max={deptBars.max} tone="bg-teal" />
                ))}
                {deptBars.total > deptBars.rows.length && (
                  <p className="text-[0.74rem] text-ink-secondary">+ {deptBars.total - deptBars.rows.length} more departments</p>
                )}
              </div>
            )}
            <p className="text-[0.76rem] text-ink-secondary mt-3">
              {questionnaires.length} questionnaire{questionnaires.length === 1 ? "" : "s"} configured ·{" "}
              <Link to="/questionnaires" className="font-bold text-healthcare hover:underline">Review forms</Link>
            </p>
          </section>

          {/* ---------- 7 · AI + integration ---------- */}
          <section className="card-base p-4 sm:p-5" aria-label="AI and integration health">
            <SectionHeader title="AI & integration health" sub="Scheduling assistant and connected systems" />
            <div className="grid grid-cols-2 gap-2.5 mt-3">
              <div className="border border-border rounded-xl p-3">
                <p className="text-[0.68rem] font-bold uppercase tracking-wide text-ink-faint">AI executions</p>
                <p className="text-[1.35rem] font-extrabold text-navy tabular-nums">{aiExecutions.length}</p>
                <p className="text-[0.72rem] text-ink-secondary tabular-nums">{aiSuccess} ok · {aiErrors} errors{aiLatency !== null && <> · {aiLatency} ms avg</>}</p>
                {topTools.length > 0 && (
                  <p className="text-[0.7rem] text-ink-faint mt-1.5 truncate font-mono">{topTools.map(([t, n]) => `${t}×${n}`).join(" · ")}</p>
                )}
              </div>
              <div className="border border-border rounded-xl p-3">
                <p className="text-[0.68rem] font-bold uppercase tracking-wide text-ink-faint">Verifications · 24h</p>
                <p className="text-[1.35rem] font-extrabold text-navy tabular-nums">{verifiedMatched + verifiedMismatched}</p>
                <p className="text-[0.72rem] text-ink-secondary tabular-nums">{verifiedMatched} matched · {verifiedMismatched} mismatched</p>
                <p className="text-[0.7rem] text-ink-faint mt-1.5">{integration?.vendor_mappings ?? "—"} vendor mappings</p>
              </div>
            </div>
            {operations.slice(0, 3).length > 0 && (
              <ul className="mt-3 divide-y divide-border/70 border-t border-border/70">
                {operations.slice(0, 3).map((o) => (
                  <li key={o.id} className="py-2 flex items-center gap-2 text-[0.78rem]">
                    <span className="font-mono truncate flex-1">{o.type}</span>
                    <span className="text-ink-faint tabular-nums">×{o.attempts}</span>
                    <StatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-4 mt-3 text-[0.78rem] font-bold">
              <Link to="/ai-activity" className="text-healthcare hover:underline">AI activity</Link>
              <Link to="/integration" className="text-healthcare hover:underline">Integration</Link>
            </div>
          </section>

          {/* ---------- 8 · workflows ---------- */}
          <section className="card-base p-4 sm:p-5" aria-label="Workflow health">
            <SectionHeader title="Workflow health" sub={workflows.length > 0 ? `${wfActive} active · ${wfFailing} failing` : undefined} action={{ label: "Workflows", to: "/workflows" }} />
            {workflows.length === 0 ? (
              <p className="text-[0.8rem] text-ink-secondary py-4 text-center">{loading ? "Loading…" : "No workflow executions recorded yet — bookings and sweeps will appear here."}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {workflows.slice(0, 4).map((w) => (
                  <li key={w.id} className="flex items-center gap-2.5 text-[0.8rem]">
                    {w.status === "failing" ? <AlertTriangle size={14} className="text-danger shrink-0" /> : <CheckCircle2 size={14} className="text-success shrink-0" />}
                    <span className="font-semibold truncate flex-1">{w.name}</span>
                    <span className="text-ink-faint text-[0.72rem] truncate">{w.lastRun}</span>
                    <StatusBadge status={w.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* ---------- 9 · quick actions ---------- */}
      <section className="card-base p-4 sm:p-5" aria-label="Quick actions">
        <SectionHeader title="Quick actions" sub="Jump to the tasks administrators do most" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          {[
            [UserPlus, "Add doctor", "/doctors"],
            [Building2, "Departments", "/catalog/departments"],
            [ClipboardList, "Visit types", "/catalog/types"],
            [CalendarDays, "Appointments", "/appointments"],
            [ClipboardList, "Questionnaires", "/questionnaires"],
            [Activity, "AI activity", "/ai-activity"],
            [Settings, "Integration", "/integration"],
            [BarChart3, "Analytics", "/analytics"],
          ].map(([Icon, label, to]) => {
            const I = Icon as typeof Building2;
            return (
              <Link key={label as string} to={to as string} className="flex items-center gap-2.5 border border-border rounded-xl px-3.5 py-3 text-[0.82rem] font-bold text-ink hover:border-healthcare hover:text-healthcare transition-colors duration-150">
                <I size={16} className="shrink-0 text-healthcare" /> {label as string}
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid xl:grid-cols-[1fr_1.5fr] gap-4">
        {/* ---------- 10 · hospital profile ---------- */}
        <section className="card-base p-4 sm:p-5" aria-label="Hospital profile">
          <SectionHeader title="Hospital profile" action={{ label: "Configure", to: "/setup" }} />
          <div className="flex items-center gap-2 mt-3">
            <StatusBadge status={hospital?.status ?? "draft"} />
            {approved && (
              <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-success"><ShieldCheck size={13} /> Verified operational</span>
            )}
          </div>
          <dl className="mt-3 space-y-2 text-[0.83rem]">
            {[
              ["Address", hospital?.address ?? "—"],
              ["Contact", hospital ? `${hospital.contact_email} · ${hospital.contact_phone}` : "—"],
              ["City", hospital?.city ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink-secondary shrink-0">{k}</dt>
                <dd className="font-semibold text-right truncate">{v}</dd>
              </div>
            ))}
          </dl>
          <ol className="flex items-center mt-4 pt-3 border-t border-border/70" aria-label="Onboarding lifecycle">
            {(["draft", "submitted", "under_review", "approved"] as const).map((s, i, arr) => {
              const idx = arr.indexOf((hospital?.status ?? "approved") as (typeof arr)[number]);
              const done = idx >= 0 && i <= idx;
              return (
                <li key={s} className={`flex items-center ${i < arr.length - 1 ? "flex-1" : ""}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.6rem] font-bold border ${done ? "bg-success text-white border-success" : "bg-white text-ink-faint border-border"}`} aria-hidden>{i + 1}</span>
                  {i < arr.length - 1 && <span className={`h-0.5 flex-1 mx-1 rounded-full ${idx >= 0 && i < idx ? "bg-success" : "bg-border"}`} aria-hidden />}
                </li>
              );
            })}
          </ol>
        </section>

        {/* ---------- 11 · operational events ---------- */}
        <section className="card-base p-4 sm:p-5" aria-label="Operational events">
          <SectionHeader title="Operational events" sub="Latest integration, reconciliation, and escalation updates" action={{ label: "Operations", to: "/ops" }} />
          {events.length === 0 ? (
            <EmptyState title="No events yet" body="Integration operations, reconciliations, and escalations will appear here." />
          ) : (
            <ul className="mt-2 divide-y divide-border/70">
              {events.map((e) => (
                <li key={e.key} className="py-2 flex items-center gap-2.5 text-[0.8rem]">
                  <LifeBuoy size={14} className="text-ink-faint shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="font-bold block truncate">{e.title}</span>
                    <span className="text-ink-secondary truncate block">{e.desc}</span>
                  </span>
                  <span className="text-ink-faint text-[0.72rem] whitespace-nowrap">{e.time}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
