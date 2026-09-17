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
import { ADMIN_NOTIFICATIONS } from "../mock/platform";
import { INITIAL_ESCALATIONS, INITIAL_OPERATIONS, INITIAL_RECONCILIATION } from "../mock/ops";

export type BackendMode = "checking" | "live" | "mock";

interface OpsStore {
  authed: boolean;
  /** Real sign-in (hospital_admin or platform_admin) when reachable, mock fallback offline. */
  login: (email?: string, password?: string) => Promise<void>;
  loginMock: () => void;
  logout: () => void;
  mode: BackendMode;
  /** True when lists below come from the backend (false = mock seeds). */
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
  verifyOperation: (id: string, found: boolean) => Promise<string>;
  resolveReconciliation: (id: string, finalState: string, note: string) => Promise<void>;
  assignEscalation: (id: string, who: string) => void;
  resolveEscalation: (id: string) => Promise<void>;
  simulateTimeout: (id: string) => void;
  notifications: NotificationItem[];
  unread: number;
  markAllRead: () => void;
  pushNotification: (title: string, body: string) => void;
}

const Ctx = createContext<OpsStore | null>(null);
let seq = 1000;
const nid = (p: string) => `${p}-${seq++}`;
const MOCK_KEY = "careflow_ops_mock";

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

  const [mockOperations, setMockOperations] = useState(INITIAL_OPERATIONS);
  const [mockReconciliations, setMockReconciliations] = useState(INITIAL_RECONCILIATION);
  const [mockEscalations, setMockEscalations] = useState(INITIAL_ESCALATIONS);

  const [liveOperations, setLiveOperations] = useState<Operation[]>([]);
  const [liveReconciliations, setLiveReconciliations] = useState<Reconciliation[]>([]);
  const [liveEscalations, setLiveEscalations] = useState<Escalation[]>([]);
  const [metrics, setMetrics] = useState<OpsMetrics | null>(null);

  const [notifications, setNotifications] = useState<NotificationItem[]>(ADMIN_NOTIFICATIONS);

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
        apiOperations().catch(() => []),
        apiReconciliations().catch(() => []),
        apiEscalations().catch(() => []),
        apiMetrics().catch(() => null),
      ]);
      setLiveOperations(ops.map(mapOperation));
      setLiveReconciliations(recs.map(mapReconciliation));
      setLiveEscalations(escs.map(mapEscalation));
      if (mets) setMetrics(mets);
      setLiveLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [live]);

  useEffect(() => {
    if (live && !liveLoaded) void refreshAll();
    if (!live && liveLoaded) setLiveLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reachable = await probeBackend();
      if (cancelled) return;
      if (!reachable) {
        try {
          if (localStorage.getItem(MOCK_KEY) === "1") setAuthed(true);
        } catch {
          /* private mode */
        }
        setMode("mock");
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

  const login = useCallback(async (email?: string, password?: string) => {
    setBackendError(null);
    if (email && password) {
      const reachable = await probeBackend();
      if (!reachable) throw fail("Backend is unreachable — try the offline demo.");
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
        return;
      } catch (e) {
        if (e instanceof Error && (e.message.startsWith("Backend") || e.message.startsWith("This console"))) throw e;
        throw fail("Sign-in failed. Check your email and password.");
      }
    }
    try {
      localStorage.setItem(MOCK_KEY, "1");
    } catch {
      /* noop */
    }
    setMode("mock");
    setAuthed(true);
  }, [fail]);

  const loginMock = useCallback(() => {
    try {
      localStorage.setItem(MOCK_KEY, "1");
    } catch {
      /* noop */
    }
    setMode("mock");
    setAuthed(true);
  }, []);

  const logout = useCallback(() => {
    setAccessToken(null);
    try {
      localStorage.removeItem(MOCK_KEY);
    } catch {
      /* noop */
    }
    setUser(null);
    setAuthed(false);
    setBackendError(null);
    setLiveLoaded(false);
  }, []);

  const retryOperation = useCallback(async (id: string) => {
    if (!live) {
      setMockOperations((p) => p.map((o) => (o.id === id ? { ...o, status: "retrying", attempts: o.attempts + 1, lastAttempt: "Just now", nextRetry: "In 15 min" } : o)));
      return;
    }
    await apiRetryOperation(id).catch(() => { throw fail("Retry failed — operation may already be resolved."); });
    await refreshAll();
  }, [live, refreshAll, fail]);

  const verifyOperation = useCallback(async (id: string, found: boolean) => {
    if (!live) {
      setMockOperations((p) =>
        p.map((o) =>
          o.id === id
            ? {
                ...o,
                status: found ? "recovered" : "needs_reconciliation",
                timeline: o.timeline.map((t) =>
                  t.label === "External record lookup"
                    ? { ...t, state: "done" as const, detail: found ? "Found externally" : "Not found externally" }
                    : t.label === "Internal state synchronized" || t.label === "Appointment confirmed"
                      ? { ...t, state: found ? ("done" as const) : ("pending" as const) }
                      : t,
                ),
              }
            : o,
        ),
      );
      return `mock:${found ? "found" : "missing"}`;
    }
    const op = liveOperations.find((o) => o.id === id);
    if (!op) throw fail("Operation not found.");
    const result = await apiVerify(op.appointment).catch(() => {
      throw fail("Verification failed — vendor unreachable.");
    });
    await refreshAll();
    return result.outcome;
  }, [live, liveOperations, refreshAll, fail]);

  const resolveReconciliation = useCallback(async (id: string, finalState: string, note: string) => {
    if (!live) {
      setMockReconciliations((p) => p.map((r) => (r.id === id ? { ...r, resolution: "resolved", internalState: finalState, updated: "Just now" } : r)));
      return;
    }
    const mapped = FINAL_STATE_MAP[finalState];
    await apiResolveRecord(id, {
      resolution: "resolved",
      note,
      ...(mapped ? { final_state: mapped } : {}),
    }).catch(() => { throw fail("Could not resolve case."); });
    await refreshAll();
  }, [live, refreshAll, fail]);

  const assignEscalation = useCallback((id: string, who: string) => {
    // Assignment is console-local: the backend queue tracks open/resolved only.
    if (live) {
      setLiveEscalations((p) => p.map((e) => (e.id === id ? { ...e, assignee: who, status: "investigating" } : e)));
      return;
    }
    setMockEscalations((p) => p.map((e) => (e.id === id ? { ...e, assignee: who, status: "investigating" } : e)));
  }, [live]);

  const resolveEscalation = useCallback(async (id: string) => {
    if (!live) {
      setMockEscalations((p) => p.map((e) => (e.id === id ? { ...e, status: "resolved" } : e)));
      return;
    }
    await apiResolveEscalation(id).catch(() => { throw fail("Could not resolve escalation."); });
    await refreshAll();
  }, [live, refreshAll, fail]);

  const simulateTimeout = useCallback((id: string) => {
    // Demo-only simulation; live operations come from the vendor log.
    if (live) return;
    setMockOperations((p) =>
      p.map((o) =>
        o.id === id
          ? { ...o, status: "unknown", error: "Request timed out after 8s — outcome could not be determined.", lastAttempt: "Just now" }
          : o,
      ),
    );
  }, [live]);

  const pushNotification = useCallback((title: string, body: string) => {
    setNotifications((prev) => [{ id: nid("n"), title, body, time: "Just now", unread: true }, ...prev]);
  }, []);
  const markAllRead = useCallback(() => setNotifications((prev) => prev.map((n) => ({ ...n, unread: false }))), []);

  const operations = live && liveLoaded ? liveOperations : mockOperations;
  const reconciliations = live && liveLoaded ? liveReconciliations : mockReconciliations;
  const escalations = live && liveLoaded ? liveEscalations : mockEscalations;

  const value = useMemo(
    () => ({
      authed,
      login,
      loginMock,
      logout,
      mode,
      live: live && liveLoaded,
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
      simulateTimeout,
      notifications,
      unread: notifications.filter((n) => n.unread).length,
      markAllRead,
      pushNotification,
    }),
    [authed, login, loginMock, logout, mode, live, liveLoaded, loading, backendError, user,
      metrics, refreshAll, operations, reconciliations, escalations,
      retryOperation, verifyOperation, resolveReconciliation, assignEscalation, resolveEscalation,
      simulateTimeout, notifications, markAllRead, pushNotification],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): OpsStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdmin must be used inside AdminProvider");
  return ctx;
}
