import { useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, Lock, Mail, ShieldCheck, Stethoscope } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CURRENT_DOCTOR } from "../mock/doctors";
import { useAuth } from "../context/AuthContext";
import { Avatar, Button } from "../components/common/ui";

export default function LoginPage() {
  const { login, loginMock, authError, mode } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("sarah.johnson@citygeneral.org");
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
      navigate("/");
    } catch {
      setError(authError ?? "Sign-in failed. Check your email and password.");
    } finally {
      setBusy(false);
    }
  }

  function useDemo() {
    loginMock();
    navigate("/");
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="w-full max-w-3xl card-base overflow-hidden grid md:grid-cols-[0.9fr_1.1fr]">
        <div className="hidden md:flex flex-col justify-between bg-gradient-to-b from-navy to-healthcare-dark text-white p-8">
          <div>
            <p className="text-[0.72rem] font-bold uppercase tracking-widest text-white/70">CareFlow AI · Doctor Portal</p>
            <h2 className="text-[1.5rem] font-extrabold mt-3 leading-snug">Your clinic day, clearly organized.</h2>
            <p className="text-white/80 text-sm mt-2">Schedules, pre-visit forms, and availability — one calm workspace.</p>
          </div>
          <div className="flex items-center gap-3 bg-white/10 rounded-control p-3.5">
            <Avatar name={CURRENT_DOCTOR.name} photo={CURRENT_DOCTOR.photo} />
            <div>
              <p className="font-bold text-sm">{CURRENT_DOCTOR.name}</p>
              <p className="text-white/75 text-[0.8rem]">{CURRENT_DOCTOR.specialty} · {CURRENT_DOCTOR.hospital}</p>
            </div>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <p className="inline-flex items-center gap-1.5 text-[0.75rem] font-bold text-teal-dark bg-teal-soft rounded-full px-2.5 py-1"><Stethoscope size={13} /> Doctor sign in</p>
          <h1 className="text-[1.45rem] font-extrabold text-navy mt-2">Welcome back, Doctor</h1>
          <p className="text-sm text-ink-secondary mt-1">
            {mode === "mock" ? "Offline demo — sign in with mock data." : "Sign in with your hospital account."}
          </p>
          <form onSubmit={(e) => void submit(e)} className="mt-5 space-y-4">
            <div>
              <label htmlFor="email" className="text-[0.83rem] font-bold block mb-1.5">Work email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-base pl-10" required />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="text-[0.83rem] font-bold block mb-1.5">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input id="password" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="input-base pl-10 pr-11" required />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center text-ink-secondary">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {(error ?? authError) && (
              <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">
                {error ?? authError}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in to Doctor Portal"}</Button>
            <button type="button" onClick={useDemo} className="w-full text-center text-[0.83rem] font-bold text-healthcare hover:underline">
              Continue with offline demo data
            </button>
          </form>
          <p className="flex items-start gap-2 text-[0.78rem] text-ink-secondary bg-healthcare-faint border border-healthcare/20 rounded-control px-3 py-2.5 mt-5">
            <ShieldCheck size={15} className="shrink-0 mt-0.5 text-healthcare" /> Demo only — patient data shown is fictional mock data.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
