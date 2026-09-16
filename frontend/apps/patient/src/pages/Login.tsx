import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { apiError, login } from "../api";
import { EASE, Page } from "../motion";

const PERKS = [
  "Real open slots, straight from clinic schedules",
  "Pre-visit forms handled online",
  "Reminders so you never miss a visit",
];

export default function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      onDone();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <div className="container">
        <div className="login-wrap">
          <motion.div
            className="card login-card"
            initial={{ opacity: 0, y: 28, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <div className="login-brand">
              <motion.span
                className="brand"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15, duration: 0.4, ease: EASE }}
              >
                <span className="brand-badge" aria-hidden>
                  +
                </span>
                CareFlow <span>AI</span>
              </motion.span>
              <motion.h2
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22, duration: 0.4, ease: EASE }}
              >
                Care, minus the phone tag
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28, duration: 0.4, ease: EASE }}
              >
                Live hospital availability, guided booking, and reminders — in one place.
              </motion.p>
              <ul>
                {PERKS.map((perk, i) => (
                  <motion.li
                    key={perk}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.34 + i * 0.08, duration: 0.35, ease: EASE }}
                  >
                    ✓ {perk}
                  </motion.li>
                ))}
              </ul>
            </div>
            <motion.div
              className="login-form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2, duration: 0.45, ease: EASE }}
            >
              <h2>Welcome back</h2>
              <p className="muted">Sign in to find care and manage your visits.</p>
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
              </AnimatePresence>
              <div className="field">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                />
              </div>
              <motion.button
                className="btn btn-primary btn-lg"
                style={{ width: "100%" }}
                onClick={() => void submit()}
                disabled={busy || !email || !password}
                whileHover={busy || !email || !password ? undefined : { scale: 1.02 }}
                whileTap={busy || !email || !password ? undefined : { scale: 0.98 }}
              >
                {busy ? (
                  <>
                    <span className="spinner" aria-hidden /> Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </motion.button>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </Page>
  );
}
