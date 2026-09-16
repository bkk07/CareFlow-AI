import { useCallback, useEffect, useState } from "react";
import { api, apiError, type Notification } from "../api";

export default function Inbox() {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<Notification[]>("/notifications");
      setItems(data);
    } catch (e) {
      setError(apiError(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="card">
      <h2>Inbox</h2>
      <p className="muted">Confirmations, reminders, and messages from your care team.</p>
      {error && <p className="error">{error}</p>}
      {items.map((n) => (
        <div className="card" key={n.id}>
          <p>
            <span className={`pill pill-${n.status}`}>{n.status}</span>{" "}
            <strong>{n.subject ?? n.type.replace(/_/g, " ")}</strong>{" "}
            <span className="muted">· {new Date(n.created_at).toLocaleString()}</span>
          </p>
          {n.body && <p>{n.body}</p>}
          {n.error && <p className="error">{n.error}</p>}
        </div>
      ))}
      {items.length === 0 && <p className="muted">No messages yet.</p>}
    </div>
  );
}
