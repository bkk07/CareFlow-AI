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
  startHospitalReview as apiStartReview,
  requestHospitalCorrections as apiRequestCorrections,
  reinstateHospital as apiReinstate,
  type AIEvaluation,
  type CurrentUser,
  type OpsMetrics,
  type PlatformAnalytics,
  type PlatformOverview,
} from "../api";
import {
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

export type BackendMode = "checking" | "live";

export interface PatientRow {
  id: string;
  email: string;
  active: boolean;
  since: string;
}

interface AdminStore {
  authed: boolean;
  /** Platform-admin sign-in via backend JWT. */
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  mode: BackendMode;
  /** True when the session is an authenticated live backend session. */
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
  startReview: (id: string) => Promise<void>;
  requestCorrections: (id: string, message: string) => Promise<void>;
  reinstateHospital: (id: string) => Promise<void>;
  notifications: NotificationItem[];
  unread: number;
  markAllRead: () => void;
  pushNotification: (title: string, body: string) => void;
}

const Ctx = createContext<AdminStore | null>(null);
let seq = 1000;
const nid = (p: string) => `${p}-${seq++}`;

export function AdminProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<BackendMode>("checking");
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const live = mode === "live" && authed && user?.role === "platform_admin";

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [aiEvaluation, setAiEvaluation] = useState<AIEvaluation | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
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
      const [hospitalRows, doctorRows, patientRes, appointmentRows, aiEval, auditRes, over, integ, analytic, flows, mets] =
        await Promise.all([
          apiHospitals(),
          apiDoctors(),
          apiPatients(),
          apiAppointments(),
          apiAIEval(),
          apiAudit(),
          apiOverview(),
          apiIntegrations(),
          apiAnalytics(),
          apiWorkflows(),
          apiMetrics(),
        ]);
      const hospitalName = (id: string) => hospitalRows.find((h) => h.id === id)?.name ?? id.slice(0, 8);
      const doctorName = (id: string) => doctorRows.find((d) => d.id === id)?.name ?? id.slice(0, 8);
      setHospitals(
        hospitalRows.map((h) => {
          const docs = doctorRows.filter((d) => d.hospital_id === h.id);
          return mapHospital(h, docs.length, docs.filter((d) => d.status === "active").length, 0);
        }),
      );
      setDoctors(doctorRows.map((d) => mapDoctor(d, hospitalName(d.hospital_id))));
      setPatients(patientRes.patients.map(mapPatient));
      setAppointments(
        appointmentRows.map((a) => mapAppointment(a, hospitalName(a.hospital_id), doctorName(a.doctor_id))),
      );
      setAiEvaluation(aiEval);
      const actorName = (id: string | null) => {
        if (!id) return "system";
        const doc = doctorRows.find((d) => d.user_id === id);
        return doc?.name ?? id.slice(0, 8);
      };
      setAudit(auditRes.events.map((e) => mapAudit(e, actorName(e.actor_user_id))));
      setOverview(over);
      setIntegrations(integ.integrations.map(mapPlatformIntegration));
      setAnalytics(analytic);
      setWorkflows(flows.map(mapWorkflow));
      setMetrics(mets);
    } catch {
      setBackendError("Could not load platform data. Check the backend connection and retry.");
    } finally {
      setLoading(false);
    }
  }, [live]);

  useEffect(() => {
    if (live) void refreshAll();
  }, [live, refreshAll]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reachable = await probeBackend();
      if (cancelled) return;
      if (!reachable) {
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

  const login = useCallback(async (email: string, password: string) => {
    setBackendError(null);
    const reachable = await probeBackend();
    if (!reachable) throw fail("Backend is unreachable. Start the backend and retry.");
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
    } catch (e) {
      if (e instanceof Error && (e.message.startsWith("Backend") || e.message.startsWith("This console"))) throw e;
      throw fail("Sign-in failed. Check your email and password.");
    }
  }, [fail]);

  const logout = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setAuthed(false);
    setBackendError(null);
    setHospitals([]);
    setDoctors([]);
    setPatients([]);
    setAppointments([]);
    setAiEvaluation(null);
    setAudit([]);
    setOverview(null);
    setIntegrations([]);
    setAnalytics(null);
    setWorkflows([]);
    setMetrics(null);
    setNotifications([]);
  }, []);

  const reviewHospital = useCallback(async (id: string, decision: "approved" | "rejected", reason?: string) => {
    if (!live) throw fail("Not authenticated. Sign in to review hospitals.");
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
    if (!live) throw fail("Not authenticated. Sign in to manage hospitals.");
    await apiSuspend(id).catch(() => { throw fail("Could not suspend hospital."); });
    await refreshAll();
  }, [live, refreshAll, fail]);

  const startReview = useCallback(async (id: string) => {
    if (!live) throw fail("Not authenticated. Sign in to review hospitals.");
    await apiStartReview(id).catch(() => { throw fail("Could not start review (already under review?)."); });
    await refreshAll();
    pushNotification("Review started", `${id} → under_review`);
  }, [live, refreshAll, fail]);

  const requestCorrections = useCallback(async (id: string, message: string) => {
    if (!live) throw fail("Not authenticated. Sign in to review hospitals.");
    await apiRequestCorrections(id, message).catch(() => { throw fail("Could not request corrections."); });
    await refreshAll();
    pushNotification("Corrections requested", `${id} → draft`);
  }, [live, refreshAll, fail]);

  const reinstateHospital = useCallback(async (id: string) => {
    if (!live) throw fail("Not authenticated. Sign in to manage hospitals.");
    await apiReinstate(id).catch(() => { throw fail("Could not reinstate hospital."); });
    await refreshAll();
    pushNotification("Hospital reinstated", `${id} → approved`);
  }, [live, refreshAll, fail]);

  const pushNotification = useCallback((title: string, body: string) => {
    setNotifications((prev) => [{ id: nid("n"), title, body, time: "Just now", unread: true }, ...prev]);
  }, []);
  const markAllRead = useCallback(() => setNotifications((prev) => prev.map((n) => ({ ...n, unread: false }))), []);

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
      refreshAll,
      hospitals,
      doctors,
      patients,
      appointments,
      aiEvaluation,
      audit,
      overview,
      integrations,
      analytics,
      workflows,
      metrics,
      reviewHospital,
      suspendHospital,
      startReview,
      requestCorrections,
      reinstateHospital,
      notifications,
      unread: notifications.filter((n) => n.unread).length,
      markAllRead,
      pushNotification,
    }),
    [authed, login, logout, mode, live, loading, backendError, user,
      refreshAll, hospitals, doctors, patients, appointments, aiEvaluation, audit,
      overview, integrations, analytics, workflows, metrics, reviewHospital, suspendHospital,
      startReview, requestCorrections, reinstateHospital,
      notifications, markAllRead, pushNotification],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdmin must be used inside AdminProvider");
  return ctx;
}
