import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Play, RotateCcw, Search } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, EmptyState, MetricCard, StatusBadge } from "../../components/common/ui";
import { Drawer, Modal, ResponsiveTable } from "../../components/common/Modal";
import type { Operation } from "../../types";

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

function shortId(id: string, live: boolean): string {
  return live && id.includes("-") ? id.slice(0, 8).toUpperCase() : id;
}

function useOpError() {
  const { backendError } = useAdmin();
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : (backendError ?? "Operation failed."));
    }
  }
  return { error, run };
}

export function OperationTimeline({ op }: { op: Operation }) {
  const colors: Record<string, string> = {
    done: "bg-success",
    failed: "bg-danger",
    unknown: "bg-warning",
    active: "bg-healthcare",
    pending: "bg-border",
  };
  return (
    <ol>
      {op.timeline.map((t, i) => (
        <motion.li
          key={t.label}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.07 }}
          className="flex gap-2.5 pb-3 last:pb-0 relative"
        >
          {i < op.timeline.length - 1 && <span className="absolute left-[7px] top-5 bottom-0 w-px bg-border" aria-hidden />}
          <span className={`w-[15px] h-[15px] rounded-full shrink-0 mt-1 ${colors[t.state]} ${t.state === "active" ? "animate-pulse" : ""}`} aria-hidden />
          <span>
            <span className="font-bold text-[0.85rem] block">{t.label}</span>
            {t.detail && <span className="text-[0.78rem] text-ink-secondary">{t.detail}</span>}
          </span>
        </motion.li>
      ))}
    </ol>
  );
}

