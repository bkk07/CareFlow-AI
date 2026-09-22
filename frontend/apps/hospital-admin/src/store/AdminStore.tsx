import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  activateDoctor as apiActivateDoctor,
  addQuestion as apiAddQuestion,
  deleteQuestion as apiDeleteQuestion,
  updateQuestion as apiUpdateQuestion,
  deleteQuestionnaire as apiDeleteQuestionnaire,
  createAppointmentType as apiCreateType,
  updateAppointmentType as apiUpdateType,
  createDepartment as apiCreateDepartment,
  createDoctor as apiCreateDoctor,
  updateDoctor as apiUpdateDoctor,
  deleteDoctor as apiDeleteDoctor,
  createQuestionnaire as apiCreateQuestionnaire,
  createSpecialty as apiCreateSpecialty,
  renameSpecialty as apiRenameSpecialty,
  deactivateDoctor as apiDeactivateDoctor,
  suspendDoctor as apiSuspendDoctor,
  deactivateStaff as apiDeactivateStaff,
  deleteAppointmentType as apiDeleteType,
  deleteDepartment as apiDeleteDepartment,
  deleteSpecialty as apiDeleteSpecialty,
  fetchAIActivity as apiAIActivity,
  fetchAnalytics as apiAnalytics,
  fetchIntegrationStatus as apiIntegration,
  fetchOverview as apiOverview,
  getHospital as apiGetHospital,
  getQuestionnaireDetail as apiQuestionDetail,
  inviteStaff as apiInviteStaff,
  inviteDoctorLogin as apiInviteDoctorLogin,
  listAppointments as apiAppointments,
  listAppointmentTypes as apiTypes,
  listDepartments as apiDepartments,
  listDoctors as apiDoctors,
  listEscalations as apiEscalations,
  listOperations as apiOperations,
  listQuestionnaires as apiQuestionnaires,
  listReconciliations as apiReconciliations,
  listSpecialties as apiSpecialties,
  listStaff as apiStaff,
  listWorkflows as apiWorkflows,
  login as apiLogin,
  me as apiMe,
  probeBackend,
  renameDepartment as apiRenameDepartment,
  removeDoctorLogin as apiRemoveDoctorLogin,
  resolveEscalation as apiResolveEscalation,
  resolveReconciliation as apiResolveRecord,
  retryReconciliation as apiRetryRecord,
  restoreAccessToken,
  retryOperation as apiRetryOperation,
  setAccessToken,
  updateHospital as apiUpdateHospital,
  resubmitHospital as apiResubmitHospital,
  updateQuestionnaire as apiUpdateQuestionnaire,
  verifyAppointment as apiVerify,
  cancelAppointment as apiCancelAppointment,
  completeAppointment as apiCompleteAppointment,
  markNoShow as apiNoShowAppointment,
  confirmAppointment as apiConfirmAppointment,
  type AIActivityEntry,
  type CurrentUser,
  type Hospital as ApiHospital,
  type QuestionnaireDetail,
} from "../api";
import type {
  Appointment,
  AppointmentType,
  AuditEvent,
  Department,
  Doctor,
  Escalation,
  Hospital,
  NotificationItem,
  Operation,
  Questionnaire,
  Reconciliation,
  Role,
  Specialty,
  StaffMember,
  Workflow,
} from "../types";
import {
  mapAIExecution,
  mapAppointment,
  mapDepartment,
  mapDoctor,
  mapEscalation,
  mapOperation,
  mapQuestionnaire,
  mapReconciliation,
  mapSpecialty,
  mapStaff,
  mapWorkflow,
} from "../lib/backend";

export type BackendMode = "checking" | "live";

export interface AIExecRow {
  id: string;
  time: string;
  tool: string;
  status: string;
  latency: number;
  correlation: string;
  actor: string | null;
  error: string | null;
}

