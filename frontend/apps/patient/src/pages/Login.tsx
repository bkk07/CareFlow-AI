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
        <div className="card">
          <h2>Welcome back</h2>
          <p className="muted">Sign in to find care and manage your visits.</p>
          {error && <p className="error">{error}</p>}
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              style={{ width: "100%" }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              style={{ width: "100%" }}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
