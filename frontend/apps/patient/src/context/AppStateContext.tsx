import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  cancelAppointment as apiCancel,
  fetchMyAppointments,
  fetchNotifications,
  rescheduleAppointment as apiReschedule,
} from "../api";
import { mapNotification, mapPatientAppointment, persistRead } from "../lib/backend";
import { useAuth } from "./AuthContext";
import type { Appointment, NotificationItem } from "../types";

interface AppState {
  appointments: Appointment[];
  notifications: NotificationItem[];
  unreadCount: number;
  /** True while the first live load is in flight. */
  loading: boolean;
  /** True when the backend session is ready. */
  live: boolean;
  refresh: () => Promise<void>;
  addAppointment: (a: Appointment) => void;
  updateAppointment: (id: string, patch: Partial<Appointment>) => void;
  rescheduleLive: (id: string, slotStart: string, slotEnd: string) => Promise<void>;
  cancelAppointment: (id: string) => Promise<void>;
  markAllRead: () => void;
  markRead: (id: string) => void;
  pushNotification: (n: Omit<NotificationItem, "id" | "time">) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { mode, isAuthenticated } = useAuth();
  const live = mode === "live" && isAuthenticated;
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!live) return;
    setLoading(true);
    try {
      const [appts, notes] = await Promise.all([fetchMyAppointments(), fetchNotifications()]);
      setAppointments(appts.map(mapPatientAppointment));
      setNotifications(notes.map((n) => mapNotification(n)));
      setLiveLoaded(true);
    } catch {
      // Backend dropped mid-session: keep last-known data on screen.
    } finally {
      setLoading(false);
    }
  }, [live]);

  // When a live session starts, load backend data; on logout, clear it.
  useEffect(() => {
    if (live && !liveLoaded) void refresh();
    if (!live && liveLoaded) {
      setLiveLoaded(false);
      setAppointments([]);
      setNotifications([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const addAppointment = useCallback((a: Appointment) => {
    setAppointments((prev) => [a, ...prev]);
  }, []);

  const updateAppointment = useCallback((id: string, patch: Partial<Appointment>) => {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const rescheduleLive = useCallback(
    async (id: string, slotStart: string, slotEnd: string) => {
      await apiReschedule(id, { slot_start: slotStart, slot_end: slotEnd });
      await refresh();
    },
    [refresh],
  );

  const cancelAppointment = useCallback(
    async (id: string) => {
      await apiCancel(id);
      await refresh();
    },
    [refresh],
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      prev.forEach((n) => persistRead(n.id));
      return prev.map((n) => ({ ...n, unread: false }));
    });
  }, []);

  const markRead = useCallback((id: string) => {
    persistRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, unread: false } : n)));
  }, []);

  const pushNotification = useCallback((n: Omit<NotificationItem, "id" | "time">) => {
    setNotifications((prev) => [
      { ...n, id: `n-${Date.now()}`, time: "Just now" },
      ...prev,
    ]);
  }, []);

  const unreadCount = useMemo(() => notifications.filter((n) => n.unread).length, [notifications]);

  const value = useMemo(
    () => ({
      appointments,
      notifications,
      unreadCount,
      loading,
      live,
      refresh,
      addAppointment,
      updateAppointment,
      rescheduleLive,
      cancelAppointment,
      markAllRead,
      markRead,
      pushNotification,
    }),
    [appointments, notifications, unreadCount, loading, live, refresh, addAppointment, updateAppointment, rescheduleLive, cancelAppointment, markAllRead, markRead, pushNotification],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}
