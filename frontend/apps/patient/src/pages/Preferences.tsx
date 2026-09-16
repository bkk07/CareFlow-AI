import { useEffect, useState } from "react";
import axios from "axios";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

interface Preferences {
  preferred_doctor_id: string | null;
  preferred_hospital_id: string | null;
  preferred_appointment_type_id: string | null;
  preferred_time_of_day: string | null;
  preferred_consultation_mode: string | null;
}

function storedToken(): string | null {
  return localStorage.getItem("careflow_patient_token");
}

function describe(prefs: Preferences): string {
  const parts: string[] = [];
  if (prefs.preferred_time_of_day)
    parts.push(`time of day: ${prefs.preferred_time_of_day}`);
  if (prefs.preferred_consultation_mode)
    parts.push(`consultation: ${prefs.preferred_consultation_mode}`);
  if (prefs.preferred_doctor_id) parts.push("a preferred doctor");
  if (prefs.preferred_hospital_id) parts.push("a preferred hospital");
  if (prefs.preferred_appointment_type_id)
    parts.push("a preferred appointment type");
  return parts.length > 0 ? parts.join(", ") : "none set";
}

export default function Preferences() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = storedToken();
    if (!token) return;
    axios
      .get<Preferences>(`${API_BASE}/patients/me/preferences`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setPrefs(res.data))
      .catch(() => setError("Could not load your preferences."));
  }, []);

  if (!storedToken()) {
    return (
      <section>
        <h2>Preferences</h2>
        <p>Sign in to view your preferences.</p>
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <h2>Preferences</h2>
        <p>{error}</p>
      </section>
    );
  }

  if (!prefs) {
    return (
      <section>
        <h2>Preferences</h2>
        <p>Loading…</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Preferences</h2>
      <p>Your saved preferences: {describe(prefs)}.</p>
    </section>
  );
}
