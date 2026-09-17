import { useState } from "react";
import { CalendarDays, Edit3, LogOut, MapPin, Phone, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAppState } from "../context/AppStateContext";
import { Button, SafeImage } from "../components/common/ui";
import { Modal } from "../components/common/Modal";

export default function ProfilePage() {
  const { patient, contact, updateContactInfo, logout, live } = useLiveProfile();
  const { appointments } = useAppState();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(patient.name);
  const [phone, setPhone] = useState(patient.phone);
  const [address, setAddress] = useState(patient.address);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const completed = appointments.filter((a) => a.status === "completed").length;
  const upcomingCount = appointments.filter((a) => ["confirmed", "pending", "rescheduled"].includes(a.status)).length;

  function doLogout() {
    logout();
    navigate("/login");
  }

  async function saveEdits() {
    setSaving(true);
    setSaveError(null);
    try {
      if (live) {
        // Backend stores the verified identity (name/phone); address stays local.
        await updateContactInfo({ full_name: name, phone });
      }
      setEditing(false);
    } catch {
      setSaveError("Could not save changes. Check the phone format and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="card-base p-6">
        <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
          <SafeImage src={patient.avatar} alt={patient.name} name={patient.name} className="w-20 h-20 rounded-2xl border border-border" />
          <div className="flex-1 min-w-0">
            <h1 className="text-[1.35rem] font-extrabold text-navy">{name}</h1>
            <p className="text-sm text-ink-secondary">Patient since {patient.memberSince} · {patient.email}</p>
            {live && contact && (
              <p className="text-[0.75rem] text-ink-faint mt-0.5">Verified identity on file{contact.date_of_birth ? ` · DOB ${contact.date_of_birth}` : ""}</p>
            )}
            <div className="flex gap-2 mt-2 flex-wrap">
              <span className="text-[0.75rem] font-bold bg-healthcare-soft text-healthcare rounded-full px-2.5 py-1">{upcomingCount} upcoming</span>
              <span className="text-[0.75rem] font-bold bg-success-soft text-success rounded-full px-2.5 py-1">{completed} completed visits</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setName(patient.name); setPhone(patient.phone); setAddress(patient.address); setSaveError(null); setEditing(true); }}>
            <Edit3 size={15} /> Edit profile
          </Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <section className="card-base p-5">
          <h2 className="section-title">Personal information</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            {[
              ["Full name", name],
              ["Date of birth", patient.dob],
              ["Blood group", patient.bloodGroup],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink-secondary">{k}</dt>
                <dd className="font-bold text-ink text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="card-base p-5">
          <h2 className="section-title">Contact information</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-secondary flex items-center gap-1"><Phone size={13} /> Phone</dt>
              <dd className="font-bold text-ink text-right">{phone}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-secondary flex items-center gap-1"><MapPin size={13} /> Address</dt>
              <dd className="font-bold text-ink text-right max-w-[60%]">{address}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-secondary">Emergency</dt>
              <dd className="font-bold text-ink text-right max-w-[60%]">{patient.emergencyContact}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="card-base p-5">
        <h2 className="section-title flex items-center gap-1.5"><CalendarDays size={17} /> Appointment history</h2>
        <ul className="mt-3 divide-y divide-border">
          {appointments.slice(0, 5).map((a) => (
            <li key={a.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="font-bold text-ink block truncate">{a.doctorName} · {a.specialty}</span>
                <span className="text-ink-secondary text-[0.8rem]">{a.date} at {a.time}</span>
              </span>
              <span className="text-[0.72rem] font-bold uppercase tracking-wide text-ink-secondary bg-background border border-border rounded-full px-2 py-0.5 shrink-0">
                {a.status.replace("_", " ")}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card-base p-5 space-y-1">
        <button onClick={() => navigate("/preferences")} className="w-full text-left px-3 py-2.5 rounded-control hover:bg-background font-semibold text-[0.9rem] text-ink">
          Notification settings
        </button>
        <button className="w-full text-left px-3 py-2.5 rounded-control hover:bg-background font-semibold text-[0.9rem] text-ink">
          Change password
        </button>
        <button onClick={doLogout} className="w-full text-left px-3 py-2.5 rounded-control hover:bg-danger-soft font-semibold text-[0.9rem] text-danger flex items-center gap-2">
          <LogOut size={16} /> Sign out
        </button>
      </section>

      <p className="flex items-start gap-2 text-[0.78rem] text-ink-secondary bg-healthcare-faint border border-healthcare/20 rounded-control px-3.5 py-3">
        <ShieldCheck size={15} className="shrink-0 mt-0.5 text-healthcare" />
        Your healthcare information stays private and secure. {live ? "Name and phone sync to your profile." : "Demo profile — edits stay on this device."}
      </p>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit profile">
        <div className="space-y-3">
          <label className="block text-[0.83rem] font-bold">Full name<input value={name} onChange={(e) => setName(e.target.value)} className="input-base mt-1" /></label>
          <label className="block text-[0.83rem] font-bold">Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-base mt-1" placeholder="+1 555 010 0000" /></label>
          <label className="block text-[0.83rem] font-bold">Address<input value={address} onChange={(e) => setAddress(e.target.value)} className="input-base mt-1" /></label>
          {saveError && (
            <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">
              {saveError}
            </p>
          )}
          <Button onClick={() => void saveEdits()} disabled={saving} className="w-full">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// Thin adapter so the page reads live profile state from one place.
function useLiveProfile() {
  const auth = useAuth();
  return {
    patient: auth.patient,
    contact: auth.contact,
    updateContactInfo: auth.updateContactInfo,
    logout: auth.logout,
    live: auth.mode === "live" && !!auth.user,
  };
}
