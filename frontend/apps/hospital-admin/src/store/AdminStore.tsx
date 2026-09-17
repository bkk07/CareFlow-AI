import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  activateDoctor as apiActivateDoctor,
  addQuestion as apiAddQuestion,
  createAppointmentType as apiCreateType,
  createDepartment as apiCreateDepartment,
  createDoctor as apiCreateDoctor,
  createQuestionnaire as apiCreateQuestionnaire,
  createSpecialty as apiCreateSpecialty,
  deactivateDoctor as apiDeactivateDoctor,
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
  resolveEscalation as apiResolveEscalation,
  resolveReconciliation as apiResolveRecord,
  restoreAccessToken,
  retryOperation as apiRetryOperation,
  setAccessToken,
  updateHospital as apiUpdateHospital,
  updateQuestionnaire as apiUpdateQuestionnaire,
  verifyAppointment as apiVerify,
  cancelAppointment as apiCancelAppointment,
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
import {
  INITIAL_APPOINTMENTS,
  INITIAL_DEPARTMENTS,
  INITIAL_DOCTORS,
  INITIAL_QUESTIONNAIRES,
  INITIAL_SPECIALTIES,
  INITIAL_STAFF,
  INITIAL_TYPES,
} from "../mock/hospital";
import { ALL_HOSPITALS, ADMIN_NOTIFICATIONS, INITIAL_AUDIT } from "../mock/platform";
import {
  INITIAL_ESCALATIONS,
  INITIAL_OPERATIONS,
  INITIAL_RECONCILIATION,
  WORKFLOWS,
} from "../mock/ops";

export type BackendMode = "checking" | "live" | "mock";

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
  /** Real sign-in when the backend is reachable, mock fallback offline. */
  login: (email?: string, password?: string) => Promise<void>;
  loginMock: () => void;
  logout: () => void;
  mode: BackendMode;
  /** True when lists below come from the backend (false = mock seeds). */
  live: boolean;
  loading: boolean;
  backendError: string | null;
  user: CurrentUser | null;
  hospital: ApiHospital | null;
  refreshAll: () => Promise<void>;
  updateHospital: (patch: { name?: string; address?: string; contact_email?: string; contact_phone?: string }) => Promise<void>;
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
  addSpecialty: (name: string, department?: string) => Promise<void>;
  deleteSpecialty: (id: string) => Promise<void>;
  toggleSpecialty: (id: string) => void;
  addType: (t: Omit<AppointmentType, "id" | "status">) => Promise<void>;
  deleteType: (id: string) => Promise<void>;
  toggleType: (id: string) => void;
  createDoctor: (input: { name: string; specialty_id?: string | null; department_id?: string | null }) => Promise<void>;
  setDoctorStatus: (id: string, status: Doctor["status"]) => Promise<void>;
  cancelAppointment: (id: string) => Promise<void>;
  createQuestionnaire: (name: string) => Promise<void>;
  duplicateQuestionnaire: (id: string) => Promise<void>;
  toggleQuestionnaire: (id: string) => Promise<void>;
  fetchQuestionnaireDetail: (id: string) => Promise<QuestionnaireDetail | null>;
  inviteStaff: (email: string, password: string) => Promise<void>;
  deactivateStaff: (id: string) => Promise<void>;
  // platform (mock-local)
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
  verifyOperation: (id: string, found: boolean) => Promise<string>;
  resolveReconciliation: (id: string, finalState: string, note: string) => Promise<void>;
  assignEscalation: (id: string, who: string) => void;
  resolveEscalation: (id: string) => Promise<void>;
  simulateTimeout: (id: string) => void;
  // notifications (mock-local: hospital admins have no inbox endpoint)
  notifications: NotificationItem[];
  unread: number;
  markAllRead: () => void;
  pushNotification: (title: string, body: string) => void;
}

