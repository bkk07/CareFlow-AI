import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  approveHospital as apiApprove,
  fetchAIEvaluation as apiAIEval,
  fetchAuditEvents as apiAudit,
  fetchMetrics as apiMetrics,
  fetchPlatformAnalytics as apiAnalytics,
  fetchPlatformIntegrations as apiIntegrations,
  fetchPlatformOverview as apiOverview,
  listHospitals as apiHospitals,
  listPlatformAppointments as apiAppointments,
  listPlatformDoctors as apiDoctors,
  listPlatformPatients as apiPatients,
  listWorkflows as apiWorkflows,
  login as apiLogin,
  me as apiMe,
  probeBackend,
  rejectHospital as apiReject,
  restoreAccessToken,
  setAccessToken,
  suspendHospital as apiSuspend,
  type AIEvaluation,
  type ApiHospital,
  type CurrentUser,
  type OpsMetrics,
  type PlatformAnalytics,
  type PlatformOverview,
} from "../api";
import {
  formatDateTime,
  mapAppointment,
  mapAudit,
  mapDoctor,
  mapHospital,
  mapPatient,
  mapPlatformIntegration,
  mapWorkflow,
} from "../lib/backend";
import type {
  Appointment,
  AuditEvent,
  Doctor,
  Hospital,
  Integration,
  NotificationItem,
  Workflow,
} from "../types";
import { ALL_HOSPITALS, ADMIN_NOTIFICATIONS, INITIAL_AUDIT } from "../mock/platform";
import { INITIAL_APPOINTMENTS, INITIAL_DOCTORS } from "../mock/hospital";
import { WORKFLOWS } from "../mock/ops";

export type BackendMode = "checking" | "live" | "mock";

export interface PatientRow {
  id: string;
  email: string;
  active: boolean;
  since: string;
}

interface AdminStore {
  authed: boolean;
  /** Real platform-admin sign-in when reachable, mock fallback offline. */
  login: (email?: string, password?: string) => Promise<void>;
  loginMock: () => void;
  logout: () => void;
  mode: BackendMode;
  /** True when lists below come from the backend (false = mock seeds). */
  live: boolean;
  loading: boolean;
  backendError: string | null;
  user: CurrentUser | null;
  refreshAll: () => Promise<void>;
  hospitals: Hospital[];
  doctors: Doctor[];
  patients: PatientRow[];
  appointments: Appointment[];
  aiEvaluation: AIEvaluation | null;
  audit: AuditEvent[];
  overview: PlatformOverview | null;
  integrations: Integration[];
  analytics: PlatformAnalytics | null;
  workflows: Workflow[];
  metrics: OpsMetrics | null;
  reviewHospital: (id: string, decision: "approved" | "rejected", reason?: string) => Promise<void>;
  suspendHospital: (id: string) => Promise<void>;
  notifications: NotificationItem[];
  unread: number;
  markAllRead: () => void;
  pushNotification: (title: string, body: string) => void;
}

const Ctx = createContext<AdminStore | null>(null);
let seq = 1000;
const nid = (p: string) => `${p}-${seq++}`;
const MOCK_KEY = "careflow_platform_mock";

