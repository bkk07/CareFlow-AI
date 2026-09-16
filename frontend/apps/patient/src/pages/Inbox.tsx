import { useCallback, useEffect, useState } from "react";
import { api, apiError, type Notification } from "../api";

export default function Inbox() {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<Notification[]>("/notifications");
      setItems(data);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="card">
      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>Inbox</h2>
        <button className="btn btn-sm btn-ghost" onClick={() => void refresh()}>
          Refresh ↻
        </button>
      </div>
      <p className="muted">Confirmations, reminders, and messages from your care team.</p>
      {error && <p className="error">{error}</p>}
      {loading ? (
        <div aria-live="polite">
          {[0, 1, 2].map((i) => (
            <div className="skeleton-row" key={i}>
              <div className="skeleton" style={{ width: 90, height: 24, borderRadius: 999 }} />
              <div className="skeleton" style={{ flex: 1 }} />
            </div>
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="row-list">
          {items.map((n) => (
            <div className="row-item" key={n.id}>
              <span className={`pill pill-${n.status}`}>{n.status}</span>
              <div className="grow">
                <p className="title">{n.subject ?? n.type.replace(/_/g, " ")}</p>
                {n.body && <p className="sub">{n.body}</p>}
                {n.error && <p className="error">{n.error}</p>}
              </div>
              <span className="muted" style={{ fontSize: "0.83rem", whiteSpace: "nowrap" }}>
                {new Date(n.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon" aria-hidden>
            ✉
          </div>
          <h3>All caught up</h3>
          <p>Confirmations and reminders from your care team will land here.</p>
        </div>
      )}
    </div>
  );
}
