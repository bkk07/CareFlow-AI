import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  createBlock as apiCreateBlock,
  createRule as apiCreateRule,
  deleteBlock as apiDeleteBlock,
  deleteNotification as apiDeleteNotification,
  deleteRule as apiDeleteRule,
  fetchNotifications as apiNotifications,
  markAllNotificationsRead as apiMarkAllRead,
  markNotificationRead as apiMarkRead,
  myAppointments as apiMyAppointments,
  myCalendar as apiMyCalendar,
  questionnaireInbox as apiInbox,
  updateCalendar as apiUpdateCalendar,
  type AvailabilityRule as ApiRule,
  type BlockedSlot as ApiBlock,
} from "../api";
import {
  blockReasonToApi,
  mapBlocks,
  mapDoctorAppointment,
  mapNotification,
  mapQuestionnaireItem,
  mapRules,
} from "../lib/backend";
import { useAuth } from "./AuthContext";
import type {
  Appointment,
  AvailabilityRule,
  BlockedSlot,
  NotificationItem,
  Questionnaire,
} from "../types";

interface ScheduleState {
  /** True when the backend drives this store. Always backend-driven when authenticated. */
  live: boolean;
  loading: boolean;
  error: string | null;
  appointments: Appointment[];
  rules: AvailabilityRule[];
  blocks: BlockedSlot[];
  notifications: NotificationItem[];
  questionnaires: Questionnaire[];
  unreadCount: number;
  /** Calendar on/off — backend `calendars.is_active`. */
  accepting: boolean;
  setAccepting: (on: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  toggleRule: (id: string) => Promise<void>;
  updateRule: (id: string, patch: Partial<AvailabilityRule>) => Promise<void>;
  addLiveBlock: (date: string, start: string, end: string, reason: BlockedSlot["reason"]) => Promise<void>;
  deleteBlock: (id: string) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
}

const Ctx = createContext<ScheduleState | null>(null);

const DAY_INDEX: Record<string, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
};

function toApiTime(hhmm: string): string {
  return hhmm.length === 5 ? `${hhmm}:00` : hhmm;
}

