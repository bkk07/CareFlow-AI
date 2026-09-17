import { useState } from "react";
import { Activity, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { AI_ACTIVITY, INTEGRATIONS } from "../../mock/ops";
import { useAdmin } from "../../store/AdminStore";
import { Button, MetricCard, StatusBadge } from "../../components/common/ui";
import { Drawer, ResponsiveTable } from "../../components/common/Modal";
import type { AIExecution } from "../../types";
import type { AIExecRow } from "../../store/AdminStore";

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

export function AIActivityPage() {
  const { live, aiExecutions } = useAdmin();
  const [selected, setSelected] = useState<AIExecRow | null>(null);

  if (live) {
    const success = aiExecutions.filter((e) => e.status === "success").length;
    const errors = aiExecutions.filter((e) => e.status === "error").length;
    const avg = aiExecutions.length > 0
      ? Math.round(aiExecutions.reduce((s, e) => s + e.latency, 0) / aiExecutions.length)
      : 0;
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">AI Activity</h1><p className="page-sub mt-1">Administrative assistant oversight. No patient conversation content shown.</p></div>
        <LiveBanner text="Live capability executions from your hospital" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <MetricCard label="Executions" value={String(aiExecutions.length)} sub="recent" />
          <MetricCard label="Success" value={String(success)} sub="capability level" tone="success" />
          <MetricCard label="Errors" value={String(errors)} sub="needs review" tone={errors > 0 ? "danger" : "navy"} />
          <MetricCard label="Avg latency" value={`${avg} ms`} sub="per execution" tone="teal" />
        </div>
        <ResponsiveTable headers={["Time", "Capability", "Status", "Duration", "Correlation", "Error"]}>
          {aiExecutions.map((e) => (
            <tr key={e.id} className="hover:bg-background/60 transition cursor-pointer" onClick={() => setSelected(e)}>
              <td className="td-cell whitespace-nowrap">{e.time}</td>
              <td className="td-cell font-mono text-[0.78rem]">{e.tool}</td>
              <td className="td-cell"><StatusBadge status={e.status} /></td>
              <td className="td-cell tabular-nums">{Math.round(e.latency)} ms</td>
              <td className="td-cell font-mono text-[0.78rem]">{e.correlation.slice(0, 8)}</td>
              <td className="td-cell text-ink-secondary text-[0.78rem] max-w-[220px] truncate">{e.error ?? "—"}</td>
            </tr>
          ))}
        </ResponsiveTable>
        {aiExecutions.length === 0 && (
          <div className="card-base p-5 text-sm text-ink-secondary">No capability executions recorded yet.</div>
        )}
        <Drawer open={!!selected} onClose={() => setSelected(null)} title="Capability execution">
          {selected && (
            <dl className="text-sm border border-border rounded-control overflow-hidden">
              {[
                ["Capability", selected.tool],
                ["Execution status", selected.status],
                ["Latency", `${Math.round(selected.latency)} ms`],
                ["Timestamp", selected.time],
                ["Correlation ID", selected.correlation],
                ["Actor", selected.actor ?? "—"],
                ["Error", selected.error ?? "—"],
              ].map(([k, v], i) => (
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

  return <AIActivityMockView />;
}

function AIActivityMockView() {
  const [selected, setSelected] = useState<AIExecution | null>(null);
  const success = AI_ACTIVITY.filter((e) => e.status === "success").length;
  const esc = AI_ACTIVITY.filter((e) => e.escalated).length;
  const avg = Math.round(AI_ACTIVITY.reduce((s, e) => s + e.durationMs, 0) / AI_ACTIVITY.length);

  return (
    <div className="space-y-4">
      <div><h1 className="page-title">AI Activity</h1><p className="page-sub mt-1">Administrative assistant oversight. No patient conversation content shown.</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Executions (24h)" value="1,284" sub={`${success} shown · sample`} />
        <MetricCard label="Success rate" value="97.2%" sub="capability level" tone="success" />
        <MetricCard label="Escalations" value={String(esc)} sub="to human" tone="warning" />
        <MetricCard label="Avg latency" value={`${avg} ms`} sub="per execution" tone="teal" />
      </div>
      <ResponsiveTable headers={["Time", "Conversation", "Intent", "Capability", "Status", "Duration", "Escalation"]}>
        {AI_ACTIVITY.map((e) => (
          <tr key={e.id} className="hover:bg-background/60 transition cursor-pointer" onClick={() => setSelected(e)}>
            <td className="td-cell whitespace-nowrap">{e.time}</td>
            <td className="td-cell font-mono text-[0.78rem]">{e.conversation}</td>
            <td className="td-cell font-semibold">{e.intent}</td>
            <td className="td-cell font-mono text-[0.78rem]">{e.capability}</td>
            <td className="td-cell"><StatusBadge status={e.status} /></td>
            <td className="td-cell tabular-nums">{e.durationMs} ms</td>
            <td className="td-cell">{e.escalated ? <StatusBadge status="escalated" /> : <span className="text-ink-faint">—</span>}</td>
          </tr>
        ))}
      </ResponsiveTable>
      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Capability execution">
        {selected && (
          <dl className="text-sm border border-border rounded-control overflow-hidden">
            {[
              ["Intent", selected.intent],
              ["Capability", selected.capability],
              ["Input summary", "specialty + date range (redacted)"],
              ["Validation", "passed"],
              ["Execution status", selected.status],
              ["Timestamp", `Today ${selected.time}`],
              ["Correlation ID", `corr-${selected.id}`],
              ["Operation ID", `op-${selected.id}`],
            ].map(([k, v], i) => (
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

export function IntegrationPage() {
  const { live, integration, integrationRows, operations } = useAdmin();
  const [tested, setTested] = useState(false);

  if (live) {
    const recent = integrationRows.slice(0, 8);
    const failed = recent.filter((o) => o.status === "error").length;
    const unknown = operations.filter((o) => o.status === "unknown").length;
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Integration</h1><p className="page-sub mt-1">Vendor connection health for your hospital.</p></div>
        <LiveBanner text="Live integration status" />
        <div className="card-base p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <span className="w-12 h-12 rounded-xl bg-teal-soft text-teal-dark flex items-center justify-center font-extrabold">EHR</span>
          <div className="flex-1">
            <p className="font-extrabold text-navy">Mock EHR <span className="text-ink-faint font-semibold">· test vendor</span></p>
            <p className="text-[0.8rem] text-ink-secondary">
              Vendor mappings: {integration?.vendor_mappings ?? "—"} · Open reconciliations: {integration?.open_reconciliations ?? "—"}
            </p>
          </div>
          <StatusBadge status={(integration?.open_reconciliations ?? 0) > 0 ? "degraded" : "connected"} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setTested(true)}>Test connection</Button>
          </div>
        </div>
        {tested && <p className="flex items-center gap-1.5 text-[0.85rem] font-bold text-success bg-success-soft border border-success/25 rounded-control px-3.5 py-2.5"><CheckCircle2 size={15} /> Connection test passed — vendor reachable.</p>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <MetricCard label="Recent executions" value={String(recent.length)} />
          <MetricCard label="Errors" value={String(failed)} tone={failed > 0 ? "danger" : "success"} />
          <MetricCard label="Unknown outcomes" value={String(unknown)} tone={unknown > 0 ? "warning" : "navy"} />
          <MetricCard label="Verifications (24h)" value={String(Object.values(integration?.verifications_24h ?? {}).reduce((s, n) => s + n, 0))} tone="teal" />
        </div>
        <ResponsiveTable headers={["Capability", "Status", "Latency", "At"]}>
          {recent.map((op) => (
            <tr key={op.id} className="hover:bg-background/60">
              <td className="td-cell font-mono text-[0.8rem]">{op.tool_name}</td>
              <td className="td-cell"><StatusBadge status={op.status} /></td>
              <td className="td-cell">{Math.round(op.latency_ms)} ms</td>
              <td className="td-cell">{op.created_at}</td>
            </tr>
          ))}
        </ResponsiveTable>
      </div>
    );
  }

  const int = INTEGRATIONS[0];
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Integration</h1><p className="page-sub mt-1">Mock EHR connection health (local simulation).</p></div>
      <div className="card-base p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <span className="w-12 h-12 rounded-xl bg-teal-soft text-teal-dark flex items-center justify-center font-extrabold">EHR</span>
        <div className="flex-1">
          <p className="font-extrabold text-navy">{int.name} <span className="text-ink-faint font-semibold">· {int.env}</span></p>
          <p className="text-[0.8rem] text-ink-secondary">Last verified: {tested ? "just now" : int.lastSync}</p>
        </div>
        <StatusBadge status={int.status} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setTested(true)}>Test connection</Button>
          <Button size="sm" variant="ghost">View configuration</Button>
        </div>
      </div>
      {tested && <p className="flex items-center gap-1.5 text-[0.85rem] font-bold text-success bg-success-soft border border-success/25 rounded-control px-3.5 py-2.5"><CheckCircle2 size={15} /> Connection test passed (mock).</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Requests" value={int.requests.toLocaleString()} />
        <MetricCard label="Success" value={int.success.toLocaleString()} tone="success" />
        <MetricCard label="Failures" value={String(int.failures)} tone="danger" />
        <MetricCard label="Unknown outcomes" value={String(int.unknown)} tone="warning" />
        <MetricCard label="Verifications" value={int.verifications.toLocaleString()} tone="teal" />
        <MetricCard label="Retries" value={String(int.retries)} />
      </div>
      <ResponsiveTable headers={["Operation", "Status", "Attempts", "Last run"]}>
        {[["create_appointment", "success", "1", "10:41 AM"], ["verify_external_appointment", "success", "1", "10:41 AM"], ["create_appointment", "error", "2", "09:57 AM"], ["synchronize_state", "success", "1", "08:52 AM"]].map(([op, st, att, t], i) => (
          <tr key={i} className="hover:bg-background/60"><td className="td-cell font-mono text-[0.8rem]">{op}</td><td className="td-cell"><StatusBadge status={st} /></td><td className="td-cell">{att}</td><td className="td-cell">{t}</td></tr>
        ))}
      </ResponsiveTable>
    </div>
  );
}

export function WorkflowsPage() {
  const { live, workflows } = useAdmin();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Workflows</h1><p className="page-sub mt-1">Automated follow-ups triggered by scheduling events.</p></div>
      {live ? <LiveBanner text="Live workflow executions for your hospital" /> : null}
      <div className="space-y-2.5">
        {workflows.map((w) => {
          const open = openId === w.id;
          return (
            <article key={w.id} className="card-base p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2.5">
                  {w.status === "failing" ? <XCircle size={17} className="text-danger" /> : w.status === "paused" ? <Activity size={17} className="text-ink-faint" /> : <CheckCircle2 size={17} className="text-success" />}
                  <div>
                    <p className="font-bold text-[0.9rem]">{w.name}</p>
                    <p className="text-[0.76rem] text-ink-secondary">Trigger: {w.trigger} · Last run {w.lastRun} · {w.success} ok / {w.failed} failed</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={w.status} />
                  <button onClick={() => setOpenId(open ? null : w.id)} className="text-[0.78rem] font-bold text-healthcare hover:underline">{open ? "Hide" : "View flow"}</button>
                </div>
              </div>
              {open && (
                <ol className="mt-3">
                  {w.steps.map((s, i) => (
                    <li key={s} className="flex gap-2.5 pb-2.5 last:pb-0 relative">
                      {i < w.steps.length - 1 && <span className="absolute left-[7px] top-5 bottom-0 w-px bg-border" aria-hidden />}
                      <span className="w-[15px] h-[15px] rounded-full bg-healthcare shrink-0 mt-1" aria-hidden />
                      <span className="text-[0.84rem] font-semibold">{s}</span>
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        })}
      </div>
      {workflows.length === 0 && live && (
        <div className="card-base p-5 text-sm text-ink-secondary">No workflow executions recorded yet — bookings and sweeps will appear here.</div>
      )}
      <p className="text-[0.78rem] text-ink-secondary flex items-center gap-1.5"><RefreshCw size={13} /> {live ? "Execution history is the operator-visible trace." : "Workflow runs are mock executions in this demo."}</p>
    </div>
  );
}
