import { useState } from "react";
import { INTEGRATIONS } from "../../mock/ops";
import { useAdmin } from "../../store/AdminStore";
import { LiveBanner } from "./PlatformPages";
import { MetricCard, StatusBadge } from "../../components/common/ui";
import { Drawer, ResponsiveTable } from "../../components/common/Modal";
import type { AuditEvent } from "../../types";

export function PlatformIntegrationsPage() {
  const { integrations, live } = useAdmin();
  if (live) {
    const failed = integrations.reduce((s, i) => s + i.failures, 0);
    const unknown = integrations.reduce((s, i) => s + i.unknown, 0);
    const retries = 0;
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Integrations</h1><p className="page-sub mt-1">Healthcare-system connections per hospital.</p></div>
        <LiveBanner text="Live vendor health per hospital" />
        {integrations.map((i) => (
          <div key={i.id} className="card-base p-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="font-extrabold text-navy">{i.name} <span className="text-ink-faint font-semibold">· {i.env}</span></p>
              <p className="text-[0.8rem] text-ink-secondary">{i.requests} requests · {i.unknown} unknown · {i.verifications} verifications (24h)</p>
            </div>
            <StatusBadge status={i.status} />
          </div>
        ))}
        {integrations.length === 0 && (
          <div className="card-base p-5 text-sm text-ink-secondary">No hospitals registered yet.</div>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <MetricCard label="Requests" value={String(integrations.reduce((s, i) => s + i.requests, 0))} />
          <MetricCard label="Failures" value={String(failed)} tone={failed > 0 ? "danger" : "success"} />
          <MetricCard label="Retries" value={String(retries)} />
          <MetricCard label="Unknown" value={String(unknown)} tone={unknown > 0 ? "warning" : "navy"} />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Integrations</h1><p className="page-sub mt-1">Healthcare-system connections per hospital (mock).</p></div>
      {INTEGRATIONS.map((i) => (
        <div key={i.id} className="card-base p-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="font-extrabold text-navy">{i.name} <span className="text-ink-faint font-semibold">· {i.env}</span></p>
            <p className="text-[0.8rem] text-ink-secondary">City General · {i.requests.toLocaleString()} requests · {i.unknown} unknown</p>
          </div>
          <StatusBadge status={i.status} />
        </div>
      ))}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Success" value="96.6%" tone="success" />
        <MetricCard label="Failures" value="12" tone="danger" />
        <MetricCard label="Retries" value="22" />
        <MetricCard label="Unknown" value="2" tone="warning" />
      </div>
    </div>
  );
}

export function PlatformWorkflowsPage() {
  const { workflows } = useAdmin();
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Workflows</h1><p className="page-sub mt-1">Automation health across the platform.</p></div>
      <LiveBanner text="Live workflow executions network-wide" />
      <ResponsiveTable headers={["Workflow", "Trigger", "Status", "Last run", "Success", "Failed"]}>
        {workflows.map((w) => (
          <tr key={w.id} className="hover:bg-background/60">
            <td className="td-cell font-bold">{w.name}</td><td className="td-cell text-ink-secondary">{w.trigger}</td>
            <td className="td-cell"><StatusBadge status={w.status} /></td><td className="td-cell">{w.lastRun}</td>
            <td className="td-cell">{w.success}</td><td className="td-cell">{w.failed}</td>
          </tr>
        ))}
      </ResponsiveTable>
      {workflows.length === 0 && (
        <div className="card-base p-5 text-sm text-ink-secondary">No workflow executions recorded yet.</div>
      )}
    </div>
  );
}

export function PlatformAnalyticsPage() {
  const { analytics, live } = useAdmin();
  if (live && analytics) {
    const total = analytics.appointments_total;
    const confirmed = analytics.appointments_by_state.confirmed ?? 0;
    const cancelled = analytics.appointments_by_state.cancelled ?? 0;
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Platform Analytics</h1><p className="page-sub mt-1">Network-level trends.</p></div>
        <LiveBanner text="Live network analytics" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <MetricCard label="Appointments" value={total.toLocaleString()} sub="all hospitals" />
          <MetricCard label="Confirmed share" value={total > 0 ? `${Math.round((confirmed / total) * 100)}%` : "—"} sub="network" tone="success" />
          <MetricCard label="Cancellation" value={total > 0 ? `${((cancelled / total) * 100).toFixed(1)}%` : "—"} sub={`${cancelled} cancelled`} />
          <MetricCard label="AI error rate" value={`${(analytics.ai_error_rate * 100).toFixed(1)}%`} sub={`${analytics.ai_executions_total} executions`} tone={analytics.ai_error_rate > 0.05 ? "warning" : "success"} />
        </div>
        <ResponsiveTable headers={["State", "Count"]}>
          {Object.entries(analytics.appointments_by_state).map(([state, count]) => (
            <tr key={state} className="hover:bg-background/60">
              <td className="td-cell"><StatusBadge status={state} /></td>
              <td className="td-cell font-bold">{count}</td>
            </tr>
          ))}
        </ResponsiveTable>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Platform Analytics</h1><p className="page-sub mt-1">Network-level trends (mock).</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Booking success" value="96.1%" tone="success" />
        <MetricCard label="Cancellation" value="3.4%" />
        <MetricCard label="Form completion" value="79%" tone="teal" />
        <MetricCard label="AI success" value="97.2%" tone="success" />
      </div>
    </div>
  );
}

export function AuditPage() {
  const { audit } = useAdmin();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("all");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const visible = audit.filter((a) => {
    if (result !== "all" && a.result !== result) return false;
    const q = query.toLowerCase().trim();
    if (q && !a.action.toLowerCase().includes(q) && !a.actor.toLowerCase().includes(q) && !a.resource.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Audit Logs</h1><p className="page-sub mt-1">Who did what, when. No clinical content.</p></div>
      <LiveBanner text="Live audit trail" />
      <div className="card-base p-3.5 flex flex-col sm:flex-row gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search actor, action, resource…" aria-label="Search audit" className="input-base flex-1" />
        <select value={result} onChange={(e) => setResult(e.target.value)} aria-label="Filter by result" className="input-base sm:!w-44">
          <option value="all">All results</option>
          <option value="success">Success</option>
          <option value="denied">Denied</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <ResponsiveTable headers={["Time", "Actor", "Action", "Resource", "Result", "Correlation"]}>
        {visible.map((a) => (
          <tr key={a.id} className="hover:bg-background/60 cursor-pointer" onClick={() => setSelected(a)}>
            <td className="td-cell whitespace-nowrap">{a.time}</td>
            <td className="td-cell font-mono text-[0.76rem]">{a.actor}</td>
            <td className="td-cell font-semibold">{a.action}</td>
            <td className="td-cell">{a.resource}</td>
            <td className="td-cell"><StatusBadge status={a.result} /></td>
            <td className="td-cell font-mono text-[0.76rem]">{a.correlationId}</td>
          </tr>
        ))}
      </ResponsiveTable>
      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Audit event">
        {selected && (
          <dl className="text-sm border border-border rounded-control overflow-hidden">
            {[["Timestamp", selected.time], ["Actor", selected.actor], ["Action", selected.action], ["Resource", selected.resource], ["Result", selected.result], ["Correlation ID", selected.correlationId]].map(([k, v], i) => (
              <div key={k} className={`flex justify-between gap-3 px-4 py-2.5 ${i % 2 ? "bg-background/60" : "bg-white"}`}>
                <dt className="text-ink-secondary">{k}</dt><dd className="font-semibold text-right font-mono text-[0.8rem]">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Drawer>
    </div>
  );
}

export function OperationalHealthPage() {
  const { metrics, aiEvaluation } = useAdmin();
  if (metrics) {
    const openRec = metrics.reconciliation.open;
    const failedFlows = Object.entries(metrics.workflow.workflows_by_status)
      .filter(([k]) => k === "failed")
      .reduce((s, [, n]) => s + n, 0);
    const aiErr = aiEvaluation ? aiEvaluation.error_rate : null;
    const bookingRate = metrics.booking.success_rate;
    const cards = [
      {
        label: "Integration health",
        state: openRec > 0 ? "Attention" : "Healthy",
        tone: openRec > 0 ? "warning" : "success",
        detail: `${openRec} open reconciliations · ${metrics.reconciliation.total} total cases`,
      },
      {
        label: "Workflow health",
        state: failedFlows > 0 ? "Degraded" : "Healthy",
        tone: failedFlows > 0 ? "warning" : "success",
        detail: `${failedFlows} failed executions · ${metrics.workflow.open_escalations} open escalations`,
      },
      {
        label: "AI health",
        state: aiErr != null && aiErr > 0.05 ? "Review" : "Healthy",
        tone: aiErr != null && aiErr > 0.05 ? "warning" : "success",
        detail: aiErr != null ? `${(aiErr * 100).toFixed(1)}% error rate` : "No executions yet",
      },
      {
        label: "Scheduling health",
        state: "Healthy",
        tone: "success",
        detail: bookingRate != null
          ? `${Math.round(bookingRate * 100)}% booking success · ${metrics.booking.terminal_total} terminal bookings`
          : "No terminal bookings yet",
      },
    ] as const;
    const tones: Record<string, string> = { warning: "bg-warning-soft text-warning", success: "bg-success-soft text-success" };
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Operational Health</h1><p className="page-sub mt-1">System status at a glance. Generated {new Date(metrics.generated_at).toLocaleString()}.</p></div>
        <LiveBanner text="Live observability metrics" />
        <div className="grid sm:grid-cols-2 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="card-base p-5">
              <p className="text-[0.76rem] font-bold uppercase tracking-wide text-ink-faint">{c.label}</p>
              <p className={`inline-flex items-center gap-1.5 font-extrabold text-[1.1rem] mt-1 px-2.5 py-1 rounded-full ${tones[c.tone]}`}>
                <span className="w-2 h-2 rounded-full bg-current" aria-hidden />{c.state}
              </p>
              <p className="text-[0.8rem] text-ink-secondary mt-1.5">{c.detail}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const cards = [
    { label: "Integration health", state: "Degraded", tone: "warning", detail: "Mock EHR · 2 unknown outcomes" },
    { label: "Workflow health", state: "Healthy", tone: "success", detail: "3/4 flows nominal" },
    { label: "AI health", state: "Healthy", tone: "success", detail: "97.2% success · latency normal" },
    { label: "Scheduling health", state: "Healthy", tone: "success", detail: "No double-booking detected" },
  ] as const;
  const tones: Record<string, string> = { warning: "bg-warning-soft text-warning", success: "bg-success-soft text-success" };
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Operational Health</h1><p className="page-sub mt-1">System status at a glance.</p></div>
      <div className="grid sm:grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card-base p-5">
            <p className="text-[0.76rem] font-bold uppercase tracking-wide text-ink-faint">{c.label}</p>
            <p className={`inline-flex items-center gap-1.5 font-extrabold text-[1.1rem] mt-1 px-2.5 py-1 rounded-full ${tones[c.tone]}`}>
              <span className="w-2 h-2 rounded-full bg-current" aria-hidden />{c.state}
            </p>
            <p className="text-[0.8rem] text-ink-secondary mt-1.5">{c.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