const Ctx = createContext<AdminStore | null>(null);
let seq = 1000;
const nid = (p: string) => `${p}-${seq++}`;
const MOCK_KEY = "careflow_admin_mock";

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
  const [liveLoaded, setLiveLoaded] = useState(false);

  const live = mode === "live" && authed && user?.hospital_id != null;
  const hospitalId = live && user?.hospital_id ? user.hospital_id : null;

  // Mock seeds (offline demo + platform/ops extras that stay local).
  const [mockDepartments, setMockDepartments] = useState(INITIAL_DEPARTMENTS);
  const [mockSpecialties, setMockSpecialties] = useState(INITIAL_SPECIALTIES);
  const [mockTypes, setMockTypes] = useState(INITIAL_TYPES);
  const [mockDoctors, setMockDoctors] = useState(INITIAL_DOCTORS);
  const [mockAppointments, setMockAppointments] = useState(INITIAL_APPOINTMENTS);
  const [mockQuestionnaires, setMockQuestionnaires] = useState(INITIAL_QUESTIONNAIRES);
  const [mockStaff, setMockStaff] = useState(INITIAL_STAFF);
  const [mockOperations, setMockOperations] = useState(INITIAL_OPERATIONS);
  const [mockReconciliations, setMockReconciliations] = useState(INITIAL_RECONCILIATION);
  const [mockEscalations, setMockEscalations] = useState(INITIAL_ESCALATIONS);

  // Live rows.
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

  const [hospitals, setHospitals] = useState(ALL_HOSPITALS);
  const [audit, setAudit] = useState(INITIAL_AUDIT);
  const [notifications, setNotifications] = useState<NotificationItem[]>(ADMIN_NOTIFICATIONS);

  const fail = useCallback((message: string): Error => {
    setBackendError(message);
    return new Error(message);
  }, []);

  const refreshAll = useCallback(async () => {
    if (!live || !hospitalId) return;
    setLoading(true);
    setBackendError(null);
    try {
      const hid = hospitalId;
      const hosp = await apiGetHospital(hid).catch(() => null);
      if (hosp) setHospital(hosp);
      const hospitalName = hosp?.name ?? "Hospital";

      const [depts, specs, types, docs, appts, forms, staff, ops, recs, escs, flows] =
        await Promise.all([
          apiDepartments(hid).catch(() => []),
          apiSpecialties(hid).catch(() => []),
          apiTypes(hid).catch(() => []),
          apiDoctors(hid).catch(() => []),
          apiAppointments(hid).catch(() => []),
          apiQuestionnaires(hid).catch(() => []),
          apiStaff(hid).catch(() => []),
          apiOperations().catch(() => []),
          apiReconciliations().catch(() => []),
          apiEscalations().catch(() => []),
          apiWorkflows().catch(() => []),
        ]);
      const specName = (id: string | null) => specs.find((s) => s.id === id)?.name ?? "";
      const deptName = (id: string | null) => depts.find((d) => d.id === id)?.name ?? "";
      const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? "Visit";

      setLiveDepartments(
        depts.map((d) =>
          mapDepartment(
            d,
            0,
            docs.filter((doc) => doc.department_id === d.id).length,
          ),
        ),
      );
      setLiveSpecialties(
        specs.map((s) => mapSpecialty(s, docs.filter((doc) => doc.specialty_id === s.id).length, "")),
      );
      setLiveTypes(types.map((t) => ({
        id: t.id,
        name: t.name,
        description: `${t.duration_minutes} min visit`,
        duration: t.duration_minutes,
        mode: "In person",
        status: "active" as const,
      })));
      setLiveDoctors(
        docs.map((d) =>
          mapDoctor(d, specName(d.specialty_id), deptName(d.department_id), hospitalName, 0),
        ),
      );
      setLiveAppointments(
        appts.map((a) => {
          const doc = docs.find((d) => d.id === a.doctor_id);
          const spec = specs.find((s) => s.id === doc?.specialty_id)?.name ?? "";
          return mapAppointment(a, doc?.name ?? a.doctor_id.slice(0, 8), spec, hospitalName, typeName(a.appointment_type_id));
        }),
      );
      const details = await Promise.all(
        forms.map((f) => apiQuestionDetail(hid, f.id).catch(() => null)),
      );
      setLiveQuestionnaires(
        forms.map((f, i) => mapQuestionnaire(f, details[i])),
      );
      setLiveStaff(staff.map(mapStaff));
      setLiveOperations(ops.map(mapOperation));
      setLiveReconciliations(recs.map(mapReconciliation));
      setLiveEscalations(escs.map(mapEscalation));
      setLiveWorkflows(flows.map(mapWorkflow));

      const [ai, integ, analytic, over] = await Promise.all([
        apiAIActivity(hid).catch(() => null),
        apiIntegration(hid).catch(() => null),
        apiAnalytics(hid).catch(() => null),
        apiOverview(hid).catch(() => null),
      ]);
      if (ai) {
        setLiveIntegrationRows(ai.executions);
        setLiveAI(ai.executions.map((e) => {
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
        }));
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
      setLiveLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [live, hospitalId]);

  useEffect(() => {
    if (live && !liveLoaded) void refreshAll();
    if (!live && liveLoaded) setLiveLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // -- auth ----------------------------------------------------------------------

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

  const login = useCallback(async (email?: string, password?: string) => {
    setBackendError(null);
    if (email && password) {
      const reachable = await probeBackend();
      if (!reachable) throw fail("Backend is unreachable — try the offline demo.");
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
        if (e instanceof Error && e.message.startsWith("Backend") ) throw e;
        if (e instanceof Error && e.message === "This console is for hospital administrators.") throw e;
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
    setHospital(null);
    setAuthed(false);
    setBackendError(null);
    setLiveLoaded(false);
  }, []);

  const updateHospital = useCallback(async (patch: {
    name?: string;
    address?: string;
    contact_email?: string;
    contact_phone?: string;
  }) => {
    if (!live || !hospitalId) throw fail("Offline — hospital edits need the backend.");
    const next = await apiUpdateHospital(hospitalId, patch).catch(() => {
      throw fail("Could not save hospital profile.");
    });
    setHospital(next);
  }, [live, hospitalId, fail]);

  // -- catalog (live CRUD; mock fallback keeps toggles local) ----------------------

  const addDepartment = useCallback(async (name: string) => {
    if (!live || !hospitalId) {
      setMockDepartments((p) => [...p, { id: nid("dep"), name, specialties: 0, doctors: 0, status: "active", updated: "Just now" }]);
      return;
    }
    await apiCreateDepartment(hospitalId, name).catch(() => { throw fail("Could not add department (name may exist)."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const renameDepartment = useCallback(async (id: string, name: string) => {
    if (!live || !hospitalId) {
      setMockDepartments((p) => p.map((d) => (d.id === id ? { ...d, name, updated: "Just now" } : d)));
      return;
    }
    await apiRenameDepartment(hospitalId, id, name).catch(() => { throw fail("Could not rename department."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const deleteDepartment = useCallback(async (id: string) => {
    if (!live || !hospitalId) {
      setMockDepartments((p) => p.filter((d) => d.id !== id));
      return;
    }
    await apiDeleteDepartment(hospitalId, id).catch(() => {
      throw fail("Cannot delete: referenced by doctors, or already removed.");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const toggleDepartment = useCallback(async (id: string) => {
    // Backend departments carry no status flag: live toggle deletes the row.
    if (!live || !hospitalId) {
      setMockDepartments((p) => p.map((d) => (d.id === id ? { ...d, status: d.status === "active" ? "inactive" : "active" } : d)));
      return;
    }
    await deleteDepartment(id);
  }, [live, hospitalId, deleteDepartment]);

  const addSpecialty = useCallback(async (name: string) => {
    if (!live || !hospitalId) {
      setMockSpecialties((p) => [...p, { id: nid("sp"), name, department: "", doctors: 0, status: "active" }]);
      return;
    }
    await apiCreateSpecialty(hospitalId, name).catch(() => { throw fail("Could not add specialty (name may exist)."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const deleteSpecialty = useCallback(async (id: string) => {
    if (!live || !hospitalId) {
      setMockSpecialties((p) => p.filter((s) => s.id !== id));
      return;
    }
    await apiDeleteSpecialty(hospitalId, id).catch(() => {
      throw fail("Cannot delete: referenced by doctors, or already removed.");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const toggleSpecialty = useCallback((id: string) => {
    if (live) return; // live specialties have no status flag — use Delete.
    setMockSpecialties((p) => p.map((s) => (s.id === id ? { ...s, status: s.status === "active" ? "inactive" : "active" } : s)));
  }, [live]);

  const addType = useCallback(async (t: Omit<AppointmentType, "id" | "status">) => {
    if (!live || !hospitalId) {
      setMockTypes((p) => [...p, { ...t, id: nid("t"), status: "active" }]);
      return;
    }
    await apiCreateType(hospitalId, { name: t.name, duration_minutes: t.duration }).catch(() => {
      throw fail("Could not add appointment type (name may exist).");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const deleteType = useCallback(async (id: string) => {
    if (!live || !hospitalId) {
      setMockTypes((p) => p.filter((t) => t.id !== id));
      return;
    }
    await apiDeleteType(hospitalId, id).catch(() => { throw fail("Could not delete appointment type."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const toggleType = useCallback((id: string) => {
    if (live) return; // live types have no status flag — use Delete.
    setMockTypes((p) => p.map((t) => (t.id === id ? { ...t, status: t.status === "active" ? "inactive" : "active" } : t)));
  }, [live]);

  // -- doctors ---------------------------------------------------------------------

  const createDoctor = useCallback(async (input: {
    name: string;
    specialty_id?: string | null;
    department_id?: string | null;
  }) => {
    if (!live || !hospitalId) throw fail("Offline — creating doctors needs the backend.");
    await apiCreateDoctor(hospitalId, input).catch(() => {
      throw fail("Could not create doctor. Check specialty/department.");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const setDoctorStatus = useCallback(async (id: string, status: Doctor["status"]) => {
    if (!live || !hospitalId) {
      setMockDoctors((p) => p.map((d) => (d.id === id ? { ...d, status, availability: status === "active" ? d.availability : status === "invited" ? "—" : "Paused" } : d)));
      log(status === "active" ? "Doctor activated" : "Doctor deactivated", id);
      return;
    }
    try {
      if (status === "active") await apiActivateDoctor(hospitalId, id);
      else if (status === "inactive") await apiDeactivateDoctor(hospitalId, id);
      else throw fail("Only activate/deactivate is supported live.");
    } catch (e) {
      if (e instanceof Error && e.message === "Only activate/deactivate is supported live.") throw e;
      throw fail("Status change rejected — set specialty, department and a compatible visit type first.");
    }
    await refreshAll();
    log(status === "active" ? "Doctor activated" : "Doctor deactivated", id);
  }, [live, hospitalId, refreshAll, fail]);

  // -- appointments ------------------------------------------------------------------

  const cancelAppointment = useCallback(async (id: string) => {
    if (!live) {
      setMockAppointments((p) => p.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a)));
      log("Appointment cancelled", id);
      return;
    }
    await apiCancelAppointment(id).catch(() => { throw fail("Could not cancel appointment."); });
    await refreshAll();
    log("Appointment cancelled", id);
  }, [live, refreshAll, fail]);

  // -- questionnaires ------------------------------------------------------------------

  const createQuestionnaire = useCallback(async (name: string) => {
    if (!live || !hospitalId) {
      setMockQuestionnaires((p) => [...p, {
        id: nid("q"), name, specialty: "", doctor: "", type: "Pre-visit",
        status: "draft", questions: 0, updated: "Just now", fields: [],
      }]);
      return;
    }
    await apiCreateQuestionnaire(hospitalId, { name }).catch(() => { throw fail("Could not create questionnaire."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const duplicateQuestionnaire = useCallback(async (id: string) => {
    if (!live || !hospitalId) {
      const q = mockQuestionnaires.find((x) => x.id === id);
      if (q) setMockQuestionnaires((p) => [...p, { ...q, id: nid("q"), name: `${q.name} (copy)`, status: "draft", updated: "Just now" }]);
      return;
    }
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
  }, [live, hospitalId, mockQuestionnaires, refreshAll, fail]);

  const toggleQuestionnaire = useCallback(async (id: string) => {
    if (!live || !hospitalId) {
      setMockQuestionnaires((p) => p.map((q) => (q.id === id ? { ...q, status: q.status === "active" ? "inactive" : "active" } : q)));
      return;
    }
    const current = liveQuestionnaires.find((q) => q.id === id);
    await apiUpdateQuestionnaire(hospitalId, id, { is_active: current?.status !== "active" }).catch(() => {
      throw fail("Could not update questionnaire.");
    });
    await refreshAll();
  }, [live, hospitalId, liveQuestionnaires, refreshAll, fail]);

  const fetchQuestionnaireDetail = useCallback(async (id: string) => {
    if (!live || !hospitalId) return null;
    return apiQuestionDetail(hospitalId, id).catch(() => null);
  }, [live, hospitalId]);

  // -- staff ---------------------------------------------------------------------------

  const inviteStaff = useCallback(async (email: string, password: string) => {
    if (!live || !hospitalId) {
      setMockStaff((p) => [...p, { id: nid("s"), name: email.split("@")[0], role: "Hospital Admin", status: "invited", lastActive: "Invite sent" }]);
      return;
    }
    await apiInviteStaff(hospitalId, { email, password }).catch(() => {
      throw fail("Invite failed — email may already be registered.");
    });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  const deactivateStaff = useCallback(async (id: string) => {
    if (!live || !hospitalId) {
      setMockStaff((p) => p.map((s) => (s.id === id ? { ...s, status: "deactivated" as const } : s)));
      return;
    }
    await apiDeactivateStaff(hospitalId, id).catch(() => { throw fail("Could not deactivate staff."); });
    await refreshAll();
  }, [live, hospitalId, refreshAll, fail]);

  // -- ops -------------------------------------------------------------------------------

  const retryOperation = useCallback(async (id: string) => {
    if (!live) {
      setMockOperations((p) => p.map((o) => (o.id === id ? { ...o, status: "retrying", attempts: o.attempts + 1, lastAttempt: "Just now", nextRetry: "In 15 min" } : o)));
      log("Operation retried", id);
      return;
    }
    await apiRetryOperation(id).catch(() => { throw fail("Retry failed — operation may already be resolved."); });
    await refreshAll();
    log("Operation retried", id);
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
      log(found ? "External verification: found" : "External verification: not found", id);
      return `mock:${found ? "found" : "missing"}`;
    }
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
    if (!live) {
      setMockReconciliations((p) => p.map((r) => (r.id === id ? { ...r, resolution: "resolved", internalState: finalState, updated: "Just now" } : r)));
      log(`Reconciliation resolved → ${finalState}: ${note.slice(0, 40)}`, id);
      return;
    }
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

  // -- platform + notifications (mock-local) -------------------------------------------------

  const pushNotification = useCallback((title: string, body: string) => {
    setNotifications((prev) => [{ id: nid("n"), title, body, time: "Just now", unread: true }, ...prev]);
  }, []);
  const markAllRead = useCallback(() => setNotifications((prev) => prev.map((n) => ({ ...n, unread: false }))), []);
  const log = useCallback((action: string, resource: string) => {
    setAudit((prev) => [{ id: nid("au"), time: "Just now", actor: "admin@careflow.ai", action, resource, result: "success", correlationId: `corr-${seq}` }, ...prev]);
  }, []);

  const departments = live && liveLoaded ? liveDepartments : mockDepartments;
  const specialties = live && liveLoaded ? liveSpecialties : mockSpecialties;
  const types = live && liveLoaded ? liveTypes : mockTypes;
  const doctors = live && liveLoaded ? liveDoctors : mockDoctors;
  const appointments = live && liveLoaded ? liveAppointments : mockAppointments;
  const questionnaires = live && liveLoaded ? liveQuestionnaires : mockQuestionnaires;
  const staff = live && liveLoaded ? liveStaff : mockStaff;
  const operations = live && liveLoaded ? liveOperations : mockOperations;
  const reconciliations = live && liveLoaded ? liveReconciliations : mockReconciliations;
  const escalations = live && liveLoaded ? liveEscalations : mockEscalations;

  const value: AdminStore = useMemo(
    () => ({
      role,
      setRole,
      authed,
      login,
      loginMock,
      logout,
      mode,
      live: live && liveLoaded,
      loading,
      backendError,
      user,
      hospital,
      refreshAll,
      updateHospital,
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
      deleteSpecialty,
      toggleSpecialty,
      addType,
      deleteType,
      toggleType,
      createDoctor,
      setDoctorStatus,
      cancelAppointment,
      createQuestionnaire,
      duplicateQuestionnaire,
      toggleQuestionnaire,
      fetchQuestionnaireDetail,
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
      workflows: live && liveLoaded ? liveWorkflows : WORKFLOWS,
      aiExecutions: live && liveLoaded ? liveAI : [],
      integrationRows: live && liveLoaded ? liveIntegrationRows : [],
      overview,
      analytics,
      integration,
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
    [role, authed, login, loginMock, logout, mode, live, liveLoaded, loading, backendError, user, hospital,
      refreshAll, updateHospital, departments, specialties, types, doctors, appointments, questionnaires, staff,
      addDepartment, renameDepartment, deleteDepartment, toggleDepartment, addSpecialty, deleteSpecialty,
      toggleSpecialty, addType, deleteType, toggleType, createDoctor, setDoctorStatus, cancelAppointment,
      createQuestionnaire, duplicateQuestionnaire, toggleQuestionnaire, fetchQuestionnaireDetail,
      inviteStaff, deactivateStaff, hospitals, audit, operations, reconciliations, escalations,
      liveWorkflows, liveAI, liveIntegrationRows, overview, analytics, integration,
      retryOperation, verifyOperation, resolveReconciliation, assignEscalation, resolveEscalation,
      simulateTimeout, notifications, markAllRead, pushNotification, log],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdmin must be used inside AdminProvider");
  return ctx;
}
