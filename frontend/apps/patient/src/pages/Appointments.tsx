import { useCallback, useEffect, useState } from "react";
import axios from "axios";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

interface Appointment {
  id: string;
  hospital_id: string;
  patient_id: string;
  doctor_id: string;
  appointment_type_id: string;
  slot_start: string;
  slot_end: string;
  state: string;
  external_id: string | null;
  idempotency_key: string;
}

interface HistoryEntry {
  from_state: string;
  to_state: string;
  reason: string | null;
  created_at: string;
}

function storedToken(): string | null {
  return localStorage.getItem("careflow_patient_token");
}

function authHeaders() {
  return { Authorization: `Bearer ${storedToken()}` };
}

/** datetime-local value ("2026-10-05T09:00") is interpreted as UTC. */
function asUtcIso(local: string): string {
  return new Date(`${local}:00Z`).toISOString();
}

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `key-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export default function Appointments() {
  const [patientId, setPatientId] = useState<string | null>(null);
  const [items, setItems] = useState<Appointment[]>([]);
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({});
  const [doctorId, setDoctorId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await axios.get<Appointment[]>(`${API_BASE}/appointments`, {
      headers: authHeaders(),
    });
    setItems(data);
  }, []);

  useEffect(() => {
    if (!storedToken()) return;
    axios
      .get<{ id: string }>(`${API_BASE}/patients/me`, { headers: authHeaders() })
      .then((res) => setPatientId(res.data.id))
      .catch(() => setError("Could not load your profile."));
    refresh().catch(() => setError("Could not load your appointments."));
  }, [refresh]);

  async function book() {
    setError(null);
    setNotice(null);
    try {
      await axios.post(
        `${API_BASE}/appointments`,
        {
          patient_id: patientId,
          doctor_id: doctorId,
          appointment_type_id: typeId,
          slot_start: asUtcIso(start),
          slot_end: asUtcIso(end),
          idempotency_key: newKey(),
        },
        { headers: authHeaders() },
      );
      setDoctorId("");
      setTypeId("");
      setStart("");
      setEnd("");
      setNotice("Appointment booked.");
      await refresh();
    } catch {
      setError("Booking failed. Check the IDs and that the slot is free.");
    }
  }

  async function cancel(id: string) {
    setError(null);
    setNotice(null);
    try {
      await axios.post(
        `${API_BASE}/appointments/${id}/cancel`,
        {},
        { headers: authHeaders() },
      );
      setNotice("Appointment cancelled; the slot is free again.");
      await refresh();
    } catch {
      setError("Cancellation failed.");
    }
  }

  async function reschedule(id: string) {
    setError(null);
    setNotice(null);
    try {
      await axios.post(
        `${API_BASE}/appointments/${id}/reschedule`,
        { slot_start: asUtcIso(newStart), slot_end: asUtcIso(newEnd) },
        { headers: authHeaders() },
      );
      setRescheduling(null);
      setNotice("Appointment rescheduled.");
      await refresh();
    } catch {
      setError("Reschedule failed; your original booking is unchanged.");
    }
  }

  async function showHistory(id: string) {
    try {
      const { data } = await axios.get<{ history: HistoryEntry[] }>(
        `${API_BASE}/appointments/${id}`,
        { headers: authHeaders() },
      );
      setHistory((prev) => ({ ...prev, [id]: data.history }));
    } catch {
      setError("Could not load history.");
    }
  }

  if (!storedToken()) {
    return (
      <section>
        <h2>Appointments</h2>
        <p>Sign in to manage your appointments.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Appointments</h2>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {notice && <p style={{ color: "green" }}>{notice}</p>}

      <h3>Book (times are UTC)</h3>
      <div>
        <input
          style={{ marginRight: "0.5rem" }}
          placeholder="Doctor ID"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
        />
        <input
          style={{ marginRight: "0.5rem" }}
          placeholder="Appointment type ID"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
        />
      </div>
      <div style={{ marginTop: "0.5rem" }}>
        <label>
          Start{" "}
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>{" "}
        <label>
          End{" "}
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>{" "}
        <button
          onClick={() => void book()}
          disabled={!patientId || !doctorId || !typeId || !start || !end}
        >
          Book
        </button>
      </div>

      <h3>My appointments</h3>
      {items.length === 0 && <p>None yet.</p>}
      <ul>
        {items.map((a) => (
          <li key={a.id}>
            {new Date(a.slot_start).toLocaleString()} –{" "}
            {new Date(a.slot_end).toLocaleString()} · {a.state}{" "}
            <button onClick={() => void showHistory(a.id)}>History</button>{" "}
            {(a.state === "confirmed" || a.state === "rescheduled") && (
              <>
                <button onClick={() => setRescheduling(a.id)}>Reschedule</button>{" "}
                <button onClick={() => void cancel(a.id)}>Cancel</button>
              </>
            )}
            {rescheduling === a.id && (
              <span>
                {" "}
                <input
                  type="datetime-local"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                />{" "}
                <input
                  type="datetime-local"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                />{" "}
                <button
                  onClick={() => void reschedule(a.id)}
                  disabled={!newStart || !newEnd}
                >
                  Confirm move
                </button>{" "}
                <button onClick={() => setRescheduling(null)}>Keep</button>
              </span>
            )}
            {history[a.id] && (
              <ul>
                {history[a.id].map((h, i) => (
                  <li key={i}>
                    {h.from_state} → {h.to_state}
                    {h.reason ? ` (${h.reason})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
