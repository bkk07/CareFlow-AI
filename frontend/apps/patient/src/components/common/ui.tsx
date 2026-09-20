import { useState } from "react";
import { initials } from "../../lib/helpers";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

const variants: Record<string, string> = {
  primary: "bg-healthcare text-white hover:bg-healthcare-dark border border-healthcare-dark shadow-subtle",
  secondary: "bg-teal-soft text-teal-dark hover:bg-teal hover:text-white border border-teal/25",
  outline: "bg-white text-navy border border-border hover:border-healthcare hover:text-healthcare",
  ghost: "bg-transparent text-healthcare border border-transparent hover:bg-healthcare-soft",
  danger: "bg-danger text-white border border-danger hover:brightness-95",
};

const sizes: Record<string, string> = {
  sm: "min-h-[2rem] px-3 py-1.5 text-[0.82rem] rounded-lg",
  md: "min-h-[2.5rem] px-4 py-2.5 text-[0.9rem] rounded-control",
  lg: "min-h-[3rem] px-6 py-3 text-[1rem] rounded-control",
};

export function Button({ variant = "primary", size = "md", className = "", ...rest }: ButtonProps) {
  return (
    <button
      className={`btn-base ${variants[variant]} ${sizes[size]} disabled:opacity-55 disabled:cursor-not-allowed active:translate-y-px ${className}`}
      {...rest}
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const map: Record<string, string> = {
    confirmed: "bg-success-soft text-success",
    completed: "bg-success-soft text-success",
    pending: "bg-warning-soft text-warning",
    sync_pending: "bg-warning-soft text-warning",
    rescheduled: "bg-healthcare-soft text-healthcare",
    cancelled: "bg-slate-100 text-ink-secondary",
    video: "bg-teal-soft text-teal-dark",
    in_person: "bg-healthcare-soft text-healthcare",
    phone: "bg-navy-soft text-navy",
  };
  const cls = map[s] ?? "bg-healthcare-soft text-healthcare";
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={`inline-flex items-center gap-1.5 text-[0.74rem] font-bold px-2.5 py-1 rounded-full ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </span>
  );
}

export function SafeImage({
  src,
  alt,
  name,
  className = "",
  fallbackSrc = "",
}: {
  src: string;
  alt: string;
  name: string;
  className?: string;
  /** Tried once when `src` is empty/broken, before falling back to initials. */
  fallbackSrc?: string;
}) {
  // Empty src would render a broken-image icon: start at the fallback
  // (or initials when there is nothing to try).
  const [stage, setStage] = useState<"src" | "fallback" | "initials">(() =>
    src ? "src" : fallbackSrc ? "fallback" : "initials",
  );
  const shown = stage === "src" ? src : stage === "fallback" ? fallbackSrc : "";
  if (!shown) {
    return (
      <div className={`flex items-center justify-center bg-healthcare-soft text-healthcare font-extrabold ${className}`} aria-label={alt} role="img">
        {initials(name)}
      </div>
    );
  }
  return (
    <img
      src={shown}
      alt={alt}
      loading="lazy"
      onError={() => setStage(stage === "src" && fallbackSrc ? "fallback" : "initials")}
      className={`object-cover ${className}`}
    />
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-10 px-6">
      <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-healthcare-soft border border-border text-healthcare flex items-center justify-center font-extrabold text-lg" aria-hidden>
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

export function ErrorState({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card-base p-6 text-center border-danger/25">
      <p className="font-bold text-danger">{title}</p>
      <p className="text-sm text-ink-secondary mt-1 mb-4">{body}</p>
      <div className="flex gap-2 justify-center">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
