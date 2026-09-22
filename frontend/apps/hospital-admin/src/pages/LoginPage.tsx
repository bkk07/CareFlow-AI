import { useEffect, useState } from "react";
import { Building2, Eye, EyeOff, Lock, Mail, ShieldCheck, Stethoscope, Workflow } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAdmin } from "../store/AdminStore";
import { Button } from "../components/common/ui";
import { AuthFooter, AuthNavbar } from "../components/auth/AuthChrome";

/**
 * Hospital Admin sign-in — landing-matched enterprise layout.
 * Auth flow preserved: login() → POST /auth/login → GET /auth/me
 * (hospital_admin role enforced in store) → navigate /overview.
 */
export default function LoginPage() {
  const { login, backendError, authed, mode } = useAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (mode === "live" && authed) navigate("/overview", { replace: true });
  }, [mode, authed, navigate]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formError = error ?? backendError;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/overview");
    } catch (err) {
      if (err instanceof Error && err.message === "Backend is unreachable — check VITE_API_URL and try again.") {
        setError("We couldn't connect to CareFlow AI. Please check your connection and try again.");
      } else if (err instanceof Error && /inactive/i.test(err.message)) {
        setError("This account is inactive. Contact your hospital administrator.");
      } else if (err instanceof Error && /hospital administrator/i.test(err.message)) {
        setError(err.message);
      } else {
        setError("The email or password is incorrect. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased flex flex-col">
      <AuthNavbar />

      <main className="flex-1">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-10 lg:py-16 grid lg:grid-cols-[1fr_460px] gap-8 items-start">
          {/* LEFT — landing-style intro */}
          <div className="animate-[fadeIn_200ms_ease]">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-teal-dark">
              Hospital Admin Access
            </p>
            <h1 className="text-[1.9rem] sm:text-[2.4rem] font-bold text-navy tracking-tight leading-[1.12] mt-3">
              Welcome back to your hospital workspace.
            </h1>
            <p className="text-ink-secondary text-[1rem] leading-relaxed mt-4 max-w-[52ch]">
              Sign in to manage your hospital operations, care teams, appointments, and
              workflows — the same workspace shown across the CareFlow AI platform.
            </p>

            <div className="grid sm:grid-cols-3 gap-3 mt-8">
              {[
                [Building2, "Hospital Operations", "Configuration and daily operations."],
                [Stethoscope, "Care Team", "Doctors, availability, appointments."],
                [Workflow, "Connected Care", "Scheduling and workflows, connected."],
              ].map(([Icon, title, body]) => {
                const I = Icon as typeof Building2;
                return (
                  <div key={title as string} className="bg-white border border-border rounded-2xl p-4 hover:border-healthcare/50 hover:shadow-subtle transition-all duration-200">
                    <span className="w-10 h-10 rounded-xl bg-healthcare-soft text-healthcare flex items-center justify-center">
                      <I size={18} />
                    </span>
                    <p className="font-bold text-navy text-[0.88rem] mt-3">{title as string}</p>
                    <p className="text-ink-secondary text-[0.8rem] mt-1 leading-relaxed">{body as string}</p>
                  </div>
                );
              })}
            </div>

            <div className="flex items-start gap-2.5 bg-white border border-border rounded-2xl px-4 py-3.5 mt-4 text-[0.85rem]">
              <ShieldCheck size={16} className="shrink-0 mt-0.5 text-teal-dark" />
              <p className="text-ink-secondary">
                <span className="font-bold text-navy">Secure hospital workspace.</span> Role-based,
                hospital-scoped access — you only ever see your own hospital&apos;s data.
              </p>
            </div>
          </div>

          {/* RIGHT — form card */}
          <div className="bg-white border border-border rounded-2xl shadow-subtle p-6 sm:p-8 animate-[fadeIn_200ms_ease]">
            <h2 className="text-[1.25rem] font-bold text-navy tracking-tight">Sign in to your hospital workspace</h2>
            <p className="text-[0.9rem] text-ink-secondary mt-1.5">Use your hospital administrator credentials to continue.</p>

            <form onSubmit={(e) => void submit(e)} className="mt-6">
              <div>
                <label htmlFor="email" className="text-[0.85rem] font-semibold text-ink block mb-1.5">
                  Work Email <span className="text-danger" aria-hidden>*</span>
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="admin@hospital.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-base pl-10 !min-h-[50px]"
                    required
                    aria-invalid={formError ? true : undefined}
                    aria-describedby={formError ? "login-error" : undefined}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label htmlFor="password" className="text-[0.85rem] font-semibold text-ink block mb-1.5">
                  Password <span className="text-danger" aria-hidden>*</span>
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                  <input
                    id="password"
                    name="password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-base pl-10 pr-12 !min-h-[50px]"
                    required
                    aria-invalid={formError ? true : undefined}
                    aria-describedby={formError ? "login-error" : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Hide password" : "Show password"}
                    aria-pressed={show}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg hover:bg-background flex items-center justify-center text-ink-secondary transition-colors duration-200"
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {formError && (
                <p id="login-error" role="alert" className="flex items-start gap-2 text-[0.85rem] font-medium text-danger bg-danger-soft border border-danger/20 rounded-control px-3.5 py-3 mt-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0 mt-[7px]" aria-hidden />
                  {formError}
                </p>
              )}

              <Button type="submit" size="lg" className="w-full !min-h-[50px] !rounded-[11px] mt-6" disabled={busy}>
                {busy ? "Signing in…" : "Sign In"}
              </Button>
            </form>

            <p className="text-center text-[0.875rem] text-ink-secondary mt-5">
              New hospital? <Link to="/register" className="font-semibold text-healthcare hover:underline">Create hospital account</Link>
            </p>
          </div>
        </div>
      </main>

      <AuthFooter />
    </div>
  );
}
