import { useEffect, useState } from "react";
import axios from "axios";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

interface PatientMe {
  id: string;
  email: string;
  role: string;
  hospital_id: string | null;
  is_active: boolean;
  created_at: string;
}

function storedToken(): string | null {
  return localStorage.getItem("careflow_patient_token");
}

export default function Profile() {
  const [profile, setProfile] = useState<PatientMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = storedToken();
    if (!token) return;
    axios
      .get<PatientMe>(`${API_BASE}/patients/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setProfile(res.data))
      .catch(() => setError("Could not load your profile."));
  }, []);

  if (!storedToken()) {
    return (
      <section>
        <h2>Profile</h2>
        <p>Sign in to view your profile.</p>
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <h2>Profile</h2>
        <p>{error}</p>
      </section>
    );
  }

  if (!profile) {
    return (
      <section>
        <h2>Profile</h2>
        <p>Loading…</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Profile</h2>
      <dl>
        <dt>Email</dt>
        <dd>{profile.email}</dd>
        <dt>Member since</dt>
        <dd>{new Date(profile.created_at).toLocaleDateString()}</dd>
      </dl>
    </section>
  );
}
