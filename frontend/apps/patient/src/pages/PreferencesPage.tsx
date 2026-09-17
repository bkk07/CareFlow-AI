import { useEffect, useState } from "react";
import { Bell, Globe, HeartHandshake, Mail, MessageSquare, Mic, Moon } from "lucide-react";
import { fetchPreferences, savePreferences, searchHospitals, type BackendPreferences } from "../api";
import { useAppState } from "../context/AppStateContext";
import { Button } from "../components/common/ui";

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full p-0.5 transition shrink-0 ${on ? "bg-healthcare" : "bg-border"}`}
    >
      <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function Row({
  icon: Icon,
  title,
  desc,
  control,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 py-3.5 border-b border-border/70 last:border-0">
      <span className="w-10 h-10 rounded-xl bg-healthcare-faint text-healthcare flex items-center justify-center shrink-0">
        <Icon size={18} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[0.9rem] text-ink">{title}</p>
        <p className="text-[0.8rem] text-ink-secondary">{desc}</p>
      </div>
      {control}
    </div>
  );
}

const TIME_OPTIONS = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];

const MODE_OPTIONS = [
  { value: "in_person", label: "In person" },
  { value: "video", label: "Video" },
  { value: "phone", label: "Phone" },
];

export default function PreferencesPage() {
  const { live } = useAppState();
  const [email, setEmail] = useState(true);
  const [inapp, setInapp] = useState(true);
  const [sms, setSms] = useState(false);
  const [reminders, setReminders] = useState(true);
  const [voiceConfirm, setVoiceConfirm] = useState(true);
  const [language, setLanguage] = useState("English");
  const [reminderTime, setReminderTime] = useState("24 hours before");
  const [saved, setSaved] = useState(false);

  // Synced care defaults (backend UserPreferences).
  const [prefs, setPrefs] = useState<BackendPreferences | null>(null);
  const [hospitals, setHospitals] = useState<{ id: string; name: string }[]>([]);
  const [prefHospital, setPrefHospital] = useState("");
  const [prefTime, setPrefTime] = useState("");
  const [prefMode, setPrefMode] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, h] = await Promise.all([fetchPreferences(), searchHospitals("")]);
        if (cancelled) return;
        setPrefs(p);
        setHospitals(h);
        setPrefHospital(p.preferred_hospital_id ?? "");
        setPrefTime(p.preferred_time_of_day ?? "");
        setPrefMode(p.preferred_consultation_mode ?? "");
      } catch {
        /* stay local-only */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live]);

  function save() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function saveSynced() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const next = await savePreferences({
        preferred_hospital_id: prefHospital || null,
        preferred_time_of_day: (prefTime || null) as BackendPreferences["preferred_time_of_day"],
        preferred_consultation_mode: (prefMode || null) as BackendPreferences["preferred_consultation_mode"],
      });
      setPrefs(next);
      setSyncMsg("Care defaults saved to your profile.");
    } catch {
      setSyncMsg("Could not save right now. Try again.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="page-title">Preferences</h1>
        <p className="page-sub mt-1">
          {live && prefs ? "Care defaults sync to your profile. Notification toggles stay on this device." : "How CareFlow AI contacts you about your care. Stored locally in this demo."}
        </p>
      </div>

      {live && (
        <section className="card-base p-5" aria-label="Care defaults">
          <h2 className="section-title flex items-center gap-1.5"><HeartHandshake size={17} /> Care defaults</h2>
          <p className="text-[0.8rem] text-ink-secondary mt-1">Used by booking and CareFlow AI to rank options for you.</p>
          <div className="grid sm:grid-cols-3 gap-3 mt-3">
            <label className="text-[0.83rem] font-bold text-ink">
              Preferred hospital
              <select value={prefHospital} onChange={(e) => setPrefHospital(e.target.value)} className="input-base mt-1.5 font-medium">
                <option value="">No preference</option>
                {hospitals.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </label>
            <label className="text-[0.83rem] font-bold text-ink">
              Preferred time
              <select value={prefTime} onChange={(e) => setPrefTime(e.target.value)} className="input-base mt-1.5 font-medium">
                <option value="">No preference</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="text-[0.83rem] font-bold text-ink">
              Preferred visit type
              <select value={prefMode} onChange={(e) => setPrefMode(e.target.value)} className="input-base mt-1.5 font-medium">
                <option value="">No preference</option>
                {MODE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>
          {syncMsg && <p className="text-[0.8rem] font-semibold text-ink-secondary mt-2">{syncMsg}</p>}
          <Button onClick={() => void saveSynced()} disabled={syncing} className="mt-3">
            {syncing ? "Saving…" : "Save care defaults"}
          </Button>
        </section>
      )}

      <section className="card-base p-5" aria-label="Communication">
        <h2 className="section-title">Communication</h2>
        <Row icon={Mail} title="Email notifications" desc="Confirmations, reminders, and visit summaries." control={<Toggle on={email} onChange={setEmail} label="Email notifications" />} />
        <Row icon={MessageSquare} title="In-app notifications" desc="Updates inside the patient portal inbox." control={<Toggle on={inapp} onChange={setInapp} label="In-app notifications" />} />
        <Row icon={Bell} title="Appointment reminders" desc="Nudges before each visit so you never miss one." control={<Toggle on={reminders} onChange={setReminders} label="Appointment reminders" />} />
      </section>

      <section className="card-base p-5" aria-label="Language and timing">
        <h2 className="section-title">Language & timing</h2>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <label className="text-[0.83rem] font-bold text-ink">
            <span className="flex items-center gap-1.5 mb-1.5"><Globe size={14} /> Preferred language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input-base font-medium">
              {["English", "Spanish", "Hindi", "French", "German", "Mandarin"].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="text-[0.83rem] font-bold text-ink">
            <span className="flex items-center gap-1.5 mb-1.5"><Moon size={14} /> Reminder timing</span>
            <select value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} className="input-base font-medium">
              {["24 hours before", "12 hours before", "2 hours before", "1 week before"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card-base p-5" aria-label="Voice">
        <h2 className="section-title">Voice</h2>
        <Row icon={Mic} title="Text confirmations" desc="Receive a text message for phone bookings." control={<Toggle on={sms} onChange={setSms} label="Text confirmations" />} />
        <Row icon={Mic} title="Voice confirmations" desc="Hear appointment details read aloud before ending a voice session." control={<Toggle on={voiceConfirm} onChange={setVoiceConfirm} label="Voice confirmations" />} />
      </section>

      <button
        onClick={save}
        className="w-full min-h-[3rem] rounded-control bg-healthcare text-white font-bold hover:bg-healthcare-dark transition"
      >
        {saved ? "Saved ✓" : "Save preferences"}
      </button>
    </div>
  );
}
