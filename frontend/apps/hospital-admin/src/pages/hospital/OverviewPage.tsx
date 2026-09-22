import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { LivePill, MetricCard, PageHeader, StatusBadge, TableSkeleton } from "../../components/common/ui";

const LIFECYCLE = ["draft", "submitted", "under_review", "approved"] as const;

export default function HospitalOverviewPage() {
  const { appointments, doctors, departments, questionnaires, hospital, overview, live, loading, syncing, operations, reconciliations } = useAdmin();
  const todayCount = appointments.filter((a) => a.date === "Today").length;
  const activeDocs = doctors.filter((d) => d.status === "active").length;
  const hospitalName = hospital?.name ?? (loading ? "Loading…" : "Hospital");
  const hospitalStatus = (hospital?.status ?? "approved") as (typeof LIFECYCLE)[number] | "rejected" | "suspended";
  const stageIdx = LIFECYCLE.indexOf(hospitalStatus as (typeof LIFECYCLE)[number]);
  const attention =
    operations.filter((o) => ["failed", "unknown"].includes(o.status)).length +
    reconciliations.filter((r) => r.resolution === "open").length;
  const isInitial = loading && !hospital && appointments.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hospital Overview"
        sub={hospitalName}
        actions={<StatusBadge status={hospitalStatus} />}
      />

      {live && <LivePill syncing={syncing} loading={loading} text="Live data from your hospital" />}

      {attention > 0 && (
        <Link to="/ops" className="flex items-center gap-2.5 bg-warning-soft border border-warning/30 rounded-2xl px-4 py-3 text-sm hover:shadow-subtle transition">
          <AlertTriangle size={17} className="text-warning shrink-0" />
          <span className="font-bold text-ink">{attention} operations require attention</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[0.8rem] font-bold text-healthcare">Open operations <ArrowRight size={14} /></span>
        </Link>
      )}

      <section aria-label="Lifecycle">
        <div className="card-base p-4 sm:p-5">
          <p className="text-[0.76rem] font-bold uppercase tracking-wide text-ink-faint">Hospital status lifecycle</p>
          <ol className="flex items-center mt-3">
            {LIFECYCLE.map((s, i) => (
              <li key={s} className={`flex items-center ${i < LIFECYCLE.length - 1 ? "flex-1" : ""}`}>
                <div className="flex flex-col items-center gap-1.5">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.7rem] font-bold border-2 transition ${stageIdx >= 0 && i <= stageIdx ? "bg-success text-white border-success" : "bg-white text-ink-faint border-border"}`}>{i + 1}</span>
                  <span className={`text-[0.68rem] font-bold capitalize ${stageIdx >= 0 && i <= stageIdx ? "text-success" : "text-ink-faint"}`}>{s.replace("_", " ")}</span>
                </div>
                {i < LIFECYCLE.length - 1 && <div className={`h-0.5 flex-1 mx-1.5 mb-6 rounded-full ${stageIdx >= 0 && i < stageIdx ? "bg-success" : "bg-border"}`} aria-hidden />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {isInitial ? (
        <TableSkeleton rows={4} cols={4} />
      ) : (
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5" aria-label="Key metrics">
        {[
          { label: "Doctors", value: overview ? `${overview.doctors_active} / ${overview.doctors_total}` : `${activeDocs} / ${doctors.length}`, sub: "active / total" },
          { label: "Appointments today", value: String(todayCount), sub: "across departments" },
          { label: "Upcoming", value: overview ? String(overview.upcoming_appointments) : String(appointments.length), sub: "scheduled" },
          { label: "Open reconciliations", value: overview ? String(overview.pending_reconciliations) : String(reconciliations.filter((r) => r.resolution === "open").length), sub: "need attention", tone: "warning" as const },
          { label: "Departments", value: String(departments.length), sub: "clinical units" },
          { label: "Questionnaires", value: String(questionnaires.length), sub: "forms" },
          { label: "AI success rate", value: "—", sub: "last 24h", tone: "success" as const },
          { label: "Integration", value: live ? "Live" : "…", sub: live ? "connected" : "connecting", tone: "warning" as const },
        ].map((m, i) => (
          <motion.div key={m.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.3) }}>
            <MetricCard label={m.label} value={m.value} sub={m.sub} tone={m.tone ?? "navy"} />
          </motion.div>
        ))}
      </section>
      )}

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="card-base p-5">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Today&apos;s appointments</h2>
            <Link to="/appointments" className="text-[0.8rem] font-bold text-healthcare hover:underline">Manage</Link>
          </div>
          <ul className="mt-3 divide-y divide-border/70">
            {appointments.filter((a) => a.date === "Today").slice(0, 4).map((a) => (
              <li key={a.id} className="py-2.5 flex items-center justify-between gap-2 text-sm">
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
          <dl className="mt-3 space-y-2.5 text-sm">
            {[
              ["Address", hospital?.address ?? "—"],
              ["Contact", hospital ? `${hospital.contact_email} · ${hospital.contact_phone}` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-ink-secondary shrink-0">{k}</dt><dd className="font-semibold text-right truncate">{v}</dd></div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}
