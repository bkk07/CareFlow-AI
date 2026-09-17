import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { AI_ACTIVITY } from "../../mock/ops";
import { useAdmin } from "../../store/AdminStore";
import { Avatar, Button, EmptyState, MetricCard, StatusBadge } from "../../components/common/ui";
import { ConfirmDialog, Drawer, ResponsiveTable } from "../../components/common/Modal";
import type { Hospital } from "../../types";

const LIFECYCLE = ["draft", "submitted", "under_review", "approved"] as const;

export function LiveBanner({ text }: { text: string }) {
  const { live, loading, refreshAll } = useAdmin();
  if (!live) return null;
  return (
    <div className="flex items-center gap-2">
      <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
        {loading ? "Syncing…" : text}
      </p>
      <button onClick={() => void refreshAll()} className="text-[0.8rem] font-bold text-healthcare hover:underline">Refresh</button>
    </div>
  );
}

export function PlatformOverviewPage() {
  const { overview, hospitals, live } = useAdmin();
  const pending = live && overview ? overview.pending_applications : hospitals.filter((h) => ["submitted", "under_review", "draft"].includes(h.status)).length;
  const openIssues = live && overview ? overview.open_reconciliations + overview.open_escalations : 0;
  return (
    <div className="space-y-5">
      <div><h1 className="page-title">Platform Overview</h1><p className="page-sub mt-1">Global visibility across hospitals, doctors, and operations.</p></div>
      <LiveBanner text="Live network counts" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Hospitals" value={String(live && overview ? overview.hospitals_total : hospitals.length)} sub={`${pending} pending review`} />
        <MetricCard label="Active doctors" value={String(live && overview ? overview.doctors_active : "—")} sub="across network" tone="teal" />
        <MetricCard label="Patients" value={live && overview ? overview.patients_total.toLocaleString() : "—"} sub="administrative records" />
        <MetricCard label="Appointments today" value={String(live && overview ? overview.appointments_today : "—")} sub="all hospitals" />
        <MetricCard label="AI conversations" value="—" sub="see AI Activity" />
        <MetricCard label="Integration health" value={live && overview ? (overview.open_reconciliations > 0 ? "Attention" : "Healthy") : "—"} sub="open reconciliations" tone={live && overview && overview.open_reconciliations > 0 ? "warning" : "success"} />
        <MetricCard label="Open operational issues" value={String(openIssues)} sub="needs review" tone={openIssues > 0 ? "danger" : "navy"} />
        <MetricCard label="Pending applications" value={String(pending)} sub="awaiting decision" tone={pending > 0 ? "warning" : "navy"} />
      </div>
      <div className="card-base p-5">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Needs attention</h2>
          <Link to="/platform/applications" className="text-[0.8rem] font-bold text-healthcare hover:underline inline-flex items-center gap-1">Review <ArrowRight size={13} /></Link>
        </div>
        <ul className="mt-2 divide-y divide-border/70 text-sm">
          {live && overview ? (
            <>
              <li className="py-2">{overview.pending_applications} hospital applications — <strong>awaiting review</strong>.</li>
              <li className="py-2">{overview.open_reconciliations} open reconciliations — <strong>verification needed</strong>.</li>
              <li className="py-2">{overview.open_escalations} open escalations — <strong>operator queue</strong>.</li>
            </>
          ) : (
            <>
              <li className="py-2">Northgate Hospital application — <strong>submitted</strong>, awaiting review.</li>
              <li className="py-2">2 unknown integration outcomes — <strong>verification needed</strong>.</li>
              <li className="py-2">Eastside Clinic application was <strong>rejected</strong> — record kept for audit.</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}

export function HospitalApplicationsPage() {
  const { hospitals, reviewHospital, live, backendError } = useAdmin();
  const [selected, setSelected] = useState<Hospital | null>(null);
  const [decision, setDecision] = useState<{ id: string; approve: boolean } | null>(null);
  const [reason, setReason] = useState("Does not meet onboarding requirements.");
  const [error, setError] = useState<string | null>(null);
  const pending = hospitals.filter((h) => ["submitted", "under_review", "draft"].includes(h.status));

  async function decide(id: string, approve: boolean) {
    setError(null);
    try {
      await reviewHospital(id, approve ? "approved" : "rejected", approve ? undefined : reason);
      setDecision(null);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed.");
    }
  }

  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Hospital Applications</h1><p className="page-sub mt-1">{pending.length} awaiting decision.</p></div>
      <LiveBanner text="Live applications from the platform" />
      {(error ?? backendError) && live && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      {pending.length === 0 ? (
        <div className="card-base"><EmptyState title="No pending applications" body="New hospital applications will appear here for review." /></div>
      ) : (
        <ResponsiveTable headers={["Hospital", "Submitted", "Contact", "Status", "Actions"]}>
          {hospitals.map((h) => (
            <tr key={h.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{h.name}<span className="block text-[0.72rem] font-semibold text-ink-faint">{h.location}</span></td>
              <td className="td-cell">{h.submitted}</td>
              <td className="td-cell text-ink-secondary text-[0.8rem]">{h.contact}</td>
              <td className="td-cell"><StatusBadge status={h.status} /></td>
              <td className="td-cell">
                <div className="flex gap-2">
                  <button onClick={() => setSelected(h)} className="text-[0.78rem] font-bold text-healthcare hover:underline">Detail</button>
                  {["submitted", "under_review"].includes(h.status) && (
                    <>
                      <button onClick={() => setDecision({ id: h.id, approve: true })} className="text-[0.78rem] font-bold text-success hover:underline">Approve</button>
                      <button onClick={() => setDecision({ id: h.id, approve: false })} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Reject</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? "Application"}>
        {selected && (
          <div className="space-y-4 text-sm">
            <ol className="flex items-center">
              {LIFECYCLE.map((s, i) => {
                const idx = LIFECYCLE.indexOf(selected.status as (typeof LIFECYCLE)[number]);
                return (
                  <li key={s} className={`flex items-center ${i < LIFECYCLE.length - 1 ? "flex-1" : ""}`}>
                    <div className="flex flex-col items-center gap-1">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[0.65rem] font-bold border ${i <= idx ? "bg-success text-white border-success" : "bg-white text-ink-faint border-border"}`}>{i + 1}</span>
                      <span className="text-[0.64rem] font-bold capitalize">{s.replace("_", " ")}</span>
                    </div>
                    {i < LIFECYCLE.length - 1 && <div className={`h-0.5 flex-1 mx-1 mb-4 ${i < idx ? "bg-success" : "bg-border"}`} />}
                  </li>
                );
              })}
            </ol>
            <dl className="border border-border rounded-control overflow-hidden">
              {[["Contact", selected.contact], ["Location", selected.location], ["Departments", String(selected.departments)], ["Doctors", String(selected.doctors)], ["Submitted", selected.submitted]].map(([k, v], i) => (
                <div key={k} className={`flex justify-between px-4 py-2.5 ${i % 2 ? "bg-background/60" : "bg-white"}`}>
                  <dt className="text-ink-secondary">{k}</dt><dd className="font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {["submitted", "under_review"].includes(selected.status) && (
              <>
                <label className="block text-[0.83rem] font-bold">Rejection reason (used when rejecting)
                  <input value={reason} onChange={(e) => setReason(e.target.value)} className="input-base mt-1" />
                </label>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => void decide(selected.id, true)}><CheckCircle2 size={15} /> Approve</Button>
                  <Button variant="danger" className="flex-1" onClick={() => void decide(selected.id, false)}><XCircle size={15} /> Reject</Button>
                </div>
              </>
            )}
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={!!decision}
        onClose={() => setDecision(null)}
        title={decision?.approve ? "Approve hospital" : "Reject hospital"}
        body={decision?.approve ? "The hospital will go live and can configure doctors and schedules." : "The application will be marked rejected with a reason kept for audit."}
        confirmLabel={decision?.approve ? "Approve" : "Reject"}
        danger={!decision?.approve}
        onConfirm={() => decision && void decide(decision.id, decision.approve)}
      />
    </div>
  );
}

export function PlatformHospitalsPage() {
  const { hospitals, suspendHospital, live, backendError } = useAdmin();
  const [error, setError] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Hospitals</h1><p className="page-sub mt-1">Every organization on the platform.</p></div>
      <LiveBanner text="Live hospital directory" />
      {(error ?? backendError) && live && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      <ResponsiveTable headers={["Hospital", "Status", "Doctors", "Today", "Contact", "Actions"]}>
        {hospitals.map((h) => (
          <tr key={h.id} className="hover:bg-background/60">
            <td className="td-cell font-bold">{h.name}<span className="block text-[0.72rem] text-ink-faint font-semibold">{live ? h.id.slice(0, 8) : h.location}</span></td>
            <td className="td-cell"><StatusBadge status={h.status} /></td>
            <td className="td-cell">{h.activeDoctors}/{h.doctors} active</td>
            <td className="td-cell">{h.appointmentsToday}</td>
            <td className="td-cell text-ink-secondary text-[0.8rem]">{h.contact}</td>
            <td className="td-cell">
              {live && h.status === "approved" ? (
                <button
                  onClick={() => setConfirmSuspend(h.id)}
                  className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger"
                >
                  Suspend
                </button>
              ) : (
                <span className="text-ink-faint text-[0.78rem]">—</span>
              )}
            </td>
          </tr>
        ))}
      </ResponsiveTable>
      <ConfirmDialog
        open={!!confirmSuspend}
        onClose={() => setConfirmSuspend(null)}
        title="Suspend hospital"
        body="The hospital stops taking bookings immediately. This can only be reversed by platform review."
        confirmLabel="Suspend"
        danger
        onConfirm={() => {
          if (confirmSuspend) {
            setError(null);
            suspendHospital(confirmSuspend)
              .catch((e: unknown) => setError(e instanceof Error ? e.message : "Suspend failed."))
              .finally(() => setConfirmSuspend(null));
          }
        }}
      />
    </div>
  );
}

export function PlatformDoctorsPage() {
  const { doctors } = useAdmin();
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Doctors</h1><p className="page-sub mt-1">Global directory across hospitals.</p></div>
      <LiveBanner text="Live doctor directory" />
      <ResponsiveTable headers={["Doctor", "Hospital", "Specialty", "Status", "This week"]}>
        {doctors.map((d) => (
          <tr key={d.id} className="hover:bg-background/60">
            <td className="td-cell"><span className="flex items-center gap-2"><Avatar name={d.name} photo={d.photo} size="sm" /><span className="font-bold">{d.name}</span></span></td>
            <td className="td-cell">{d.hospital}</td>
            <td className="td-cell">{d.specialty}</td>
            <td className="td-cell"><StatusBadge status={d.status} /></td>
            <td className="td-cell">{d.appointmentsWeek}</td>
          </tr>
        ))}
      </ResponsiveTable>
    </div>
  );
}

export function PlatformPatientsPage() {
  const { patients, live } = useAdmin();
  if (live) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Patients</h1><p className="page-sub mt-1">Minimal administrative directory. Contact details partially masked.</p></div>
        <LiveBanner text="Live patient directory" />
        <ResponsiveTable headers={["Patient", "Contact", "Status", "Since"]}>
          {patients.map((p) => (
            <tr key={p.id} className="hover:bg-background/60">
              <td className="td-cell font-bold font-mono text-[0.8rem]">{p.id.slice(0, 8)}</td>
              <td className="td-cell font-mono text-[0.78rem]">{p.email}</td>
              <td className="td-cell"><StatusBadge status={p.active ? "active" : "deactivated"} /></td>
              <td className="td-cell">{p.since}</td>
            </tr>
          ))}
        </ResponsiveTable>
        {patients.length === 0 && (
          <div className="card-base p-5 text-sm text-ink-secondary">No patient accounts registered yet.</div>
        )}
      </div>
    );
  }
  const rows = [
    ["A. Morgan", "alex.m***@example.com", "City General", "3", "Active", "2023"],
    ["J. Smith", "john.s***@example.com", "City General", "2", "Active", "2024"],
    ["M. Garcia", "maria.g***@example.com", "Riverside", "1", "Active", "2024"],
    ["R. Chen", "robert.c***@example.com", "City General", "4", "Active", "2022"],
  ];
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Patients</h1><p className="page-sub mt-1">Minimal administrative directory. Contact details partially masked.</p></div>
      <ResponsiveTable headers={["Patient", "Contact", "Hospital", "Visits", "Status", "Since"]}>
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-background/60">
            <td className="td-cell font-bold">{r[0]}</td><td className="td-cell font-mono text-[0.78rem]">{r[1]}</td><td className="td-cell">{r[2]}</td><td className="td-cell">{r[3]}</td>
            <td className="td-cell"><StatusBadge status="active" /></td><td className="td-cell">{r[5]}</td>
          </tr>
        ))}
      </ResponsiveTable>
    </div>
  );
}

export function PlatformAppointmentsPage() {
  const { appointments } = useAdmin();
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Appointments</h1><p className="page-sub mt-1">All hospitals, with integration state.</p></div>
      <LiveBanner text="Live network bookings" />
      <ResponsiveTable headers={["ID", "Patient", "Doctor", "Hospital", "When", "Status", "Sync"]}>
        {appointments.map((a) => (
          <tr key={a.id} className="hover:bg-background/60">
            <td className="td-cell font-mono text-[0.78rem]">{a.id}</td>
            <td className="td-cell font-bold">{a.patient}</td>
            <td className="td-cell">{a.doctor}</td>
            <td className="td-cell">{a.hospital}</td>
            <td className="td-cell whitespace-nowrap">{a.date} · {a.time}</td>
            <td className="td-cell"><StatusBadge status={a.status} /></td>
            <td className="td-cell"><StatusBadge status={a.status === "sync_pending" ? "verifying" : "success"} /></td>
          </tr>
        ))}
      </ResponsiveTable>
    </div>
  );
}

export function PlatformAIPage() {
  const { aiEvaluation, live } = useAdmin();
  if (live && aiEvaluation) {
    const avg = (ms: number | null) => (ms == null ? "—" : `${Math.round(ms)} ms`);
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Platform AI Activity</h1><p className="page-sub mt-1">Capability executions across hospitals.</p></div>
        <LiveBanner text="Live capability aggregates" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <MetricCard label="Executions" value={aiEvaluation.executions_total.toLocaleString()} sub="all capabilities" />
          <MetricCard label="Errors" value={String(aiEvaluation.errors_total)} sub="needs review" tone={aiEvaluation.errors_total > 0 ? "warning" : "success"} />
          <MetricCard label="Error rate" value={`${(aiEvaluation.error_rate * 100).toFixed(1)}%`} sub="across network" tone={aiEvaluation.error_rate > 0.05 ? "warning" : "success"} />
          <MetricCard label="Capabilities" value={String(aiEvaluation.by_tool.length)} sub="distinct tools" tone="teal" />
        </div>
        <ResponsiveTable headers={["Capability", "Calls", "Errors", "Avg latency"]}>
          {aiEvaluation.by_tool.map((t) => (
            <tr key={t.tool_name} className="hover:bg-background/60">
              <td className="td-cell font-mono text-[0.78rem]">{t.tool_name}</td>
              <td className="td-cell">{t.calls}</td>
              <td className="td-cell">{t.errors}</td>
              <td className="td-cell tabular-nums">{avg(t.avg_latency_ms)}</td>
            </tr>
          ))}
        </ResponsiveTable>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Platform AI Activity</h1><p className="page-sub mt-1">Capability executions across hospitals.</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Conversations" value="1,893" sub="7 days" />
        <MetricCard label="Executions" value="6,412" sub="all capabilities" />
        <MetricCard label="Error rate" value="2.1%" sub="needs review" tone="warning" />
        <MetricCard label="Avg latency" value="612 ms" sub="per execution" tone="teal" />
      </div>
      <ResponsiveTable headers={["Time", "Hospital", "Intent", "Capability", "Status", "Duration"]}>
        {AI_ACTIVITY.map((e) => (
          <tr key={e.id} className="hover:bg-background/60">
            <td className="td-cell">{e.time}</td><td className="td-cell">{e.hospital}</td><td className="td-cell font-semibold">{e.intent}</td>
            <td className="td-cell font-mono text-[0.78rem]">{e.capability}</td>
            <td className="td-cell"><StatusBadge status={e.status} /></td><td className="td-cell tabular-nums">{e.durationMs} ms</td>
          </tr>
        ))}
      </ResponsiveTable>
    </div>
  );
}
