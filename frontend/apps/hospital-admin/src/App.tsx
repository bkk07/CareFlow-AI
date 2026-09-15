import { useCallback, useEffect, useState } from "react";
import {
  api,
  login,
  me,
  restoreAccessToken,
  setAccessToken,
  type AppointmentType,
  type CurrentUser,
  type Doctor,
  type NamedEntity,
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

type Tab = "departments" | "specialties" | "types" | "doctors";

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
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1>CareFlow AI — Hospital Admin</h1>
        <ErrorNote error={error} />
        <div>
          <input
            style={inputStyle}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={() => void doLogin()}>Log in</button>
        </div>
      </main>
    );
  }

  if (user.role !== "hospital_admin" || !user.hospital_id) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1>CareFlow AI — Hospital Admin</h1>
        <p>Signed in as {user.email}, but this app requires a hospital_admin.</p>
        <button onClick={logout}>Log out</button>
      </main>
    );
  }

  const hospitalId = user.hospital_id;
  const bump = () => setRefVersion((v) => v + 1);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>CareFlow AI — Hospital Admin</h1>
      <p>
        {user.email} ·{" "}
        <button onClick={logout}>Log out</button>
      </p>
      <nav style={{ marginBottom: "1rem" }}>
        {(["departments", "specialties", "types", "doctors"] as Tab[]).map((t) => (
          <button
            key={t}
            style={{ ...inputStyle, fontWeight: tab === t ? "bold" : "normal" }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "departments" && (
        <NamedManager
          title="Departments"
          path="/departments"
          hospitalId={hospitalId}
          onChanged={bump}
        />
      )}
      {tab === "specialties" && (
        <NamedManager
          title="Specialties"
          path="/specialties"
          hospitalId={hospitalId}
          onChanged={bump}
        />
      )}
      {tab === "types" && (
        <AppointmentTypeManager
          hospitalId={hospitalId}
          specialtiesVersion={refVersion}
        />
      )}
      {tab === "doctors" && (
        <DoctorManager hospitalId={hospitalId} specialtiesVersion={refVersion} />
      )}
    </main>
  );
}
