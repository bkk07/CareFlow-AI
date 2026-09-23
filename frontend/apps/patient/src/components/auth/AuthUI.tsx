import { useState } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Check, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import PublicNav from "../layout/PublicNav";

/* ------------------------------------------------------------------ */
/* Safe, user-facing error mapping. Never leaks internals.             */
/* ------------------------------------------------------------------ */

export function friendlyAuthError(e: unknown, fallback: string): string {
  const err = e as {
    response?: { status?: number; data?: { detail?: unknown } };
  } | null;
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail;
  if (status === 401) {
    return "The email or password is incorrect. Please try again.";
  }
  if (typeof detail === "string" && detail.length > 0 && detail.length < 200) {
    return detail;
  }
  if (Array.isArray(detail)) {
    return "Please check the highlighted fields and try again.";
  }
  if (!err?.response) {
    return "We couldn't connect to CareFlow AI. Please check your connection and try again.";
  }
  return fallback;
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/* ------------------------------------------------------------------ */
/* Page shell: shared public navbar, form centered in the middle.     */
/* ------------------------------------------------------------------ */

export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <PublicNav />
      <main className="flex-1 flex flex-col justify-center px-5 py-10 sm:py-14">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-[440px] mx-auto"
        >
          {children}
        </motion.div>
      </main>
      <footer className="px-5 pb-6">
        <p className="text-center text-[0.74rem] text-ink-faint max-w-md mx-auto leading-relaxed">
          CareFlow AI helps with scheduling and care navigation. It does not provide medical diagnosis or emergency
          medical services.
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stepper (registration: Account → About you).                        */
/* ------------------------------------------------------------------ */

export function AuthStepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 mt-5" aria-label="Registration progress">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex flex-1 items-center gap-2 last:flex-none" aria-current={active ? "step" : undefined}>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.68rem] font-extrabold transition ${
                done ? "bg-success text-white" : active ? "bg-navy text-white" : "bg-slate-100 text-slate-400"
              }`}
              aria-hidden
            >
              {done ? <Check size={12} strokeWidth={3.5} /> : i + 1}
            </span>
            <span className={`text-[0.76rem] font-bold whitespace-nowrap ${active || done ? "text-navy" : "text-slate-400"}`}>
              {s}
            </span>
            {i < steps.length - 1 && <span className={`h-px flex-1 ${done ? "bg-success/50" : "bg-slate-200"}`} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs: 52px, icon tile, valid check, described, invalid-aware.     */
/* ------------------------------------------------------------------ */

const inputCls =
  "input-base min-h-[52px] pl-[3.25rem] pr-11 text-[0.95rem] transition-shadow aria-[invalid=true]:border-danger aria-[invalid=true]:focus:border-danger aria-[invalid=true]:focus:ring-danger/20";

export function AuthInput({
  id,
  label,
  required,
  error,
  hint,
  valid,
  icon,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  valid?: boolean;
  icon: ReactNode;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="text-[0.86rem] font-bold text-ink block mb-1.5">
        {label} {required && <span aria-hidden className="text-danger">*</span>}
        {required && <span className="sr-only">(required)</span>}
      </label>
      <div className="relative group">
        <span
          className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg bg-healthcare-faint text-healthcare pointer-events-none transition group-focus-within:bg-healthcare group-focus-within:text-white"
          aria-hidden
        >
          {icon}
        </span>
        <input id={id} aria-invalid={!!error} aria-describedby={describedBy} className={inputCls} {...rest} />
        {valid && !error && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-success" aria-hidden>
            <Check size={17} strokeWidth={3} />
          </span>
        )}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[0.76rem] text-ink-secondary mt-1.5">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[0.78rem] font-semibold text-danger mt-1.5">
          {error}
        </p>
      )}
    </div>
  );
}

function strengthOf(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "" };
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (pw.length >= 12) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s += 1;
  return { score: s, label: ["", "Weak", "Fair", "Good", "Strong"][s] };
}

export function PasswordInput({
  id,
  label,
  required,
  error,
  hint,
  showStrength,
  icon,
  value,
  onChange,
  autoComplete,
  placeholder = "Enter your password",
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  showStrength?: boolean;
  icon: ReactNode;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  const strength = showStrength ? strengthOf(value) : null;
  const barColor = !strength || !value ? "" : strength.score <= 1 ? "bg-danger" : strength.score === 2 ? "bg-warning" : strength.score === 3 ? "bg-teal" : "bg-success";

  return (
    <div>
      <label htmlFor={id} className="text-[0.86rem] font-bold text-ink block mb-1.5">
        {label} {required && <span aria-hidden className="text-danger">*</span>}
        {required && <span className="sr-only">(required)</span>}
      </label>
      <div className="relative group">
        <span
          className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg bg-healthcare-faint text-healthcare pointer-events-none transition group-focus-within:bg-healthcare group-focus-within:text-white"
          aria-hidden
        >
          {icon}
        </span>
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => {
            const ev = e as React.KeyboardEvent<HTMLInputElement>;
            if (typeof ev.getModifierState === "function") setCapsOn(ev.getModifierState("CapsLock"));
          }}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={`${inputCls} pr-20`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[2.75rem] min-h-[2.75rem] px-2 rounded-lg hover:bg-background flex items-center justify-center gap-1 text-[0.76rem] font-bold text-ink-secondary"
        >
          {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {strength && value && (
        <div className="mt-2 flex items-center gap-2" aria-hidden={false}>
          <span className="flex flex-1 gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i < strength.score ? barColor : "bg-slate-200"}`} />
            ))}
          </span>
          <span className="text-[0.74rem] font-bold text-ink-secondary">{strength.label} password</span>
        </div>
      )}
      {capsOn && !error && (
        <p className="text-[0.76rem] font-semibold text-warning mt-1.5">Caps Lock is on.</p>
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[0.76rem] text-ink-secondary mt-1.5">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[0.78rem] font-semibold text-danger mt-1.5">
          {error}
        </p>
      )}
    </div>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 text-[0.86rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-xl px-4 py-3"
    >
      <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

export function AuthFooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-bold text-healthcare hover:underline rounded">
      {children}
    </Link>
  );
}

export function AuthTrustRow() {
  return (
    <div className="mt-7 grid grid-cols-3 gap-2 border-t border-border pt-5" aria-label="Why trust CareFlow AI">
      {[
        { icon: ShieldCheck, label: "Private by design" },
        { icon: Eye, label: "Secure sign-in" },
        { icon: Check, label: "Free to reschedule" },
      ].map((t) => (
        <span key={t.label} className="flex flex-col items-center gap-1.5 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-healthcare-faint text-healthcare" aria-hidden>
            <t.icon size={16} />
          </span>
          <span className="text-[0.7rem] font-bold text-ink-secondary leading-tight">{t.label}</span>
        </span>
      ))}
    </div>
  );
}