export function AdminProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<BackendMode>("checking");
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);

  const live = mode === "live" && authed && user?.role === "platform_admin";

  const [mockHospitals, setMockHospitals] = useState(ALL_HOSPITALS);
  const [mockAudit] = useState(INITIAL_AUDIT);

  const [liveHospitals, setLiveHospitals] = useState<Hospital[]>([]);
  const [liveDoctors, setLiveDoctors] = useState<Doctor[]>([]);
  const [livePatients, setLivePatients] = useState<PatientRow[]>([]);
  const [liveAppointments, setLiveAppointments] = useState<Appointment[]>([]);
  const [aiEvaluation, setAiEvaluation] = useState<AIEvaluation | null>(null);
  const [liveAudit, setLiveAudit] = useState<AuditEvent[]>([]);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
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
      const [hospitals, doctors, patients, appointments, aiEval, audit, over, integ, analytic, flows, mets] =
        await Promise.all([
          apiHospitals().catch(() => [] as ApiHospital[]),
          apiDoctors().catch(() => []),
          apiPatients().catch(() => ({ patients: [] })),
          apiAppointments().catch(() => []),
          apiAIEval().catch(() => null),
          apiAudit().catch(() => ({ events: [] })),
          apiOverview().catch(() => null),
          apiIntegrations().catch(() => null),
          apiAnalytics().catch(() => null),
          apiWorkflows().catch(() => []),
          apiMetrics().catch(() => null),
        ]);
      const hospitalName = (id: string) => hospitals.find((h) => h.id === id)?.name ?? id.slice(0, 8);
      const doctorName = (id: string) => doctors.find((d) => d.id === id)?.name ?? id.slice(0, 8);
      setLiveHospitals(
        hospitals.map((h) => {
          const docs = doctors.filter((d) => d.hospital_id === h.id);
          return mapHospital(h, docs.length, docs.filter((d) => d.status === "active").length, 0);
        }),
      );
      setLiveDoctors(doctors.map((d) => mapDoctor(d, hospitalName(d.hospital_id))));
      setLivePatients(patients.patients.map(mapPatient));
      setLiveAppointments(
        appointments.map((a) => mapAppointment(a, hospitalName(a.hospital_id), doctorName(a.doctor_id))),
      );
      if (aiEval) setAiEvaluation(aiEval);
      const actorName = (id: string | null) => {
        if (!id) return "system";
        const doc = doctors.find((d) => d.user_id === id);
        return doc?.name ?? id.slice(0, 8);
      };
      setLiveAudit(audit.events.map((e) => mapAudit(e, actorName(e.actor_user_id))));
      if (over) setOverview(over);
      if (integ) setIntegrations(integ.integrations.map(mapPlatformIntegration));
      if (analytic) setAnalytics(analytic);
      setWorkflows(flows.map(mapWorkflow));
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
        if (me.role !== "platform_admin") {
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
        if (me.role !== "platform_admin") {
          setAccessToken(null);
          throw fail("This console is for platform administrators.");
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

  const reviewHospital = useCallback(async (id: string, decision: "approved" | "rejected", reason?: string) => {
    if (!live) {
      setMockHospitals((p) => p.map((h) => (h.id === id ? { ...h, status: decision } : h)));
      pushNotification(decision === "approved" ? "Hospital approved" : "Hospital rejected", `${id} → ${decision}`);
      return;
    }
    try {
      if (decision === "approved") await apiApprove(id);
      else await apiReject(id, reason || "Rejected after platform review");
    } catch {
      throw fail(`Could not ${decision === "approved" ? "approve" : "reject"} hospital.`);
    }
    await refreshAll();
    pushNotification(decision === "approved" ? "Hospital approved" : "Hospital rejected", `${id} → ${decision}`);
  }, [live, refreshAll, fail]);

  const suspendHospital = useCallback(async (id: string) => {
    if (!live) {
      setMockHospitals((p) => p.map((h) => (h.id === id ? { ...h, status: "suspended" } : h)));
      return;
    }
    await apiSuspend(id).catch(() => { throw fail("Could not suspend hospital."); });
    await refreshAll();
  }, [live, refreshAll, fail]);

  const pushNotification = useCallback((title: string, body: string) => {
    setNotifications((prev) => [{ id: nid("n"), title, body, time: "Just now", unread: true }, ...prev]);
  }, []);
  const markAllRead = useCallback(() => setNotifications((prev) => prev.map((n) => ({ ...n, unread: false }))), []);

  const hospitals = live && liveLoaded ? liveHospitals : mockHospitals;
  const audit = live && liveLoaded ? liveAudit : mockAudit;

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
      refreshAll,
      hospitals,
      doctors: live && liveLoaded ? liveDoctors : INITIAL_DOCTORS,
      patients: live && liveLoaded ? livePatients : [],
      appointments: live && liveLoaded ? liveAppointments : INITIAL_APPOINTMENTS,
      aiEvaluation,
      audit,
      overview,
      integrations,
      analytics,
      workflows: live && liveLoaded ? workflows : WORKFLOWS,
      metrics,
      reviewHospital,
      suspendHospital,
      notifications,
      unread: notifications.filter((n) => n.unread).length,
      markAllRead,
      pushNotification,
    }),
    [authed, login, loginMock, logout, mode, live, liveLoaded, loading, backendError, user,
      refreshAll, hospitals, liveDoctors, livePatients, liveAppointments, aiEvaluation, audit,
      overview, integrations, analytics, workflows, metrics, reviewHospital, suspendHospital,
      notifications, markAllRead, pushNotification],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdmin must be used inside AdminProvider");
  return ctx;
}

export { formatDateTime };
