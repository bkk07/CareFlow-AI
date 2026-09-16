import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, apiError, type Notification } from "../api";
import { EASE, Page } from "../motion";

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
    <Page>
      <div className="card">
        <div className="section-head" style={{ marginTop: 0 }}>
          <h2>Inbox</h2>
          <motion.button
            className="btn btn-sm btn-ghost"
            onClick={() => void refresh()}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95, rotate: -30 }}
          >
            Refresh ↻
          </motion.button>
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
          <motion.div
            className="row-list"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
          >
            {items.map((n) => (
              <motion.div
                key={n.id}
                className="row-item"
                variants={{
                  hidden: { opacity: 0, y: 12 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
                }}
              >
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
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <div className="empty">
            <motion.div
              className="empty-icon"
              aria-hidden
              initial={{ scale: 0, rotate: 20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 15 }}
            >
              ✉
            </motion.div>
            <h3>All caught up</h3>
            <p>Confirmations and reminders from your care team will land here.</p>
          </div>
        )}
      </div>
    </Page>
  );
}
