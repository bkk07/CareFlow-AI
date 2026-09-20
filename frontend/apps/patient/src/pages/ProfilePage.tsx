import { useRef, useState } from "react";
import { CalendarDays, Edit3, LogOut, MapPin, Navigation, Phone, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAppState } from "../context/AppStateContext";
import { Button, SafeImage } from "../components/common/ui";
import { Modal } from "../components/common/Modal";
import { readPosition } from "../lib/helpers";

export default function ProfilePage() {
  const { patient, contact, updateContactInfo, logout, live } = useLiveProfile();
  const { appointments } = useAppState();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(patient.name);
  const [phone, setPhone] = useState(patient.phone);
  const [address, setAddress] = useState(patient.address);
  const [city, setCity] = useState(contact?.city ?? "");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(
    contact?.latitude != null && contact?.longitude != null
      ? { latitude: contact.latitude, longitude: contact.longitude }
      : null,
  );
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Downscale to a 256px JPEG data-URL so the photo fits the profile column. */
  async function fileToPhoto(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file);
    try {
      const size = 256;
      const scale = Math.max(size / bitmap.width, size / bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
      const url = canvas.toDataURL("image/jpeg", 0.82);
      if (url.length > 400000) throw new Error("photo too large after resize");
      return url;
    } finally {
      bitmap.close();
    }
  }

  async function onPhotoFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError("Image must be under 5 MB.");
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await updateContactInfo({ photo_url: await fileToPhoto(file) });
    } catch {
      setPhotoError("Could not upload that photo. Try a smaller image.");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await updateContactInfo({ photo_url: "" });
    } catch {
      setPhotoError("Could not remove the photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  const completed = appointments.filter((a) => a.status === "completed").length;
  const upcomingCount = appointments.filter((a) => ["confirmed", "pending", "rescheduled"].includes(a.status)).length;

  function doLogout() {
    logout();
    navigate("/login");
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

  function openEditor() {
    setName(patient.name);
    setPhone(patient.phone);
    setAddress(patient.address);
    setCity(contact?.city ?? "");
    setCoords(
      contact?.latitude != null && contact?.longitude != null
        ? { latitude: contact.latitude, longitude: contact.longitude }
        : null,
    );
    setGeoError(null);
    setSaveError(null);
    setEditing(true);
  }

  async function saveEdits() {
    setSaving(true);
    setSaveError(null);
    try {
      if (live) {
        // Backend stores the verified identity (name/phone/city/coords); address stays local.
        await updateContactInfo({
          full_name: name,
          phone,
          city: city || null,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
        });
      }
      setEditing(false);
    } catch {
      setSaveError("Could not save changes. Check the phone format and try again.");
    } finally {
      setSaving(false);
    }
  }

  const savedCoords =
    contact?.latitude != null && contact?.longitude != null
      ? `${contact.latitude.toFixed(4)}, ${contact.longitude.toFixed(4)}`
      : null;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="card-base p-6">
        <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
          <div className="flex flex-col items-center gap-1.5">
            <SafeImage src={patient.avatar} alt={patient.name} name={patient.name} className="w-20 h-20 rounded-2xl border border-border" />
            {live && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Upload profile photo"
                  onChange={(e) => void onPhotoFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={photoBusy}
                  className="text-[0.76rem] font-bold text-healthcare hover:underline disabled:opacity-60"
                >
                  {photoBusy ? "Uploading…" : patient.avatar ? "Change photo" : "Add photo"}
                </button>
                {patient.avatar && !photoBusy && (
                  <button
                    type="button"
                    onClick={() => void removePhoto()}
                    className="text-[0.72rem] font-semibold text-ink-faint hover:text-danger hover:underline"
                  >
                    Remove
                  </button>
                )}
              </>
            )}
            {photoError && (
              <p role="alert" className="text-[0.72rem] font-semibold text-danger text-center max-w-[140px]">{photoError}</p>
            )}
          </div>
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
            <Button variant="outline" size="sm" onClick={openEditor}>
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
              <dt className="text-ink-secondary flex items-center gap-1"><MapPin size={13} /> City</dt>
              <dd className="font-bold text-ink text-right max-w-[60%]">
                {live ? (contact?.city || city || "Not set") : (city || "Not set")}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-secondary flex items-center gap-1"><Navigation size={13} /> Location</dt>
              <dd className="font-bold text-ink text-right max-w-[60%]">
                {live ? (savedCoords ?? "Not set") : (coords ? `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}` : "Not set")}
              </dd>
            </div>
            <p className="text-[0.75rem] text-ink-faint">Your city + precise location power nearby doctor suggestions — set them once and the AI remembers.</p>
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
        Your healthcare information stays private and secure. {live ? "Name, phone, city and location sync to your profile." : "Demo profile — edits stay on this device."}
      </p>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit profile">
        <div className="space-y-3">
          <label className="block text-[0.83rem] font-bold">Full name<input value={name} onChange={(e) => setName(e.target.value)} className="input-base mt-1" /></label>
          <label className="block text-[0.83rem] font-bold">Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-base mt-1" placeholder="+1 555 010 0000" /></label>
          <label className="block text-[0.83rem] font-bold">Address<input value={address} onChange={(e) => setAddress(e.target.value)} className="input-base mt-1" /></label>
          <label className="block text-[0.83rem] font-bold">City — for nearby suggestions<input value={city} onChange={(e) => setCity(e.target.value)} className="input-base mt-1" placeholder="e.g. Bengaluru" /></label>
          <div className="bg-healthcare-faint border border-healthcare/20 rounded-control px-3 py-2.5">
            <p className="text-[0.83rem] font-bold text-navy flex items-center gap-1.5">
              <Navigation size={14} className="text-healthcare" /> Precise location
            </p>
            <p className="text-[0.76rem] text-ink-secondary mt-0.5">For exact distances (“2 km away”) instead of just city ranking.</p>
            {coords ? (
              <div className="flex items-center justify-between gap-2 mt-2">
                <span className="text-[0.78rem] font-bold text-teal-dark bg-white border border-teal/20 rounded-full px-2.5 py-1">
                  📍 {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
                </span>
                <button type="button" onClick={() => setCoords(null)} className="text-[0.78rem] font-bold text-ink-secondary hover:text-healthcare hover:underline">
                  Clear
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void useMyLocation()} disabled={locating}>
                <Navigation size={14} /> {locating ? "Reading location…" : "Use my location"}
              </Button>
            )}
            {geoError && (
              <p role="alert" className="text-[0.78rem] font-semibold text-danger mt-1.5">{geoError}</p>
            )}
          </div>
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
