import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  apiError,
  checkAvailability,
  listAppointmentTypes,
  searchDoctors,
  searchHospitals,
  type Appointment,
  type DoctorResult,
  type Hospital,
} from "../api";

function initials(name: string): string {
  return name
    .split(" ")
    .filter((w) => w.length > 0 && w[0] === w[0]?.toUpperCase())
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function Home() {
  const navigate = useNavigate();
  const [specialty, setSpecialty] = useState("");
  const [hospitalId, setHospitalId] = useState("");
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [results, setResults] = useState<DoctorResult[] | null>(null);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [nextSlots, setNextSlots] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshUpcoming = useCallback(async () => {
    try {
      const { data } = await api.get<Appointment[]>("/appointments");
      const live = data
        .filter((a) =>
          ["confirmed", "rescheduled", "sync_pending", "reconciliation_required"].includes(a.state),
        )
        .sort((a, b) => a.slot_start.localeCompare(b.slot_start))
        .slice(0, 3);
      setUpcoming(live);
    } catch {
      /* visits page shows the full picture */
    }
  }, []);

  useEffect(() => {
    searchHospitals("")
      .then(setHospitals)
      .catch(() => undefined);
    void refreshUpcoming();
  }, [refreshUpcoming]);

  async function search() {
    setError(null);
    setBusy(true);
    try {
      const doctors = await searchDoctors({
        hospital_id: hospitalId || undefined,
        specialty: specialty.trim() || undefined,
      });
      setResults(doctors);
      // Next-available hint per doctor (first type, next 7 days).
      const hints: Record<string, string> = {};
      await Promise.all(
        doctors.slice(0, 6).map(async (d) => {
          try {
            const types = await listAppointmentTypes(d.hospital_id);
            if (types.length === 0) return;
            const today = new Date().toISOString().slice(0, 10);
            const plus7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
            const slots = await checkAvailability({
              doctor_id: d.id,
              appointment_type_id: types[0].id,
              date_from: today,
              date_to: plus7,
            });
            if (slots.length > 0) hints[d.id] = slots[0].start;
          } catch {
            /* hint is best-effort */
          }
        }),
      );
      setNextSlots(hints);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero">
        <h1>Find the right doctor, book in minutes</h1>
        <p>Real availability from live hospital schedules — no phone tag.</p>
        <div className="searchbar">
          <input
            className="input"
            placeholder="Specialty, e.g. Cardiology"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
          />
          <select
            className="select"
            value={hospitalId}
            onChange={(e) => setHospitalId(e.target.value)}
          >
            <option value="">All hospitals</option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => void search()} disabled={busy}>
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {upcoming.length > 0 && (
        <div className="card">
          <h3>Your upcoming visits</h3>
          {upcoming.map((a) => (
            <p key={a.id}>
              <span className={`pill pill-${a.state}`}>{a.state.replace("_", " ")}</span>{" "}
              {new Date(a.slot_start).toLocaleString()}{" "}
              <Link to="/visits">Manage</Link>
            </p>
          ))}
        </div>
      )}

      {results !== null && (
        <>
          <h2>
            {results.length} doctor{results.length === 1 ? "" : "s"} found
          </h2>
          <div className="grid-cards">
            {results.map((d) => (
              <div className="card doctor-card" key={d.id}>
                <div className="avatar">{initials(d.name)}</div>
                <div>
                  <h3>{d.name}</h3>
                  <p className="sub">
                    {d.specialty ?? "General"} · {d.hospital_name}
                  </p>
                  <p className="sub">
                    {nextSlots[d.id]
                      ? `Next available: ${new Date(nextSlots[d.id]).toLocaleString()}`
                      : "Checking availability…"}
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={() => navigate("/book", { state: { doctor: d } })}
                  >
                    Book
                  </button>
                </div>
              </div>
            ))}
          </div>
          {results.length === 0 && (
            <div className="card">
              <p className="muted">
                No doctors match. Try a different specialty, or{" "}
                <Link to="/chat">ask the assistant</Link>.
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}
