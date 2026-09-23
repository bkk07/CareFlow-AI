import { useState } from "react";
import { doctorInitials } from "../../lib/helpers";

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
    sm: "min-h-[2rem] px-3 py-1.5 text-[0.82rem] rounded-lg",
    md: "min-h-[2.5rem] px-4 py-2.5 text-[0.9rem] rounded-control",
    lg: "min-h-[3rem] px-6 py-3 text-[1rem] rounded-control",
  };
  return (
    <button className={`btn-base ${variants[variant]} ${sizes[size]} disabled:opacity-55 disabled:cursor-not-allowed active:translate-y-px ${className}`} {...rest} />
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const map: Record<string, string> = {
    confirmed: "bg-success-soft text-success",
    completed: "bg-success-soft text-success",
    pending: "bg-warning-soft text-warning",
    sync_pending: "bg-warning-soft text-warning",
    requested: "bg-warning-soft text-warning",
    rescheduled: "bg-healthcare-soft text-healthcare",
    cancelled: "bg-slate-100 text-ink-secondary",
    no_show: "bg-slate-100 text-ink-secondary",
    failed: "bg-danger-soft text-danger",
    active: "bg-success-soft text-success",
    inactive: "bg-slate-100 text-ink-secondary",
    invited: "bg-healthcare-soft text-healthcare",
    suspended: "bg-danger-soft text-danger",
    assigned: "bg-healthcare-soft text-healthcare",
    in_progress: "bg-warning-soft text-warning",
    not_assigned: "bg-slate-100 text-ink-secondary",
    video: "bg-teal-soft text-teal-dark",
    in_person: "bg-healthcare-soft text-healthcare",
    phone: "bg-navy-soft text-navy",
  };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={`inline-flex items-center gap-1.5 text-[0.72rem] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${map[s] ?? "bg-healthcare-soft text-healthcare"}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </span>
  );
}

export function Avatar({ name, photo, size = "md" }: { name: string; photo?: string; size?: "sm" | "md" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const cls = size === "lg" ? "w-16 h-16 text-lg" : size === "sm" ? "w-8 h-8 text-[0.7rem]" : "w-11 h-11 text-sm";
  if (photo && !failed) {
    return (
      <img
        src={photo}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${cls} rounded-full object-cover border border-border shrink-0`}
      />
    );
  }
  return (
    <span className={`${cls} rounded-full bg-healthcare-soft text-healthcare font-extrabold flex items-center justify-center border border-border shrink-0`} aria-label={name} role="img">
      {name.includes(" ") ? doctorInitials(name) : name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub mt-1">{sub}</p>}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2 flex-wrap">{action}</div>}
    </div>
  );
}

export function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2.5">
      <div className="min-w-0">
        <h2 className="section-title">{title}</h2>
        {sub && <p className="text-[0.78rem] text-ink-secondary mt-0.5">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function LiveBadge({ loading }: { loading: boolean }) {
  return (
    <p className="text-[0.76rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-1.5 w-fit">
      {loading ? "Syncing live schedule…" : "Live schedule from your hospital"}
    </p>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-10 px-6">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-healthcare-soft border border-border text-healthcare flex items-center justify-center font-extrabold" aria-hidden>
        +
      </div>
      <h3 className="font-bold text-ink">{title}</h3>
      <p className="text-ink-secondary text-sm mt-1 mb-4 max-w-md mx-auto">{body}</p>
      {action}
    </div>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card-base p-5" aria-hidden>
      <div className="skeleton h-5 w-2/5 rounded-md mb-3" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-3.5 rounded-md mb-2" style={{ width: `${85 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return (
    <div className="card-base p-6 text-center">
      <p className="font-bold text-danger">{title}</p>
      <p className="text-sm text-ink-secondary mt-1 mb-4">{body}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
