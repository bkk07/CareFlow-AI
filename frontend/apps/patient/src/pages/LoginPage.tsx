import { useEffect, useState } from "react";
import { Lock, Mail } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/common/ui";
import {
  AuthError,
  AuthFooterLink,
  AuthInput,
  AuthPage,
  AuthTrustRow,
  PasswordInput,
  friendlyAuthError,
  isValidEmail,
} from "../components/auth/AuthUI";

export default function LoginPage() {
  const { login, mode, authError, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  useEffect(() => {
    if (mode === "live" && isAuthenticated) navigate("/home", { replace: true });
  }, [mode, isAuthenticated, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = "Enter your email address.";
    else if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setLocalError(null);
    try {
      await login(email.trim(), password);
      if (remember === false) {
        /* session-only is not supported yet; token stays in localStorage */
      }
      navigate("/home");
    } catch (err) {
      setLocalError(friendlyAuthError(err, authError ?? "Sign-in failed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPage>
      <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.18em] text-teal-dark">Sign in</p>
      <h1 className="mt-2 text-[1.9rem] font-extrabold text-navy tracking-[-0.02em] leading-tight">
        Sign in to CareFlow AI
      </h1>
      <p className="text-ink-secondary text-[0.93rem] mt-2">
        Access your appointments and personalized care experience.
      </p>

      <form onSubmit={(e) => void submit(e)} noValidate className="mt-7 space-y-4">
        <AuthInput
          id="email"
          label="Email address"
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setFieldErrors((f) => ({ ...f, email: undefined }));
          }}
          placeholder="you@example.com"
          error={fieldErrors.email ?? null}
          valid={!!email && !fieldErrors.email && isValidEmail(email)}
          icon={<Mail size={16} />}
        />
        <PasswordInput
          id="password"
          label="Password"
          required
          value={password}
          onChange={(v) => {
            setPassword(v);
            setFieldErrors((f) => ({ ...f, password: undefined }));
          }}
          autoComplete="current-password"
          placeholder="Enter your password"
          error={fieldErrors.password ?? null}
          icon={<Lock size={16} />}
        />

        <AuthError message={localError ?? authError} />

        <div className="flex items-center justify-between text-[0.86rem]">
          <label className="flex items-center gap-2 font-medium text-ink-secondary cursor-pointer min-h-[2.75rem]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-4 h-4 accent-[#1769AA]"
            />
            Remember me
          </label>
          <button type="button" className="font-bold text-healthcare hover:underline rounded min-h-[2.75rem] px-1">
            Forgot password?
          </button>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={busy || mode === "checking"}>
          {busy ? "Signing in…" : "Sign In"}
        </Button>

        <p className="text-center text-[0.87rem] text-ink-secondary pt-1">
          New to CareFlow AI? <AuthFooterLink to="/register">Create your patient account</AuthFooterLink>
        </p>
      </form>

      <AuthTrustRow />
    </AuthPage>
  );
}
