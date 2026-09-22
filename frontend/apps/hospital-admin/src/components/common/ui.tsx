import { useState } from "react";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  const variants: Record<string, string> = {
    primary: "bg-healthcare text-white hover:bg-healthcare-dark border border-healthcare-dark shadow-subtle",
    outline: "bg-white text-navy border border-border hover:border-healthcare hover:text-healthcare",
    ghost: "bg-transparent text-healthcare border border-transparent hover:bg-healthcare-soft",
    danger: "bg-danger text-white border border-danger hover:brightness-95",
  };
  const sizes: Record<string, string> = {
    sm: "min-h-[2rem] px-3 py-1.5 text-[0.8rem] rounded-lg",
    md: "min-h-[2.4rem] px-4 py-2 text-[0.86rem] rounded-control",
    lg: "min-h-[2.9rem] px-6 py-2.5 text-[0.95rem] rounded-control",
  };
  return <button className={`btn-base ${variants[variant]} ${sizes[size]} disabled:opacity-55 disabled:cursor-not-allowed active:translate-y-px ${className}`} {...rest} />;
}

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const map: Record<string, string> = {
    approved: "bg-success-soft text-success",
    active: "bg-success-soft text-success",
    connected: "bg-success-soft text-success",
    healthy: "bg-success-soft text-success",
    confirmed: "bg-success-soft text-success",
    completed: "bg-success-soft text-success",
    resolved: "bg-success-soft text-success",
    recovered: "bg-success-soft text-success",
    success: "bg-success-soft text-success",
    submitted: "bg-healthcare-soft text-healthcare",
    under_review: "bg-healthcare-soft text-healthcare",
    rescheduled: "bg-healthcare-soft text-healthcare",
    assigned: "bg-healthcare-soft text-healthcare",
    verifying: "bg-healthcare-soft text-healthcare",
    in_progress: "bg-warning-soft text-warning",
    pending: "bg-warning-soft text-warning",
    sync_pending: "bg-warning-soft text-warning",
    unknown: "bg-warning-soft text-warning",
    retrying: "bg-warning-soft text-warning",
    open: "bg-warning-soft text-warning",
    new: "bg-warning-soft text-warning",
    degraded: "bg-warning-soft text-warning",
    draft: "bg-slate-100 text-ink-secondary",
    cancelled: "bg-slate-100 text-ink-secondary",
    inactive: "bg-slate-100 text-ink-secondary",
    not_assigned: "bg-slate-100 text-ink-secondary",
    none: "bg-slate-100 text-ink-secondary",
    paused: "bg-slate-100 text-ink-secondary",
    waiting: "bg-slate-100 text-ink-secondary",
    invited: "bg-healthcare-soft text-healthcare",
    investigating: "bg-healthcare-soft text-healthcare",
    failed: "bg-danger-soft text-danger",
    error: "bg-danger-soft text-danger",
    rejected: "bg-danger-soft text-danger",
    suspended: "bg-danger-soft text-danger",
    disconnected: "bg-danger-soft text-danger",
    escalated: "bg-danger-soft text-danger",
    needs_reconciliation: "bg-danger-soft text-danger",
    denied: "bg-danger-soft text-danger",
    failing: "bg-danger-soft text-danger",
    critical: "bg-danger-soft text-danger",
  };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${map[s] ?? "bg-healthcare-soft text-healthcare"}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </span>
  );
}

export function Avatar({ name, photo, size = "md" }: { name: string; photo?: string; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const cls = size === "sm" ? "w-8 h-8 text-[0.68rem]" : "w-10 h-10 text-[0.8rem]";
  const initials = name.replace(/^(Dr\.\s*)/i, "").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
  if (photo && !failed) {
    return <img src={photo} alt={name} loading="lazy" onError={() => setFailed(true)} className={`${cls} rounded-full object-cover border border-border shrink-0`} />;
  }
  return <span className={`${cls} rounded-full bg-healthcare-soft text-healthcare font-extrabold flex items-center justify-center border border-border shrink-0`} role="img" aria-label={name}>{initials}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-10 px-6">
      <div className="w-11 h-11 mx-auto mb-3 rounded-full bg-healthcare-soft border border-border text-healthcare flex items-center justify-center font-extrabold" aria-hidden>+</div>
      <h3 className="font-bold text-ink text-[0.95rem]">{title}</h3>
      <p className="text-ink-secondary text-[0.83rem] mt-1 mb-4 max-w-md mx-auto">{body}</p>
      {action}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card-base overflow-hidden" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 px-4 py-3 border-b border-border/60 last:border-0">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="skeleton h-3.5 rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function MetricCard({ label, value, sub, tone = "navy" }: { label: string; value: string; sub?: string; tone?: "navy" | "success" | "warning" | "danger" | "teal" }) {
  const tints: Record<string, string> = {
    navy: "text-navy",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    teal: "text-teal-dark",
  };
  return (
    <div className="card-base p-4 hover:shadow-card transition-shadow">
      <p className="text-[0.74rem] font-bold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={`text-[1.5rem] font-extrabold leading-tight mt-1 tabular-nums ${tints[tone]}`}>{value}</p>
      {sub && <p className="text-[0.76rem] text-ink-secondary mt-0.5">{sub}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  count,
  actions,
}: {
  title: string;
  sub: string;
  count?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="page-title">{title}</h1>
          {count && (
            <span className="inline-flex items-center text-[0.72rem] font-bold bg-navy text-white rounded-full px-2.5 py-1 tabular-nums">
              {count}
            </span>
          )}
        </div>
        <p className="page-sub mt-1">{sub}</p>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}

export function LivePill({ syncing, loading, text }: { syncing?: boolean; loading?: boolean; text: string }) {
  const busy = Boolean(syncing || loading);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <p className="inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-full px-3 py-1.5 w-fit">
        <span className={`w-1.5 h-1.5 rounded-full ${busy ? "bg-teal-dark animate-pulse" : "bg-success"}`} aria-hidden />
        {busy ? "Syncing…" : text}
      </p>
    </div>
  );
}
