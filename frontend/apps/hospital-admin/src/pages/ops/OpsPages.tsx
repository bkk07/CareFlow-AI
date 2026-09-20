import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, RotateCcw, Search } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { LiveBanner } from "../hospital/InsightPages";
import { Button, EmptyState, MetricCard, StatusBadge } from "../../components/common/ui";
import { Drawer, Modal, ResponsiveTable } from "../../components/common/Modal";
import type { Operation } from "../../types";

function shortId(id: string): string {
  return id.includes("-") ? id.slice(0, 8).toUpperCase() : id;
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
  const { retryOperation, verifyOperation } = useAdmin();
  const { error, run } = useOpError();
  const [verifying, setVerifying] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  return (
    <Drawer open={!!op} onClose={onClose} title={op ? `Operation ${shortId(op.id)}` : "Operation"}>
      {op && (
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2 flex-wrap"><StatusBadge status={op.status} /><span className="text-ink-secondary font-mono text-[0.76rem]">{op.correlationId}</span></div>
          <dl className="border border-border rounded-control overflow-hidden">
            {[["Type", op.type], ["Appointment", `${shortId(op.appointment)} · ${op.patient}`], ["System", op.system], ["Started", op.started], ["Last attempt", op.lastAttempt], ["Attempts", String(op.attempts)], ["Error", op.error || "—"]].map(([k, v], i) => (
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
            <Button
              size="sm"
              disabled={verifying}
              onClick={() => {
                setVerifying(true);
                setOutcome(null);
                run(async () => setOutcome(await verifyOperation(op.id))).finally(() => setVerifying(false));
              }}
            >
              <Search size={14} /> Verify external record
            </Button>
          </div>
          <p className="text-[0.75rem] text-ink-faint">Retry re-drives vendor recovery; verify re-reads the vendor record.</p>
        </div>
      )}
    </Drawer>
  );
}

export function OpsOverviewPage() {
  const { operations, reconciliations, escalations } = useAdmin();
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
        <MetricCard label="Healthy operations" value={String(healthy)} tone="success" />
        <MetricCard label="Failed" value={String(failed)} tone="danger" />
        <MetricCard label="Unknown outcomes" value={String(unknown)} tone="warning" />
        <MetricCard label="Reconciliation" value={String(reconciling)} tone="warning" />
        <MetricCard label="Escalations" value={String(openEsc)} tone="danger" />
        <MetricCard label="Retry queue" value={String(retryQueue)} />
      </div>
      <ResponsiveTable headers={["Operation", "Type", "Appointment", "System", "Status", "Attempts"]}>
        {operations.slice(0, 4).map((o) => (
          <tr key={o.id} className="hover:bg-background/60 cursor-pointer" onClick={() => setSelected(o)}>
            <td className="td-cell font-mono font-bold text-[0.8rem]">{shortId(o.id)}</td>
            <td className="td-cell">{o.type}</td>
            <td className="td-cell">{shortId(o.appointment)}</td>
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
  const { operations, retryOperation } = useAdmin();
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
              <td className="td-cell font-mono font-bold text-[0.8rem]">{shortId(o.id)}</td>
              <td className="td-cell">{o.type}</td>
              <td className="td-cell">{shortId(o.appointment)}<span className="block text-[0.72rem] text-ink-secondary">{o.patient}</span></td>
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
  const { operations, verifyOperation } = useAdmin();
  const [selected, setSelected] = useState<Operation | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const { error, run } = useOpError();
  const unknown = operations.filter((o) => o.status === "unknown" || o.status === "verifying");

  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Unknown Outcomes</h1><p className="page-sub mt-1">Appointment creation outcome could not be determined — verify before retrying.</p></div>
      <LiveBanner text="Live unknown-outcome vendor calls" />
      {error && <p role="alert" className="text-[0.83rem] font-semibold text-danger">{error}</p>}
      {outcome && <p className="text-[0.83rem] font-semibold text-success">Verification outcome: {outcome}</p>}

      {unknown.length === 0 ? (
        <div className="card-base"><EmptyState title="No unknown outcomes" body="All operations have a determined final state." /></div>
      ) : (
        <ResponsiveTable headers={["Operation", "Appointment", "System", "Request time", "Last known", "Verification", "Action"]}>
          {unknown.map((o) => (
            <tr key={o.id} className="hover:bg-background/60">
              <td className="td-cell font-mono font-bold text-[0.8rem]">{shortId(o.id)}</td>
              <td className="td-cell">{shortId(o.appointment)}</td>
              <td className="td-cell">{o.system}</td>
              <td className="td-cell">{o.started}</td>
              <td className="td-cell">{o.error || "—"}</td>
              <td className="td-cell"><StatusBadge status={o.status} /></td>
              <td className="td-cell">
                <div className="flex gap-2">
                  <button onClick={() => setSelected(o)} className="text-[0.78rem] font-bold text-healthcare hover:underline">Open recovery</button>
                  <button
                    onClick={() => void run(async () => setOutcome(await verifyOperation(o.id)))}
                    className="text-[0.78rem] font-bold text-ink-secondary hover:text-healthcare"
                  >
                    Verify now
                  </button>
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
  const { reconciliations, resolveReconciliation, retryReconciliation } = useAdmin();
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
              <td className="td-cell font-mono font-bold text-[0.8rem]">{shortId(r.id)}</td>
              <td className="td-cell font-mono text-[0.78rem]">{shortId(r.operationId)}</td>
              <td className="td-cell font-mono text-[0.78rem]">{shortId(r.appointmentId)}</td>
              <td className="td-cell font-mono text-[0.78rem]">{r.externalId ?? "—"}</td>
              <td className="td-cell text-ink-secondary text-[0.8rem] max-w-[220px]">{r.error}</td>
              <td className="td-cell">{r.attempts}</td>
              <td className="td-cell">{r.externalStatus}</td>
              <td className="td-cell">{r.internalState}</td>
              <td className="td-cell"><StatusBadge status={r.resolution} /></td>
              <td className="td-cell">
                <div className="flex gap-2">
                  {r.resolution !== "resolved" && r.resolution !== "escalated" && (
                    <button onClick={() => void run(() => retryReconciliation(r.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-healthcare">Retry</button>
                  )}
                  <button onClick={() => { setSelectedId(r.id); setNote(""); }} className="text-[0.78rem] font-bold text-healthcare hover:underline">Resolve</button>
                </div>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}

      <Modal open={!!selected} onClose={() => setSelectedId(null)} title={selected ? `Resolve ${shortId(selected.id)}` : "Resolve case"}>
        {selected && (
          <div className="space-y-3 text-sm">
            <dl className="border border-border rounded-control overflow-hidden">
              {[["Operation ID", shortId(selected.operationId)], ["Appointment ID", shortId(selected.appointmentId)], ["External ID", selected.externalId ?? "—"], ["Attempts", String(selected.attempts)]].map(([k, v], i) => (
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
        <p className="text-sm text-ink-secondary">Resolve <strong className="text-ink">{selected ? shortId(selected.id) : ""}</strong> as <strong className="text-ink">{finalState}</strong>? This moves the real booking.</p>
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
  const { escalations, assignEscalation, resolveEscalation } = useAdmin();
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
                <p className="font-bold text-[0.9rem]">{e.title} <span className="font-mono text-ink-faint text-[0.75rem]">{shortId(e.id)}</span></p>
                <p className="text-[0.8rem] text-ink-secondary">{shortId(e.appointment)} · {e.issue} · {e.assignee} · {e.created}</p>
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
  const { operations, retryOperation } = useAdmin();
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
              <td className="td-cell font-mono font-bold text-[0.8rem]">{shortId(o.id)}</td>
              <td className="td-cell">{o.type}</td>
              <td className="td-cell">{shortId(o.appointment)}</td>
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
  const { reconciliations } = useAdmin();
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
              <p className="font-bold text-[0.9rem] flex items-center gap-1.5"><CheckCircle2 size={16} className="text-success" /> Case {shortId(r.id)} · resolved</p>
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