function OpDrawer({ op, onClose }: { op: Operation | null; onClose: () => void }) {
  const { retryOperation, verifyOperation, simulateTimeout, live } = useAdmin();
  const { error, run } = useOpError();
  const [verifying, setVerifying] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  return (
    <Drawer open={!!op} onClose={onClose} title={op ? `Operation ${shortId(op.id, live)}` : "Operation"}>
      {op && (
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2 flex-wrap"><StatusBadge status={op.status} /><span className="text-ink-secondary font-mono text-[0.76rem]">{op.correlationId}</span></div>
          <dl className="border border-border rounded-control overflow-hidden">
            {[["Type", op.type], ["Appointment", `${shortId(op.appointment, live)} · ${op.patient}`], ["System", op.system], ["Started", op.started], ["Last attempt", op.lastAttempt], ["Attempts", String(op.attempts)], ["Error", op.error || "—"]].map(([k, v], i) => (
              <div key={k} className={`flex justify-between gap-3 px-4 py-2.5 ${i % 2 ? "bg-background/60" : "bg-white"}`}>
                <dt className="text-ink-secondary shrink-0">{k}</dt><dd className="font-semibold text-right">{v}</dd>
              </div>
            ))}
          </dl>
          <div><h4 className="font-bold mb-2">Recovery timeline</h4><OperationTimeline op={op} /></div>
          {error && <p role="alert" className="text-[0.83rem] font-semibold text-danger">{error}</p>}
          {outcome && <p className="text-[0.83rem] font-semibold text-success">Verification outcome: {outcome}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={() => void run(() => retryOperation(op.id))}><RotateCcw size={14} /> Retry</Button>
            {!live && <Button variant="outline" size="sm" onClick={() => simulateTimeout(op.id)}><Play size={14} /> Simulate timeout</Button>}
            <Button
              size="sm"
              disabled={verifying}
              onClick={() => {
                setVerifying(true);
                setOutcome(null);
                run(async () => setOutcome(await verifyOperation(op.id, true))).finally(() => setVerifying(false));
              }}
            >
              <Search size={14} /> {live ? "Verify external record" : "Verify: found"}
            </Button>
            {!live && <Button size="sm" variant="ghost" onClick={() => void run(async () => { await verifyOperation(op.id, false); })}>Verify: not found</Button>}
          </div>
          {!live && <p className="text-[0.75rem] text-ink-faint">Frontend simulation only — verify updates the timeline and status locally.</p>}
          {live && <p className="text-[0.75rem] text-ink-faint">Retry re-drives vendor recovery; verify re-reads the vendor record.</p>}
        </div>
      )}
    </Drawer>
  );
}

export function OpsOverviewPage() {
  const { operations, reconciliations, escalations, live } = useAdmin();
  const [selected, setSelected] = useState<Operation | null>(null);
  const failed = operations.filter((o) => o.status === "failed").length;
  const unknown = operations.filter((o) => o.status === "unknown").length;
  const reconciling = reconciliations.filter((r) => r.resolution === "open").length;
  const openEsc = escalations.filter((e) => e.status !== "resolved").length;
  const retryQueue = operations.filter((o) => ["failed", "unknown"].includes(o.status)).length;
  const healthy = operations.filter((o) => o.status === "resolved").length;
  const attention = failed + unknown + reconciling;

  return (
    <div className="space-y-5">
      <div><h1 className="page-title">Operations Overview</h1><p className="page-sub mt-1">Integration health, failures, and recovery.</p></div>
      <LiveBanner text="Live vendor-call log for your hospital" />
      {attention > 0 && (
        <p className="flex items-center gap-2 bg-danger-soft border border-danger/25 rounded-card px-4 py-3 text-sm font-bold text-danger">
          <AlertTriangle size={17} /> {attention} operations require attention
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
        <MetricCard label="Healthy operations" value={live ? String(healthy) : healthy.toLocaleString()} tone="success" />
        <MetricCard label="Failed" value={String(failed)} tone="danger" />
        <MetricCard label="Unknown outcomes" value={String(unknown)} tone="warning" />
        <MetricCard label="Reconciliation" value={String(reconciling)} tone="warning" />
        <MetricCard label="Escalations" value={String(openEsc)} tone="danger" />
        <MetricCard label="Retry queue" value={String(retryQueue)} />
      </div>
      <ResponsiveTable headers={["Operation", "Type", "Appointment", "System", "Status", "Attempts"]}>
        {operations.slice(0, 4).map((o) => (
          <tr key={o.id} className="hover:bg-background/60 cursor-pointer" onClick={() => setSelected(o)}>
            <td className="td-cell font-mono font-bold text-[0.8rem]">{shortId(o.id, live)}</td>
            <td className="td-cell">{o.type}</td>
            <td className="td-cell">{shortId(o.appointment, live)}</td>
            <td className="td-cell">{o.system}</td>
            <td className="td-cell"><StatusBadge status={o.status} /></td>
            <td className="td-cell">{o.attempts}</td>
          </tr>
        ))}
      </ResponsiveTable>
      <OpDrawer op={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export function FailedOpsPage() {
  const { operations, retryOperation, live } = useAdmin();
  const [selected, setSelected] = useState<Operation | null>(null);
  const { error, run } = useOpError();
  const failed = operations.filter((o) => ["failed", "retrying", "recovered", "needs_reconciliation"].includes(o.status));
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Failed Operations</h1><p className="page-sub mt-1">What failed, where, and what happens next.</p></div>
      <LiveBanner text="Live failed vendor calls" />
      {error && <p role="alert" className="text-[0.83rem] font-semibold text-danger">{error}</p>}
      {failed.length === 0 ? (
        <div className="card-base"><EmptyState title="No failed operations" body="All integration operations are currently healthy." /></div>
      ) : (
        <ResponsiveTable headers={["Operation", "Type", "Appointment", "System", "Status", "Attempts", "Last attempt", "Action"]}>
          {failed.map((o) => (
            <tr key={o.id} className="hover:bg-background/60">
              <td className="td-cell font-mono font-bold text-[0.8rem]">{shortId(o.id, live)}</td>
              <td className="td-cell">{o.type}</td>
              <td className="td-cell">{shortId(o.appointment, live)}<span className="block text-[0.72rem] text-ink-secondary">{o.patient}</span></td>
              <td className="td-cell">{o.system}</td>
              <td className="td-cell"><StatusBadge status={o.status} /></td>
              <td className="td-cell">{o.attempts}</td>
              <td className="td-cell whitespace-nowrap">{o.lastAttempt}</td>
              <td className="td-cell">
                <div className="flex gap-2">
                  <button onClick={() => setSelected(o)} className="text-[0.78rem] font-bold text-healthcare hover:underline">Detail</button>
                  <button onClick={() => void run(() => retryOperation(o.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-healthcare">Retry</button>
                </div>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
      <OpDrawer op={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export function UnknownOutcomesPage() {
  const { operations, verifyOperation, simulateTimeout, live } = useAdmin();
  const [selected, setSelected] = useState<Operation | null>(null);
  const [stage, setStage] = useState<"idle" | "sent" | "timeout" | "unknown" | "verifying" | "done">("idle");
  const [found, setFound] = useState<boolean | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const { error, run } = useOpError();
  const unknown = operations.filter((o) => o.status === "unknown" || o.status === "verifying");

  function runSimulation() {
    setStage("sent");
    setFound(null);
    setTimeout(() => setStage("timeout"), 900);
    setTimeout(() => { setStage("unknown"); simulateTimeout("OP-8815"); }, 1800);
  }
  function runVerify(externalFound: boolean) {
    setStage("verifying");
    setTimeout(() => {
      setFound(externalFound);
      setStage("done");
      void run(async () => { await verifyOperation("OP-8815", externalFound); });
    }, 1400);
  }

  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Unknown Outcomes</h1><p className="page-sub mt-1">Appointment creation outcome could not be determined — verify before retrying.</p></div>
      <LiveBanner text="Live unknown-outcome vendor calls" />
      {error && <p role="alert" className="text-[0.83rem] font-semibold text-danger">{error}</p>}
      {outcome && <p className="text-[0.83rem] font-semibold text-success">Verification outcome: {outcome}</p>}

      {!live && (
        <section className="card-base p-5" aria-label="Failure simulation">
          <h2 className="section-title">Failure demo (mock)</h2>
          <p className="text-[0.82rem] text-ink-secondary mt-1">Simulate an EHR timeout on OP-8815, then verify the external record.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button size="sm" variant="outline" onClick={runSimulation}><Play size={14} /> Simulate EHR timeout</Button>
            <Button size="sm" disabled={stage !== "unknown"} onClick={() => runVerify(true)}><Search size={14} /> Verify external record</Button>
            <Button size="sm" variant="ghost" disabled={stage !== "unknown"} onClick={() => runVerify(false)}>Verify: nothing found</Button>
          </div>
          <AnimatePresence>
            {stage !== "idle" && (
              <motion.ol initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 space-y-0">
                {[
                  { id: "sent", label: "External request sent" },
                  { id: "timeout", label: "Request timed out" },
                  { id: "unknown", label: "Outcome unknown — requires verification" },
                  { id: "verifying", label: "External record lookup" },
                  { id: "done", label: found === null ? "Awaiting verification…" : found ? "External appointment found → recovered → confirmed" : "Not found → safe retry → verifying" },
                ].map((s, i, arr) => {
                  const order = ["sent", "timeout", "unknown", "verifying", "done"];
                  const active = order.indexOf(stage) >= order.indexOf(s.id);
                  return (
                    <li key={s.id} className="flex gap-2.5 pb-2.5 last:pb-0 relative">
                      {i < arr.length - 1 && <span className="absolute left-[7px] top-5 bottom-0 w-px bg-border" aria-hidden />}
                      <motion.span initial={false} animate={{ scale: active ? 1 : 0.85, opacity: active ? 1 : 0.4 }} className={`w-[15px] h-[15px] rounded-full shrink-0 mt-1 ${active ? (s.id === "timeout" || s.id === "unknown" ? "bg-warning" : s.id === "done" ? "bg-success" : "bg-healthcare") : "bg-border"}`} />
                      <span className={`text-[0.84rem] font-semibold ${active ? "" : "text-ink-faint"}`}>{s.label}</span>
                    </li>
                  );
                })}
              </motion.ol>
            )}
          </AnimatePresence>
        </section>
      )}

      {unknown.length === 0 ? (
        <div className="card-base"><EmptyState title="No unknown outcomes" body="All operations have a determined final state." /></div>
      ) : (
        <ResponsiveTable headers={["Operation", "Appointment", "System", "Request time", "Last known", "Verification", "Action"]}>
          {unknown.map((o) => (
            <tr key={o.id} className="hover:bg-background/60">
              <td className="td-cell font-mono font-bold text-[0.8rem]">{shortId(o.id, live)}</td>
              <td className="td-cell">{shortId(o.appointment, live)}</td>
              <td className="td-cell">{o.system}</td>
              <td className="td-cell">{o.started}</td>
              <td className="td-cell">{o.error || "—"}</td>
              <td className="td-cell"><StatusBadge status={o.status} /></td>
              <td className="td-cell">
                <div className="flex gap-2">
                  <button onClick={() => setSelected(o)} className="text-[0.78rem] font-bold text-healthcare hover:underline">Open recovery</button>
                  {live && (
                    <button
                      onClick={() => void run(async () => setOutcome(await verifyOperation(o.id, true)))}
                      className="text-[0.78rem] font-bold text-ink-secondary hover:text-healthcare"
                    >
                      Verify now
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
      <OpDrawer op={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export function ReconciliationPage() {
  const { reconciliations, resolveReconciliation, live } = useAdmin();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [finalState, setFinalState] = useState("Confirmed");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { error, run } = useOpError();
  const selected = reconciliations.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Reconciliation</h1><p className="page-sub mt-1">Match internal state with external reality.</p></div>
      <LiveBanner text="Live reconciliation work queue" />
      {error && <p role="alert" className="text-[0.83rem] font-semibold text-danger">{error}</p>}
      {reconciliations.filter((r) => r.resolution !== "resolved").length === 0 ? (
        <div className="card-base"><EmptyState title="All integration operations are currently reconciled." body="New mismatches will open a case here." /></div>
      ) : (
        <ResponsiveTable headers={["Case", "Operation", "Appointment", "External ID", "Error", "Attempts", "External", "Internal", "Resolution", "Action"]}>
          {reconciliations.map((r) => (
            <tr key={r.id} className="hover:bg-background/60">
              <td className="td-cell font-mono font-bold text-[0.8rem]">{shortId(r.id, live)}</td>
              <td className="td-cell font-mono text-[0.78rem]">{shortId(r.operationId, live)}</td>
              <td className="td-cell font-mono text-[0.78rem]">{shortId(r.appointmentId, live)}</td>
              <td className="td-cell font-mono text-[0.78rem]">{r.externalId ?? "—"}</td>
              <td className="td-cell text-ink-secondary text-[0.8rem] max-w-[220px]">{r.error}</td>
              <td className="td-cell">{r.attempts}</td>
              <td className="td-cell">{r.externalStatus}</td>
              <td className="td-cell">{r.internalState}</td>
              <td className="td-cell"><StatusBadge status={r.resolution} /></td>
              <td className="td-cell"><button onClick={() => { setSelectedId(r.id); setNote(""); }} className="text-[0.78rem] font-bold text-healthcare hover:underline">Resolve</button></td>
            </tr>
          ))}
        </ResponsiveTable>
      )}

      <Modal open={!!selected} onClose={() => setSelectedId(null)} title={selected ? `Resolve ${shortId(selected.id, live)}` : "Resolve case"}>
        {selected && (
          <div className="space-y-3 text-sm">
            <dl className="border border-border rounded-control overflow-hidden">
              {[["Operation ID", shortId(selected.operationId, live)], ["Appointment ID", shortId(selected.appointmentId, live)], ["External ID", selected.externalId ?? "—"], ["Attempts", String(selected.attempts)]].map(([k, v], i) => (
                <div key={k} className={`flex justify-between px-4 py-2 ${i % 2 ? "bg-background/60" : "bg-white"}`}>
                  <dt className="text-ink-secondary">{k}</dt><dd className="font-mono font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <label className="block font-bold">Resolution note<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What was verified and decided…" className="input-base mt-1 font-medium" /></label>
            <label className="block font-bold">Final state
              <select value={finalState} onChange={(e) => setFinalState(e.target.value)} className="input-base mt-1">
                {["Confirmed", "Cancelled", "Failed", "Reconciliation resolved"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <Button className="w-full" disabled={!note.trim()} onClick={() => setConfirmOpen(true)}><CheckCircle2 size={15} /> Resolve case</Button>
          </div>
        )}
      </Modal>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm resolution">
        <p className="text-sm text-ink-secondary">Resolve <strong className="text-ink">{selected ? shortId(selected.id, live) : ""}</strong> as <strong className="text-ink">{finalState}</strong>? {live ? "This moves the real booking." : "This writes a mock audit event."}</p>
        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)}>Back</Button>
          <Button className="flex-1" onClick={() => {
            if (selected) void run(async () => { await resolveReconciliation(selected.id, finalState, note); setConfirmOpen(false); setSelectedId(null); });
            else { setConfirmOpen(false); setSelectedId(null); }
          }}>Resolve case</Button>
        </div>
      </Modal>
    </div>
  );
}

export function EscalationsPage() {
  const { escalations, assignEscalation, resolveEscalation, live } = useAdmin();
  const { error, run } = useOpError();
  const open = escalations.filter((e) => e.status !== "resolved");
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Human Escalations</h1><p className="page-sub mt-1">{open.length} open cases in the operator queue.</p></div>
      <LiveBanner text="Live human-escalation queue" />
      {error && <p role="alert" className="text-[0.83rem] font-semibold text-danger">{error}</p>}
      {open.length === 0 ? (
        <div className="card-base"><EmptyState title="No human escalations" body="Cases needing operator judgment will queue here." /></div>
      ) : (
        <div className="space-y-2.5">
          {escalations.map((e) => (
            <article key={e.id} className="card-base p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[0.9rem]">{e.title} <span className="font-mono text-ink-faint text-[0.75rem]">{shortId(e.id, live)}</span></p>
                <p className="text-[0.8rem] text-ink-secondary">{shortId(e.appointment, live)} · {e.issue} · {e.assignee} · {e.created}</p>
              </div>
              <StatusBadge status={e.priority} />
              <StatusBadge status={e.status} />
              {e.status !== "resolved" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => assignEscalation(e.id, "Ops — You")}>Assign</Button>
                  <Button size="sm" onClick={() => void run(() => resolveEscalation(e.id))}>Resolve</Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function RetryQueuePage() {
  const { operations, retryOperation, live } = useAdmin();
  const { error, run } = useOpError();
  const queue = operations.filter((o) => ["retrying", "failed", "unknown"].includes(o.status));
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Retry Queue</h1><p className="page-sub mt-1">Operations waiting for another attempt.</p></div>
      <LiveBanner text="Live retry queue" />
      {error && <p role="alert" className="text-[0.83rem] font-semibold text-danger">{error}</p>}
      {queue.length === 0 ? (
        <div className="card-base"><EmptyState title="Retry queue is empty" body="Failed operations scheduled for retry will appear here." /></div>
      ) : (
        <ResponsiveTable headers={["Operation", "Type", "Appointment", "Attempts", "Next retry", "Status", "Action"]}>
          {queue.map((o) => (
            <tr key={o.id} className="hover:bg-background/60">
              <td className="td-cell font-mono font-bold text-[0.8rem]">{shortId(o.id, live)}</td>
              <td className="td-cell">{o.type}</td>
              <td className="td-cell">{shortId(o.appointment, live)}</td>
              <td className="td-cell">{o.attempts}</td>
              <td className="td-cell">{o.nextRetry}</td>
              <td className="td-cell"><StatusBadge status={o.status} /></td>
              <td className="td-cell"><div className="flex gap-2">
                <button onClick={() => void run(() => retryOperation(o.id))} className="text-[0.78rem] font-bold text-healthcare hover:underline">Retry</button>
              </div></td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
    </div>
  );
}

export function RecoveryHistoryPage() {
  const { operations, reconciliations, live } = useAdmin();
  if (live) {
    const recovered = reconciliations.filter((r) => r.resolution === "resolved");
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Recovery History</h1><p className="page-sub mt-1">How past failures were recovered.</p></div>
        <LiveBanner text="Live recovery history" />
        {recovered.length === 0 ? (
          <div className="card-base"><EmptyState title="No recoveries yet" body="Resolved reconciliation cases will be recorded here." /></div>
        ) : (
          <div className="space-y-2.5">
            {recovered.map((r) => (
              <article key={r.id} className="card-base p-4">
                <p className="font-bold text-[0.9rem] flex items-center gap-1.5"><CheckCircle2 size={16} className="text-success" /> Case {shortId(r.id, live)} · resolved</p>
                <p className="text-[0.82rem] text-ink-secondary mt-1">Original failure: {r.error}</p>
                <p className="text-[0.82rem] text-ink-secondary">Resolution note: {r.note ?? "—"}</p>
                <p className="text-[0.82rem] mt-1">Final state: {r.internalState} <span className="text-ink-faint">· {r.updated}</span></p>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }
  const recovered = operations.filter((o) => o.status === "recovered" || o.status === "resolved");
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Recovery History</h1><p className="page-sub mt-1">How past failures were recovered.</p></div>
      {recovered.length === 0 ? (
        <div className="card-base"><EmptyState title="No recoveries yet" body="Recovered operations will be recorded here with their final state." /></div>
      ) : (
        <div className="space-y-2.5">
          {recovered.map((o) => (
            <article key={o.id} className="card-base p-4">
              <p className="font-bold text-[0.9rem] flex items-center gap-1.5"><CheckCircle2 size={16} className="text-success" /> {o.type} · {o.id}</p>
              <p className="text-[0.82rem] text-ink-secondary mt-1">Original failure: {o.error}</p>
              <p className="text-[0.82rem] text-ink-secondary">Recovery action: external verification → internal synchronization</p>
              <p className="text-[0.82rem] mt-1">Final state: <StatusBadge status="confirmed" /> <span className="text-ink-faint">· {o.lastAttempt}</span></p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
