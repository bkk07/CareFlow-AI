import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  api,
  apiError,
  listAppointmentTypes,
  searchDoctors,
  searchHospitals,
  type AppointmentType,
  type DoctorResult,
  type Hospital,
  type Preferences,
} from "../api";
import { EASE, Item, Page, Stagger } from "../motion";

const TIMES = ["morning", "afternoon", "evening"];
const MODES = ["in_person", "video", "phone"];

export default function Preferences() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [doctors, setDoctors] = useState<DoctorResult[]>([]);
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [hospitalId, setHospitalId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [time, setTime] = useState("");
  const [mode, setMode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<Preferences>("/patients/me/preferences")
      .then((res) => {
        const p = res.data;
        setPrefs(p);
        setHospitalId(p.preferred_hospital_id ?? "");
        setDoctorId(p.preferred_doctor_id ?? "");
        setTypeId(p.preferred_appointment_type_id ?? "");
        setTime(p.preferred_time_of_day ?? "");
        setMode(p.preferred_consultation_mode ?? "");
      })
      .catch(() => setError("Could not load your preferences."));
    searchHospitals("").then(setHospitals).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hospitalId) {
      setDoctors([]);
      setTypes([]);
      return;
    }
    searchDoctors({ hospital_id: hospitalId })
      .then(setDoctors)
      .catch(() => setDoctors([]));
    listAppointmentTypes(hospitalId)
      .then(setTypes)
      .catch(() => setTypes([]));
  }, [hospitalId]);

  async function save() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const { data } = await api.put<Preferences>("/patients/me/preferences", {
        preferred_hospital_id: hospitalId || null,
        preferred_doctor_id: doctorId || null,
        preferred_appointment_type_id: typeId || null,
        preferred_time_of_day: time || null,
        preferred_consultation_mode: mode || null,
      });
      setPrefs(data);
      setNotice("Preferences saved.");
    } catch (e) {
      setError(apiError(e));
    } finally {
      setSaving(false);
    }
  }

  if (error && !prefs)
    return (
      <Page>
        <p className="error">{error}</p>
      </Page>
    );
  if (!prefs)
    return (
      <Page>
        <div className="card" aria-live="polite">
          <div className="skeleton" style={{ width: "40%", marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 40, marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 40, marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 40 }} />
        </div>
      </Page>
    );

  const fields = [
    {
      key: "hospital",
      label: "Preferred hospital",
      control: (
        <select className="select" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
          <option value="">No preference</option>
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "doctor",
      label: "Preferred doctor",
      control: (
        <select
          className="select"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          disabled={!hospitalId}
        >
          <option value="">No preference</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} {d.specialty ? `· ${d.specialty}` : ""}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "type",
      label: "Preferred visit type",
      control: (
        <select
          className="select"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          disabled={!hospitalId}
        >
          <option value="">No preference</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.duration_minutes} min
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "time",
      label: "Preferred time of day",
      control: (
        <select className="select" value={time} onChange={(e) => setTime(e.target.value)}>
          <option value="">No preference</option>
          {TIMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "mode",
      label: "Preferred consultation mode",
      control: (
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="">No preference</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m.replace("_", " ")}
            </option>
          ))}
        </select>
      ),
    },
  ];

  return (
    <Page>
      <div className="card">
        <h2>Your preferences</h2>
        <p className="muted">
          We use these to suggest the right doctors and times — and the assistant
          remembers them too.
        </p>
        <AnimatePresence>
          {error && (
            <motion.p
              className="error"
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: "1rem" }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            >
              {error}
            </motion.p>
          )}
          {notice && (
            <motion.p
              className="notice"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              {notice}
            </motion.p>
          )}
        </AnimatePresence>
        <Stagger>
          {fields.map((f) => (
            <Item key={f.key}>
              <div className="field">
                <label>{f.label}</label>
                {f.control}
              </div>
            </Item>
          ))}
        </Stagger>
        <motion.button
          className="btn btn-primary"
          onClick={() => void save()}
          disabled={saving}
          whileHover={saving ? undefined : { scale: 1.03 }}
          whileTap={saving ? undefined : { scale: 0.97 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          {saving ? (
            <>
              <span className="spinner" aria-hidden /> Saving…
            </>
          ) : (
            "Save preferences"
          )}
        </motion.button>
      </div>
    </Page>
  );
}
