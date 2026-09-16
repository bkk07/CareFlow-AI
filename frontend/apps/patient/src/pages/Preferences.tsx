import { useEffect, useState } from "react";
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
    }
  }

  if (error && !prefs) return <p className="error">{error}</p>;
  if (!prefs) return <p className="muted">Loading…</p>;

  return (
    <div className="card">
      <h2>Your preferences</h2>
      <p className="muted">
        We use these to suggest the right doctors and times — and the assistant
        remembers them too.
      </p>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <div className="field">
        <label>Preferred hospital</label>
        <select className="select" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
          <option value="">No preference</option>
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Preferred doctor</label>
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
      </div>
      <div className="field">
        <label>Preferred visit type</label>
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
      </div>
      <div className="field">
        <label>Preferred time of day</label>
        <select className="select" value={time} onChange={(e) => setTime(e.target.value)}>
          <option value="">No preference</option>
          {TIMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Preferred consultation mode</label>
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="">No preference</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <button className="btn btn-primary" onClick={() => void save()}>
        Save preferences
      </button>
    </div>
  );
}
