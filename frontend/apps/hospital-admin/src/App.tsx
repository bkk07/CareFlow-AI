import { useCallback, useEffect, useState } from "react";
import {
  api,
  login,
  me,
  restoreAccessToken,
  setAccessToken,
  type AIEvaluation,
  type Appointment,
  type AppointmentDetail,
  type AppointmentType,
  type AuditEvent,
  type CurrentUser,
  type Doctor,
  type HospitalAnalytics,
  type HospitalOverview,
  type IntegrationStatus,
  type AIActivityEntry,
  type NamedEntity,
  type PlatformPatient,
  type ReconciliationDetail,
  type ReconciliationRecord,
} from "./api";

const inputStyle: React.CSSProperties = { marginRight: "0.5rem" };
const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  marginTop: "0.75rem",
};
const cellStyle: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "0.25rem 0.5rem",
};

function useHospitalBase(hospitalId: string) {
  return `/hospitals/${hospitalId}`;
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p style={{ color: "crimson" }}>{error}</p>;
}

function apiError(e: unknown): string {
  if (typeof e === "object" && e !== null && "response" in e) {
    const r = (e as { response?: { data?: { detail?: unknown }; status?: number } })
      .response;
    if (r?.data?.detail) return `Error ${r.status ?? ""}: ${JSON.stringify(r.data.detail)}`;
  }
  return "Request failed";
}

