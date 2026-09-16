import { useCallback, useEffect, useState } from "react";
import {
  api,
  login,
  me,
  restoreAccessToken,
  setAccessToken,
  type Appointment,
  type AvailabilityRule,
  type BlockedSlot,
  type CurrentUser,
  type DoctorCalendar,
  type DoctorProfile,
  type QuestionnaireResponse,
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

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function AppointmentTable({
  items,
  onDetail,
  hideActions,
}: {
  items: Appointment[];
  onDetail: (id: string) => void;
  hideActions?: boolean;
}) {
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={cellStyle}>Slot start (UTC)</th>
          <th style={cellStyle}>Slot end (UTC)</th>
          <th style={cellStyle}>State</th>
          {!hideActions && <th style={cellStyle}>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td style={cellStyle}>{new Date(item.slot_start).toLocaleString()}</td>
            <td style={cellStyle}>{new Date(item.slot_end).toLocaleString()}</td>
            <td style={cellStyle}>{item.state}</td>
            {!hideActions && (
              <td style={cellStyle}>
                <button onClick={() => onDetail(item.id)}>Detail</button>
              </td>
            )}
          </tr>
        ))}
        {items.length === 0 && (
          <tr>
            <td style={cellStyle} colSpan={hideActions ? 3 : 4}>
              None yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function AppointmentList({ range }: { range: "today" | "upcoming" }) {
  const [items, setItems] = useState<Appointment[]>([]);
  const [detail, setDetail] = useState<Appointment | null>(null);
  const [responses, setResponses] = useState<QuestionnaireResponse[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<Appointment[]>(
        `/doctors/me/appointments?range=${range}`,
      );
      setItems(data);
    } catch (e) {
      setError(apiError(e));
    }
  }, [range]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function showDetail(id: string) {
    setError(null);
    try {
      const found = items.find((a) => a.id === id) ?? null;
      setDetail(found);
      const { data } = await api.get<QuestionnaireResponse[]>(
        `/doctors/me/questionnaire-responses/${id}`,
      );
      setResponses(data);
    } catch (e) {
      setError(apiError(e));
    }
  }

  return (
    <section>
      <h2>{range === "today" ? "Today" : "Upcoming"}</h2>
      <ErrorNote error={error} />
      <AppointmentTable items={items} onDetail={(id) => void showDetail(id)} />
      {detail && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Appointment detail</h3>
          <p>
            Patient {detail.patient_id.slice(0, 8)} · {detail.state} · external{" "}
            {detail.external_id ?? "—"}
          </p>
          <h4>Questionnaire responses ({responses.length})</h4>
          {responses.map((r) => (
            <div key={r.id}>
              <p>
                {r.completed ? "Completed" : "Draft"} ·{" "}
                {r.completed_at ? new Date(r.completed_at).toLocaleString() : "—"}
              </p>
              <pre>{JSON.stringify(r.answers, null, 2)}</pre>
            </div>
          ))}
          {responses.length === 0 && <p>No responses submitted.</p>}
          <button onClick={() => setDetail(null)}>Close</button>
        </div>
      )}
    </section>
  );
}

