import { useEffect, useState } from "react";
import { LocateFixed } from "lucide-react";
import { Button, StatusBadge } from "../../components/common/ui";
import { useAdmin } from "../../store/AdminStore";

export default function HospitalSetupPage() {
  const { hospital, loading, backendError, updateHospital, resubmitHospital } = useAdmin();
  const [name, setName] = useState(hospital?.name ?? "");
  const [address, setAddress] = useState(hospital?.address ?? "");
  const [contactEmail, setContactEmail] = useState(hospital?.contact_email ?? "");
  const [contactPhone, setContactPhone] = useState(hospital?.contact_phone ?? "");
  const [city, setCity] = useState(hospital?.city ?? "");
  const [latitude, setLatitude] = useState(hospital?.latitude != null ? String(hospital.latitude) : "");
  const [longitude, setLongitude] = useState(hospital?.longitude != null ? String(hospital.longitude) : "");
  const [locating, setLocating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  const DAYS: { key: DayKey; label: string }[] = [
    { key: "mon", label: "Monday" },
    { key: "tue", label: "Tuesday" },
    { key: "wed", label: "Wednesday" },
    { key: "thu", label: "Thursday" },
    { key: "fri", label: "Friday" },
    { key: "sat", label: "Saturday" },
    { key: "sun", label: "Sunday" },
  ];
  const [hours, setHours] = useState<Record<DayKey, { open: string; close: string } | null>>({
    mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
  });

  function hoursFromBackend(raw: Record<string, [string, string]> | null | undefined) {
    const next: Record<DayKey, { open: string; close: string } | null> = {
      mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
    };
    if (raw) {
      for (const d of DAYS) {
        const span = (raw as Record<string, unknown>)[d.key];
        if (Array.isArray(span) && span.length === 2 && typeof span[0] === "string" && typeof span[1] === "string") {
          next[d.key] = { open: span[0], close: span[1] };
        }
      }
    }
    return next;
  }

  useEffect(() => {
    if (hospital) {
      setName(hospital.name);
      setAddress(hospital.address);
      setContactEmail(hospital.contact_email);
      setContactPhone(hospital.contact_phone);
      setCity(hospital.city ?? "");
      setLatitude(hospital.latitude != null ? String(hospital.latitude) : "");
      setLongitude(hospital.longitude != null ? String(hospital.longitude) : "");
      setHours(hoursFromBackend(hospital.operating_hours));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospital]);

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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const lat = latitude.trim() === "" ? null : Number(latitude);
      const lng = longitude.trim() === "" ? null : Number(longitude);
      if ((lat === null) !== (lng === null)) throw new Error("Latitude and longitude must be provided together.");
      if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) throw new Error("Latitude must be between -90 and 90.");
      if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) throw new Error("Longitude must be between -180 and 180.");
      const opHours: Record<string, [string, string]> = {};
      for (const d of DAYS) {
        const h = hours[d.key];
        if (!h) continue;
        if (!/^[0-2]\d:[0-5]\d$/.test(h.open) || !/^[0-2]\d:[0-5]\d$/.test(h.close)) {
          throw new Error(`${d.label}: use HH:MM for open and close.`);
        }
        if (h.open >= h.close) throw new Error(`${d.label}: open must be before close.`);
        opHours[d.key] = [h.open, h.close];
      }
      await updateHospital({
        name,
        address,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        city: city.trim() === "" ? null : city.trim(),
        latitude: lat,
        longitude: lng,
        operating_hours: opHours,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Could not save hospital profile."));
    } finally {
      setSaving(false);
    }
  }

  async function resubmit() {
    setResubmitting(true);
    setError(null);
    try {
      await resubmitHospital();
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Could not resubmit."));
    } finally {
      setResubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Hospital Setup</h1>
          <p className="page-sub mt-1">Profile syncs with your hospital record.</p>
        </div>
        <StatusBadge status={(hospital?.status ?? "approved") as string} />
      </div>

      {loading && !hospital && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">Loading hospital profile…</p>
      )}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      {hospital?.status === "draft" && (
        <div className="card-base p-5 border-warning/30">
          <h2 className="section-title">Back to draft — corrections requested</h2>
          {hospital.review_notes && (
            <p className="text-[0.83rem] text-ink mt-2 bg-background border border-border rounded-control px-3 py-2.5">{hospital.review_notes}</p>
          )}
          <p className="text-[0.8rem] text-ink-secondary mt-2">Fix the items above, save your changes, then resubmit for platform review.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void resubmit()} disabled={resubmitting}>
            {resubmitting ? "Resubmitting…" : "Resubmit for review"}
          </Button>
        </div>
      )}

      <form onSubmit={(e) => void save(e)} className="space-y-4">
        <section className="card-base p-5">
          <h2 className="section-title">General information</h2>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <label className="block text-[0.82rem] font-bold sm:col-span-2">Hospital name<input value={name} onChange={(e) => setName(e.target.value)} className="input-base mt-1" required /></label>
            <label className="block text-[0.82rem] font-bold sm:col-span-2">Address<input value={address} onChange={(e) => setAddress(e.target.value)} className="input-base mt-1" required /></label>
            <label className="block text-[0.82rem] font-bold">Contact email<input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="input-base mt-1" required /></label>
            <label className="block text-[0.82rem] font-bold">Contact phone<input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="input-base mt-1" required /></label>
          </div>
          {hospital && (
            <p className="text-[0.78rem] text-ink-secondary mt-3">Status: <strong className="text-ink capitalize">{hospital.status.replace("_", " ")}</strong> — lifecycle changes go through platform review.</p>
          )}
        </section>
        <section className="card-base p-5">
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
        <section className="card-base p-5">
          <h2 className="section-title">Operating hours</h2>
          <p className="text-[0.8rem] text-ink-secondary mt-1">Hospital-level hours, shown across the console. Unticked days are closed.</p>
          <div className="mt-3 space-y-2">
            {DAYS.map((d) => {
              const h = hours[d.key];
              return (
                <div key={d.key} className="flex items-center gap-2">
                  <label className="flex items-center gap-2 w-32 text-[0.82rem] font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={h !== null}
                      onChange={(e) => setHours((prev) => ({ ...prev, [d.key]: e.target.checked ? { open: "09:00", close: "18:00" } : null }))}
                      className="w-4 h-4 accent-[#1769AA]"
                    />
                    {d.label}
                  </label>
                  {h ? (
                    <>
                      <input type="time" value={h.open} onChange={(e) => setHours((prev) => ({ ...prev, [d.key]: { open: e.target.value, close: prev[d.key]?.close ?? "18:00" } }))} className="input-base" aria-label={`${d.label} opens`} />
                      <span className="text-ink-faint text-sm">–</span>
                      <input type="time" value={h.close} onChange={(e) => setHours((prev) => ({ ...prev, [d.key]: { open: prev[d.key]?.open ?? "09:00", close: e.target.value } }))} className="input-base" aria-label={`${d.label} closes`} />
                    </>
                  ) : (
                    <span className="text-[0.8rem] text-ink-faint">Closed</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <Button type="submit" disabled={saving} className="w-full sm:w-auto sm:min-w-[220px]">{saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}</Button>
      </form>
    </div>
  );
}
