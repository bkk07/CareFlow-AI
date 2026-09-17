import { useState } from "react";
import { motion } from "framer-motion";
import { Building2, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAdmin } from "../store/AdminStore";
import { Button } from "../components/common/ui";

export default function LoginPage() {
  const { login, loginMock, backendError, mode } = useAdmin();
  const navigate = useNavigate();
  const [email, setEmail] = useState("platform.admin@careflow.ai");
  const [password, setPassword] = useState("password123");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/platform");
    } catch {
      setError(backendError ?? "Sign-in failed. Check your credentials or use the offline demo.");
    } finally {
      setBusy(false);
    }
  }

  function useDemo() {
    loginMock();
    navigate("/platform");
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="w-full max-w-3xl card-base overflow-hidden grid md:grid-cols-[0.9fr_1.1fr]">
        <div className="hidden md:flex flex-col justify-between bg-gradient-to-b from-navy to-healthcare-dark text-white p-8">
          <div>
            <p className="text-[0.72rem] font-bold uppercase tracking-widest text-white/70">CareFlow AI · Platform Console</p>
            <h2 className="text-[1.45rem] font-extrabold mt-3 leading-snug">The whole network, one view.</h2>
            <p className="text-white/80 text-sm mt-2">Hospitals, doctors, AI oversight, and audit — global platform administration.</p>
          </div>
          <p className="flex items-center gap-2 text-[0.8rem] text-white/80"><Building2 size={15} /> 14 hospitals · 186 doctors on the platform</p>
        </div>
        <div className="p-6 sm:p-8">
          <h1 className="text-[1.45rem] font-extrabold text-navy">Platform sign in</h1>
          <p className="text-sm text-ink-secondary mt-1">
            {mode === "mock" ? "Offline demo — sign in with mock data." : "Sign in with your platform administrator account."}
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
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
            <button type="button" onClick={useDemo} className="w-full text-center text-[0.83rem] font-bold text-healthcare hover:underline">
              Continue with offline demo data
            </button>
          </form>
          <p className="flex items-start gap-2 text-[0.77rem] text-ink-secondary bg-healthcare-faint border border-healthcare/20 rounded-control px-3 py-2.5 mt-5">
            <ShieldCheck size={14} className="shrink-0 mt-0.5 text-healthcare" /> Demo only — all data is local mock data, no backend involved.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
