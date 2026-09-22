import { useState } from "react";
import { Building2, CheckCircle2, ClipboardList, Eye, EyeOff, LocateFixed, Lock, Mail, MapPin, Phone, ShieldCheck, Stethoscope, User } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { registerHospital } from "../api";
import { useAdmin } from "../store/AdminStore";
import { Button } from "../components/common/ui";
import { AuthFooter, AuthNavbar } from "../components/auth/AuthChrome";

function apiError(e: unknown, fallback: string): { message: string; conflict: boolean } {
  if (typeof e === "object" && e !== null && "response" in e) {
    const r = (e as { response?: { data?: { detail?: unknown }; status?: number } }).response;
    if (r?.status === 409) {
      return { message: "An account with this email already exists. Try signing in instead.", conflict: true };
    }
    if (r?.data?.detail) {
      const d = r.data.detail;
      return { message: typeof d === "string" ? d : "Registration failed. Check the form and try again.", conflict: false };
    }
  }
  if (e instanceof Error && e.message) return { message: e.message, conflict: false };
  return { message: fallback, conflict: false };
}

const inputCls = "input-base !min-h-[50px] mt-1.5";
const labelCls = "block text-[0.85rem] font-semibold text-ink";

/**
 * Hospital registration — landing-matched onboarding layout.
 * API contract preserved: POST /hospitals (HospitalCreateIn) →
 * login() → navigate /setup. No new fields, no new endpoints.
 */
