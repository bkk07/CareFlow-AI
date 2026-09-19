import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  fetchMetrics as apiMetrics,
  listEscalations as apiEscalations,
  listOperations as apiOperations,
  listReconciliations as apiReconciliations,
  login as apiLogin,
  me as apiMe,
  probeBackend,
  resolveEscalation as apiResolveEscalation,
  resolveReconciliation as apiResolveRecord,
  restoreAccessToken,
  retryOperation as apiRetryOperation,
  setAccessToken,
  verifyAppointment as apiVerify,
  type CurrentUser,
  type OpsMetrics,
} from "../api";
import { mapEscalation, mapOperation, mapReconciliation } from "../lib/backend";
import type {
  Escalation,
  NotificationItem,
  Operation,
  Reconciliation,
} from "../types";

export type BackendMode = "checking" | "live";

interface OpsStore {
  authed: boolean;
  /** Backend JWT sign-in (hospital_admin or platform_admin). */
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  mode: BackendMode;
  /** True when lists below come from the backend. */
  live: boolean;
  loading: boolean;
  backendError: string | null;
  user: CurrentUser | null;
  metrics: OpsMetrics | null;
  refreshAll: () => Promise<void>;
  operations: Operation[];
  reconciliations: Reconciliation[];
  escalations: Escalation[];
  retryOperation: (id: string) => Promise<void>;
  verifyOperation: (id: string) => Promise<string>;
  resolveReconciliation: (id: string, finalState: string, note: string) => Promise<void>;
  assignEscalation: (id: string, who: string) => void;
  resolveEscalation: (id: string) => Promise<void>;
  notifications: NotificationItem[];
  unread: number;
  markAllRead: () => void;
  pushNotification: (title: string, body: string) => void;
}

const Ctx = createContext<OpsStore | null>(null);
let seq = 1000;
const nid = (p: string) => `${p}-${seq++}`;

const FINAL_STATE_MAP: Record<string, string> = {
  Confirmed: "confirmed",
  Cancelled: "cancelled",
  Failed: "failed",
};

