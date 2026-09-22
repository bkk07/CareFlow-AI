import { useState } from "react";
import { motion } from "framer-motion";
import { Building2, LocateFixed, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { registerHospital } from "../api";
import { useAdmin } from "../store/AdminStore";
import { Button } from "../components/common/ui";

function apiError(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "response" in e) {
    const r = (e as { response?: { data?: { detail?: unknown }; status?: number } }).response;
    if (r?.status === 409) return "This hospital or admin email is already registered. Try signing in instead.";
    if (r?.data?.detail) {
      const d = r.data.detail;
      return typeof d === "string" ? d : `Request failed: ${JSON.stringify(d)}`;
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
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
      setError(apiError(err, "Registration failed. Check the form and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="w-full max-w-3xl card-base overflow-hidden">
        <div className="bg-gradient-to-r from-navy to-healthcare-dark text-white p-6 sm:p-8">
          <p className="text-[0.72rem] font-bold uppercase tracking-widest text-white/70 flex items-center gap-1.5"><Building2 size={14} /> Hospital onboarding</p>
          <h1 className="text-[1.5rem] font-extrabold mt-2">Register your hospital</h1>
          <p className="text-white/85 text-sm mt-1">Submit for platform review. Once approved, your hospital goes live for patient bookings.</p>
        </div>
        <form onSubmit={(e) => void submit(e)} className="p-6 sm:p-8 space-y-5">
          <p><Link to="/" className="text-[0.78rem] font-bold text-ink-secondary hover:text-healthcare">← Back to home</Link></p>
          <section>
            <h2 className="section-title">Hospital details</h2>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <label className="block text-[0.82rem] font-bold sm:col-span-2">Hospital name<input value={name} onChange={(e) => setName(e.target.value)} className="input-base mt-1" required /></label>
              <label className="block text-[0.82rem] font-bold sm:col-span-2">Address<input value={address} onChange={(e) => setAddress(e.target.value)} className="input-base mt-1" required /></label>
              <label className="block text-[0.82rem] font-bold">Contact email<input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="input-base mt-1" required /></label>
              <label className="block text-[0.82rem] font-bold">Contact phone<input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="input-base mt-1" required /></label>
            </div>
          </section>
          <section>
            <h2 className="section-title">Location</h2>
            <p className="text-[0.8rem] text-ink-secondary mt-1">Coordinates power distance-based "near me" recommendations for patients.</p>
            <div className="grid sm:grid-cols-3 gap-3 mt-3">
              <label className="block text-[0.82rem] font-bold">City<input value={city} onChange={(e) => setCity(e.target.value)} className="input-base mt-1" placeholder="e.g. Bengaluru" /></label>
              <label className="block text-[0.82rem] font-bold">Latitude<input value={latitude} onChange={(e) => setLatitude(e.target.value)} className="input-base mt-1" placeholder="e.g. 12.9716" inputMode="decimal" /></label>
              <label className="block text-[0.82rem] font-bold">Longitude<input value={longitude} onChange={(e) => setLongitude(e.target.value)} className="input-base mt-1" placeholder="e.g. 77.5946" inputMode="decimal" /></label>
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={useMyLocation} disabled={locating}>
              <LocateFixed size={14} /> {locating ? "Reading location…" : "Use my location"}
            </Button>
          </section>
          <section>
            <h2 className="section-title">Administrator account</h2>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <label className="block text-[0.82rem] font-bold">Admin email<input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="input-base mt-1" required /></label>
              <label className="block text-[0.82rem] font-bold">Admin password (min 8 characters)<input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className="input-base mt-1" required minLength={8} /></label>
            </div>
          </section>
          {error && (
            <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error}</p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Submitting…" : "Submit for review"}</Button>
          <p className="text-center text-[0.83rem] text-ink-secondary">
            Already registered? <Link to="/login" className="font-bold text-healthcare hover:underline">Sign in</Link>
          </p>
          <p className="flex items-start gap-2 text-[0.77rem] text-ink-secondary bg-healthcare-faint border border-healthcare/20 rounded-control px-3 py-2.5">
            <ShieldCheck size={14} className="shrink-0 mt-0.5 text-healthcare" /> New hospitals start as submitted — the platform team reviews before you go live.
          </p>
        </form>
      </motion.div>
    </div>
  );
}
