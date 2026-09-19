import { useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/common/ui";
import { Logo } from "../components/layout/PatientShell";

export default function LoginPage() {
  const { login, register, mode, authError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      if (creating) {
        await register(email, password);
      } else {
        await login(email, password);
      }
      if (remember === false) {
        /* session-only is not supported yet; token stays in localStorage */
      }
      navigate("/");
    } catch {
      setLocalError(authError ?? "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const error = localError ?? authError;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-4xl bg-white border border-border rounded-2xl shadow-card overflow-hidden grid md:grid-cols-2"
      >
        {/* Left brand panel */}
        <div className="relative hidden md:block bg-gradient-to-br from-navy-deep via-navy to-healthcare">
          <div className="absolute inset-0 bg-gradient-to-t from-navy-deep/60 via-transparent to-transparent" aria-hidden />
          <div className="relative h-full flex flex-col justify-end p-8 text-white">
            <Logo light />
            <h2 className="text-[1.4rem] font-extrabold mt-4 leading-snug">Care that starts with listening.</h2>
            <p className="text-white/85 text-sm mt-2 leading-relaxed">
              Find the right doctor, check real availability, and manage visits — all in one calm, secure place.
            </p>
            <div className="flex items-center gap-2 mt-4 text-[0.8rem] text-white/85">
              <ShieldCheck size={16} /> Trusted by hospital teams · Private by design
            </div>
          </div>
        </div>

        {/* Right form */}
        <div className="p-6 sm:p-9">
          <div className="md:hidden mb-5">
            <Logo />
          </div>
          <h1 className="text-[1.5rem] font-extrabold text-navy tracking-tight">
            {creating ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-ink-secondary text-sm mt-1">
            {creating ? "Register as a patient to book and manage visits." : "Sign in to manage your care with CareFlow AI."}
          </p>

          <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="text-[0.83rem] font-bold text-ink block mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-base pl-10"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="text-[0.83rem] font-bold text-ink block mb-1.5">
                Password{creating ? " (min 8 characters)" : ""}
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete={creating ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-base pl-10 pr-11"
                  placeholder="••••••••"
                  required
                  minLength={creating ? 8 : undefined}
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

            {error && (
              <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between text-[0.83rem]">
              <label className="flex items-center gap-2 font-medium text-ink-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="w-4 h-4 accent-[#1769AA]"
                />
                Remember me
              </label>
              <button type="button" className="font-bold text-healthcare hover:underline">
                Forgot password?
              </button>
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={busy || mode === "checking"}>
              {busy ? (creating ? "Creating account…" : "Signing in…") : creating ? "Create account" : "Sign in"}
            </Button>

            <p className="text-center text-[0.83rem] text-ink-secondary">
              {creating ? (
                <>Already have an account? <button type="button" onClick={() => { setCreating(false); setLocalError(null); }} className="font-bold text-healthcare hover:underline">Sign in</button></>
              ) : (
                <>New to CareFlow AI? <button type="button" onClick={() => { setCreating(true); setLocalError(null); }} className="font-bold text-healthcare hover:underline">Create account</button></>
              )}
            </p>
          </form>

          <div className="mt-6 flex items-start gap-2 bg-healthcare-faint border border-healthcare/20 rounded-control px-3.5 py-3 text-[0.8rem] text-navy leading-relaxed">
            <ShieldCheck size={16} className="shrink-0 mt-0.5 text-healthcare" />
            Your healthcare information stays private and secure.
          </div>
          <p className="text-center text-[0.72rem] text-ink-faint mt-4">
            {mode === "live" ? "Connected to CareFlow AI backend." : "Checking backend connection…"}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
