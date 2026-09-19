import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { MetricCard, StatusBadge } from "../../components/common/ui";

const LIFECYCLE = ["draft", "submitted", "under_review", "approved"] as const;

export default function HospitalOverviewPage() {
  const { appointments, doctors, departments, questionnaires, hospital, overview, live, loading, operations, reconciliations } = useAdmin();
  const todayCount = appointments.filter((a) => a.date === "Today").length;
  const activeDocs = doctors.filter((d) => d.status === "active").length;
  const hospitalName = hospital?.name ?? (loading ? "Loading…" : "Hospital");
  const hospitalStatus = (hospital?.status ?? "approved") as (typeof LIFECYCLE)[number] | "rejected" | "suspended";
  const stageIdx = LIFECYCLE.indexOf(hospitalStatus as (typeof LIFECYCLE)[number]);
  const attention =
    operations.filter((o) => ["failed", "unknown"].includes(o.status)).length +
    reconciliations.filter((r) => r.resolution === "open").length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Hospital Overview</h1>
          <p className="page-sub mt-1">{hospitalName}</p>
        </div>
        <StatusBadge status={hospitalStatus} />
      </div>

      {live && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
          {loading ? "Syncing hospital data…" : "Live data from your hospital"}
        </p>
      )}

      {attention > 0 && (
        <Link to="/ops" className="flex items-center gap-2.5 bg-warning-soft border border-warning/30 rounded-card px-4 py-3 text-sm hover:shadow-subtle transition">
          <AlertTriangle size={17} className="text-warning shrink-0" />
          <span className="font-bold text-ink">{attention} operations require attention</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[0.8rem] font-bold text-healthcare">Open operations <ArrowRight size={14} /></span>
        </Link>
      )}

      <section aria-label="Lifecycle">
        <div className="card-base p-4">
          <p className="text-[0.76rem] font-bold uppercase tracking-wide text-ink-faint">Hospital status lifecycle</p>
          <ol className="flex items-center mt-2">
            {LIFECYCLE.map((s, i) => (
              <li key={s} className={`flex items-center ${i < LIFECYCLE.length - 1 ? "flex-1" : ""}`}>
                <div className="flex flex-col items-center gap-1">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.7rem] font-bold border ${stageIdx >= 0 && i <= stageIdx ? "bg-success text-white border-success" : "bg-white text-ink-faint border-border"}`}>{i + 1}</span>
                  <span className={`text-[0.68rem] font-bold capitalize ${stageIdx >= 0 && i <= stageIdx ? "text-success" : "text-ink-faint"}`}>{s.replace("_", " ")}</span>
                </div>
                {i < LIFECYCLE.length - 1 && <div className={`h-0.5 flex-1 mx-1 mb-5 rounded ${stageIdx >= 0 && i < stageIdx ? "bg-success" : "bg-border"}`} aria-hidden />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5" aria-label="Key metrics">
        {[
          { label: "Doctors", value: overview ? `${overview.doctors_active} / ${overview.doctors_total}` : loading && doctors.length === 0 ? "…" : `${activeDocs} / ${doctors.length}`, sub: "active / total" },
          { label: "Appointments today", value: loading && appointments.length === 0 ? "…" : String(todayCount), sub: "across departments" },
          { label: "Upcoming", value: overview ? String(overview.upcoming_appointments) : loading && appointments.length === 0 ? "…" : String(appointments.length), sub: "scheduled" },
          { label: "Open reconciliations", value: overview ? String(overview.pending_reconciliations) : String(reconciliations.filter((r) => r.resolution === "open").length), sub: "need attention", tone: "warning" as const },
          { label: "Departments", value: loading && departments.length === 0 ? "…" : String(departments.length), sub: "clinical units" },
          { label: "Questionnaires", value: loading && questionnaires.length === 0 ? "…" : String(questionnaires.length), sub: "forms" },
          { label: "AI success rate", value: "—", sub: "last 24h", tone: "success" as const },
          { label: "Integration", value: live ? "Live" : "…", sub: live ? "connected" : "connecting", tone: "warning" as const },
        ].map((m, i) => (
          <motion.div key={m.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <MetricCard label={m.label} value={m.value} sub={m.sub} tone={m.tone ?? "navy"} />
          </motion.div>
        ))}
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="card-base p-5">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Today&apos;s appointments</h2>
            <Link to="/appointments" className="text-[0.8rem] font-bold text-healthcare hover:underline">Manage</Link>
          </div>
          <ul className="mt-3 divide-y divide-border/70">
            {appointments.filter((a) => a.date === "Today").slice(0, 4).map((a) => (
              <li key={a.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0"><span className="font-bold block truncate">{a.time} · {a.patient}</span><span className="text-ink-secondary text-[0.78rem]">{a.doctor} · {a.type}</span></span>
                <StatusBadge status={a.status} />
              </li>
            ))}
            {appointments.filter((a) => a.date === "Today").length === 0 && (
              <li className="py-2 text-sm text-ink-secondary">{loading ? "Loading appointments…" : "No appointments today."}</li>
            )}
          </ul>
        </div>
        <div className="card-base p-5">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Hospital profile</h2>
            <Link to="/setup" className="text-[0.8rem] font-bold text-healthcare hover:underline">Configure</Link>
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ["Address", hospital?.address ?? "—"],
              ["Contact", hospital ? `${hospital.contact_email} · ${hospital.contact_phone}` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-ink-secondary">{k}</dt><dd className="font-semibold text-right">{v}</dd></div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}