function CalendarEditor({ profile }: { profile: DoctorProfile }) {
  const [data, setData] = useState<DoctorCalendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState("0");
  const [start, setStart] = useState("09:00:00");
  const [end, setEnd] = useState("17:00:00");
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockReason, setBlockReason] = useState("appointment");

  const base = `/hospitals/${profile.hospital_id}/doctors/${profile.id}`;

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<DoctorCalendar>("/doctors/me/calendar");
      setData(data);
    } catch (e) {
      setError(apiError(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addRule() {
    setError(null);
    try {
      await api.post(`${base}/availability-rules`, {
        day_of_week: Number(day),
        start_time: start,
        end_time: end,
        recurrence: "weekly",
      });
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function deleteRule(id: string) {
    setError(null);
    try {
      await api.delete(`${base}/availability-rules/${id}`);
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function addBlock() {
    setError(null);
    try {
      await api.post(`${base}/blocked-slots`, {
        start_datetime: new Date(`${blockStart}:00Z`).toISOString(),
        end_datetime: new Date(`${blockEnd}:00Z`).toISOString(),
        reason: blockReason,
      });
      setBlockStart("");
      setBlockEnd("");
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function deleteBlock(id: string) {
    setError(null);
    try {
      await api.delete(`${base}/blocked-slots/${id}`);
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function toggleCalendar() {
    if (!data) return;
    setError(null);
    try {
      await api.put(`${base}/calendar`, { is_active: !data.calendar.is_active });
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  function ruleLabel(rule: AvailabilityRule): string {
    const dayName =
      rule.day_of_week === null || rule.day_of_week === undefined
        ? "one-off"
        : (DAY_NAMES[rule.day_of_week] ?? `day ${rule.day_of_week}`);
    return `${dayName} ${rule.start_time}–${rule.end_time} (${rule.recurrence})`;
  }

  return (
    <section>
      <h2>Calendar</h2>
      <ErrorNote error={error} />
      {data && (
        <>
          <p>
            Calendar {data.calendar.is_active ? "active" : "paused"}{" "}
            <button onClick={() => void toggleCalendar()}>
              {data.calendar.is_active ? "Pause" : "Activate"}
            </button>
          </p>
          <h3>Availability rules</h3>
          <div>
            <select
              style={inputStyle}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            >
              {DAY_NAMES.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
            <input
              style={inputStyle}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <input
              style={inputStyle}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
            <button onClick={() => void addRule()}>Add rule</button>
          </div>
          <table style={tableStyle}>
            <tbody>
              {data.rules.map((rule) => (
                <tr key={rule.id}>
                  <td style={cellStyle}>{ruleLabel(rule)}</td>
                  <td style={cellStyle}>
                    <button onClick={() => void deleteRule(rule.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {data.rules.length === 0 && (
                <tr>
                  <td style={cellStyle}>No rules yet.</td>
                </tr>
              )}
            </tbody>
          </table>
          <h3>Blocked time</h3>
          <div>
            <input
              style={inputStyle}
              type="datetime-local"
              value={blockStart}
              onChange={(e) => setBlockStart(e.target.value)}
            />
            <input
              style={inputStyle}
              type="datetime-local"
              value={blockEnd}
              onChange={(e) => setBlockEnd(e.target.value)}
            />
            <select
              style={inputStyle}
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
            >
              {["appointment", "leave", "ad_hoc"].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button onClick={() => void addBlock()} disabled={!blockStart || !blockEnd}>
              Block
            </button>
          </div>
          <table style={tableStyle}>
            <tbody>
              {data.blocks.map((block: BlockedSlot) => (
                <tr key={block.id}>
                  <td style={cellStyle}>
                    {new Date(block.start_datetime).toLocaleString()} →{" "}
                    {new Date(block.end_datetime).toLocaleString()} ({block.reason})
                  </td>
                  <td style={cellStyle}>
                    <button onClick={() => void deleteBlock(block.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {data.blocks.length === 0 && (
                <tr>
                  <td style={cellStyle}>Nothing blocked.</td>
                </tr>
              )}
            </tbody>
          </table>
          <h3>Live bookings (30 days)</h3>
          <AppointmentTable
            items={data.live_appointments}
            onDetail={() => undefined}
            hideActions
          />
        </>
      )}
    </section>
  );
}

type Tab = "today" | "upcoming" | "calendar";

export default function App() {
  const [token, setToken] = useState<string | null>(() => restoreAccessToken());
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [profile, setProfile] = useState<DoctorProfile | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setProfile(null);
      return;
    }
    me()
      .then((u) => {
        setUser(u);
        return api.get<DoctorProfile>("/doctors/me");
      })
      .then((res) => setProfile(res.data))
      .catch((e) => {
        setError(apiError(e));
        setAccessToken(null);
        setToken(null);
      });
  }, [token]);

  async function doLogin() {
    setError(null);
    try {
      await login(email, password);
      setToken(localStorage.getItem("careflow_doctor_token"));
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
              CareFlow <span>AI</span> — Doctor
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

  if (user.role !== "doctor") {
    return (
      <div className="container">
        <div className="card">
          <h2>Signed in as {user.email}</h2>
          <p className="muted">This app requires a doctor login.</p>
          <button className="btn" onClick={logout}>
            Log out
          </button>
        </div>
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="container">
        <div className="card">
          <h2>{user.email}</h2>
          <ErrorNote error={error} />
          <p className="muted">
            No doctor profile is linked to this login yet — ask your hospital
            admin. <button className="btn" onClick={logout}>Log out</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          CareFlow <span style={{ color: "#9fd9d8" }}>AI</span>
        </div>
        <div className="who">{profile?.name}</div>
        {(["today", "upcoming", "calendar"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <div className="spacer" />
        <button onClick={logout}>Log out</button>
      </aside>
      <main className="content">
        {tab === "today" && <AppointmentList range="today" />}
        {tab === "upcoming" && <AppointmentList range="upcoming" />}
        {tab === "calendar" && profile && <CalendarEditor profile={profile} />}
      </main>
    </div>
  );
}
