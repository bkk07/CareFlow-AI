import { useEffect, useState } from "react";
import { LocateFixed } from "lucide-react";
import { Button, StatusBadge } from "../../components/common/ui";
import { useAdmin } from "../../store/AdminStore";

export default function HospitalSetupPage() {
  const { hospital, loading, backendError, updateHospital } = useAdmin();
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hospital) {
      setName(hospital.name);
      setAddress(hospital.address);
      setContactEmail(hospital.contact_email);
      setContactPhone(hospital.contact_phone);
      setCity(hospital.city ?? "");
      setLatitude(hospital.latitude != null ? String(hospital.latitude) : "");
      setLongitude(hospital.longitude != null ? String(hospital.longitude) : "");
    }
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
      await updateHospital({
        name,
        address,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        city: city.trim() === "" ? null : city.trim(),
        latitude: lat,
        longitude: lng,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Could not save hospital profile."));
    } finally {
      setSaving(false);
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
        <Button type="submit" disabled={saving} className="w-full sm:w-auto sm:min-w-[220px]">{saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}</Button>
      </form>
    </div>
  );
}
