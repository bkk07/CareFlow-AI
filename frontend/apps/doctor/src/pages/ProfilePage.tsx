import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Award, Building2, CheckCircle2, Clock, Edit3, Globe } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useSchedule } from "../context/ScheduleContext";
import { consultationModeLabel } from "../lib/helpers";
import { Avatar, Button, CardSkeleton, StatusBadge } from "../components/common/ui";
import { Modal } from "../components/common/Modal";
import type { ConsultationMode } from "../types";

export default function ProfilePage() {
  const { doctor, updateDoctor, mode, profile } = useAuth();
  const { live, accepting } = useSchedule();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(doctor.name);
  const [qualifications, setQualifications] = useState(doctor.qualifications);
  const [experience, setExperience] = useState(String(doctor.experienceYears));
  const [languages, setLanguages] = useState(doctor.languages.join(", "));
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync the edit form when the backend profile arrives.
  useEffect(() => {
    if (editing) return;
    setName(doctor.name);
    setQualifications(doctor.qualifications);
    setExperience(String(doctor.experienceYears));
    setLanguages(doctor.languages.join(", "));
  }, [doctor, editing]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await updateDoctor({
        name,
        qualifications,
        experienceYears: parseInt(experience, 10) || doctor.experienceYears,
        languages: languages.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch {
      setSaveError("Could not save changes. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleMode(m: ConsultationMode) {
    const has = doctor.consultationTypes.includes(m);
    try {
      await updateDoctor({
        consultationTypes: has
          ? doctor.consultationTypes.filter((x) => x !== m)
          : [...doctor.consultationTypes, m],
      });
    } catch {
      setSaveError("Could not save consultation types.");
      setTimeout(() => setSaveError(null), 2500);
    }
  }

  if (mode === "checking") {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={3} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="card-base p-6 text-center">
          <p className="font-bold text-ink">Profile unavailable</p>
          <p className="text-sm text-ink-secondary mt-1">Your backend profile could not be loaded yet. Sign in again or try later.</p>
        </div>
      </div>
    );
  }

  const acceptingShown = live ? accepting : doctor.acceptingAppointments;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <AnimatePresence>
        {saved && (
          <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-[0.85rem] font-bold text-success bg-success-soft border border-success/25 rounded-control px-3.5 py-2.5">
            <CheckCircle2 size={16} /> Profile saved to your hospital
          </motion.p>
        )}
      </AnimatePresence>
      {saveError && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3.5 py-2.5">{saveError}</p>
      )}
      {live && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">Live profile — specialty, department and status are managed by your hospital admin.</p>
      )}

      <div className="card-base p-6">
        <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
          <Avatar name={doctor.name} photo={doctor.photo} size="lg" />
          <div className="flex-1 min-w-0">
            <h1 className="text-[1.35rem] font-extrabold text-navy">{doctor.name || "Doctor"}</h1>
            {[doctor.specialty, doctor.department].filter(Boolean).length > 0 ? (
              <p className="text-sm font-semibold text-healthcare">{[doctor.specialty, doctor.department].filter(Boolean).join(" · ")}</p>
            ) : (
              <p className="text-[0.83rem] text-ink-secondary mt-0.5">Specialty and department are managed by your hospital admin.</p>
            )}
            {doctor.hospital && (
              <p className="text-[0.83rem] text-ink-secondary mt-0.5 flex items-center gap-1.5"><Building2 size={13} /> {doctor.hospital}</p>
            )}
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <StatusBadge status={doctor.status} />
              <span className={`text-[0.72rem] font-bold rounded-full px-2.5 py-1 ${acceptingShown ? "bg-success-soft text-success" : "bg-slate-100 text-ink-secondary"}`}>
                {acceptingShown ? "Accepting appointments" : "Not accepting appointments"}
              </span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Edit3 size={15} /> Edit profile</Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <section className="card-base p-5">
          <h2 className="section-title">Professional information</h2>
          <ul className="mt-3 space-y-2.5 text-sm">
            <li className="flex items-center gap-2"><Award size={15} className="text-teal shrink-0" /><span className="font-semibold">{doctor.qualifications || "—"}</span></li>
            <li className="flex items-center gap-2"><Clock size={15} className="text-teal shrink-0" /><span className="font-semibold">{doctor.experienceYears} years experience</span></li>
            <li className="flex items-center gap-2"><Globe size={15} className="text-teal shrink-0" /><span className="font-semibold">{doctor.languages.join(" · ") || "—"}</span></li>
          </ul>
        </section>
        <section className="card-base p-5">
          <h2 className="section-title">Practice setup</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-ink-secondary">Visit lengths</dt><dd className="font-bold">{doctor.appointmentDurations.length > 0 ? doctor.appointmentDurations.join(", ") + " min" : `${doctor.appointmentDuration} min`}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-secondary">Consultation</dt><dd className="font-bold text-right">{doctor.consultationTypes.map(consultationModeLabel).join(" · ") || "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-secondary">Status</dt><dd><StatusBadge status={doctor.status} /></dd></div>
          </dl>
        </section>
      </div>

      <section className="card-base p-5">
        <h2 className="section-title">Consultation types</h2>
        <div className="flex flex-wrap gap-2 mt-3">
          {(["in_person", "video", "phone"] as ConsultationMode[]).map((m) => {
            const on = doctor.consultationTypes.includes(m);
            return (
              <button key={m} onClick={() => void toggleMode(m)} aria-pressed={on} className={`text-[0.83rem] font-bold border rounded-full px-3.5 py-2 transition ${on ? "bg-navy text-white border-navy" : "bg-white border-border text-ink-secondary hover:border-healthcare"}`}>
                {consultationModeLabel(m)}
              </button>
            );
          })}
        </div>
      </section>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit profile">
        <div className="space-y-3">
          <label className="block text-[0.83rem] font-bold">Name<input value={name} onChange={(e) => setName(e.target.value)} className="input-base mt-1" /></label>
          <label className="block text-[0.83rem] font-bold">Qualifications<input value={qualifications} onChange={(e) => setQualifications(e.target.value)} className="input-base mt-1" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[0.83rem] font-bold">Experience (years)<input value={experience} onChange={(e) => setExperience(e.target.value)} inputMode="numeric" className="input-base mt-1" /></label>
            <label className="block text-[0.83rem] font-bold">Languages (comma separated)<input value={languages} onChange={(e) => setLanguages(e.target.value)} className="input-base mt-1" /></label>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => void save()} disabled={saving} className="flex-1">{saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
