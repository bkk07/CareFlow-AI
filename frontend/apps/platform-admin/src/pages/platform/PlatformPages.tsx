import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";
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
  const { overview, hospitals, loading, backendError } = useAdmin();
  const pending = overview ? overview.pending_applications : hospitals.filter((h) => ["submitted", "under_review", "draft"].includes(h.status)).length;
  const openIssues = overview ? overview.open_reconciliations + overview.open_escalations : 0;
  return (
    <div className="space-y-5">
      <div><h1 className="page-title">Platform Overview</h1><p className="page-sub mt-1">Global visibility across hospitals, doctors, and operations.</p></div>
      <LiveBanner text="Live network counts" />
      {loading && <p className="text-[0.83rem] text-ink-secondary">Loading platform overview…</p>}
      {backendError && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{backendError}</p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Hospitals" value={String(overview ? overview.hospitals_total : hospitals.length)} sub={`${pending} pending review`} />
        <MetricCard label="Active doctors" value={overview ? String(overview.doctors_active) : "—"} sub="across network" tone="teal" />
        <MetricCard label="Patients" value={overview ? overview.patients_total.toLocaleString() : "—"} sub="administrative records" />
        <MetricCard label="Appointments today" value={overview ? String(overview.appointments_today) : "—"} sub="all hospitals" />
        <MetricCard label="AI conversations" value="—" sub="see AI Activity" />
        <MetricCard label="Integration health" value={overview ? (overview.open_reconciliations > 0 ? "Attention" : "Healthy") : "—"} sub="open reconciliations" tone={overview && overview.open_reconciliations > 0 ? "warning" : "success"} />
        <MetricCard label="Open operational issues" value={String(openIssues)} sub="needs review" tone={openIssues > 0 ? "danger" : "navy"} />
        <MetricCard label="Pending applications" value={String(pending)} sub="awaiting decision" tone={pending > 0 ? "warning" : "navy"} />
      </div>
      <div className="card-base p-5">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Needs attention</h2>
          <Link to="/platform/applications" className="text-[0.8rem] font-bold text-healthcare hover:underline inline-flex items-center gap-1">Review <ArrowRight size={13} /></Link>
        </div>
        {overview ? (
          <ul className="mt-2 divide-y divide-border/70 text-sm">
            <li className="py-2">{overview.pending_applications} hospital applications — <strong>awaiting review</strong>.</li>
            <li className="py-2">{overview.open_reconciliations} open reconciliations — <strong>verification needed</strong>.</li>
            <li className="py-2">{overview.open_escalations} open escalations — <strong>operator queue</strong>.</li>
          </ul>
        ) : (
          <div className="mt-2"><EmptyState title="No platform data yet" body="Connect the backend to populate network counts. New applications, reconciliations, and escalations will appear here." /></div>
        )}
      </div>
    </div>
  );
}

export function HospitalApplicationsPage() {
  const { hospitals, reviewHospital, loading, backendError } = useAdmin();
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
      {loading && <p className="text-[0.83rem] text-ink-secondary">Loading applications…</p>}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      {pending.length === 0 && !loading ? (
        <div className="card-base"><EmptyState title="No pending applications" body="New hospital applications will appear here for review." /></div>
      ) : pending.length > 0 ? (
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
      ) : null}
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
  const { hospitals, suspendHospital, loading, backendError } = useAdmin();
  const [error, setError] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Hospitals</h1><p className="page-sub mt-1">Every organization on the platform.</p></div>
      <LiveBanner text="Live hospital directory" />
      {loading && <p className="text-[0.83rem] text-ink-secondary">Loading hospitals…</p>}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      {hospitals.length === 0 && !loading ? (
        <div className="card-base"><EmptyState title="No hospitals yet" body="Hospitals registered through the backend will appear here." /></div>
      ) : hospitals.length > 0 ? (
        <ResponsiveTable headers={["Hospital", "Status", "Doctors", "Today", "Contact", "Actions"]}>
          {hospitals.map((h) => (
            <tr key={h.id} className="hover:bg-background/60">
              <td className="td-cell font-bold">{h.name}<span className="block text-[0.72rem] text-ink-faint font-semibold">{h.id.slice(0, 8)}</span></td>
              <td className="td-cell"><StatusBadge status={h.status} /></td>
              <td className="td-cell">{h.activeDoctors}/{h.doctors} active</td>
              <td className="td-cell">{h.appointmentsToday}</td>
              <td className="td-cell text-ink-secondary text-[0.8rem]">{h.contact}</td>
              <td className="td-cell">
                {h.status === "approved" ? (
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
      ) : null}
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
  const { doctors, loading, backendError } = useAdmin();
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Doctors</h1><p className="page-sub mt-1">Global directory across hospitals.</p></div>
      <LiveBanner text="Live doctor directory" />
      {loading && <p className="text-[0.83rem] text-ink-secondary">Loading doctors…</p>}
      {backendError && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{backendError}</p>
      )}
      {doctors.length === 0 && !loading ? (
        <div className="card-base"><EmptyState title="No doctors yet" body="Doctors registered through the backend will appear here." /></div>
      ) : doctors.length > 0 ? (
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
      ) : null}
    </div>
  );
}

export function PlatformPatientsPage() {
  const { patients, loading, backendError } = useAdmin();
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Patients</h1><p className="page-sub mt-1">Minimal administrative directory. Contact details partially masked.</p></div>
      <LiveBanner text="Live patient directory" />
      {loading && <p className="text-[0.83rem] text-ink-secondary">Loading patients…</p>}
      {backendError && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{backendError}</p>
      )}
      {patients.length === 0 && !loading ? (
        <div className="card-base"><EmptyState title="No patients yet" body="No patient accounts registered yet." /></div>
      ) : patients.length > 0 ? (
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
      ) : null}
    </div>
  );
}

export function PlatformAppointmentsPage() {
  const { appointments, loading, backendError } = useAdmin();
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Appointments</h1><p className="page-sub mt-1">All hospitals, with integration state.</p></div>
      <LiveBanner text="Live network bookings" />
      {loading && <p className="text-[0.83rem] text-ink-secondary">Loading appointments…</p>}
      {backendError && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{backendError}</p>
      )}
      {appointments.length === 0 && !loading ? (
        <div className="card-base"><EmptyState title="No appointments yet" body="Bookings created through the backend will appear here." /></div>
      ) : appointments.length > 0 ? (
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
      ) : null}
    </div>
  );
}

export function PlatformAIPage() {
  const { aiEvaluation, loading, backendError } = useAdmin();
  const avg = (ms: number | null) => (ms == null ? "—" : `${Math.round(ms)} ms`);
  if (loading && !aiEvaluation) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Platform AI Activity</h1><p className="page-sub mt-1">Capability executions across hospitals.</p></div>
        <LiveBanner text="Live capability aggregates" />
        <p className="text-[0.83rem] text-ink-secondary">Loading AI activity…</p>
      </div>
    );
  }
  if (backendError && !aiEvaluation) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Platform AI Activity</h1><p className="page-sub mt-1">Capability executions across hospitals.</p></div>
        <LiveBanner text="Live capability aggregates" />
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{backendError}</p>
      </div>
    );
  }
  if (!aiEvaluation) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Platform AI Activity</h1><p className="page-sub mt-1">Capability executions across hospitals.</p></div>
        <LiveBanner text="Live capability aggregates" />
        <div className="card-base"><EmptyState title="No AI executions yet" body="Capability executions reported by the backend will appear here." /></div>
      </div>
    );
  }
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