export default function RegisterPage() {
  const { login } = useAdmin();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [city, setCity] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [locating, setLocating] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const passwordsMatch = confirmPassword === "" || adminPassword === confirmPassword;
  const pwLen = adminPassword.length;
  const pwStrength = pwLen === 0 ? null : pwLen < 8 ? "Too short" : pwLen < 12 ? "Good" : "Strong";

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setError("Geolocation is not available in this browser — enter coordinates manually.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(String(pos.coords.latitude.toFixed(6)));
        setLongitude(String(pos.coords.longitude.toFixed(6)));
        setLocating(false);
      },
      () => {
        setError("Could not read your location. Check browser permission or enter coordinates manually.");
        setLocating(false);
      },
      { timeout: 10000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      if (!passwordsMatch) throw new Error("Passwords do not match. Please re-enter them.");
      const lat = latitude.trim() === "" ? null : Number(latitude);
      const lng = longitude.trim() === "" ? null : Number(longitude);
      if ((lat === null) !== (lng === null)) throw new Error("Latitude and longitude must be provided together.");
      if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) throw new Error("Latitude must be between -90 and 90.");
      if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) throw new Error("Longitude must be between -180 and 180.");
      await registerHospital({
        name: name.trim(),
        address: address.trim(),
        contact_email: contactEmail.trim(),
        contact_phone: contactPhone.trim(),
        city: city.trim() === "" ? null : city.trim(),
        latitude: lat,
        longitude: lng,
        admin_email: adminEmail.trim(),
        admin_password: adminPassword,
      });
      // Registration creates the admin login: sign straight in.
      await login(adminEmail.trim(), adminPassword);
      navigate("/setup");
    } catch (err) {
      const mapped = apiError(err, "Registration failed. Check the form and try again.");
      if (/unreachable|network|fetch|load failed/i.test(mapped.message)) {
        setError("We couldn't connect to CareFlow AI. Please check your connection and try again.");
      } else {
        setError(mapped.message);
      }
      setConflict(mapped.conflict);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased flex flex-col">
      <AuthNavbar />

      <main className="flex-1">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-10 lg:py-14 animate-[fadeIn_200ms_ease]">
          <div className="max-w-[68ch]">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-teal-dark">Hospital Onboarding</p>
            <h1 className="text-[1.9rem] sm:text-[2.4rem] font-bold text-navy tracking-tight leading-[1.12] mt-3">
              Set up your hospital on CareFlow AI.
            </h1>
            <p className="text-ink-secondary text-[1rem] leading-relaxed mt-4">
              Create your administrator account and begin configuring your hospital workspace.
            </p>
            <ol className="flex flex-wrap gap-2 mt-6" aria-label="Your progress">
              {[
                ["1 — Hospital information", true],
                ["2 — Administrator", true],
                ["3 — Setup", false],
              ].map(([step, current]) => (
                <li
                  key={step as string}
                  className={`text-[0.78rem] font-semibold rounded-full px-3.5 py-2 border transition-colors duration-200 ${current ? "bg-navy text-white border-navy" : "bg-white text-ink-secondary border-border"}`}
                >
                  {step as string}
                </li>
              ))}
            </ol>
          </div>

          <div className="grid lg:grid-cols-[1fr_320px] gap-5 mt-8 items-start">
            <form onSubmit={(e) => void submit(e)} className="space-y-5 min-w-0">
              <section className="bg-white border border-border rounded-2xl p-5 sm:p-7" aria-labelledby="hosp-heading">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-healthcare-soft text-healthcare flex items-center justify-center shrink-0">
                    <Building2 size={19} />
                  </span>
                  <div>
                    <h2 id="hosp-heading" className="text-[1.02rem] font-bold text-navy">Hospital information</h2>
                    <p className="text-[0.82rem] text-ink-secondary">Your hospital&apos;s identity and contact details.</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4 mt-5">
                  <label className={`${labelCls} sm:col-span-2`}>
                    Hospital name <span className="text-danger" aria-hidden>*</span>
                    <span className="relative block">
                      <Building2 size={15} className="absolute left-3.5 top-[22px] text-ink-faint pointer-events-none" />
                      <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} pl-10`} placeholder="St. Mary's General Hospital" autoComplete="organization" required />
                    </span>
                  </label>
                  <label className={`${labelCls} sm:col-span-2`}>
                    Address <span className="text-danger" aria-hidden>*</span>
                    <span className="relative block">
                      <MapPin size={15} className="absolute left-3.5 top-[22px] text-ink-faint pointer-events-none" />
                      <input value={address} onChange={(e) => setAddress(e.target.value)} className={`${inputCls} pl-10`} placeholder="12 Richmond Road" autoComplete="street-address" required />
                    </span>
                  </label>
                  <label className={labelCls}>
                    Contact email <span className="text-danger" aria-hidden>*</span>
                    <span className="relative block">
                      <Mail size={15} className="absolute left-3.5 top-[22px] text-ink-faint pointer-events-none" />
                      <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={`${inputCls} pl-10`} placeholder="ops@hospital.com" autoComplete="email" required aria-invalid={conflict || undefined} />
                    </span>
                  </label>
                  <label className={labelCls}>
                    Contact phone <span className="text-danger" aria-hidden>*</span>
                    <span className="relative block">
                      <Phone size={15} className="absolute left-3.5 top-[22px] text-ink-faint pointer-events-none" />
                      <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={`${inputCls} pl-10`} placeholder="+91 80 4111 2222" autoComplete="tel" required />
                    </span>
                  </label>
                </div>
              </section>

              <section className="bg-white border border-border rounded-2xl p-5 sm:p-7" aria-labelledby="loc-heading">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-teal-soft text-teal-dark flex items-center justify-center shrink-0">
                    <MapPin size={19} />
                  </span>
                  <div>
                    <h2 id="loc-heading" className="text-[1.02rem] font-bold text-navy">Location</h2>
                    <p className="text-[0.82rem] text-ink-secondary">Powers distance-based “near me” recommendations. Optional, but coordinates come in pairs.</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-3 gap-4 mt-5">
                  <label className={labelCls}>
                    City
                    <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} placeholder="e.g. Bengaluru" autoComplete="address-level2" />
                  </label>
                  <label className={labelCls}>
                    Latitude
                    <input value={latitude} onChange={(e) => setLatitude(e.target.value)} className={inputCls} placeholder="12.9716" inputMode="decimal" autoComplete="off" />
                  </label>
                  <label className={labelCls}>
                    Longitude
                    <input value={longitude} onChange={(e) => setLongitude(e.target.value)} className={inputCls} placeholder="77.5946" inputMode="decimal" autoComplete="off" />
                  </label>
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-3.5" onClick={useMyLocation} disabled={locating}>
                  <LocateFixed size={14} /> {locating ? "Reading location…" : "Use my location"}
                </Button>
              </section>

              <section className="bg-white border border-border rounded-2xl p-5 sm:p-7" aria-labelledby="admin-heading">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-healthcare-soft text-healthcare flex items-center justify-center shrink-0">
                    <User size={19} />
                  </span>
                  <div>
                    <h2 id="admin-heading" className="text-[1.02rem] font-bold text-navy">Administrator account</h2>
                    <p className="text-[0.82rem] text-ink-secondary">Your sign-in for the hospital workspace.</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4 mt-5">
                  <label className={`${labelCls} sm:col-span-2`}>
                    Admin email <span className="text-danger" aria-hidden>*</span>
                    <span className="relative block">
                      <Mail size={15} className="absolute left-3.5 top-[22px] text-ink-faint pointer-events-none" />
                      <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className={`${inputCls} pl-10`} placeholder="admin@hospital.com" autoComplete="email" required aria-invalid={conflict || undefined} aria-describedby={conflict ? "register-error" : undefined} />
                    </span>
                  </label>
                  <div>
                    <label htmlFor="admin-password" className={labelCls}>
                      Password <span className="text-danger" aria-hidden>*</span>
                    </label>
                    <span className="relative block">
                      <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                      <input id="admin-password" type={showPw ? "text" : "password"} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className={`${inputCls} pl-10 pr-12`} placeholder="Minimum 8 characters" autoComplete="new-password" required minLength={8} aria-describedby="pw-help" />
                      <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={showPw} className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg hover:bg-background flex items-center justify-center text-ink-secondary transition-colors duration-200">
                        {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                    <p id="pw-help" className="text-[0.76rem] text-ink-secondary mt-1.5">
                      Password must contain at least 8 characters.
                      {pwStrength && <span className="font-semibold text-navy"> · {pwStrength}</span>}
                    </p>
                  </div>
                  <div>
                    <label htmlFor="confirm-password" className={labelCls}>
                      Confirm password <span className="text-danger" aria-hidden>*</span>
                    </label>
                    <span className="relative block">
                      <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                      <input id="confirm-password" type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={`${inputCls} pl-10 pr-12`} placeholder="Repeat your password" autoComplete="new-password" required aria-invalid={!passwordsMatch || undefined} aria-describedby={!passwordsMatch ? "pw-mismatch" : undefined} />
                      <button type="button" onClick={() => setShowConfirm((v) => !v)} aria-label={showConfirm ? "Hide password" : "Show password"} aria-pressed={showConfirm} className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg hover:bg-background flex items-center justify-center text-ink-secondary transition-colors duration-200">
                        {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                    {!passwordsMatch && (
                      <p id="pw-mismatch" role="alert" className="text-[0.78rem] font-medium text-danger mt-1.5">Passwords do not match.</p>
                    )}
                  </div>
                </div>
              </section>

              {error && (
                <p id="register-error" role="alert" className="flex items-start gap-2 text-[0.85rem] font-medium text-danger bg-danger-soft border border-danger/20 rounded-control px-3.5 py-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0 mt-[7px]" aria-hidden />
                  <span>{error} {conflict && <Link to="/login" className="font-bold underline">Sign in</Link>}</span>
                </p>
              )}

              <Button type="submit" size="lg" className="w-full !min-h-[50px] !rounded-[11px]" disabled={busy || !passwordsMatch}>
                {busy ? "Creating account…" : "Create Hospital Account"}
              </Button>
              <p className="text-center text-[0.875rem] text-ink-secondary">
                Already registered? <Link to="/login" className="font-semibold text-healthcare hover:underline">Sign in</Link>
              </p>
            </form>

            <aside className="lg:sticky lg:top-24 space-y-4 min-w-0">
              <div className="bg-white border border-border rounded-2xl p-5">
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-teal-dark">What happens next</p>
                <ol className="mt-3 space-y-0">
                  {[
                    [ClipboardList, "Submit details", "Your hospital enters review as submitted."],
                    [Stethoscope, "Configure workspace", "Add departments, doctors, and visit types in Setup."],
                    [CheckCircle2, "Start managing care", "Publish availability and run daily operations."],
                  ].map(([Icon, title, body], i, arr) => {
                    const I = Icon as typeof Building2;
                    return (
                      <li key={title as string} className="flex gap-3 pb-4 last:pb-0 relative">
                        {i < arr.length - 1 && <span className="absolute left-[19px] top-11 bottom-0 w-px bg-border" aria-hidden />}
                        <span className="w-10 h-10 rounded-xl bg-healthcare-soft text-healthcare flex items-center justify-center shrink-0">
                          <I size={18} />
                        </span>
                        <span>
                          <span className="block font-bold text-navy text-[0.88rem]">{title as string}</span>
                          <span className="block text-ink-secondary text-[0.8rem] mt-0.5">{body as string}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div className="flex items-start gap-2.5 bg-white border border-border rounded-2xl px-4 py-3.5 text-[0.82rem]">
                <ShieldCheck size={15} className="shrink-0 mt-0.5 text-teal-dark" />
                <p className="text-ink-secondary">
                  <span className="font-bold text-navy">Reviewed before going live.</span> The platform
                  team approves each hospital before bookings open.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <AuthFooter />
    </div>
  );
}
