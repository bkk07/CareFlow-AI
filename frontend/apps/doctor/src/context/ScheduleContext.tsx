import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  createBlock as apiCreateBlock,
  createRule as apiCreateRule,
  deleteBlock as apiDeleteBlock,
  deleteRule as apiDeleteRule,
  fetchNotifications as apiNotifications,
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
  persistRead,
} from "../lib/backend";
import { useAuth } from "./AuthContext";
import {
  INITIAL_APPOINTMENTS,
  INITIAL_BLOCKS,
  INITIAL_NOTIFICATIONS,
  INITIAL_RULES,
  QUESTIONNAIRES,
} from "../mock/schedule";
import type {
  Appointment,
  AvailabilityRule,
  BlockedSlot,
  NotificationItem,
  Questionnaire,
} from "../types";

interface ScheduleState {
  /** True when the backend drives this store (false = offline mock data). */
  live: boolean;
  loading: boolean;
  appointments: Appointment[];
  rules: AvailabilityRule[];
  blocks: BlockedSlot[];
  notifications: NotificationItem[];
  questionnaires: Questionnaire[];
  unreadCount: number;
  /** Calendar on/off — backend `calendars.is_active` when live. */
  accepting: boolean;
  setAccepting: (on: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  toggleRule: (id: string) => Promise<void>;
  updateRule: (id: string, patch: Partial<AvailabilityRule>) => Promise<void>;
  addBlock: (b: Omit<BlockedSlot, "id">) => Promise<void>;
  addLiveBlock: (date: string, start: string, end: string, reason: BlockedSlot["reason"]) => Promise<void>;
  deleteBlock: (id: string) => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => void;
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

  const [appointments, setAppointments] = useState<Appointment[]>(INITIAL_APPOINTMENTS);
  const [rules, setRules] = useState<AvailabilityRule[]>(INITIAL_RULES);
  const [blocks, setBlocks] = useState<BlockedSlot[]>(INITIAL_BLOCKS);
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>(QUESTIONNAIRES);
  const [accepting, setAcceptingState] = useState(true);
  const [loading, setLoading] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const ruleCache = useRef(new Map<string, ApiRule>());

  const refresh = useCallback(async () => {
    if (!live || !hospitalId || !doctorId) return;
    setLoading(true);
    try {
      const [today, upcoming, calendar, notes, inbox] = await Promise.all([
        apiMyAppointments("today").catch(() => []),
        apiMyAppointments("upcoming").catch(() => []),
        apiMyCalendar().catch(() => null),
        apiNotifications().catch(() => []),
        apiInbox().catch(() => []),
      ]);
      const hospitalName = "My hospital";
      const mapped = [...today, ...upcoming]
        .map((a) => mapDoctorAppointment(a, hospitalName))
        .sort((x, y) => x.sortKey.localeCompare(y.sortKey));
      // Deduplicate: an appointment can appear in both ranges.
      const seen = new Set<string>();
      setAppointments(mapped.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))));
      if (calendar) {
        for (const r of calendar.rules) ruleCache.current.set(r.id, r);
        setRules(mapRules(calendar.rules));
        setBlocks(mapBlocks(calendar.blocks));
        setAcceptingState(calendar.calendar.is_active);
      }
      setNotifications(notes.map(mapNotification));
      setQuestionnaires(inbox.map(mapQuestionnaireItem));
      setLiveLoaded(true);
    } catch {
      // Backend dropped mid-session: keep last-known data on screen.
    } finally {
      setLoading(false);
    }
  }, [live, hospitalId, doctorId]);

  // When a live session starts, swap mock seeds for backend data.
  useEffect(() => {
    if (live && !liveLoaded) void refresh();
    if (!live && liveLoaded) {
      setLiveLoaded(false);
      setAppointments(INITIAL_APPOINTMENTS);
      setRules(INITIAL_RULES);
      setBlocks(INITIAL_BLOCKS);
      setNotifications(INITIAL_NOTIFICATIONS);
      setQuestionnaires(QUESTIONNAIRES);
      setAcceptingState(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const setAccepting = useCallback(
    async (on: boolean) => {
      if (!live || !hospitalId || !doctorId) {
        setAcceptingState(on);
        return;
      }
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
      if (!live || !hospitalId || !doctorId) {
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
        return;
      }
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
      if (!live || !hospitalId || !doctorId) {
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
        return;
      }
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

  const addBlock = useCallback(
    async (b: Omit<BlockedSlot, "id">) => {
      if (!live || !hospitalId || !doctorId) {
        const id = `b-${Date.now()}`;
        setBlocks((prev) => [...prev, { ...b, id }]);
        return;
      }
      // Mock-shaped block in live mode should not happen (AvailabilityPage
      // uses addLiveBlock); fall back to a same-day window.
      const today = new Date().toISOString().slice(0, 10);
      await apiCreateBlock(hospitalId, doctorId, {
        start_datetime: combineDateTime(today, "12:00"),
        end_datetime: combineDateTime(today, "13:00"),
        reason: blockReasonToApi(b.reason),
      });
      await refresh();
    },
    [live, hospitalId, doctorId, refresh],
  );

  const addLiveBlock = useCallback(
    async (date: string, start: string, end: string, reason: BlockedSlot["reason"]) => {
      if (!live || !hospitalId || !doctorId) {
        const id = `b-${Date.now()}`;
        setBlocks((prev) => [...prev, { id, date, start, end, reason }]);
        return;
      }
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
      // Backend ids are UUIDs; mock seeds (`b1..`) and mock adds
      // (`b-<timestamp>`) never look like UUIDs.
      const isMockId = /^b\d*$/.test(id) || /^b-\d+$/.test(id);
      if (!live || !hospitalId || !doctorId || isMockId) {
        setBlocks((prev) => prev.filter((b) => b.id !== id));
        return;
      }
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

  const markRead = useCallback((id: string) => {
    persistRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, unread: false } : n)));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      prev.forEach((n) => persistRead(n.id));
      return prev.map((n) => ({ ...n, unread: false }));
    });
  }, []);

  const unreadCount = useMemo(() => notifications.filter((n) => n.unread).length, [notifications]);

  const value = useMemo(
    () => ({
      live,
      loading,
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
      addBlock,
      addLiveBlock,
      deleteBlock,
      markRead,
      markAllRead,
    }),
    [
      live,
      loading,
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
      addBlock,
      addLiveBlock,
      deleteBlock,
      markRead,
      markAllRead,
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
