import { useEffect, useState } from "react";
import { Button, StatusBadge } from "../../components/common/ui";
import { useAdmin } from "../../store/AdminStore";

export default function HospitalSetupPage() {
  const { hospital, live, loading, backendError, updateHospital } = useAdmin();
  const [name, setName] = useState(hospital?.name ?? "");
  const [address, setAddress] = useState(hospital?.address ?? "");
  const [contactEmail, setContactEmail] = useState(hospital?.contact_email ?? "");
  const [contactPhone, setContactPhone] = useState(hospital?.contact_phone ?? "");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hospital) {
      setName(hospital.name);
      setAddress(hospital.address);
      setContactEmail(hospital.contact_email);
      setContactPhone(hospital.contact_phone);
    }
  }, [hospital]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!live) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateHospital({ name, address, contact_email: contactEmail, contact_phone: contactPhone });
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch {
      setError(backendError ?? "Could not save hospital profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Hospital Setup</h1>
          <p className="page-sub mt-1">{live ? "Profile syncs with your hospital record." : "Configuration is stored locally in this demo."}</p>
        </div>
        <StatusBadge status={(hospital?.status ?? "approved") as string} />
      </div>

      {live && loading && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">Syncing…</p>
      )}
      {(error ?? backendError) && live && (
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
          {live && hospital && (
            <p className="text-[0.78rem] text-ink-secondary mt-3">Status: <strong className="text-ink capitalize">{hospital.status.replace("_", " ")}</strong> — lifecycle changes go through platform review.</p>
          )}
        </section>
        <Button type="submit" disabled={saving} className="w-full sm:w-auto sm:min-w-[220px]">{saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}</Button>
      </form>
    </div>
  );
}