interface AdminStore {
  role: Role;
  setRole: (r: Role) => void;
  authed: boolean;
  /** JWT sign-in against the backend. */
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  mode: BackendMode;
  /** True when signed in with a hospital-scoped backend session. */
  live: boolean;
  loading: boolean;
  /** Background revalidation (no skeleton flash). */
  syncing: boolean;
  backendError: string | null;
  user: CurrentUser | null;
  hospital: ApiHospital | null;
  refreshAll: () => Promise<void>;
  /** Targeted re-fetch of one section (avoids full reload flicker). */
  refreshSection: (section: "departments" | "specialties" | "types" | "doctors" | "appointments" | "questionnaires" | "staff" | "ops" | "insights") => Promise<void>;
  updateHospital: (patch: {
    name?: string;
    address?: string;
    contact_email?: string;
    contact_phone?: string;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    operating_hours?: Record<string, [string, string]> | null;
  }) => Promise<void>;
  resubmitHospital: () => Promise<void>;
  // hospital
  departments: Department[];
  specialties: Specialty[];
  types: AppointmentType[];
  doctors: Doctor[];
  appointments: Appointment[];
  questionnaires: Questionnaire[];
  staff: StaffMember[];
  addDepartment: (name: string) => Promise<void>;
  renameDepartment: (id: string, name: string) => Promise<void>;
  deleteDepartment: (id: string) => Promise<void>;
  toggleDepartment: (id: string) => Promise<void>;
  addSpecialty: (name: string) => Promise<void>;
  renameSpecialty: (id: string, name: string) => Promise<void>;
  deleteSpecialty: (id: string) => Promise<void>;
  toggleSpecialty: (id: string) => void;
  addType: (t: Omit<AppointmentType, "id" | "status">) => Promise<void>;
  updateType: (id: string, t: { name: string; duration: number; compatible_specialty_ids?: string[] }) => Promise<void>;
  deleteType: (id: string) => Promise<void>;
  toggleType: (id: string) => void;
  createDoctor: (input: {
    name: string;
    specialty_id?: string | null;
    department_id?: string | null;
    experience_years?: number;
    languages?: string[];
    consultation_types?: string[];
  }) => Promise<void>;
  setDoctorStatus: (id: string, status: Doctor["status"]) => Promise<void>;
  updateDoctor: (id: string, patch: {
    name?: string;
    specialty_id?: string | null;
    department_id?: string | null;
    experience_years?: number;
    languages?: string[];
    consultation_types?: string[];
  }) => Promise<void>;
  deleteDoctor: (id: string) => Promise<void>;
  inviteDoctorLogin: (id: string, email: string, password: string) => Promise<void>;
  removeDoctorLogin: (id: string) => Promise<void>;
  cancelAppointment: (id: string) => Promise<void>;
  completeAppointment: (id: string) => Promise<void>;
  markNoShow: (id: string) => Promise<void>;
  confirmAppointment: (id: string) => Promise<void>;
  createQuestionnaire: (name: string, scope?: string, scopeRefId?: string | null) => Promise<void>;
  deleteQuestionnaire: (id: string) => Promise<void>;
  updateQuestionnaireQuestion: (qid: string, questionId: string, patch: { prompt?: string; required?: boolean }) => Promise<void>;
  deleteQuestionnaireQuestion: (qid: string, questionId: string) => Promise<void>;
  addQuestionnaireQuestion: (id: string, body: { order: number; type: string; prompt: string; options?: string[] | null; required?: boolean }) => Promise<void>;
  duplicateQuestionnaire: (id: string) => Promise<void>;
  toggleQuestionnaire: (id: string) => Promise<void>;
  fetchQuestionnaireDetail: (id: string) => Promise<QuestionnaireDetail | null>;
  inviteStaff: (email: string, password: string) => Promise<void>;
  deactivateStaff: (id: string) => Promise<void>;
  // platform scope (no dedicated backend endpoint: session-local, starts empty)
  hospitals: Hospital[];
  audit: AuditEvent[];
  reviewHospital: (id: string, decision: "approved" | "rejected") => void;
  // ops
  operations: Operation[];
  reconciliations: Reconciliation[];
  escalations: Escalation[];
  workflows: Workflow[];
  aiExecutions: AIExecRow[];
  integrationRows: AIActivityEntry[];
  overview: {
    doctors_total: number;
    doctors_active: number;
    appointments_this_week: number;
    upcoming_appointments: number;
    pending_reconciliations: number;
  } | null;
  analytics: {
    appointments_total: number;
    appointments_by_state: Record<string, number>;
    bookings_per_day_30d: Record<string, number>;
    tool_success_avg_latency_ms: number | null;
  } | null;
  integration: {
    vendor_mappings: number;
    open_reconciliations: number;
    verifications_24h: Record<string, number>;
  } | null;
  retryOperation: (id: string) => Promise<void>;
  retryReconciliation: (id: string) => Promise<void>;
  verifyOperation: (id: string) => Promise<string>;
  resolveReconciliation: (id: string, finalState: string, note: string) => Promise<void>;
  assignEscalation: (id: string, who: string) => void;
  resolveEscalation: (id: string) => Promise<void>;
  // session-local event feed (no inbox endpoint: starts empty)
  notifications: NotificationItem[];
  unread: number;
  markAllRead: () => void;
  pushNotification: (title: string, body: string) => void;
}

const Ctx = createContext<AdminStore | null>(null);
let seq = 1000;
const nid = (p: string) => `${p}-${seq++}`;

const FINAL_STATE_MAP: Record<string, string> = {
  Confirmed: "confirmed",
  Cancelled: "cancelled",
  Failed: "failed",
};