/** Generic table + create/rename/delete form for departments & specialties. */
function NamedManager({
  title,
  path,
  hospitalId,
  onChanged,
}: {
  title: string;
  path: string;
  hospitalId: string;
  onChanged: () => void;
}) {
  const base = useHospitalBase(hospitalId);
  const [items, setItems] = useState<NamedEntity[]>([]);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<NamedEntity[]>(`${base}${path}`);
      setItems(data);
    } catch (e) {
      setError(apiError(e));
    }
  }, [base, path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    setError(null);
    try {
      await api.post(`${base}${path}`, { name });
      setName("");
      await refresh();
      onChanged();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.delete(`${base}${path}/${id}`);
      await refresh();
      onChanged();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function rename(id: string) {
    setError(null);
    try {
      await api.put(`${base}${path}/${id}`, { name: renameValue });
      setRenaming(null);
      await refresh();
      onChanged();
    } catch (e) {
      setError(apiError(e));
    }
  }

  return (
    <section>
      <h2>{title}</h2>
      <ErrorNote error={error} />
      <div>
        <input
          style={inputStyle}
          placeholder={`New ${title.slice(0, -1).toLowerCase()} name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button onClick={() => void create()} disabled={!name.trim()}>
          Add
        </button>
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Name</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={cellStyle}>
                {renaming === item.id ? (
                  <>
                    <input
                      style={inputStyle}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                    />
                    <button onClick={() => void rename(item.id)}>Save</button>{" "}
                    <button onClick={() => setRenaming(null)}>Cancel</button>
                  </>
                ) : (
                  item.name
                )}
              </td>
              <td style={cellStyle}>
                <button
                  onClick={() => {
                    setRenaming(item.id);
                    setRenameValue(item.name);
                  }}
                >
                  Rename
                </button>{" "}
                <button onClick={() => void remove(item.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td style={cellStyle} colSpan={2}>
                None yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function AppointmentTypeManager({
  hospitalId,
  specialtiesVersion,
}: {
  hospitalId: string;
  specialtiesVersion: number;
}) {
  const base = useHospitalBase(hospitalId);
  const [items, setItems] = useState<AppointmentType[]>([]);
  const [specialties, setSpecialties] = useState<NamedEntity[]>([]);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [compat, setCompat] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        api.get<AppointmentType[]>(`${base}/appointment-types`),
        api.get<NamedEntity[]>(`${base}/specialties`),
      ]);
      setItems(t.data);
      setSpecialties(s.data);
    } catch (e) {
      setError(apiError(e));
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh, specialtiesVersion]);

  function toggleCompat(id: string) {
    setCompat((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  function specialtyName(id: string): string {
    return specialties.find((s) => s.id === id)?.name ?? id;
  }

  async function create() {
    setError(null);
    try {
      await api.post(`${base}/appointment-types`, {
        name,
        duration_minutes: Number(duration),
        compatible_specialty_ids: compat,
      });
      setName("");
      setDuration("30");
      setCompat([]);
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.delete(`${base}/appointment-types/${id}`);
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  return (
    <section>
      <h2>Appointment Types</h2>
      <ErrorNote error={error} />
      <div>
        <input
          style={inputStyle}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Duration (min)"
          value={duration}
          inputMode="numeric"
          onChange={(e) => setDuration(e.target.value)}
        />
        <button onClick={() => void create()} disabled={!name.trim()}>
          Add
        </button>
      </div>
      <div style={{ marginTop: "0.5rem" }}>
        <span>Compatible specialties (none = all): </span>
        {specialties.map((s) => (
          <label key={s.id} style={{ marginRight: "0.75rem" }}>
            <input
              type="checkbox"
              checked={compat.includes(s.id)}
              onChange={() => toggleCompat(s.id)}
            />{" "}
            {s.name}
          </label>
        ))}
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Name</th>
            <th style={cellStyle}>Duration</th>
            <th style={cellStyle}>Compatible</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={cellStyle}>{item.name}</td>
              <td style={cellStyle}>{item.duration_minutes} min</td>
              <td style={cellStyle}>
                {item.compatible_specialty_ids.length === 0
                  ? "all"
                  : item.compatible_specialty_ids.map(specialtyName).join(", ")}
              </td>
              <td style={cellStyle}>
                <button onClick={() => void remove(item.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td style={cellStyle} colSpan={4}>
                None yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function DoctorManager({
  hospitalId,
  specialtiesVersion,
}: {
  hospitalId: string;
  specialtiesVersion: number;
}) {
  const base = useHospitalBase(hospitalId);
  const [items, setItems] = useState<Doctor[]>([]);
  const [specialties, setSpecialties] = useState<NamedEntity[]>([]);
  const [departments, setDepartments] = useState<NamedEntity[]>([]);
  const [name, setName] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [externalId, setExternalId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, s, dep] = await Promise.all([
        api.get<Doctor[]>(`${base}/doctors`),
        api.get<NamedEntity[]>(`${base}/specialties`),
        api.get<NamedEntity[]>(`${base}/departments`),
      ]);
      setItems(d.data);
      setSpecialties(s.data);
      setDepartments(dep.data);
    } catch (e) {
      setError(apiError(e));
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh, specialtiesVersion]);

  async function create() {
    setError(null);
    try {
      await api.post(`${base}/doctors`, {
        name,
        specialty_id: specialtyId || null,
        department_id: departmentId || null,
        external_provider_id: externalId || null,
      });
      setName("");
      setSpecialtyId("");
      setDepartmentId("");
      setExternalId("");
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function callAction(id: string, action: "activate" | "deactivate") {
    setError(null);
    try {
      await api.post(`${base}/doctors/${id}/${action}`);
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.delete(`${base}/doctors/${id}`);
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  function refName(list: NamedEntity[], id: string | null): string {
    if (!id) return "—";
    return list.find((x) => x.id === id)?.name ?? id.slice(0, 8);
  }

  return (
    <section>
      <h2>Doctors</h2>
      <ErrorNote error={error} />
      <div>
        <input
          style={inputStyle}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          style={inputStyle}
          value={specialtyId}
          onChange={(e) => setSpecialtyId(e.target.value)}
        >
          <option value="">No specialty</option>
          {specialties.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          style={inputStyle}
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          <option value="">No department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <input
          style={inputStyle}
          placeholder="External provider ID (optional)"
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
        />
        <button onClick={() => void create()} disabled={!name.trim()}>
          Add
        </button>
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Name</th>
            <th style={cellStyle}>Specialty</th>
            <th style={cellStyle}>Department</th>
            <th style={cellStyle}>Status</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={cellStyle}>{item.name}</td>
              <td style={cellStyle}>{refName(specialties, item.specialty_id)}</td>
              <td style={cellStyle}>{refName(departments, item.department_id)}</td>
              <td style={cellStyle}>{item.status}</td>
              <td style={cellStyle}>
                <button onClick={() => void callAction(item.id, "activate")}>
                  Activate
                </button>{" "}
                <button onClick={() => void callAction(item.id, "deactivate")}>
                  Deactivate
                </button>{" "}
                <button onClick={() => void remove(item.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td style={cellStyle} colSpan={5}>
                None yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

type Tab =
  | "departments"
  | "specialties"
  | "types"
  | "doctors"
  | "appointments"
  | "overview"
  | "ai-activity"
  | "integration"
  | "analytics"
  | "operations"
  | "platform-doctors"
  | "platform-patients"
  | "platform-appointments"
  | "platform-ai"
  | "platform-audit";

function AppointmentManager({ hospitalId }: { hospitalId: string }) {
  const [items, setItems] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorFilter, setDoctorFilter] = useState("");
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const params = doctorFilter ? { doctor_id: doctorFilter } : {};
      const [a, d] = await Promise.all([
        api.get<Appointment[]>("/appointments", {
          params: { hospital_id: hospitalId, ...params },
        }),
        api.get<Doctor[]>(`/hospitals/${hospitalId}/doctors`),
      ]);
      setItems(a.data);
      setDoctors(d.data);
    } catch (e) {
      setError(apiError(e));
    }
  }, [hospitalId, doctorFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function doctorName(id: string): string {
    return doctors.find((d) => d.id === id)?.name ?? id.slice(0, 8);
  }

  async function showDetail(id: string) {
    setError(null);
    try {
      const { data } = await api.get<AppointmentDetail>(`/appointments/${id}`);
      setDetail(data);
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function cancel(id: string) {
    setError(null);
    try {
      await api.post(`/appointments/${id}/cancel`, {});
      setDetail(null);
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  return (
    <section>
      <h2>Appointments</h2>
      <ErrorNote error={error} />
      <div>
        <label>
          Doctor{" "}
          <select
            style={inputStyle}
            value={doctorFilter}
            onChange={(e) => setDoctorFilter(e.target.value)}
          >
            <option value="">All doctors</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Slot start (UTC)</th>
            <th style={cellStyle}>Doctor</th>
            <th style={cellStyle}>State</th>
            <th style={cellStyle}>External ID</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={cellStyle}>
                {new Date(item.slot_start).toLocaleString()}
              </td>
              <td style={cellStyle}>{doctorName(item.doctor_id)}</td>
              <td style={cellStyle}>{item.state}</td>
              <td style={cellStyle}>{item.external_id ?? "—"}</td>
              <td style={cellStyle}>
                <button onClick={() => void showDetail(item.id)}>Detail</button>{" "}
                {(item.state === "confirmed" ||
                  item.state === "rescheduled") && (
                  <button onClick={() => void cancel(item.id)}>Cancel</button>
                )}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td style={cellStyle} colSpan={5}>
                None yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {detail && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Appointment detail</h3>
          <p>
            {detail.id} · patient {detail.patient_id.slice(0, 8)} · type{" "}
            {detail.appointment_type_id.slice(0, 8)}
          </p>
          <ul>
            {detail.history.map((h) => (
              <li key={h.id}>
                {h.from_state} → {h.to_state}
                {h.reason ? ` (${h.reason})` : ""} ·{" "}
                {new Date(h.created_at).toLocaleString()}
              </li>
            ))}
            {detail.history.length === 0 && <li>No transitions recorded.</li>}
          </ul>
          <button onClick={() => setDetail(null)}>Close</button>
        </div>
      )}
    </section>
  );
}

function OverviewTab({ hospitalId }: { hospitalId: string }) {
  const [data, setData] = useState<HospitalOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<HospitalOverview>(`/hospitals/${hospitalId}/overview`)
      .then((res) => setData(res.data))
      .catch((e) => setError(apiError(e)));
  }, [hospitalId]);

  return (
    <section>
      <h2>Overview</h2>
      <ErrorNote error={error} />
      {data && (
        <table style={tableStyle}>
          <tbody>
            {(
              [
                ["Doctors", `${data.doctors_active} active / ${data.doctors_total} total`],
                ["Appointments this week", data.appointments_this_week],
                ["Upcoming appointments", data.upcoming_appointments],
                ["Pending reconciliations", data.pending_reconciliations],
              ] as [string, string | number][]
            ).map(([label, value]) => (
              <tr key={label}>
                <td style={cellStyle}>{label}</td>
                <td style={cellStyle}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AIActivityTab({ hospitalId }: { hospitalId: string }) {
  const [items, setItems] = useState<AIActivityEntry[]>([]);
  const [toolFilter, setToolFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const params = toolFilter ? { tool: toolFilter } : {};
      const { data } = await api.get<{ executions: AIActivityEntry[] }>(
        `/hospitals/${hospitalId}/ai-activity`,
        { params },
      );
      setItems(data.executions);
    } catch (e) {
      setError(apiError(e));
    }
  }, [hospitalId, toolFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section>
      <h2>AI Activity</h2>
      <ErrorNote error={error} />
      <div>
        <input
          style={inputStyle}
          placeholder="Filter by tool name"
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
        />
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Time</th>
            <th style={cellStyle}>Tool</th>
            <th style={cellStyle}>Status</th>
            <th style={cellStyle}>Latency ms</th>
            <th style={cellStyle}>Error</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={cellStyle}>{new Date(item.created_at).toLocaleString()}</td>
              <td style={cellStyle}>{item.tool_name}</td>
              <td style={cellStyle}>{item.status}</td>
              <td style={cellStyle}>{item.latency_ms.toFixed(1)}</td>
              <td style={cellStyle}>{item.error ?? "—"}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td style={cellStyle} colSpan={5}>
                No executions yet — use chat or the MCP tools first.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function IntegrationTab({ hospitalId }: { hospitalId: string }) {
  const [data, setData] = useState<IntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<IntegrationStatus>(`/hospitals/${hospitalId}/integration-status`)
      .then((res) => setData(res.data))
      .catch((e) => setError(apiError(e)));
  }, [hospitalId]);

  return (
    <section>
      <h2>Integration status</h2>
      <ErrorNote error={error} />
      {data && (
        <>
          <p>
            Vendor mappings: {data.vendor_mappings} · open reconciliations:{" "}
            {data.open_reconciliations} · verifications (24h):{" "}
            {JSON.stringify(data.verifications_24h)}
          </p>
          <h3>Recent operations</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellStyle}>Type</th>
                <th style={cellStyle}>Status</th>
                <th style={cellStyle}>Attempt</th>
                <th style={cellStyle}>Error</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_operations.map((op) => (
                <tr key={op.id}>
                  <td style={cellStyle}>{op.operation_type}</td>
                  <td style={cellStyle}>{op.status}</td>
                  <td style={cellStyle}>{op.attempt_number}</td>
                  <td style={cellStyle}>{op.error ?? "—"}</td>
                </tr>
              ))}
              {data.recent_operations.length === 0 && (
                <tr>
                  <td style={cellStyle} colSpan={4}>
                    No vendor operations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function AnalyticsTab({ hospitalId }: { hospitalId: string }) {
  const [data, setData] = useState<HospitalAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<HospitalAnalytics>(`/hospitals/${hospitalId}/analytics`)
      .then((res) => setData(res.data))
      .catch((e) => setError(apiError(e)));
  }, [hospitalId]);

  return (
    <section>
      <h2>Analytics</h2>
      <ErrorNote error={error} />
      {data && (
        <>
          <p>
            {data.appointments_total} appointments total · tool success avg
            latency:{" "}
            {data.tool_success_avg_latency_ms === null
              ? "—"
              : `${data.tool_success_avg_latency_ms.toFixed(1)} ms`}
          </p>
          <h3>By state</h3>
          <table style={tableStyle}>
            <tbody>
              {Object.entries(data.appointments_by_state).map(([state, count]) => (
                <tr key={state}>
                  <td style={cellStyle}>{state}</td>
                  <td style={cellStyle}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Bookings per day (30d)</h3>
          <table style={tableStyle}>
            <tbody>
              {Object.entries(data.bookings_per_day_30d).map(([day, count]) => (
                <tr key={day}>
                  <td style={cellStyle}>{day}</td>
                  <td style={cellStyle}>
                    {"█".repeat(Math.min(count, 40))} {count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

const FINAL_STATES = ["confirmed", "rescheduled", "cancelled", "failed"];

function OperationsTab() {
  const [items, setItems] = useState<ReconciliationRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
  const [note, setNote] = useState("");
  const [finalState, setFinalState] = useState("cancelled");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const params = statusFilter === "all" ? {} : { resolution_status: statusFilter };
      const { data } = await api.get<ReconciliationRecord[]>(
        "/reconciliation/records",
        { params },
      );
      // Server scopes hospital_admins to their own hospital already.
      setItems(data);
    } catch (e) {
      setError(apiError(e));
    }
  }, [statusFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function showDetail(id: string) {
    setError(null);
    try {
      const { data } = await api.get<ReconciliationDetail>(
        `/reconciliation/records/${id}`,
      );
      setDetail(data);
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function retry(id: string) {
    setError(null);
    try {
      const { data } = await api.post<ReconciliationDetail>(
        `/reconciliation/records/${id}/retry`,
      );
      setDetail(data);
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function resolve(id: string, resolution: "resolved" | "escalated") {
    setError(null);
    try {
      const body: Record<string, unknown> = { resolution, note };
      if (resolution === "resolved") body.final_state = finalState;
      const { data } = await api.post<ReconciliationDetail>(
        `/reconciliation/records/${id}/resolve`,
        body,
      );
      setDetail(data);
      setNote("");
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  return (
    <section>
      <h2>Operations — reconciliation queue</h2>
      <ErrorNote error={error} />
      <div>
        <label>
          Status{" "}
          <select
            style={inputStyle}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="open">open</option>
            <option value="retrying">retrying</option>
            <option value="resolved">resolved</option>
            <option value="escalated">escalated</option>
            <option value="all">all</option>
          </select>
        </label>
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Created</th>
            <th style={cellStyle}>Internal</th>
            <th style={cellStyle}>External</th>
            <th style={cellStyle}>Attempts</th>
            <th style={cellStyle}>Status</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={cellStyle}>{new Date(item.created_at).toLocaleString()}</td>
              <td style={cellStyle}>{item.internal_status}</td>
              <td style={cellStyle}>{item.external_status ?? "—"}</td>
              <td style={cellStyle}>{item.attempts}</td>
              <td style={cellStyle}>{item.resolution_status}</td>
              <td style={cellStyle}>
                <button onClick={() => void showDetail(item.id)}>Detail</button>{" "}
                <button onClick={() => void retry(item.id)}>Retry</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td style={cellStyle} colSpan={6}>
                Queue empty.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {detail && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Record detail</h3>
          <p>
            Appointment {detail.appointment.id} · state{" "}
            {detail.appointment.state} · slot{" "}
            {new Date(detail.appointment.slot_start).toLocaleString()}
          </p>
          <p>Error: {detail.error}</p>
          {detail.note && <p>Note: {detail.note}</p>}
          <h4>Operations ({detail.operations.length})</h4>
          <ul>
            {detail.operations.map((op) => (
              <li key={op.id}>
                {op.operation_type} #{op.attempt_number}: {op.status}
                {op.error ? ` — ${op.error}` : ""}
              </li>
            ))}
          </ul>
          {(detail.resolution_status === "open" ||
            detail.resolution_status === "retrying") && (
            <div>
              <input
                style={inputStyle}
                placeholder="Resolution note (required)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <select
                style={inputStyle}
                value={finalState}
                onChange={(e) => setFinalState(e.target.value)}
              >
                {FINAL_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void resolve(detail.id, "resolved")}
                disabled={!note.trim()}
              >
                Resolve + move booking
              </button>{" "}
              <button
                onClick={() => void resolve(detail.id, "escalated")}
                disabled={!note.trim()}
              >
                Escalate
              </button>
            </div>
          )}
          <button onClick={() => setDetail(null)}>Close</button>
        </div>
      )}
    </section>
  );
}

function PlatformDoctorsTab() {
  const [items, setItems] = useState<Doctor[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Doctor[]>("/platform/doctors")
      .then((res) => setItems(res.data))
      .catch((e) => setError(apiError(e)));
  }, []);

  return (
    <section>
      <h2>Platform — doctors (all hospitals)</h2>
      <ErrorNote error={error} />
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Name</th>
            <th style={cellStyle}>Hospital</th>
            <th style={cellStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id}>
              <td style={cellStyle}>{d.name}</td>
              <td style={cellStyle}>{d.hospital_id.slice(0, 8)}</td>
              <td style={cellStyle}>{d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PlatformPatientsTab() {
  const [items, setItems] = useState<PlatformPatient[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ patients: PlatformPatient[] }>("/platform/patients")
      .then((res) => setItems(res.data.patients))
      .catch((e) => setError(apiError(e)));
  }, []);

  return (
    <section>
      <h2>Platform — patients</h2>
      <ErrorNote error={error} />
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Email</th>
            <th style={cellStyle}>Active</th>
            <th style={cellStyle}>Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td style={cellStyle}>{p.email}</td>
              <td style={cellStyle}>{p.is_active ? "yes" : "no"}</td>
              <td style={cellStyle}>{new Date(p.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PlatformAppointmentsTab() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [stateFilter, setStateFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const params = stateFilter ? { state: stateFilter } : {};
      const { data } = await api.get<Appointment[]>("/platform/appointments", {
        params,
      });
      setItems(data);
    } catch (e) {
      setError(apiError(e));
    }
  }, [stateFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section>
      <h2>Platform — appointments (all hospitals)</h2>
      <ErrorNote error={error} />
      <div>
        <label>
          State{" "}
          <select
            style={inputStyle}
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">all</option>
            {[
              "confirmed",
              "rescheduled",
              "cancelled",
              "sync_pending",
              "reconciliation_required",
              "failed",
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Slot start (UTC)</th>
            <th style={cellStyle}>Hospital</th>
            <th style={cellStyle}>State</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td style={cellStyle}>{new Date(a.slot_start).toLocaleString()}</td>
              <td style={cellStyle}>{a.hospital_id.slice(0, 8)}</td>
              <td style={cellStyle}>{a.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PlatformAITab() {
  const [data, setData] = useState<AIEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AIEvaluation>("/platform/ai-evaluation")
      .then((res) => setData(res.data))
      .catch((e) => setError(apiError(e)));
  }, []);

  return (
    <section>
      <h2>Platform — AI evaluation</h2>
      <ErrorNote error={error} />
      {data && (
        <>
          <p>
            {data.executions_total} executions · {data.errors_total} errors (
            {(data.error_rate * 100).toFixed(1)}%)
          </p>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellStyle}>Tool</th>
                <th style={cellStyle}>Calls</th>
                <th style={cellStyle}>Errors</th>
                <th style={cellStyle}>Avg latency ms</th>
              </tr>
            </thead>
            <tbody>
              {data.by_tool.map((t) => (
                <tr key={t.tool_name}>
                  <td style={cellStyle}>{t.tool_name}</td>
                  <td style={cellStyle}>{t.calls}</td>
                  <td style={cellStyle}>{t.errors}</td>
                  <td style={cellStyle}>
                    {t.avg_latency_ms === null ? "—" : t.avg_latency_ms.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function PlatformAuditTab() {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ events: AuditEvent[] }>("/platform/audit-events")
      .then((res) => setItems(res.data.events))
      .catch((e) => setError(apiError(e)));
  }, []);

  return (
    <section>
      <h2>Platform — audit log</h2>
      <ErrorNote error={error} />
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Time</th>
            <th style={cellStyle}>Action</th>
            <th style={cellStyle}>Entity</th>
            <th style={cellStyle}>Hospital</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td style={cellStyle}>{new Date(e.created_at).toLocaleString()}</td>
              <td style={cellStyle}>{e.action}</td>
              <td style={cellStyle}>
                {e.entity_type}:{e.entity_id.slice(0, 8)}
              </td>
              <td style={cellStyle}>{e.hospital_id?.slice(0, 8) ?? "—"}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td style={cellStyle} colSpan={4}>
                No audit events yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => restoreAccessToken());
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<Tab>("departments");
  const [error, setError] = useState<string | null>(null);
  const [refVersion, setRefVersion] = useState(0);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    me()
      .then(setUser)
      .catch(() => {
        setAccessToken(null);
        setToken(null);
      });
  }, [token]);

  async function doLogin() {
    setError(null);
    try {
      await login(email, password);
      setToken(localStorage.getItem("careflow_admin_token"));
    } catch (e) {
      setError(apiError(e));
    }
  }

  function logout() {
    setAccessToken(null);
    setToken(null);
  }

  if (!token || !user) {
    return (
      <div className="container">
        <div className="login-wrap">
          <div className="card">
            <h1 className="brand" style={{ fontSize: "1.4rem" }}>
              CareFlow <span>AI</span> — Admin
            </h1>
            <ErrorNote error={error} />
            <div className="field">
              <label>Email</label>
              <input
                className="input"
                style={{ width: "100%" }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                className="input"
                style={{ width: "100%" }}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doLogin();
                }}
              />
            </div>
            <button className="btn btn-primary" onClick={() => void doLogin()}>
              Log in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (user.role !== "hospital_admin" && user.role !== "platform_admin") {
    return (
      <div className="container">
        <div className="card">
          <h2>Signed in as {user.email}</h2>
          <p className="muted">This app requires an admin login.</p>
          <button className="btn" onClick={logout}>
            Log out
          </button>
        </div>
      </div>
    );
  }

  const isPlatform = user.role === "platform_admin";
  const hospitalId = user.hospital_id ?? "";
  const bump = () => setRefVersion((v) => v + 1);

  const hospitalTabs: Tab[] = [
    "overview",
    "departments",
    "specialties",
    "types",
    "doctors",
    "appointments",
    "ai-activity",
    "integration",
    "analytics",
    "operations",
  ];
  const platformTabs: Tab[] = [
    "platform-doctors",
    "platform-patients",
    "platform-appointments",
    "platform-ai",
    "platform-audit",
  ];
  const visibleTabs = isPlatform ? platformTabs : hospitalTabs;
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          CareFlow <span style={{ color: "#9fd9d8" }}>AI</span>
        </div>
        <div className="who">
          {isPlatform ? "Platform" : "Hospital"} · {user.email}
        </div>
        {visibleTabs.map((t) => (
          <button
            key={t}
            className={activeTab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <div className="spacer" />
        <button onClick={logout}>Log out</button>
      </aside>
      <main className="content">
      {activeTab === "overview" && <OverviewTab hospitalId={hospitalId} />}
      {activeTab === "departments" && (
        <NamedManager
          title="Departments"
          path="/departments"
          hospitalId={hospitalId}
          onChanged={bump}
        />
      )}
      {activeTab === "specialties" && (
        <NamedManager
          title="Specialties"
          path="/specialties"
          hospitalId={hospitalId}
          onChanged={bump}
        />
      )}
      {activeTab === "types" && (
        <AppointmentTypeManager
          hospitalId={hospitalId}
          specialtiesVersion={refVersion}
        />
      )}
      {activeTab === "doctors" && (
        <DoctorManager hospitalId={hospitalId} specialtiesVersion={refVersion} />
      )}
      {activeTab === "appointments" && <AppointmentManager hospitalId={hospitalId} />}
      {activeTab === "ai-activity" && <AIActivityTab hospitalId={hospitalId} />}
      {activeTab === "integration" && <IntegrationTab hospitalId={hospitalId} />}
      {activeTab === "analytics" && <AnalyticsTab hospitalId={hospitalId} />}
      {activeTab === "operations" && <OperationsTab />}
      {activeTab === "platform-doctors" && <PlatformDoctorsTab />}
      {activeTab === "platform-patients" && <PlatformPatientsTab />}
      {activeTab === "platform-appointments" && <PlatformAppointmentsTab />}
      {activeTab === "platform-ai" && <PlatformAITab />}
      {activeTab === "platform-audit" && <PlatformAuditTab />}
      </main>
    </div>
  );
}
