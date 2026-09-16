import { useCallback, useEffect, useState } from "react";
import { api, apiError, type CurrentUser } from "../api";

export default function Profile() {
  const [profile, setProfile] = useState<CurrentUser | null>(null);
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<CurrentUser>("/patients/me");
      setProfile(data);
      setEmail(data.email);
    } catch {
      setError("Could not load your profile.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save() {
    setError(null);
    setNotice(null);
    try {
      await api.put("/patients/me", { email });
      setEditing(false);
      setNotice("Email updated.");
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  if (error && !profile) return <p className="error">{error}</p>;
  if (!profile) return <p className="muted">Loading…</p>;

  return (
    <div className="card">
      <h2>Profile</h2>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {editing ? (
        <div className="field">
          <label>Email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p>
            <button className="btn btn-primary" onClick={() => void save()}>
              Save
            </button>{" "}
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </p>
        </div>
      ) : (
        <p>
          {profile.email} <span className="pill">{profile.role}</span>{" "}
          <button className="btn" onClick={() => setEditing(true)}>
            Edit email
          </button>
        </p>
      )}
      <p className="muted">Member since {new Date(profile.created_at).toLocaleDateString()}</p>
    </div>
  );
}
