import { useMemo, useState } from "react";
import { Activity, CheckCircle2, Search, XCircle } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, MetricCard, PageHeader, StatusBadge, TableSkeleton } from "../../components/common/ui";
import { Drawer, ResponsiveTable } from "../../components/common/Modal";
import { Pagination, usePagination } from "../../components/common/Pagination";
import type { AIExecRow } from "../../store/AdminStore";

export function LiveBanner({ text, onRefresh }: { text: string; onRefresh?: () => void }) {
  const { live, loading, syncing, refreshAll } = useAdmin();
  if (!live) return null;
  const busy = loading || syncing;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <p className="inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-full px-3 py-1.5 w-fit">
        <span className={`w-1.5 h-1.5 rounded-full ${busy ? "bg-teal-dark animate-pulse" : "bg-success"}`} aria-hidden />
        {busy ? "Syncing…" : text}
      </p>
      <button
        onClick={() => (onRefresh ? onRefresh() : void refreshAll())}
        disabled={busy}
        className="text-[0.8rem] font-bold text-healthcare hover:underline disabled:opacity-50 disabled:no-underline"
      >
        Refresh
      </button>
    </div>
  );
}

export function AIActivityPage() {
  const { aiExecutions, loading, syncing, backendError, refreshSection } = useAdmin();
  const [selected, setSelected] = useState<AIExecRow | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return aiExecutions;
    return aiExecutions.filter((e) => e.tool.toLowerCase().includes(q) || e.status.toLowerCase().includes(q));
  }, [aiExecutions, query]);
  const pager = usePagination(filtered, { initialSize: 10 });
  const isInitial = loading && aiExecutions.length === 0;

  if (backendError && aiExecutions.length === 0 && !isInitial) {
    return (
      <div className="space-y-4">
        <PageHeader title="AI Activity" sub="Administrative assistant oversight. No patient conversation content shown." />
        <LiveBanner text="Live capability executions from your hospital" onRefresh={() => void refreshSection("insights")} />
        <div className="card-base p-5">
          <p role="alert" className="text-[0.83rem] font-semibold text-danger">{backendError}</p>
          <button onClick={() => void refreshSection("insights")} className="mt-2 text-[0.8rem] font-bold text-healthcare hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  const success = aiExecutions.filter((e) => e.status === "success").length;
  const errors = aiExecutions.filter((e) => e.status === "error").length;
  const avg = aiExecutions.length > 0
    ? Math.round(aiExecutions.reduce((s, e) => s + e.latency, 0) / aiExecutions.length)
    : 0;
  return (
    <div className="space-y-4">
      <PageHeader title="AI Activity" sub="Administrative assistant oversight. No patient conversation content shown." count={`${filtered.length}`} />
      <LiveBanner text="Live capability executions from your hospital" onRefresh={() => void refreshSection("insights")} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Executions" value={String(aiExecutions.length)} sub="recent" />
        <MetricCard label="Success" value={String(success)} sub="capability level" tone="success" />
        <MetricCard label="Errors" value={String(errors)} sub="needs review" tone={errors > 0 ? "danger" : "navy"} />
        <MetricCard label="Avg latency" value={`${avg} ms`} sub="per execution" tone="teal" />
      </div>
      <div className="card-base p-3.5 flex flex-col sm:flex-row gap-2">
        <div className="flex items-center gap-2 flex-1 bg-background border border-border rounded-xl px-3 focus-within:border-healthcare focus-within:ring-2 focus-within:ring-healthcare/15 transition">
          <Search size={15} className="text-ink-faint shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by capability or status…" aria-label="Filter AI activity" className="w-full bg-transparent outline-none py-2 text-[0.86rem]" />
        </div>
      </div>
      {isInitial ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
      <ResponsiveTable
        headers={["Time", "Capability", "Status", "Duration", "Correlation", "Error"]}
        footer={
          <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} start={pager.start} end={pager.end} pageSize={pager.pageSize} onPage={pager.setPage} onSize={pager.setPageSize} />
        }
      >
        {pager.pageItems.map((e) => (
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
      )}
      {filtered.length === 0 && !isInitial && (
        <div className="card-base p-5 text-sm text-ink-secondary">No capability executions recorded yet.</div>
      )}
      {syncing && <p className="text-[0.75rem] text-ink-faint">Syncing in background…</p>}
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

export function IntegrationPage() {
  const { integration, integrationRows, operations, loading, backendError, refreshSection } = useAdmin();
  const [tested, setTested] = useState(false);
  const pager = usePagination(integrationRows, { initialSize: 10 });
  const isInitial = loading && integrationRows.length === 0 && !integration;

  if (backendError && integrationRows.length === 0 && !integration && !isInitial) {
    return (
      <div className="space-y-4">
        <PageHeader title="Integration" sub="Vendor connection health for your hospital." />
        <LiveBanner text="Live integration status" onRefresh={() => void refreshSection("insights")} />
        <div className="card-base p-5">
          <p role="alert" className="text-[0.83rem] font-semibold text-danger">{backendError}</p>
          <button onClick={() => void refreshSection("insights")} className="mt-2 text-[0.8rem] font-bold text-healthcare hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  const failed = integrationRows.filter((o) => o.status === "error").length;
  const unknown = operations.filter((o) => o.status === "unknown").length;
  return (
    <div className="space-y-4">
      <PageHeader title="Integration" sub="Vendor connection health for your hospital." count={`${integrationRows.length}`} />
      <LiveBanner text="Live integration status" onRefresh={() => void refreshSection("insights")} />
      <div className="card-base p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <span className="w-12 h-12 rounded-xl bg-teal-soft text-teal-dark flex items-center justify-center font-extrabold">EHR</span>
        <div className="flex-1">
          <p className="font-extrabold text-navy">EHR <span className="text-ink-faint font-semibold">· connected vendor</span></p>
          <p className="text-[0.8rem] text-ink-secondary">
            Vendor mappings: {integration?.vendor_mappings ?? "—"} · Open reconciliations: {integration?.open_reconciliations ?? "—"}
          </p>
        </div>
        <StatusBadge status={(integration?.open_reconciliations ?? 0) > 0 ? "degraded" : "connected"} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setTested(true)}>Test connection</Button>
        </div>
      </div>
      {tested && <p className="flex items-center gap-1.5 text-[0.85rem] font-bold text-success bg-success-soft border border-success/25 rounded-xl px-3.5 py-2.5"><CheckCircle2 size={15} /> Connection test passed — vendor reachable.</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Recent executions" value={String(integrationRows.length)} />
        <MetricCard label="Errors" value={String(failed)} tone={failed > 0 ? "danger" : "success"} />
        <MetricCard label="Unknown outcomes" value={String(unknown)} tone={unknown > 0 ? "warning" : "navy"} />
        <MetricCard label="Verifications (24h)" value={String(Object.values(integration?.verifications_24h ?? {}).reduce((s, n) => s + n, 0))} tone="teal" />
      </div>
      {isInitial ? (
        <TableSkeleton rows={6} cols={4} />
      ) : (
      <ResponsiveTable
        headers={["Capability", "Status", "Latency", "At"]}
        footer={
          <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} start={pager.start} end={pager.end} pageSize={pager.pageSize} onPage={pager.setPage} onSize={pager.setPageSize} />
        }
      >
        {pager.pageItems.map((op) => (
          <tr key={op.id} className="hover:bg-background/60">
            <td className="td-cell font-mono text-[0.8rem]">{op.tool_name}</td>
            <td className="td-cell"><StatusBadge status={op.status} /></td>
            <td className="td-cell tabular-nums">{Math.round(op.latency_ms)} ms</td>
            <td className="td-cell">{op.created_at}</td>
          </tr>
        ))}
      </ResponsiveTable>
      )}
      {integrationRows.length === 0 && !isInitial && (
        <div className="card-base p-5 text-sm text-ink-secondary">No recent vendor executions recorded yet.</div>
      )}
    </div>
  );
}

export function WorkflowsPage() {
  const { workflows, loading, backendError, refreshSection } = useAdmin();
  const [openId, setOpenId] = useState<string | null>(null);
  const pager = usePagination(workflows, { initialSize: 10 });
  const isInitial = loading && workflows.length === 0;

  if (backendError && workflows.length === 0 && !isInitial) {
    return (
      <div className="space-y-4">
        <PageHeader title="Workflows" sub="Automated follow-ups triggered by scheduling events." />
        <LiveBanner text="Live workflow executions for your hospital" onRefresh={() => void refreshSection("ops")} />
        <div className="card-base p-5">
          <p role="alert" className="text-[0.83rem] font-semibold text-danger">{backendError}</p>
          <button onClick={() => void refreshSection("ops")} className="mt-2 text-[0.8rem] font-bold text-healthcare hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Workflows" sub="Automated follow-ups triggered by scheduling events." count={`${workflows.length}`} />
      <LiveBanner text="Live workflow executions for your hospital" onRefresh={() => void refreshSection("ops")} />
      {isInitial ? (
        <TableSkeleton rows={5} cols={3} />
      ) : (
      <div className="space-y-2.5">
        {pager.pageItems.map((w) => {
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
      )}
      {workflows.length > 0 && (
        <div className="card-base overflow-hidden">
          <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} start={pager.start} end={pager.end} pageSize={pager.pageSize} onPage={pager.setPage} onSize={pager.setPageSize} />
        </div>
      )}
      {workflows.length === 0 && !isInitial && (
        <div className="card-base p-5 text-sm text-ink-secondary">No workflow executions recorded yet — bookings and sweeps will appear here.</div>
      )}
    </div>
  );
}
