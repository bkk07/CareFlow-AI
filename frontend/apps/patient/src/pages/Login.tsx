import { useState } from "react";
import { apiError, login } from "../api";

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
    <div className="container">
      <div className="login-wrap">
        <div className="card login-card">
          <div className="login-brand">
            <span className="brand">
              <span className="brand-badge" aria-hidden>
                +
              </span>
              CareFlow <span>AI</span>
            </span>
            <h2>Care, minus the phone tag</h2>
            <p>Live hospital availability, guided booking, and reminders — in one place.</p>
            <ul>
              <li>✓ Real open slots, straight from clinic schedules</li>
              <li>✓ Pre-visit forms handled online</li>
              <li>✓ Reminders so you never miss a visit</li>
            </ul>
          </div>
          <div className="login-form">
            <h2>Welcome back</h2>
            <p className="muted">Sign in to find care and manage your visits.</p>
            {error && <p className="error">{error}</p>}
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
            <button
              className="btn btn-primary btn-lg"
              style={{ width: "100%" }}
              onClick={() => void submit()}
              disabled={busy || !email || !password}
            >
              {busy ? (
                <>
                  <span className="spinner" aria-hidden /> Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