function combineDateTime(date: string, time: string): string {
  // date YYYY-MM-DD + time HH:MM -> local ISO; backend coerces to UTC.
  return new Date(`${date}T${time}:00`).toISOString();
}

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const { mode, isAuthenticated, profile } = useAuth();
  const live = mode === "live" && isAuthenticated && profile != null;
  const hospitalId = profile?.hospital_id ?? null;
  const doctorId = profile?.id ?? null;

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [blocks, setBlocks] = useState<BlockedSlot[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([]);
  const [accepting, setAcceptingState] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const ruleCache = useRef(new Map<string, ApiRule>());

  const refresh = useCallback(async () => {
    if (!live || !hospitalId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const [today, upcoming, calendar, notes, inbox] = await Promise.all([
        apiMyAppointments("today"),
        apiMyAppointments("upcoming"),
        apiMyCalendar(),
        apiNotifications(),
        apiInbox(),
      ]);
      const hospitalName = "My hospital";
      const mapped = [...today, ...upcoming]
        .map((a) => mapDoctorAppointment(a, hospitalName))
        .sort((x, y) => x.sortKey.localeCompare(y.sortKey));
      // Deduplicate: an appointment can appear in both ranges.
      const seen = new Set<string>();
      const deduped = mapped.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
      // Real form state comes from the questionnaire inbox (the appointment
      // list itself carries no form info) — completed / pending / none.
      const formByAppointment = new Map(
        inbox.map((i) => [i.appointment_id, mapQuestionnaireItem(i).status]),
      );
      for (const a of deduped) {
        const s = formByAppointment.get(a.id);
        a.questionnaire =
          s === "completed" || s === "in_progress" || s === "assigned"
            ? s
            : "not_assigned";
      }
      setAppointments(deduped);
      for (const r of calendar.rules) ruleCache.current.set(r.id, r);
      setRules(mapRules(calendar.rules));
      setBlocks(mapBlocks(calendar.blocks));
      setAcceptingState(calendar.calendar.is_active);
      setNotifications(notes.map(mapNotification));
      setQuestionnaires(inbox.map(mapQuestionnaireItem));
      setLiveLoaded(true);
    } catch {
      setError("Could not load your schedule. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [live, hospitalId, doctorId]);

  // When a live session starts, load backend data. Empty until it arrives.
  useEffect(() => {
    if (live && !liveLoaded) void refresh();
    if (!live) {
      setLiveLoaded(false);
      setAppointments([]);
      setRules([]);
      setBlocks([]);
      setNotifications([]);
      setQuestionnaires([]);
      setAcceptingState(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const setAccepting = useCallback(
    async (on: boolean) => {
      if (!live || !hospitalId || !doctorId) throw new Error("schedule-not-live");
      setAcceptingState(on);
      try {
        await apiUpdateCalendar(hospitalId, doctorId, on);
      } catch {
        setAcceptingState(!on);
        throw new Error("calendar-update-failed");
      }
    },
    [live, hospitalId, doctorId],
  );

  const toggleRule = useCallback(
    async (id: string) => {
      if (!live || !hospitalId || !doctorId) throw new Error("schedule-not-live");
      const row = rules.find((r) => r.id === id);
      if (!row) return;
      if (row.enabled) {
        // Disable = delete the backend rule (refresh() re-caches the rest).
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: false } : r)));
        try {
          await apiDeleteRule(hospitalId, doctorId, id);
          ruleCache.current.delete(id);
        } catch {
          setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: true } : r)));
          throw new Error("rule-delete-failed");
        }
      } else {
        // Enable = recreate the weekly rule for that weekday.
        const dayOfWeek = DAY_INDEX[row.day] ?? 0;
        const created = await apiCreateRule(hospitalId, doctorId, {
          day_of_week: dayOfWeek,
          start_time: toApiTime(row.start),
          end_time: toApiTime(row.end),
        });
        ruleCache.current.set(created.id, created);
        await refresh();
      }
    },
    [live, hospitalId, doctorId, rules, refresh],
  );

  const updateRule = useCallback(
    async (id: string, patch: Partial<AvailabilityRule>) => {
      if (!live || !hospitalId || !doctorId) throw new Error("schedule-not-live");
      const row = rules.find((r) => r.id === id);
      if (!row) return;
      const next = { ...row, ...patch };
      setRules((prev) => prev.map((r) => (r.id === id ? next : r)));
      try {
        // Backend rules are immutable windows: replace = delete + create.
        if (row.enabled && ruleCache.current.has(id)) {
          await apiDeleteRule(hospitalId, doctorId, id);
          ruleCache.current.delete(id);
        }
        if (next.enabled) {
          const created = await apiCreateRule(hospitalId, doctorId, {
            day_of_week: DAY_INDEX[next.day] ?? 0,
            start_time: toApiTime(next.start),
            end_time: toApiTime(next.end),
          });
          ruleCache.current.set(created.id, created);
        }
        await refresh();
      } catch {
        await refresh();
        throw new Error("rule-update-failed");
      }
    },
    [live, hospitalId, doctorId, rules, refresh],
  );

  const addLiveBlock = useCallback(
    async (date: string, start: string, end: string, reason: BlockedSlot["reason"]) => {
      if (!live || !hospitalId || !doctorId) throw new Error("schedule-not-live");
      await apiCreateBlock(hospitalId, doctorId, {
        start_datetime: combineDateTime(date, start),
        end_datetime: combineDateTime(date, end),
        reason: blockReasonToApi(reason),
      });
      await refresh();
    },
    [live, hospitalId, doctorId, refresh],
  );

  const deleteBlock = useCallback(
    async (id: string) => {
      if (!live || !hospitalId || !doctorId) throw new Error("schedule-not-live");
      setBlocks((prev) => prev.filter((b) => b.id !== id));
      try {
        await apiDeleteBlock(hospitalId, doctorId, id);
      } catch {
        await refresh();
        throw new Error("block-delete-failed");
      }
    },
    [live, hospitalId, doctorId, refresh],
  );

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic flip, then confirm server-side.
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, unread: false } : n)));
      if (!live) return;
      try {
        const updated = await apiMarkRead(id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? mapNotification(updated) : n)),
        );
      } catch {
        await refresh();
      }
    },
    [live, refresh],
  );

  const markAllRead = useCallback(async () => {
    if (!live) {
      setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
      return;
    }
    try {
      await apiMarkAllRead();
    } catch {
      // fall through to refresh
    }
    await refresh();
  }, [live, refresh]);

  const deleteNotification = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (!live) return;
      try {
        await apiDeleteNotification(id);
      } catch {
        await refresh();
      }
    },
    [live, refresh],
  );

  const unreadCount = useMemo(() => notifications.filter((n) => n.unread).length, [notifications]);

  const value = useMemo(
    () => ({
      live,
      loading,
      error,
      appointments,
      rules,
      blocks,
      notifications,
      questionnaires,
      unreadCount,
      accepting,
      setAccepting,
      refresh,
      toggleRule,
      updateRule,
      addLiveBlock,
      deleteBlock,
      markRead,
      markAllRead,
      deleteNotification,
    }),
    [
      live,
      loading,
      error,
      appointments,
      rules,
      blocks,
      notifications,
      questionnaires,
      unreadCount,
      accepting,
      setAccepting,
      refresh,
      toggleRule,
      updateRule,
      addLiveBlock,
      deleteBlock,
      markRead,
      markAllRead,
      deleteNotification,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSchedule(): ScheduleState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSchedule must be used inside ScheduleProvider");
  return ctx;
}

export type { ApiBlock, ApiRule };
