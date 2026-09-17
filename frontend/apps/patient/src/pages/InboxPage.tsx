import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellOff, Search } from "lucide-react";
import { useAppState } from "../context/AppStateContext";
import { EmptyState } from "../components/common/ui";
import { Tabs } from "../components/common/Modal";
import type { NotificationCategory } from "../types";

type Filter = "all" | NotificationCategory;

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  appointments: "Appointments",
  questionnaires: "Questionnaires",
  assistant: "CareFlow AI",
  hospital: "Hospital",
};

export default function InboxPage() {
  const { notifications, markRead, markAllRead } = useAppState();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () =>
      notifications.filter((n) => {
        if (filter !== "all" && n.category !== filter) return false;
        if (query.trim()) {
          const q = query.toLowerCase();
          return n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q);
        }
        return true;
      }),
    [notifications, filter, query],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-sub mt-1">Appointment updates, reminders, and hospital messages.</p>
        </div>
        <button onClick={markAllRead} className="text-[0.83rem] font-bold text-healthcare hover:underline">
          Mark all read
        </button>
      </div>

      <div className="card-base p-4">
        <div className="flex items-center gap-2 bg-background border border-border rounded-control px-3">
          <Search size={16} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages"
            aria-label="Search messages"
            className="w-full bg-transparent outline-none py-2.5 text-[0.9rem]"
          />
        </div>
        <div className="mt-3">
          <Tabs<Filter>
            tabs={[
              { id: "all", label: "All" },
              { id: "appointments", label: "Appointments" },
              { id: "questionnaires", label: "Questionnaires" },
              { id: "assistant", label: "CareFlow AI" },
              { id: "hospital", label: "Hospital" },
            ]}
            active={filter}
            onChange={setFilter}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card-base">
          <EmptyState
            title="No notifications"
            body="You're all caught up. Appointment confirmations and reminders will appear here."
            action={<BellOff className="hidden" />}
          />
        </div>
      ) : (
        <div className="card-base divide-y divide-border overflow-hidden" role="list">
          <AnimatePresence initial={false}>
            {visible.map((n) => (
              <motion.button
                key={n.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => markRead(n.id)}
                role="listitem"
                className={`w-full text-left px-4 sm:px-5 py-4 flex gap-3 hover:bg-background/70 transition ${n.unread ? "bg-healthcare-faint/60" : ""}`}
              >
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.unread ? "bg-healthcare" : "bg-border"}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[0.9rem] text-ink">{n.title}</span>
                    <span className="text-[0.7rem] font-bold uppercase tracking-wide bg-background border border-border rounded-full px-2 py-0.5 text-ink-secondary">
                      {CATEGORY_LABEL[n.category]}
                    </span>
                  </span>
                  <span className="block text-[0.85rem] text-ink-secondary mt-0.5 leading-relaxed">{n.body}</span>
                  <span className="block text-[0.73rem] text-ink-faint mt-1">{n.time}</span>
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
