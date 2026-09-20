import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  cancelAppointment as apiCancel,
  deleteNotification as apiDeleteNotification,
  fetchMyAppointments,
  fetchNotifications,
  markAllNotificationsRead as apiMarkAllRead,
  markNotificationRead as apiMarkRead,
  rescheduleAppointment as apiReschedule,
} from "../api";
import { mapNotification, mapPatientAppointment } from "../lib/backend";
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
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
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

  const markAllRead = useCallback(async () => {
    if (!live) {
      setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
      return;
    }
    try {
      await apiMarkAllRead();
    } catch {
      // Server unreachable: fall through to refresh which keeps last-known data.
    }
    await refresh();
  }, [live, refresh]);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic: flip immediately, then confirm server-side.
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
      deleteNotification,
      pushNotification,
    }),
    [appointments, notifications, unreadCount, loading, live, refresh, addAppointment, updateAppointment, rescheduleLive, cancelAppointment, markAllRead, markRead, deleteNotification, pushNotification],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}
