import { Link } from "react-router-dom";

/**
 * Shared operational primitives for the hospital command center.
 * All visuals are status-driven; numbers always come from live store data
 * passed in by callers — nothing here invents metrics.
 */

export function SectionHeader({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: { label: string; to: string };
}) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h2 className="text-[0.95rem] font-bold text-navy tracking-tight">{title}</h2>
        {sub && <p className="text-[0.78rem] text-ink-secondary mt-0.5">{sub}</p>}
      </div>
      {action && (
        <Link
          to={action.to}
          className="text-[0.78rem] font-bold text-healthcare hover:underline shrink-0 py-0.5"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function HealthDot({ tone }: { tone: "green" | "amber" | "red" | "gray" | "blue" }) {
  const tones: Record<string, string> = {
    green: "bg-success",
    amber: "bg-warning",
    red: "bg-danger",
    gray: "bg-border",
    blue: "bg-healthcare",
  };
  return <span className={`w-2 h-2 rounded-full shrink-0 ${tones[tone]}`} aria-hidden />;
}

export function InlineEmpty({ title, body, action }: { title: string; body: string; action?: { label: string; to: string } }) {
  return (
    <div className="py-6 px-4 text-center">
      <span className="w-9 h-9 mx-auto rounded-full bg-success-soft text-success flex items-center justify-center font-extrabold" aria-hidden>✓</span>
      <p className="font-bold text-ink text-[0.88rem] mt-2.5">{title}</p>
      <p className="text-ink-secondary text-[0.8rem] mt-1">{body}</p>
      {action && (
        <Link to={action.to} className="inline-block mt-3 text-[0.8rem] font-bold text-healthcare hover:underline">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Horizontal count bar scaled to a caller-provided max (counts are real). */
export function CountBar({
  label,
  count,
  max,
  tone = "bg-healthcare",
}: {
  label: string;
  count: number;
  max: number;
  tone?: string;
}) {
  const width = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[0.78rem]">
        <span className="font-semibold text-ink truncate">{label}</span>
        <span className="font-bold text-navy tabular-nums shrink-0">{count}</span>
      </div>
      <div className="h-1.5 bg-background border border-border/60 rounded-full mt-1 overflow-hidden" role="img" aria-label={`${label}: ${count}`}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
