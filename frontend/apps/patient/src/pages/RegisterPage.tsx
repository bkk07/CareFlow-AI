import { useEffect, useState } from "react";
import { Lock, Mail, MapPin, Navigation, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/common/ui";
import {
  AuthError,
  AuthFooterLink,
  AuthInput,
  AuthPage,
  AuthStepper,
  AuthTrustRow,
  PasswordInput,
  friendlyAuthError,
  isValidEmail,
} from "../components/auth/AuthUI";
import { readPosition } from "../lib/helpers";

/** Backend password rule (RegisterIn: min_length=8). Shown as-is — no invented rules. */
const MIN_PASSWORD_LENGTH = 8;

export default function RegisterPage() {
  const { register, updateContactInfo, mode, authError, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});

  // Post-registration profile step (existing behavior): name + location are
  // optional contact attributes saved via PUT /patients/me/contact so the
  // assistant knows who you are and can rank "near me" by real distance.
  const [onboarding, setOnboarding] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (mode === "live" && isAuthenticated && !onboarding) navigate("/home", { replace: true });
  }, [mode, isAuthenticated, onboarding, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errors: { email?: string; password?: string; confirm?: string } = {};
    if (!email.trim()) errors.email = "Enter your email address.";
    else if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter a password.";
    else if (password.length < MIN_PASSWORD_LENGTH)
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (!confirm) errors.confirm = "Confirm your password.";
    else if (confirm !== password) errors.confirm = "Passwords don't match.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setLocalError(null);
    try {
      // registerPatient: POST /auth/register then auto-login (existing flow).
      await register(email.trim(), password);
      setOnboarding(true);
    } catch (err) {
      setLocalError(friendlyAuthError(err, authError ?? "Registration failed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function useMyLocation() {
    setLocating(true);
    setGeoError(null);
    try {
      const g = await readPosition();
      setCoords({ latitude: g.latitude, longitude: g.longitude });
    } catch (err) {
      setGeoError(err instanceof Error ? err.message : "Could not read your location.");
    } finally {
      setLocating(false);
    }
  }

  async function finishOnboarding(skip = false) {
    setSavingProfile(true);
    setLocalError(null);
    try {
      if (!skip && (fullName.trim() || phone.trim() || city.trim() || coords)) {
        await updateContactInfo({
          full_name: fullName.trim() || undefined,
          phone: phone.trim() || undefined,
          city: city.trim() || null,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
        });
      }
      navigate("/home");
    } catch {
      setLocalError("Could not save your profile. You can set it later from Profile.");
      navigate("/home");
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <AuthPage>
      {onboarding ? (
        <>
          <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.18em] text-teal-dark">Step 2 of 2 · About you</p>
          <h1 className="mt-2 text-[1.9rem] font-extrabold text-navy tracking-[-0.02em] leading-tight">
            Tell us about you
          </h1>
          <p className="text-ink-secondary text-[0.93rem] mt-2">
            Hi there — this helps CareFlow AI greet you by name and find care near you. Everything here is optional.
          </p>
          <AuthStepper steps={["Account", "About you"]} current={1} />
          <div className="mt-6 space-y-4">
            <AuthInput
              id="ob-name"
              label="Full name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Priya Sharma"
              icon={<User size={16} />}
            />
            <div className="grid sm:grid-cols-2 gap-4">
              <AuthInput
                id="ob-phone"
                label="Phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                icon={<User size={16} />}
              />
              <AuthInput
                id="ob-city"
                label="City"
                type="text"
                autoComplete="address-level2"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Bengaluru"
                icon={<MapPin size={16} />}
              />
            </div>
            <div className="bg-healthcare-faint border border-healthcare/20 rounded-xl px-4 py-3.5">
              <p className="text-[0.86rem] font-bold text-navy flex items-center gap-1.5">
                <MapPin size={15} className="text-healthcare" aria-hidden /> Your location
              </p>
              <p className="text-[0.8rem] text-ink-secondary mt-0.5">
                Share it once — we&apos;ll suggest the closest doctors first.
              </p>
              {coords ? (
                <div className="flex items-center justify-between gap-2 mt-2">
                  <p className="text-[0.8rem] font-semibold text-teal-dark bg-white border border-teal/20 rounded-full px-2.5 py-1">
                    {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setCoords(null)}
                    className="text-[0.8rem] font-bold text-ink-secondary hover:text-healthcare hover:underline min-h-[2.75rem] px-2"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void useMyLocation()}
                  disabled={locating}
                >
                  <Navigation size={14} /> {locating ? "Reading location…" : "Use my location"}
                </Button>
              )}
              {geoError && (
                <p role="alert" className="text-[0.8rem] font-semibold text-danger mt-2">
                  {geoError}
                </p>
              )}
            </div>
            <AuthError message={localError} />
            <Button size="lg" className="w-full" disabled={savingProfile} onClick={() => void finishOnboarding(false)}>
              {savingProfile ? "Saving…" : "Save & continue"}
            </Button>
            <button
              type="button"
              onClick={() => void finishOnboarding(true)}
              className="w-full text-center text-[0.86rem] font-bold text-ink-secondary hover:text-healthcare hover:underline min-h-[2.75rem]"
            >
              Skip for now
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.18em] text-teal-dark">Step 1 of 2 · Your account</p>
          <h1 className="mt-2 text-[1.9rem] font-extrabold text-navy tracking-[-0.02em] leading-tight">
            Create your CareFlow account
          </h1>
          <p className="text-ink-secondary text-[0.93rem] mt-2">
            Create your patient account to discover care, manage appointments, and stay connected with your healthcare journey.
          </p>
          <AuthStepper steps={["Account", "About you"]} current={0} />

          <form onSubmit={(e) => void submit(e)} noValidate className="mt-6 space-y-4">
            <section aria-label="Your account" className="space-y-4">
              <AuthInput
                id="reg-email"
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
                id="reg-password"
                label="Password"
                required
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  setFieldErrors((f) => ({ ...f, password: undefined, confirm: undefined }));
                }}
                autoComplete="new-password"
                placeholder="Create a password"
                error={fieldErrors.password ?? null}
                hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
                showStrength
                icon={<Lock size={16} />}
              />
              <PasswordInput
                id="reg-confirm"
                label="Confirm password"
                required
                value={confirm}
                onChange={(v) => {
                  setConfirm(v);
                  setFieldErrors((f) => ({ ...f, confirm: undefined }));
                }}
                autoComplete="new-password"
                placeholder="Repeat your password"
                error={fieldErrors.confirm ?? null}
                icon={<Lock size={16} />}
              />
            </section>

            <AuthError message={localError ?? authError} />

            <Button type="submit" size="lg" className="w-full" disabled={busy || mode === "checking"}>
              {busy ? "Creating account…" : "Create Account"}
            </Button>

            <p className="text-center text-[0.87rem] text-ink-secondary pt-1">
              Already have an account? <AuthFooterLink to="/login">Sign in</AuthFooterLink>
            </p>
          </form>

          <AuthTrustRow />
        </>
      )}
    </AuthPage>
  );
}
