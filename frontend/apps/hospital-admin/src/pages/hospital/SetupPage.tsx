import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, CheckCircle2, Circle, Clock, LocateFixed, MapPin } from "lucide-react";
import { Button, StatusBadge } from "../../components/common/ui";
import { SectionHeader } from "../../components/common/ops";
import { useAdmin } from "../../store/AdminStore";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const DAYS: { key: DayKey; label: string; short: string }[] = [
  { key: "mon", label: "Monday", short: "Mon" },
  { key: "tue", label: "Tuesday", short: "Tue" },
  { key: "wed", label: "Wednesday", short: "Wed" },
  { key: "thu", label: "Thursday", short: "Thu" },
  { key: "fri", label: "Friday", short: "Fri" },
  { key: "sat", label: "Saturday", short: "Sat" },
  { key: "sun", label: "Sunday", short: "Sun" },
];

type Hours = Record<DayKey, { open: string; close: string } | null>;

function emptyHours(): Hours {
  return { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
}

function hoursFromBackend(raw: Record<string, [string, string]> | null | undefined): Hours {
  const next = emptyHours();
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

const labelCls = "block text-[0.85rem] font-semibold text-ink";
const inputCls = "input-base !min-h-[48px] mt-1.5";

export default function HospitalSetupPage() {
  const {
    hospital, loading, backendError, updateHospital, resubmitHospital,
    departments, specialties, types, doctors,
  } = useAdmin();

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
  const [hours, setHours] = useState<Hours>(emptyHours());

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

  /* ---------------- live completeness (all real store data) ---------------- */
  const checks = useMemo(() => {
    const profile = [name, address, contactEmail, contactPhone].every((v) => v.trim() !== "");
    const location = city.trim() !== "" || (latitude.trim() !== "" && longitude.trim() !== "");
    const hoursSet = DAYS.some((d) => hours[d.key] !== null);
    const activeDocs = doctors.filter((d) => d.status === "active").length;
    return [
      { key: "profile", label: "Hospital profile", desc: "Name, address, contact", done: profile, to: null as string | null },
      { key: "location", label: "Location", desc: city.trim() !== "" ? city.trim() : latitude.trim() !== "" ? `${latitude}, ${longitude}` : "City or coordinates", done: location, to: null },
      { key: "hours", label: "Operating hours", desc: `${DAYS.filter((d) => hours[d.key]).length} of 7 days open`, done: hoursSet, to: null },
      { key: "depts", label: "Departments", desc: `${departments.length} configured`, done: departments.length > 0, to: "/catalog/departments" },
      { key: "specs", label: "Specialties", desc: `${specialties.length} configured`, done: specialties.length > 0, to: "/catalog/specialties" },
      { key: "types", label: "Appointment types", desc: `${types.length} configured`, done: types.length > 0, to: "/catalog/types" },
      { key: "docs", label: "Doctors", desc: `${activeDocs} active of ${doctors.length}`, done: activeDocs > 0, to: "/doctors" },
      { key: "review", label: "Platform approval", desc: (hospital?.status ?? "draft").replace("_", " "), done: hospital?.status === "approved", to: null },
    ];
  }, [name, address, contactEmail, contactPhone, city, latitude, longitude, hours, departments, specialties, types, doctors, hospital]);
  const doneCount = checks.filter((c) => c.done).length;

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

  function applyPreset(which: "weekdays" | "all" | "clear") {
    setHours((prev) => {
      const next = { ...prev };
      for (const d of DAYS) {
        if (which === "clear") next[d.key] = null;
        else if (which === "all") next[d.key] = { open: "09:00", close: "18:00" };
        else next[d.key] = ["sat", "sun"].includes(d.key) ? null : { open: "09:00", close: "18:00" };
      }
      return next;
    });
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

  const formError = error ?? backendError;
  const openDays = DAYS.filter((d) => hours[d.key] !== null).length;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="page-title">Hospital Setup</h1>
          <p className="page-sub mt-1">Profile, location, and hours sync with your hospital record.</p>
        </div>
        <StatusBadge status={(hospital?.status ?? "approved") as string} />
      </div>

      {loading && !hospital && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">Loading hospital profile…</p>
      )}

      {hospital?.status === "draft" && (
        <div className="card-base p-5 border-warning/40" role="status">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-warning-soft text-warning flex items-center justify-center shrink-0">
              <Clock size={17} />
            </span>
            <div>
              <h2 className="font-bold text-navy text-[0.95rem]">Back to draft — corrections requested</h2>
              <p className="text-[0.8rem] text-ink-secondary">Fix the items, save your changes, then resubmit for platform review.</p>
            </div>
          </div>
          {hospital.review_notes && (
            <p className="text-[0.83rem] text-ink mt-3 bg-background border border-border rounded-control px-3 py-2.5">{hospital.review_notes}</p>
          )}
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void resubmit()} disabled={resubmitting}>
            {resubmitting ? "Resubmitting…" : "Resubmit for review"}
          </Button>
        </div>
      )}

      <div className="grid xl:grid-cols-[1fr_300px] gap-4 items-start">
        <form onSubmit={(e) => void save(e)} className="space-y-4 min-w-0">
          {/* 01 · general */}
          <section className="card-base p-5 sm:p-6" aria-labelledby="setup-general">
            <div className="flex items-center gap-3">
              <span className="text-[0.7rem] font-extrabold text-healthcare bg-healthcare-soft rounded-lg px-2 py-1">01</span>
              <div className="flex items-center gap-2.5">
                <Building2 size={17} className="text-healthcare" />
                <h2 id="setup-general" className="section-title">General information</h2>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <label className={`${labelCls} sm:col-span-2`}>
                Hospital name <span className="text-danger" aria-hidden>*</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoComplete="organization" required />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>
                Address <span className="text-danger" aria-hidden>*</span>
                <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} autoComplete="street-address" required />
              </label>
              <label className={labelCls}>
                Contact email <span className="text-danger" aria-hidden>*</span>
                <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputCls} autoComplete="email" required />
              </label>
              <label className={labelCls}>
                Contact phone <span className="text-danger" aria-hidden>*</span>
                <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputCls} autoComplete="tel" required />
              </label>
            </div>
            {hospital && (
              <p className="text-[0.78rem] text-ink-secondary mt-4 pt-3 border-t border-border/70">
                Lifecycle status: <strong className="text-ink capitalize">{hospital.status.replace("_", " ")}</strong> — changes go through platform review.
              </p>
            )}
          </section>

          {/* 02 · location */}
          <section className="card-base p-5 sm:p-6" aria-labelledby="setup-location">
            <div className="flex items-center gap-3">
              <span className="text-[0.7rem] font-extrabold text-healthcare bg-healthcare-soft rounded-lg px-2 py-1">02</span>
              <div className="flex items-center gap-2.5">
                <MapPin size={17} className="text-healthcare" />
                <h2 id="setup-location" className="section-title">Location</h2>
              </div>
            </div>
            <p className="text-[0.82rem] text-ink-secondary mt-2">Coordinates power distance-based “near me” recommendations for patients.</p>
            <div className="grid sm:grid-cols-3 gap-4 mt-4">
              <label className={labelCls}>City
                <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} placeholder="e.g. Bengaluru" autoComplete="address-level2" />
              </label>
              <label className={labelCls}>Latitude
                <input value={latitude} onChange={(e) => setLatitude(e.target.value)} className={inputCls} placeholder="e.g. 12.9716" inputMode="decimal" autoComplete="off" />
              </label>
              <label className={labelCls}>Longitude
                <input value={longitude} onChange={(e) => setLongitude(e.target.value)} className={inputCls} placeholder="e.g. 77.5946" inputMode="decimal" autoComplete="off" />
              </label>
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={useMyLocation} disabled={locating}>
              <LocateFixed size={14} /> {locating ? "Reading location…" : "Use my location"}
            </Button>
          </section>

          {/* 03 · hours */}
          <section className="card-base p-5 sm:p-6" aria-labelledby="setup-hours">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="text-[0.7rem] font-extrabold text-healthcare bg-healthcare-soft rounded-lg px-2 py-1">03</span>
                <div className="flex items-center gap-2.5">
                  <Clock size={17} className="text-healthcare" />
                  <h2 id="setup-hours" className="section-title">Operating hours</h2>
                </div>
              </div>
              <span className="text-[0.74rem] font-bold text-ink-secondary tabular-nums">{openDays} of 7 open</span>
            </div>
            <p className="text-[0.82rem] text-ink-secondary mt-2">Hospital-level hours, shown across the console. Closed days stay unticked.</p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {([["weekdays", "Weekdays 9–6"], ["all", "Open all week"], ["clear", "Clear all"]] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPreset(id)}
                  className="text-[0.76rem] font-bold text-ink-secondary hover:text-healthcare border border-border hover:border-healthcare rounded-full px-3 py-1.5 transition-colors duration-150"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 border border-border rounded-xl overflow-hidden">
              {DAYS.map((d, i) => {
                const h = hours[d.key];
                return (
                  <div key={d.key} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${i > 0 ? "border-t border-border/70" : ""} ${h ? "bg-white" : "bg-background/60"}`}>
                    <label className="flex items-center gap-2.5 w-32 shrink-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={h !== null}
                        onChange={(e) => setHours((prev) => ({ ...prev, [d.key]: e.target.checked ? { open: "09:00", close: "18:00" } : null }))}
                        className="w-4 h-4 accent-[#1769AA]"
                        aria-label={`${d.label} open`}
                      />
                      <span className={`text-[0.83rem] font-bold ${h ? "text-ink" : "text-ink-faint"}`}>{d.short}</span>
                    </label>
                    {h ? (
                      <span className="flex items-center gap-2 flex-1">
                        <input type="time" value={h.open} onChange={(e) => setHours((prev) => ({ ...prev, [d.key]: { open: e.target.value, close: prev[d.key]?.close ?? "18:00" } }))} className="input-base !min-h-[2.4rem] tabular-nums" aria-label={`${d.label} opens`} />
                        <span className="text-ink-faint text-sm shrink-0">–</span>
                        <input type="time" value={h.close} onChange={(e) => setHours((prev) => ({ ...prev, [d.key]: { open: prev[d.key]?.open ?? "09:00", close: e.target.value } }))} className="input-base !min-h-[2.4rem] tabular-nums" aria-label={`${d.label} closes`} />
                      </span>
                    ) : (
                      <span className="text-[0.78rem] text-ink-faint">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* sticky action bar */}
          <div className="sticky bottom-[76px] md:bottom-4 z-10">
            <div className="card-base px-4 py-3 flex items-center gap-3 shadow-card">
              <p className="text-[0.78rem] text-ink-secondary min-w-0 flex-1 truncate" role="status">
                {saved ? <span className="font-bold text-success">Saved ✓ — hospital record updated.</span>
                  : formError ? <span className="font-semibold text-danger">{formError}</span>
                  : "Changes save directly to your hospital record."}
              </p>
              <Button type="submit" disabled={saving} className="shrink-0 sm:min-w-[180px]">
                {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
              </Button>
            </div>
          </div>
          {formError && (
            <p role="alert" className="sr-only">{formError}</p>
          )}
        </form>

        {/* progress rail */}
        <aside className="xl:sticky xl:top-[76px] space-y-4 min-w-0" aria-label="Setup progress">
          <div className="card-base p-5">
            <SectionHeader title="Setup completeness" sub={`${doneCount} of ${checks.length} ready`} />
            <div className="h-2 bg-background border border-border/60 rounded-full mt-3 overflow-hidden" role="img" aria-label={`${doneCount} of ${checks.length} setup steps complete`}>
              <div className="h-full bg-gradient-to-r from-healthcare to-teal rounded-full transition-all duration-200" style={{ width: `${Math.round((doneCount / checks.length) * 100)}%` }} />
            </div>
            <ul className="mt-4 space-y-1">
              {checks.map((c) => (
                <li key={c.key}>
                  {c.to ? (
                    <Link to={c.to} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-background transition-colors duration-150 text-left group">
                      {c.done
                        ? <CheckCircle2 size={16} className="text-success shrink-0" />
                        : <Circle size={16} className="text-ink-faint shrink-0" />}
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-[0.82rem] text-ink">{c.label}</span>
                        <span className="block text-[0.72rem] text-ink-secondary truncate">{c.desc}</span>
                      </span>
                      <ArrowRight size={13} className="text-ink-faint group-hover:text-healthcare shrink-0" />
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2.5 px-2 py-2">
                      {c.done
                        ? <CheckCircle2 size={16} className="text-success shrink-0" />
                        : <Circle size={16} className="text-ink-faint shrink-0" />}
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-[0.82rem] text-ink">{c.label}</span>
                        <span className="block text-[0.72rem] text-ink-secondary truncate">{c.desc}</span>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="card-base p-5">
            <SectionHeader title="After setup" sub="Where each step lives" />
            <ul className="mt-3 space-y-2 text-[0.8rem]">
              {[
                ["Catalog", "Departments, specialties, visit types", "/catalog/departments"],
                ["Doctors", "Invite, activate, manage availability", "/doctors"],
                ["Operations", "Recovery queues and escalations", "/ops"],
              ].map(([t, d, to]) => (
                <li key={t as string}>
                  <Link to={to as string} className="flex items-center gap-2 font-bold text-ink hover:text-healthcare transition-colors duration-150">
                    {t as string} <ArrowRight size={13} className="text-ink-faint" />
                  </Link>
                  <p className="text-ink-secondary text-[0.76rem] ml-0 mt-0.5">{d as string}</p>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