export function AdminProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<BackendMode>("checking");
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);

  const live = mode === "live" && authed && (user?.role === "hospital_admin" || user?.role === "platform_admin");

  const [liveOperations, setLiveOperations] = useState<Operation[]>([]);
  const [liveReconciliations, setLiveReconciliations] = useState<Reconciliation[]>([]);
  const [liveEscalations, setLiveEscalations] = useState<Escalation[]>([]);
  const [metrics, setMetrics] = useState<OpsMetrics | null>(null);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const fail = useCallback((message: string): Error => {
    setBackendError(message);
    return new Error(message);
  }, []);

  const refreshAll = useCallback(async () => {
    if (!live) return;
    setLoading(true);
    setBackendError(null);
    try {
      const [ops, recs, escs, mets] = await Promise.all([
        apiOperations(),
        apiReconciliations(),
        apiEscalations(),
        apiMetrics(),
      ]);
      setLiveOperations(ops.map(mapOperation));
      setLiveReconciliations(recs.map(mapReconciliation));
      setLiveEscalations(escs.map(mapEscalation));
      setMetrics(mets);
      setLiveLoaded(true);
    } catch {
      throw fail("Could not load operations data. Check the backend connection and retry.");
    } finally {
      setLoading(false);
    }
  }, [live, fail]);

  useEffect(() => {
    if (live && !liveLoaded) void refreshAll().catch(() => undefined);
    if (!live && liveLoaded) setLiveLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reachable = await probeBackend();
      if (cancelled) return;
      if (!reachable) {
        setBackendError("Backend is unreachable. Sign in requires a live backend connection.");
        setMode("live");
        return;
      }
      const token = restoreAccessToken();
      if (!token) {
        setMode("live");
        return;
      }
      try {
        const me = await apiMe();
        if (cancelled) return;
        if (me.role !== "hospital_admin" && me.role !== "platform_admin") {
          setAccessToken(null);
        } else {
          setUser(me);
          setAuthed(true);
        }
      } catch {
        setAccessToken(null);
      }
      if (!cancelled) setMode("live");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setBackendError(null);
    const reachable = await probeBackend();
    if (!reachable) throw fail("Backend is unreachable. Check the backend connection and retry.");
    try {
      await apiLogin(email, password);
      const me = await apiMe();
      if (me.role !== "hospital_admin" && me.role !== "platform_admin") {
        setAccessToken(null);
        throw fail("This console is for hospital operators or platform admins.");
      }
      setUser(me);
      setAuthed(true);
      setMode("live");
    } catch (e) {
      if (e instanceof Error && (e.message.startsWith("Backend") || e.message.startsWith("This console") || e.message.startsWith("Could not load"))) throw e;
      throw fail("Sign-in failed. Check your email and password.");
    }
  }, [fail]);

  const logout = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setAuthed(false);
    setBackendError(null);
    setLiveLoaded(false);
    setLiveOperations([]);
    setLiveReconciliations([]);
    setLiveEscalations([]);
    setMetrics(null);
    setNotifications([]);
  }, []);

  const retryOperation = useCallback(async (id: string) => {
    await apiRetryOperation(id).catch(() => { throw fail("Retry failed — operation may already be resolved."); });
    await refreshAll();
  }, [refreshAll, fail]);

  const verifyOperation = useCallback(async (id: string) => {
    const op = liveOperations.find((o) => o.id === id);
    if (!op) throw fail("Operation not found.");
    const result = await apiVerify(op.appointment).catch(() => {
      throw fail("Verification failed — vendor unreachable.");
    });
    await refreshAll();
    return result.outcome;
  }, [liveOperations, refreshAll, fail]);

  const resolveReconciliation = useCallback(async (id: string, finalState: string, note: string) => {
    const mapped = FINAL_STATE_MAP[finalState];
    await apiResolveRecord(id, {
      resolution: "resolved",
      note,
      ...(mapped ? { final_state: mapped } : {}),
    }).catch(() => { throw fail("Could not resolve case."); });
    await refreshAll();
  }, [refreshAll, fail]);

  const assignEscalation = useCallback((id: string, who: string) => {
    // Assignment is console-local: the backend queue tracks open/resolved only.
    setLiveEscalations((p) => p.map((e) => (e.id === id ? { ...e, assignee: who, status: "investigating" } : e)));
  }, []);

  const resolveEscalation = useCallback(async (id: string) => {
    await apiResolveEscalation(id).catch(() => { throw fail("Could not resolve escalation."); });
    await refreshAll();
  }, [refreshAll, fail]);

  const pushNotification = useCallback((title: string, body: string) => {
    setNotifications((prev) => [{ id: nid("n"), title, body, time: "Just now", unread: true }, ...prev]);
  }, []);
  const markAllRead = useCallback(() => setNotifications((prev) => prev.map((n) => ({ ...n, unread: false }))), []);

  const operations = liveOperations;
  const reconciliations = liveReconciliations;
  const escalations = liveEscalations;

  const value = useMemo(
    () => ({
      authed,
      login,
      logout,
      mode,
      live,
      loading,
      backendError,
      user,
      metrics,
      refreshAll,
      operations,
      reconciliations,
      escalations,
      retryOperation,
      verifyOperation,
      resolveReconciliation,
      assignEscalation,
      resolveEscalation,
      notifications,
      unread: notifications.filter((n) => n.unread).length,
      markAllRead,
      pushNotification,
    }),
    [authed, login, logout, mode, live, loading, backendError, user,
      metrics, refreshAll, operations, reconciliations, escalations,
      retryOperation, verifyOperation, resolveReconciliation, assignEscalation, resolveEscalation,
      notifications, markAllRead, pushNotification],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): OpsStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdmin must be used inside AdminProvider");
  return ctx;
}
