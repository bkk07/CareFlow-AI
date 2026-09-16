import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, apiError, type CurrentUser } from "../api";
import { Page, popVariants } from "../motion";

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

  if (error && !profile)
    return (
      <Page>
        <p className="error">{error}</p>
      </Page>
    );
  if (!profile)
    return (
      <Page>
        <div className="card" aria-live="polite">
          <div className="skeleton" style={{ width: "35%", marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 24 }} />
        </div>
      </Page>
    );

  return (
    <Page>
      <div className="card">
        <h2>Profile</h2>
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
        <AnimatePresence mode="wait">
          {editing ? (
            <motion.div
              key="editing"
              className="field"
              variants={popVariants}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <label htmlFor="profile-email">Email</label>
              <input
                id="profile-email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p>
                <motion.button
                  className="btn btn-primary"
                  onClick={() => void save()}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                >
                  Save
                </motion.button>{" "}
                <motion.button
                  className="btn"
                  onClick={() => setEditing(false)}
                  whileTap={{ scale: 0.96 }}
                >
                  Cancel
                </motion.button>
              </p>
            </motion.div>
          ) : (
            <motion.p
              key="viewing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {profile.email} <span className="pill">{profile.role}</span>{" "}
              <motion.button
                className="btn btn-sm"
                onClick={() => setEditing(true)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Edit email
              </motion.button>
            </motion.p>
          )}
        </AnimatePresence>
        <p className="muted">Member since {new Date(profile.created_at).toLocaleDateString()}</p>
      </div>
    </Page>
  );
}
