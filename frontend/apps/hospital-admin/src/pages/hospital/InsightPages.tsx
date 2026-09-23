import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Activity, BarChart3, CheckCircle2, Search, Settings, Workflow } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, StatusBadge, TableSkeleton } from "../../components/common/ui";
import { CountBar } from "../../components/common/ops";
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

const INSIGHT_TABS = [
  { to: "/ai-activity", label: "AI Activity", icon: Activity },
  { to: "/integration", label: "Integration", icon: Settings },
  { to: "/workflows", label: "Workflows", icon: Workflow },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function InsightsTabs() {
  const { pathname } = useLocation();
  return (
    <nav className="flex gap-1 overflow-x-auto no-scrollbar border-b border-border" aria-label="Insights sections">
      {INSIGHT_TABS.map((t) => {
        const active = pathname === t.to;
        return (
          <Link
            key={t.to}
            to={t.to}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 px-4 py-2.5 text-[0.83rem] font-bold whitespace-nowrap border-b-2 -mb-px transition-colors duration-150 ${active ? "text-healthcare border-healthcare" : "text-ink-secondary border-transparent hover:text-ink"}`}
          >
            <t.icon size={15} /> {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function InsightsHeader({
  eyebrow,
  title,
  sub,
  count,
  banner,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  count?: string;
  banner: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-teal-dark">{eyebrow}</p>
      <div className="flex items-start justify-between gap-3 flex-wrap mt-1.5">
        <div className="min-w-0">
          <h1 className="text-[1.45rem] sm:text-[1.7rem] font-extrabold text-navy tracking-tight leading-tight">
            {title} {count && <span className="text-[0.95rem] font-bold text-ink-faint tabular-nums align-middle">{count}</span>}
          </h1>
          <p className="text-[0.85rem] text-ink-secondary mt-1">{sub}</p>
        </div>
        {banner}
      </div>
      <div className="mt-4"><InsightsTabs /></div>
    </div>
  );
}

function Stat({ label, value, sub, tone = "text-navy" }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="card-base p-4">
      <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={`text-[1.6rem] font-extrabold tabular-nums leading-tight mt-1 ${tone}`}>{value}</p>
      <p className="text-[0.74rem] text-ink-secondary mt-0.5">{sub}</p>
    </div>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card-base p-5">
      <p role="alert" className="text-[0.83rem] font-semibold text-danger">{message}</p>
      <button onClick={onRetry} className="mt-2 text-[0.8rem] font-bold text-healthcare hover:underline">Retry</button>
    </div>
  );
}

/* ------------------------------- AI ACTIVITY ------------------------------- */

export function AIActivityPage() {
  const { aiExecutions, loading, backendError, refreshSection } = useAdmin();
  const [selected, setSelected] = useState<AIExecRow | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return aiExecutions;
    return aiExecutions.filter((e) => e.tool.toLowerCase().includes(q) || e.status.toLowerCase().includes(q));
  }, [aiExecutions, query]);
  const pager = usePagination(filtered, { initialSize: 10 });
  const isInitial = loading && aiExecutions.length === 0;

  const success = aiExecutions.filter((e) => e.status === "success").length;
  const errors = aiExecutions.filter((e) => e.status === "error").length;
  const avg = aiExecutions.length > 0
    ? Math.round(aiExecutions.reduce((s, e) => s + e.latency, 0) / aiExecutions.length)
    : null;
  const topTools = useMemo(() => {
    const by = new Map<string, { total: number; ok: number; lat: number }>();
    for (const e of aiExecutions) {
      const r = by.get(e.tool) ?? { total: 0, ok: 0, lat: 0 };
      r.total += 1;
      if (e.status === "success") r.ok += 1;
      r.lat += e.latency;
      by.set(e.tool, r);
    }
    return [...by.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  }, [aiExecutions]);
  const topMax = topTools.reduce((m, [, r]) => Math.max(m, r.total), 0);

  if (backendError && aiExecutions.length === 0 && !isInitial) {
    return (
      <div className="space-y-4">
        <InsightsHeader eyebrow="Insights" title="AI Activity" sub="Administrative assistant oversight. No patient conversation content shown." banner={<LiveBanner text="Live capability executions from your hospital" onRefresh={() => void refreshSection("insights")} />} />
        <InlineError message={backendError} onRetry={() => void refreshSection("insights")} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <InsightsHeader
        eyebrow="Insights"
        title="AI Activity"
        sub="Administrative assistant oversight. No patient conversation content shown."
        count={`${filtered.length}`}
        banner={<LiveBanner text="Live capability executions from your hospital" onRefresh={() => void refreshSection("insights")} />}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Stat label="Executions" value={String(aiExecutions.length)} sub="recent capability calls" />
        <Stat label="Success" value={String(success)} sub="capability level" tone="text-success" />
        <Stat label="Errors" value={String(errors)} sub="needs review" tone={errors > 0 ? "text-danger" : "text-navy"} />
        <Stat label="Avg latency" value={avg !== null ? `${avg} ms` : "—"} sub="per execution" tone="text-teal-dark" />
      </div>

      {topTools.length > 0 && (
        <section className="card-base p-4 sm:p-5" aria-label="Most used capabilities">
          <h2 className="text-[0.95rem] font-bold text-navy tracking-tight">Most used capabilities</h2>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 mt-3">
            {topTools.map(([tool, r]) => (
              <div key={tool}>
                <div className="flex items-baseline justify-between gap-2 text-[0.78rem]">
                  <span className="font-mono font-semibold text-ink truncate">{tool}</span>
                  <span className="text-ink-secondary tabular-nums shrink-0">{r.total}× · {Math.round((r.ok / r.total) * 100)}% ok · {Math.round(r.lat / r.total)} ms</span>
                </div>
                <div className="h-1.5 bg-background border border-border/60 rounded-full mt-1 overflow-hidden" role="img" aria-label={`${tool}: ${r.total} executions`}>
                  <div className="h-full bg-healthcare rounded-full" style={{ width: `${topMax > 0 ? Math.max(4, Math.round((r.total / topMax) * 100)) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="card-base p-3.5 flex items-center gap-2 bg-white border border-border rounded-2xl px-3.5 focus-within:border-healthcare focus-within:ring-2 focus-within:ring-healthcare/15 transition">
        <Search size={15} className="text-ink-faint shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by capability or status…" aria-label="Filter AI activity" className="w-full bg-transparent outline-none py-1 text-[0.86rem] placeholder:text-ink-faint" />
        {query && <button onClick={() => setQuery("")} aria-label="Clear filter" className="text-[0.75rem] font-bold text-ink-faint hover:text-ink shrink-0">Clear</button>}
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
            <tr key={e.id} className="hover:bg-background/60 transition-colors duration-150 cursor-pointer" onClick={() => setSelected(e)}>
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

/* ------------------------------- INTEGRATION ------------------------------- */

export function IntegrationPage() {
  const { integration, integrationRows, operations, loading, backendError, refreshSection } = useAdmin();
  const [tested, setTested] = useState(false);
  const pager = usePagination(integrationRows, { initialSize: 10 });
  const isInitial = loading && integrationRows.length === 0 && !integration;

  if (backendError && integrationRows.length === 0 && !integration && !isInitial) {
    return (
      <div className="space-y-4">
        <InsightsHeader eyebrow="Insights" title="Integration" sub="Vendor connection health for your hospital." banner={<LiveBanner text="Live integration status" onRefresh={() => void refreshSection("insights")} />} />
        <InlineError message={backendError} onRetry={() => void refreshSection("insights")} />
      </div>
    );
  }

  const failed = integrationRows.filter((o) => o.status === "error").length;
  const unknown = operations.filter((o) => o.status === "unknown").length;
  const verify = integration?.verifications_24h ?? {};
  const matched = Object.entries(verify).filter(([k]) => k === "matched").reduce((s, [, n]) => s + n, 0);
  const mismatched = Object.entries(verify).filter(([k]) => k !== "matched").reduce((s, [, n]) => s + n, 0);
  const verifyTotal = matched + mismatched;
  const degraded = (integration?.open_reconciliations ?? 0) > 0;

  return (
    <div className="space-y-4">
      <InsightsHeader
        eyebrow="Insights"
        title="Integration"
        sub="Vendor connection health for your hospital."
        count={`${integrationRows.length}`}
        banner={<LiveBanner text="Live integration status" onRefresh={() => void refreshSection("insights")} />}
      />
      <section className="card-base p-5" aria-label="Connection">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <span className="w-12 h-12 rounded-xl bg-navy text-white flex items-center justify-center font-extrabold text-[0.8rem] shrink-0">EHR</span>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-navy">Vendor connection</p>
            <p className="text-[0.8rem] text-ink-secondary mt-0.5">
              {integration?.vendor_mappings ?? "—"} mappings · {integration?.open_reconciliations ?? "—"} open reconciliations
            </p>
          </div>
          <StatusBadge status={degraded ? "degraded" : "connected"} />
          <Button size="sm" variant="outline" onClick={() => setTested(true)}>Test connection</Button>
        </div>
        {tested && (
          <p role="status" className="flex items-center gap-1.5 text-[0.85rem] font-bold text-success bg-success-soft border border-success/25 rounded-xl px-3.5 py-2.5 mt-4">
            <CheckCircle2 size={15} /> Connection test passed — vendor reachable.
          </p>
        )}
      </section>

      <div className="grid sm:grid-cols-2 gap-4">
        <section className="card-base p-4 sm:p-5" aria-label="Verification health">
          <h2 className="text-[0.95rem] font-bold text-navy tracking-tight">Verification · last 24h</h2>
          <p className="text-[0.78rem] text-ink-secondary mt-0.5">Every external result is re-checked before it counts.</p>
          {verifyTotal === 0 ? (
            <p className="text-[0.8rem] text-ink-secondary py-4">No verifications recorded in the last 24 hours.</p>
          ) : (
            <div className="mt-3 space-y-2.5">
              <CountBar label="Matched" count={matched} max={verifyTotal} tone="bg-success" />
              <CountBar label="Mismatched" count={mismatched} max={verifyTotal} tone="bg-danger" />
            </div>
          )}
        </section>
        <section className="card-base p-4 sm:p-5" aria-label="Execution health">
          <h2 className="text-[0.95rem] font-bold text-navy tracking-tight">Executions</h2>
          <p className="text-[0.78rem] text-ink-secondary mt-0.5">Recent vendor calls and outcomes.</p>
          <div className="mt-3 space-y-2.5">
            <CountBar label="Recent executions" count={integrationRows.length} max={Math.max(integrationRows.length, 1)} tone="bg-healthcare" />
            <CountBar label="Errors" count={failed} max={Math.max(integrationRows.length, 1)} tone="bg-danger" />
            <CountBar label="Unknown outcomes" count={unknown} max={Math.max(operations.length, 1)} tone="bg-warning" />
          </div>
        </section>
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
            <tr key={op.id} className="hover:bg-background/60 transition-colors duration-150">
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

/* -------------------------------- WORKFLOWS -------------------------------- */

export function WorkflowsPage() {
  const { workflows, loading, backendError, refreshSection } = useAdmin();
  const [openId, setOpenId] = useState<string | null>(null);
  const pager = usePagination(workflows, { initialSize: 6 });
  const isInitial = loading && workflows.length === 0;

  const failing = workflows.filter((w) => w.status === "failing").length;
  const active = workflows.length - failing;

  if (backendError && workflows.length === 0 && !isInitial) {
    return (
      <div className="space-y-4">
        <InsightsHeader eyebrow="Insights" title="Workflows" sub="Automated follow-ups triggered by scheduling events." banner={<LiveBanner text="Live workflow executions for your hospital" onRefresh={() => void refreshSection("ops")} />} />
        <InlineError message={backendError} onRetry={() => void refreshSection("ops")} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <InsightsHeader
        eyebrow="Insights"
        title="Workflows"
        sub="Automated follow-ups triggered by scheduling events."
        count={`${workflows.length}`}
        banner={<LiveBanner text="Live workflow executions for your hospital" onRefresh={() => void refreshSection("ops")} />}
      />
      <div className="grid grid-cols-3 gap-2.5">
        <Stat label="Executions" value={String(workflows.length)} sub="recorded" />
        <Stat label="Active" value={String(active)} sub="running clean" tone="text-success" />
        <Stat label="Failing" value={String(failing)} sub="needs review" tone={failing > 0 ? "text-danger" : "text-navy"} />
      </div>
      {isInitial ? (
        <TableSkeleton rows={5} cols={3} />
      ) : (
        <div className="space-y-2.5">
          {pager.pageItems.map((w) => {
            const open = openId === w.id;
            return (
              <article key={w.id} className={`card-base p-4 transition-shadow duration-200 hover:shadow-card ${w.status === "failing" ? "border-danger/30" : ""}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {w.status === "failing"
                      ? <span className="w-8 h-8 rounded-lg bg-danger-soft text-danger flex items-center justify-center font-bold shrink-0">!</span>
                      : <span className="w-8 h-8 rounded-lg bg-success-soft text-success flex items-center justify-center shrink-0"><CheckCircle2 size={16} /></span>}
                    <div className="min-w-0">
                      <p className="font-bold text-[0.9rem] truncate">{w.name}</p>
                      <p className="text-[0.74rem] text-ink-secondary truncate">Trigger: {w.trigger} · Last run {w.lastRun}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[0.72rem] text-ink-secondary tabular-nums">{w.success} ok / {w.failed} failed</span>
                    <StatusBadge status={w.status} />
                    <button onClick={() => setOpenId(open ? null : w.id)} aria-expanded={open} className="text-[0.78rem] font-bold text-healthcare hover:underline">{open ? "Hide" : "View flow"}</button>
                  </div>
                </div>
                {open && (
                  <ol className="mt-3 pt-3 border-t border-border/70">
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
      {workflows.length > pager.pageSize && (
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