export function AdminProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("hospital");
  const [mode, setMode] = useState<BackendMode>("checking");
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [hospital, setHospital] = useState<ApiHospital | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const refreshInFlight = useRef(false);
  const didInitialFetch = useRef(false);

  const live = mode === "live" && authed && user?.hospital_id != null;
  const hospitalId = live && user?.hospital_id ? user.hospital_id : null;

  // Live rows (empty until the backend returns data).
  const [liveDepartments, setLiveDepartments] = useState<Department[]>([]);
  const [liveSpecialties, setLiveSpecialties] = useState<Specialty[]>([]);
  const [liveTypes, setLiveTypes] = useState<AppointmentType[]>([]);
  const [liveDoctors, setLiveDoctors] = useState<Doctor[]>([]);
  const [liveAppointments, setLiveAppointments] = useState<Appointment[]>([]);
  const [liveQuestionnaires, setLiveQuestionnaires] = useState<Questionnaire[]>([]);
  const [liveStaff, setLiveStaff] = useState<StaffMember[]>([]);
  const [liveOperations, setLiveOperations] = useState<Operation[]>([]);
  const [liveReconciliations, setLiveReconciliations] = useState<Reconciliation[]>([]);
  const [liveEscalations, setLiveEscalations] = useState<Escalation[]>([]);
  const [liveWorkflows, setLiveWorkflows] = useState<Workflow[]>([]);
  const [liveAI, setLiveAI] = useState<AIExecRow[]>([]);
  const [liveIntegrationRows, setLiveIntegrationRows] = useState<AIActivityEntry[]>([]);
  const [overview, setOverview] = useState<AdminStore["overview"]>(null);
  const [analytics, setAnalytics] = useState<AdminStore["analytics"]>(null);
  const [integration, setIntegration] = useState<AdminStore["integration"]>(null);

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const fail = useCallback((message: string): Error => {
    setBackendError(message);
    return new Error(message);
  }, []);

  const applyCatalog = useCallback(
    (
      depts: Awaited<ReturnType<typeof apiDepartments>>,
      specs: Awaited<ReturnType<typeof apiSpecialties>>,
      types: Awaited<ReturnType<typeof apiTypes>>,
      docs: Awaited<ReturnType<typeof apiDoctors>>,
      hospitalName: string,
    ) => {
      const specName = (id: string | null) => specs.find((s) => s.id === id)?.name ?? "";
      const deptName = (id: string | null) => depts.find((d) => d.id === id)?.name ?? "";
      const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? "Visit";
      setLiveDepartments(
        depts.map((d) => {
          const deptDocs = docs.filter((doc) => doc.department_id === d.id);
          const specialtyNames = [
            ...new Set(
              deptDocs
                .map((doc) => specs.find((s) => s.id === doc.specialty_id)?.name)
                .filter((n): n is string => !!n),
            ),
          ].sort();
          return mapDepartment(d, specialtyNames, deptDocs.length);
        }),
      );
      setLiveSpecialties(
        specs.map((s) => {
          const specDocs = docs.filter((doc) => doc.specialty_id === s.id);
          const departmentNames = [
            ...new Set(
              specDocs
                .map((doc) => depts.find((d) => d.id === doc.department_id)?.name)
                .filter((n): n is string => !!n),
            ),
          ].sort();
          return mapSpecialty(s, specDocs.length, departmentNames.join(", "));
        }),
      );
      setLiveTypes(
        types.map((t) => ({
          id: t.id,
          name: t.name,
          description: `${t.duration_minutes} min visit`,
          duration: t.duration_minutes,
          mode: "In person",
          status: "active" as const,
        })),
      );
      setLiveDoctors(
        docs.map((d) => mapDoctor(d, specName(d.specialty_id), deptName(d.department_id), hospitalName, 0)),
      );
      return typeName;
    },
    [],
  );

  const refreshAll = useCallback(async () => {
    if (!live || !hospitalId) return;
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const isInitial = !didInitialFetch.current;
    if (isInitial) setLoading(true);
    else setSyncing(true);
    setBackendError(null);
    try {
      const hid = hospitalId;
      const hosp = await apiGetHospital(hid).catch(() => null);
      if (hosp) setHospital(hosp);
      const hospitalName = hosp?.name ?? hospital?.name ?? "Hospital";

      const [depts, specs, types, docs, appts, forms, staff, ops, recs, escs, flows] =
        await Promise.all([
          apiDepartments(hid, { limit: 500 }).catch(() => []),
          apiSpecialties(hid, { limit: 500 }).catch(() => []),
          apiTypes(hid, { limit: 500 }).catch(() => []),
          apiDoctors(hid, { limit: 200 }).catch(() => []),
          apiAppointments(hid, { limit: 200 }).catch(() => []),
          apiQuestionnaires(hid, { limit: 200 }).catch(() => []),
          apiStaff(hid, { limit: 200 }).catch(() => []),
          apiOperations({ limit: 100 }).catch(() => []),
          apiReconciliations({ limit: 100 }).catch(() => []),
          apiEscalations({ limit: 100 }).catch(() => []),
          apiWorkflows({ limit: 100 }).catch(() => []),
        ]);
      const typeName = applyCatalog(depts, specs, types, docs, hospitalName);
      setLiveAppointments(
        appts.map((a) => {
          const doc = docs.find((d) => d.id === a.doctor_id);
          const spec = specs.find((s) => s.id === doc?.specialty_id)?.name ?? "";
          return mapAppointment(
            a,
            doc?.name ?? a.doctor_id.slice(0, 8),
            spec,
            hospitalName,
            typeName(a.appointment_type_id),
          );
        }),
      );
      // Forms render immediately; question counts enrich in background
      // (avoids N+1 blocking the whole console).
      setLiveQuestionnaires(forms.map((f) => mapQuestionnaire(f, null)));
      if (forms.length > 0) {
        void Promise.all(forms.map((f) => apiQuestionDetail(hid, f.id).catch(() => null))).then(
          (details) => {
            setLiveQuestionnaires(forms.map((f, i) => mapQuestionnaire(f, details[i])));
          },
        );
      }
      setLiveStaff(staff.map(mapStaff));
      setLiveOperations(ops.map(mapOperation));
      setLiveReconciliations(recs.map(mapReconciliation));
      setLiveEscalations(escs.map(mapEscalation));
      setLiveWorkflows(flows.map(mapWorkflow));

      const [ai, integ, analytic, over] = await Promise.all([
        apiAIActivity(hid, { limit: 100 }).catch(() => null),
        apiIntegration(hid).catch(() => null),
        apiAnalytics(hid).catch(() => null),
        apiOverview(hid).catch(() => null),
      ]);
      if (ai) {
        setLiveIntegrationRows(ai.executions);
        setLiveAI(
          ai.executions.map((e) => {
            const m = mapAIExecution(e);
            return {
              id: m.id,
              time: m.time,
              tool: m.tool,
              status: m.status,
              latency: m.latency,
              correlation: m.correlation,
              actor: m.actor,
              error: m.error,
            };
          }),
        );
      }
      if (integ) {
        setIntegration({
          vendor_mappings: integ.vendor_mappings,
          open_reconciliations: integ.open_reconciliations,
          verifications_24h: integ.verifications_24h,
        });
      }
      if (analytic) setAnalytics(analytic);
      if (over) setOverview(over);
      didInitialFetch.current = true;
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
      setSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, hospitalId, applyCatalog]);

  const refreshSection = useCallback(
    async (section: "departments" | "specialties" | "types" | "doctors" | "appointments" | "questionnaires" | "staff" | "ops" | "insights") => {
      if (!live || !hospitalId) return;
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      setSyncing(true);
      try {
        const hid = hospitalId;
        if (section === "departments" || section === "specialties" || section === "types" || section === "doctors") {
          const [depts, specs, types, docs] = await Promise.all([
            apiDepartments(hid, { limit: 500 }).catch(() => []),
            apiSpecialties(hid, { limit: 500 }).catch(() => []),
            apiTypes(hid, { limit: 500 }).catch(() => []),
            apiDoctors(hid, { limit: 200 }).catch(() => []),
          ]);
          applyCatalog(depts, specs, types, docs, hospital?.name ?? "Hospital");
        } else if (section === "appointments") {
          const [appts, docs, specs, types] = await Promise.all([
            apiAppointments(hid, { limit: 200 }).catch(() => []),
            apiDoctors(hid, { limit: 200 }).catch(() => []),
            apiSpecialties(hid, { limit: 500 }).catch(() => []),
            apiTypes(hid, { limit: 500 }).catch(() => []),
          ]);
          const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? "Visit";
          setLiveAppointments(
            appts.map((a) => {
              const doc = docs.find((d) => d.id === a.doctor_id);
              const spec = specs.find((s) => s.id === doc?.specialty_id)?.name ?? "";
              return mapAppointment(
                a,
                doc?.name ?? a.doctor_id.slice(0, 8),
                spec,
                hospital?.name ?? "Hospital",
                typeName(a.appointment_type_id),
              );
            }),
          );
        } else if (section === "questionnaires") {
          const forms = await apiQuestionnaires(hid, { limit: 200 }).catch(() => []);
          setLiveQuestionnaires(forms.map((f) => mapQuestionnaire(f, null)));
        } else if (section === "staff") {
          const staff = await apiStaff(hid, { limit: 200 }).catch(() => []);
          setLiveStaff(staff.map(mapStaff));
        } else if (section === "ops") {
          const [ops, recs, escs, flows] = await Promise.all([
            apiOperations({ limit: 100 }).catch(() => []),
            apiReconciliations({ limit: 100 }).catch(() => []),
            apiEscalations({ limit: 100 }).catch(() => []),
            apiWorkflows({ limit: 100 }).catch(() => []),
          ]);
          setLiveOperations(ops.map(mapOperation));
          setLiveReconciliations(recs.map(mapReconciliation));
          setLiveEscalations(escs.map(mapEscalation));
          setLiveWorkflows(flows.map(mapWorkflow));
        } else {
          const [ai, integ, analytic, over] = await Promise.all([
            apiAIActivity(hid, { limit: 100 }).catch(() => null),
            apiIntegration(hid).catch(() => null),
            apiAnalytics(hid).catch(() => null),
            apiOverview(hid).catch(() => null),
          ]);
          if (ai) {
            setLiveIntegrationRows(ai.executions);
            setLiveAI(
              ai.executions.map((e) => {
                const m = mapAIExecution(e);
                return {
                  id: m.id,
                  time: m.time,
                  tool: m.tool,
                  status: m.status,
                  latency: m.latency,
                  correlation: m.correlation,
                  actor: m.actor,
                  error: m.error,
                };
              }),
            );
          }
          if (integ)
            setIntegration({
              vendor_mappings: integ.vendor_mappings,
              open_reconciliations: integ.open_reconciliations,
              verifications_24h: integ.verifications_24h,
            });
          if (analytic) setAnalytics(analytic);
          if (over) setOverview(over);
        }
      } finally {
        refreshInFlight.current = false;
        setSyncing(false);
      }
    },
    [live, hospitalId, hospital?.name, applyCatalog],
  );

  useEffect(() => {
    if (live && !didInitialFetch.current && !refreshInFlight.current) void refreshAll();
    if (!live) {
      didInitialFetch.current = false;
    }
  }, [live, refreshAll]);

  // -- auth (backend JWT only) -------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reachable = await probeBackend();
      if (cancelled) return;
      if (!reachable) {
        setMode("live");
        setBackendError("Backend is unreachable. Sign-in and data require the API at VITE_API_URL.");
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
        setUser(me);
        setAuthed(true);
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
    if (!reachable) throw fail("Backend is unreachable — check VITE_API_URL and try again.");
    try {
      await apiLogin(email, password);
      const me = await apiMe();
      if (me.role !== "hospital_admin") {
        setAccessToken(null);
        throw fail("This console is for hospital administrators.");
      }
      setUser(me);
      setAuthed(true);
      setMode("live");
      return;
    } catch (e) {
      if (e instanceof Error && (e.message.startsWith("Backend") || e.message === "This console is for hospital administrators.")) throw e;
      throw fail("Sign-in failed. Check your email and password.");
    }
  }, [fail]);

  const logout = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setHospital(null);
    setAuthed(false);
    setBackendError(null);
    didInitialFetch.current = false;
    refreshInFlight.current = false;
    setSyncing(false);
    setLoading(false);
    setLiveDepartments([]);
    setLiveSpecialties([]);
    setLiveTypes([]);
    setLiveDoctors([]);
    setLiveAppointments([]);
    setLiveQuestionnaires([]);
    setLiveStaff([]);
    setLiveOperations([]);
    setLiveReconciliations([]);
    setLiveEscalations([]);
    setLiveWorkflows([]);
    setLiveAI([]);
    setLiveIntegrationRows([]);
    setOverview(null);
    setAnalytics(null);
    setIntegration(null);
  }, []);

  const updateHospital = useCallback(async (patch: {
    name?: string;
    address?: string;
    contact_email?: string;
    contact_phone?: string;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    operating_hours?: Record<string, [string, string]> | null;
  }) => {
    if (!live || !hospitalId) throw fail("Sign in — hospital edits need the backend.");
    const next = await apiUpdateHospital(hospitalId, patch).catch(() => {
      throw fail("Could not save hospital profile.");
    });
    setHospital(next);
  }, [live, hospitalId, fail]);

  const resubmitHospital = useCallback(async () => {
    if (!live || !hospitalId) throw fail("Sign in — resubmission needs the backend.");
    const next = await apiResubmitHospital(hospitalId).catch(() => {
      throw fail("Could not resubmit (only drafts can be resubmitted).");
    });
    setHospital(next);
  }, [live, hospitalId, fail]);

  // -- catalog (live CRUD only) ------------------------------------------------------

  const addDepartment = useCallback(async (name: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing departments needs the backend.");
    await apiCreateDepartment(hospitalId, name).catch(() => { throw fail("Could not add department (name may exist)."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const renameDepartment = useCallback(async (id: string, name: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing departments needs the backend.");
    await apiRenameDepartment(hospitalId, id, name).catch(() => { throw fail("Could not rename department."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const deleteDepartment = useCallback(async (id: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing departments needs the backend.");
    await apiDeleteDepartment(hospitalId, id).catch(() => {
      throw fail("Cannot delete: referenced by doctors, or already removed.");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const toggleDepartment = useCallback(async (id: string) => {
    // Backend departments carry no status flag: toggle deletes the row.
    if (!live || !hospitalId) throw fail("Sign in — managing departments needs the backend.");
    await deleteDepartment(id);
  }, [live, hospitalId, deleteDepartment]);

  const addSpecialty = useCallback(async (name: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing specialties needs the backend.");
    await apiCreateSpecialty(hospitalId, name).catch(() => { throw fail("Could not add specialty (name may exist)."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const deleteSpecialty = useCallback(async (id: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing specialties needs the backend.");
    await apiDeleteSpecialty(hospitalId, id).catch(() => {
      throw fail("Cannot delete: referenced by doctors, or already removed.");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const renameSpecialty = useCallback(async (id: string, name: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing specialties needs the backend.");
    await apiRenameSpecialty(hospitalId, id, name).catch(() => {
      throw fail("Could not rename specialty (name may exist).");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const toggleSpecialty = useCallback((_id: string) => {
    // Live specialties have no status flag — use Delete.
    setBackendError("Status toggle is not supported by the backend — use Delete.");
  }, []);

  const addType = useCallback(async (t: Omit<AppointmentType, "id" | "status">) => {
    if (!live || !hospitalId) throw fail("Sign in — managing appointment types needs the backend.");
    await apiCreateType(hospitalId, { name: t.name, duration_minutes: t.duration }).catch(() => {
      throw fail("Could not add appointment type (name may exist).");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const deleteType = useCallback(async (id: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing appointment types needs the backend.");
    await apiDeleteType(hospitalId, id).catch(() => { throw fail("Could not delete appointment type."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const updateType = useCallback(async (id: string, t: { name: string; duration: number; compatible_specialty_ids?: string[] }) => {
    if (!live || !hospitalId) throw fail("Sign in — managing appointment types needs the backend.");
    await apiUpdateType(hospitalId, id, {
      name: t.name,
      duration_minutes: t.duration,
      compatible_specialty_ids: t.compatible_specialty_ids ?? [],
    }).catch(() => { throw fail("Could not update appointment type (name may exist)."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const toggleType = useCallback((_id: string) => {
    // Live types have no status flag — use Delete.
    setBackendError("Status toggle is not supported by the backend — use Delete.");
  }, []);

  // -- doctors ---------------------------------------------------------------------

  const createDoctor = useCallback(async (input: {
    name: string;
    specialty_id?: string | null;
    department_id?: string | null;
    experience_years?: number;
    languages?: string[];
    consultation_types?: string[];
  }) => {
    if (!live || !hospitalId) throw fail("Sign in — creating doctors needs the backend.");
    await apiCreateDoctor(hospitalId, input).catch(() => {
      throw fail("Could not create doctor. Check specialty/department.");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const inviteDoctorLogin = useCallback(async (id: string, email: string, password: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing doctor logins needs the backend.");
    await apiInviteDoctorLogin(hospitalId, id, { email, password }).catch((e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: unknown }; status?: number } })?.response;
      if (detail?.status === 409) throw fail("Email already registered or doctor already has a login.");
      throw fail("Could not create login. Check the email and password (min 8 characters).");
    });
    await refreshAll();
    log("Doctor login created", id);
  }, [live, hospitalId, refreshAll, fail]);

  const removeDoctorLogin = useCallback(async (id: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing doctor logins needs the backend.");
    await apiRemoveDoctorLogin(hospitalId, id).catch(() => {
      throw fail("Could not remove login.");
    });
    await refreshAll();
    log("Doctor login removed", id);
  }, [live, hospitalId, refreshAll, fail]);

  const setDoctorStatus = useCallback(async (id: string, status: Doctor["status"]) => {    if (!live || !hospitalId) throw fail("Sign in — managing doctors needs the backend.");
    try {
      if (status === "active") await apiActivateDoctor(hospitalId, id);
      else if (status === "inactive") await apiDeactivateDoctor(hospitalId, id);
      else if (status === "suspended") await apiSuspendDoctor(hospitalId, id);
      else throw fail("Only activate/deactivate/suspend is supported by the backend.");
    } catch (e) {
      if (e instanceof Error && e.message === "Only activate/deactivate/suspend is supported by the backend.") throw e;
      throw fail("Status change rejected — set specialty, department and a compatible visit type first.");
    }
    await refreshAll();
    log(status === "active" ? "Doctor activated" : status === "suspended" ? "Doctor suspended" : "Doctor deactivated", id);
  }, [live, hospitalId, refreshAll, fail]);

  const updateDoctor = useCallback(async (id: string, patch: {
    name?: string;
    specialty_id?: string | null;
    department_id?: string | null;
    experience_years?: number;
    languages?: string[];
    consultation_types?: string[];
  }) => {
    if (!live || !hospitalId) throw fail("Sign in — managing doctors needs the backend.");
    await apiUpdateDoctor(hospitalId, id, patch).catch(() => { throw fail("Could not update doctor."); });
    await refreshAll();
    log("Doctor updated", id);
  }, [live, hospitalId, refreshAll, fail]);

  const deleteDoctor = useCallback(async (id: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing doctors needs the backend.");
    await apiDeleteDoctor(hospitalId, id).catch(() => { throw fail("Could not delete doctor (upcoming visits may reference them)."); });
    await refreshAll();
    log("Doctor deleted", id);
  }, [live, hospitalId, refreshAll, fail]);

  // -- appointments ------------------------------------------------------------------

  const cancelAppointment = useCallback(async (id: string) => {
    if (!live) throw fail("Sign in — managing appointments needs the backend.");
    await apiCancelAppointment(id).catch(() => { throw fail("Could not cancel appointment."); });
    await refreshAll();
    log("Appointment cancelled", id);
  }, [live, refreshAll, fail]);

  const completeAppointment = useCallback(async (id: string) => {
    if (!live) throw fail("Sign in — managing appointments needs the backend.");
    await apiCompleteAppointment(id).catch(() => { throw fail("Could not complete appointment (wrong state?)."); });
    await refreshAll();
    log("Appointment completed", id);
  }, [live, refreshAll, fail]);

  const markNoShow = useCallback(async (id: string) => {
    if (!live) throw fail("Sign in — managing appointments needs the backend.");
    await apiNoShowAppointment(id).catch(() => { throw fail("Could not mark no-show (wrong state?)."); });
    await refreshAll();
    log("Appointment marked no-show", id);
  }, [live, refreshAll, fail]);

  const confirmAppointment = useCallback(async (id: string) => {
    if (!live) throw fail("Sign in — managing appointments needs the backend.");
    await apiConfirmAppointment(id).catch(() => { throw fail("Could not confirm appointment (wrong state?)."); });
    await refreshAll();
    log("Appointment confirmed", id);
  }, [live, refreshAll, fail]);

  // -- questionnaires ------------------------------------------------------------------

  const createQuestionnaire = useCallback(async (name: string, scope?: string, scopeRefId?: string | null) => {
    if (!live || !hospitalId) throw fail("Sign in — managing questionnaires needs the backend.");
    await apiCreateQuestionnaire(hospitalId, { name, scope: scope ?? "hospital", scope_ref_id: scopeRefId ?? null }).catch(() => { throw fail("Could not create questionnaire."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const addQuestionnaireQuestion = useCallback(async (id: string, body: { order: number; type: string; prompt: string; options?: string[] | null; required?: boolean }) => {
    if (!live || !hospitalId) throw fail("Sign in — managing questionnaires needs the backend.");
    if ((body.type === "choice" || body.type === "multi_choice") && (!body.options || body.options.length === 0)) {
      throw fail("Choice questions need at least one option.");
    }
    await apiAddQuestion(hospitalId, id, body).catch(() => { throw fail("Could not add question."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const duplicateQuestionnaire = useCallback(async (id: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing questionnaires needs the backend.");
    const detail = await apiQuestionDetail(hospitalId, id).catch(() => { throw fail("Could not read questionnaire."); });
    const copy = await apiCreateQuestionnaire(hospitalId, { name: `${detail.questionnaire.name} (copy)` }).catch(() => {
      throw fail("Could not duplicate questionnaire.");
    });
    for (const [i, q] of detail.questions.entries()) {
      await apiAddQuestion(hospitalId, copy.id, {
        order: q.order ?? i,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        required: q.required,
      }).catch(() => { throw fail("Copy created, but some questions failed to copy."); });
    }
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const toggleQuestionnaire = useCallback(async (id: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing questionnaires needs the backend.");
    const current = liveQuestionnaires.find((q) => q.id === id);
    await apiUpdateQuestionnaire(hospitalId, id, { is_active: current?.status !== "active" }).catch(() => {
      throw fail("Could not update questionnaire.");
    });
    await refreshAll();
  }, [live, hospitalId, liveQuestionnaires, refreshAll, fail]);

  const fetchQuestionnaireDetail = useCallback(async (id: string) => {
    if (!live || !hospitalId) throw fail("Sign in — reading questionnaires needs the backend.");
    return apiQuestionDetail(hospitalId, id).catch(() => null);
  }, [live, hospitalId, fail]);

  const deleteQuestionnaire = useCallback(async (id: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing questionnaires needs the backend.");
    await apiDeleteQuestionnaire(hospitalId, id).catch(() => { throw fail("Could not delete questionnaire."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const updateQuestionnaireQuestion = useCallback(async (qid: string, questionId: string, patch: { prompt?: string; required?: boolean }) => {
    if (!live || !hospitalId) throw fail("Sign in — managing questionnaires needs the backend.");
    await apiUpdateQuestion(hospitalId, qid, questionId, patch).catch(() => { throw fail("Could not update question."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const deleteQuestionnaireQuestion = useCallback(async (qid: string, questionId: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing questionnaires needs the backend.");
    await apiDeleteQuestion(hospitalId, qid, questionId).catch(() => { throw fail("Could not delete question."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  // -- staff ---------------------------------------------------------------------------

  const inviteStaff = useCallback(async (email: string, password: string) => {
    if (!live || !hospitalId) throw fail("Sign in — inviting staff needs the backend.");
    await apiInviteStaff(hospitalId, { email, password }).catch(() => {
      throw fail("Invite failed — email may already be registered.");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const deactivateStaff = useCallback(async (id: string) => {
    if (!live || !hospitalId) throw fail("Sign in — managing staff needs the backend.");
    await apiDeactivateStaff(hospitalId, id).catch(() => { throw fail("Could not deactivate staff."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  // -- ops -------------------------------------------------------------------------------

  const retryOperation = useCallback(async (id: string) => {
    if (!live) throw fail("Sign in — retrying operations needs the backend.");
    await apiRetryOperation(id).catch(() => { throw fail("Retry failed — operation may already be resolved."); });
    await refreshAll();
    log("Operation retried", id);
  }, [live, refreshAll, fail]);

  const retryReconciliation = useCallback(async (id: string) => {
    if (!live) throw fail("Sign in — retrying cases needs the backend.");
    await apiRetryRecord(id).catch(() => { throw fail("Retry failed — case may be resolved or escalated."); });
    await refreshAll();
    log("Reconciliation retried", id);
  }, [live, refreshAll, fail]);

  const verifyOperation = useCallback(async (id: string) => {
    if (!live) throw fail("Sign in — verifying operations needs the backend.");
    const op = liveOperations.find((o) => o.id === id);
    if (!op) throw fail("Operation not found.");
    const result = await apiVerify(op.appointment).catch(() => {
      throw fail("Verification failed — vendor unreachable.");
    });
    await refreshAll();
    log(`External verification: ${result.outcome}`, id);
    return result.outcome;
  }, [live, liveOperations, refreshAll, fail]);

  const resolveReconciliation = useCallback(async (id: string, finalState: string, note: string) => {
    if (!live) throw fail("Sign in — resolving cases needs the backend.");
    const mapped = FINAL_STATE_MAP[finalState];
    await apiResolveRecord(id, {
      resolution: "resolved",
      note,
      ...(mapped ? { final_state: mapped } : {}),
    }).catch(() => { throw fail("Could not resolve case."); });
    await refreshAll();
    log(`Reconciliation resolved → ${finalState}: ${note.slice(0, 40)}`, id);
  }, [live, refreshAll, fail]);

  const assignEscalation = useCallback((id: string, who: string) => {
    // Assignment is console-local: the backend queue tracks open/resolved only.
    setLiveEscalations((p) => p.map((e) => (e.id === id ? { ...e, assignee: who, status: "investigating" } : e)));
  }, []);

  const resolveEscalation = useCallback(async (id: string) => {
    if (!live) throw fail("Sign in — resolving escalations needs the backend.");
    await apiResolveEscalation(id).catch(() => { throw fail("Could not resolve escalation."); });
    await refreshAll();
  }, [live, refreshAll, fail]);

  // -- session-local event feed (no inbox/audit endpoint) ---------------------------------

  const pushNotification = useCallback((title: string, body: string) => {
    setNotifications((prev) => [{ id: nid("n"), title, body, time: "Just now", unread: true }, ...prev]);
  }, []);
  const markAllRead = useCallback(() => setNotifications((prev) => prev.map((n) => ({ ...n, unread: false }))), []);
  const log = useCallback((action: string, resource: string) => {
    setAudit((prev) => [{ id: nid("au"), time: "Just now", actor: "admin@careflow.ai", action, resource, result: "success", correlationId: `corr-${seq}` }, ...prev]);
  }, []);

  const departments = liveDepartments;
  const specialties = liveSpecialties;
  const types = liveTypes;
  const doctors = liveDoctors;
  const appointments = liveAppointments;
  const questionnaires = liveQuestionnaires;
  const staff = liveStaff;
  const operations = liveOperations;
  const reconciliations = liveReconciliations;
  const escalations = liveEscalations;

  const value: AdminStore = useMemo(
    () => ({
      role,
      setRole,
      authed,
      login,
      logout,
      mode,
      live,
      loading,
      syncing,
      backendError,
      user,
      hospital,
      refreshAll,
      refreshSection,
      updateHospital,
      resubmitHospital,
      departments,
      specialties,
      types,
      doctors,
      appointments,
      questionnaires,
      staff,
      addDepartment,
      renameDepartment,
      deleteDepartment,
      toggleDepartment,
      addSpecialty: (name) => addSpecialty(name),
      renameSpecialty,
      deleteSpecialty,
      toggleSpecialty,
      addType,
      updateType,
      deleteType,
      toggleType,
      createDoctor,
      updateDoctor,
      deleteDoctor,
      setDoctorStatus,
      inviteDoctorLogin,
      removeDoctorLogin,
      cancelAppointment,
      completeAppointment,
      markNoShow,
      confirmAppointment,
      createQuestionnaire,
      deleteQuestionnaire,
      updateQuestionnaireQuestion,
      deleteQuestionnaireQuestion,
      duplicateQuestionnaire,
      toggleQuestionnaire,
      fetchQuestionnaireDetail,
      addQuestionnaireQuestion,
      inviteStaff,
      deactivateStaff,
      hospitals,
      audit,
      reviewHospital: (id, decision) => {
        setHospitals((p) => p.map((h) => (h.id === id ? { ...h, status: decision } : h)));
        log(decision === "approved" ? "Hospital approved" : "Hospital rejected", id);
        pushNotification(decision === "approved" ? "Hospital approved" : "Hospital rejected", `${id} → ${decision}`);
      },
      operations,
      reconciliations,
      escalations,
      workflows: liveWorkflows,
      aiExecutions: liveAI,
      integrationRows: liveIntegrationRows,
      overview,
      analytics,
      integration,
      retryOperation,
      retryReconciliation,
      verifyOperation,
      resolveReconciliation,
      assignEscalation,
      resolveEscalation,
      notifications,
      unread: notifications.filter((n) => n.unread).length,
      markAllRead,
      pushNotification,
    }),
    [role, authed, login, logout, mode, live, loading, syncing, backendError, user, hospital,
      refreshAll, refreshSection, updateHospital, resubmitHospital, departments, specialties, types, doctors, appointments, questionnaires, staff,
      addDepartment, renameDepartment, deleteDepartment, toggleDepartment, addSpecialty, renameSpecialty, deleteSpecialty,
      toggleSpecialty, addType, updateType, deleteType, toggleType, createDoctor, updateDoctor, deleteDoctor,
      setDoctorStatus, inviteDoctorLogin,
      removeDoctorLogin, cancelAppointment, completeAppointment, markNoShow, confirmAppointment,
      createQuestionnaire, deleteQuestionnaire, updateQuestionnaireQuestion, deleteQuestionnaireQuestion,
      duplicateQuestionnaire, toggleQuestionnaire, fetchQuestionnaireDetail,
      inviteStaff, deactivateStaff, hospitals, audit, operations, reconciliations, escalations,
      liveWorkflows, liveAI, liveIntegrationRows, overview, analytics, integration,
      retryOperation, retryReconciliation, verifyOperation, resolveReconciliation, assignEscalation, resolveEscalation,
      notifications, markAllRead, pushNotification, log],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdmin must be used inside AdminProvider");
  return ctx;
}
