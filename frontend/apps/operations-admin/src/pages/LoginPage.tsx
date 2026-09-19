import { useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, LifeBuoy, Lock, Mail, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAdmin } from "../store/AdminStore";
import { Button } from "../components/common/ui";

export default function LoginPage() {
  const { login, backendError, mode } = useAdmin();
  const navigate = useNavigate();
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
      navigate("/ops");
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Sign-in failed. Check your credentials and retry."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="w-full max-w-3xl card-base overflow-hidden grid md:grid-cols-[0.9fr_1.1fr]">
        <div className="hidden md:flex flex-col justify-between bg-gradient-to-b from-navy to-healthcare-dark text-white p-8">
          <div>
            <p className="text-[0.72rem] font-bold uppercase tracking-widest text-white/70">CareFlow AI · Operations Console</p>
            <h2 className="text-[1.45rem] font-extrabold mt-3 leading-snug">Every failure, recoverable.</h2>
            <p className="text-white/80 text-sm mt-2">Unknown outcomes, reconciliation, retries, and human escalation — one recovery workspace.</p>
          </div>
          <p className="flex items-center gap-2 text-[0.8rem] text-white/80"><LifeBuoy size={15} /> Live backend required for operations data</p>
        </div>
        <div className="p-6 sm:p-8">
          <h1 className="text-[1.45rem] font-extrabold text-navy">Operations sign in</h1>
          <p className="text-sm text-ink-secondary mt-1">
            {mode === "checking" ? "Checking backend connection…" : "Sign in with your operator account."}
          </p>
          <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4">
            <div>
              <label htmlFor="email" className="text-[0.82rem] font-bold block mb-1.5">Work email</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-base pl-10" required />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="text-[0.82rem] font-bold block mb-1.5">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input id="password" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="input-base pl-10 pr-11" required />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center text-ink-secondary">
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            {(error ?? backendError) && (
              <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">
                {error ?? backendError}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy || mode === "checking"}>{busy ? "Signing in…" : "Sign in"}</Button>
          </form>
          <p className="flex items-start gap-2 text-[0.77rem] text-ink-secondary bg-healthcare-faint border border-healthcare/20 rounded-control px-3 py-2.5 mt-5">
            <ShieldCheck size={14} className="shrink-0 mt-0.5 text-healthcare" /> Live backend sign-in only — hospital operators and platform admins.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
