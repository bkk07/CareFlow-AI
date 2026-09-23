import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarCheck, ClipboardList, Clock, Eye, EyeOff, Lock, Mail, ShieldCheck, Stethoscope } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/common/ui";

const BULLETS = [
  { icon: Clock, text: "Today's appointments at a glance" },
  { icon: CalendarCheck, text: "Availability management" },
  { icon: ClipboardList, text: "Questionnaire review" },
];

export default function LoginPage() {
  const { login, authError, isAuthenticated, mode } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (mode === "live" && isAuthenticated) navigate("/", { replace: true });
  }, [mode, isAuthenticated, navigate]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch {
      setError(authError ?? "Sign-in failed. Check your email and password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-white border-b border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-[60px] flex items-center gap-2.5">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Back to Doctor Portal home">
            <span className="w-8 h-8 rounded-[9px] bg-navy text-white flex items-center justify-center" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="leading-none">
              <span className="block font-extrabold tracking-tight text-navy text-[0.95rem]">
                CareFlow <span className="text-healthcare">AI</span>
              </span>
              <span className="block text-[0.65rem] font-bold uppercase tracking-widest text-ink-faint mt-0.5">Doctor Portal</span>
            </span>
          </Link>
          <div className="flex-1" />
          <Link to="/" className="text-[0.83rem] font-bold text-healthcare hover:underline">← Portal home</Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-3xl card-base overflow-hidden grid md:grid-cols-[0.9fr_1.1fr]"
        >
          {/* Left: brand panel */}
          <div className="hidden md:flex flex-col justify-between text-white p-8" style={{ background: "linear-gradient(180deg, #0E2E4A 0%, #123B5D 60%, #11527F 100%)" }}>
            <div>
              <p className="text-[0.72rem] font-bold uppercase tracking-widest text-white/70">CareFlow AI · Doctor Portal</p>
              <h2 className="text-[1.5rem] font-extrabold mt-3 leading-snug" style={{ color: "#fff" }}>Your schedule, organized.</h2>
              <p className="text-white/80 text-sm mt-2">Today's visits, pre-visit forms, and availability — one focused workspace.</p>
              <ul className="mt-5 space-y-2.5">
                {BULLETS.map((b) => (
                  <li key={b.text} className="flex items-center gap-2.5 text-[0.86rem] font-semibold text-white/90">
                    <span className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center shrink-0" aria-hidden>
                      <b.icon size={15} />
                    </span>
                    {b.text}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center gap-3 bg-white/10 rounded-control p-3.5 mt-6">
              <span className="w-11 h-11 rounded-full bg-white/15 border border-white/20 flex items-center justify-center shrink-0" aria-hidden>
                <Stethoscope size={20} />
              </span>
              <div>
                <p className="font-bold text-sm">Doctor sign in</p>
                <p className="text-white/75 text-[0.8rem]">Secure hospital credentials</p>
              </div>
            </div>
          </div>

          {/* Right: form */}
          <div className="p-6 sm:p-8">
            <p className="inline-flex items-center gap-1.5 text-[0.75rem] font-bold text-teal-dark bg-teal-soft rounded-full px-2.5 py-1">
              <Stethoscope size={13} /> Sign in to Doctor Portal
            </p>
            <h1 className="text-[1.45rem] font-extrabold text-navy mt-2">Welcome back, Doctor</h1>
            <p className="text-sm text-ink-secondary mt-1">Sign in with your hospital account.</p>
            <form onSubmit={(e) => void submit(e)} className="mt-5 space-y-4">
              <div>
                <label htmlFor="email" className="text-[0.83rem] font-bold block mb-1.5">Work email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-base pl-10"
                    required
                    autoComplete="username"
                    placeholder="you@hospital.org"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="password" className="text-[0.83rem] font-bold block mb-1.5">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <input
                    id="password"
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-base pl-10 pr-11"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center text-ink-secondary"
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              {(error ?? authError) && (
                <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">
                  {error ?? authError}
                </p>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
            </form>
            <p className="flex items-start gap-2 text-[0.78rem] text-ink-secondary bg-healthcare-faint border border-healthcare/20 rounded-control px-3 py-2.5 mt-5">
              <ShieldCheck size={15} className="shrink-0 mt-0.5 text-healthcare" />
              <span>Your session is secured with your hospital credentials. No public registration — contact your hospital administrator for access.</span>
            </p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
