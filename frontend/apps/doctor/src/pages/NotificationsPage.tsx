import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useSchedule } from "../context/ScheduleContext";
import { EmptyState } from "../components/common/ui";
import { Tabs } from "../components/common/Modal";
import type { NotificationCategory } from "../types";

type Filter = "all" | NotificationCategory;

const LABEL: Record<NotificationCategory, string> = {
  appointments: "Appointments",
  questionnaires: "Questionnaires",
  system: "System",
};

export default function NotificationsPage() {
  const { notifications, markRead, markAllRead, live, loading, refresh } = useSchedule();
  const [filter, setFilter] = useState<Filter>("all");
  const visible = useMemo(
    () => notifications.filter((n) => (filter === "all" ? true : n.category === filter)),
    [notifications, filter],
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-sub mt-1">Bookings, cancellations, questionnaires, and schedule updates.</p>
        </div>
        <button onClick={markAllRead} className="text-[0.83rem] font-bold text-healthcare hover:underline">Mark all read</button>
      </div>

      {live && (
        <div className="flex items-center gap-2">
          <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
            {loading ? "Syncing inbox…" : "Live inbox from your hospital"}
          </p>
          <button onClick={() => void refresh()} className="text-[0.8rem] font-bold text-healthcare hover:underline">Refresh</button>
        </div>
      )}

      <div className="card-base px-2">
        <Tabs<Filter>
          tabs={[{ id: "all", label: "All" }, { id: "appointments", label: "Appointments" }, { id: "questionnaires", label: "Questionnaires" }, { id: "system", label: "System" }]}
          active={filter}
          onChange={setFilter}
        />
      </div>

      {visible.length === 0 ? (
        <div className="card-base"><EmptyState title="No notifications" body="You're all caught up. New bookings and form completions will appear here." /></div>
      ) : (
        <div className="card-base divide-y divide-border overflow-hidden">
          {visible.map((n) => (
            <motion.button
              key={n.id}
              layout
              onClick={() => markRead(n.id)}
              className={`w-full text-left px-4 sm:px-5 py-4 flex gap-3 hover:bg-background/70 transition ${n.unread ? "bg-healthcare-faint/60" : ""}`}
            >
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.unread ? "bg-healthcare" : "bg-border"}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-[0.9rem] text-ink">{n.title}</span>
                  <span className="text-[0.68rem] font-bold uppercase tracking-wide bg-background border border-border rounded-full px-2 py-0.5 text-ink-secondary">{LABEL[n.category]}</span>
                </span>
                <span className="block text-[0.85rem] text-ink-secondary mt-0.5">{n.body}</span>
                <span className="block text-[0.73rem] text-ink-faint mt-1">{n.time}</span>
              </span>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
