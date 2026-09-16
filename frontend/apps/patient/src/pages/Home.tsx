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

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  const [searched, setSearched] = useState(false);

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
    setSearched(true);
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
        <p>Real availability from live hospital schedules — no phone tag, no waiting rooms.</p>
        <div className="hero-trust">
          <span>
            <strong>{hospitals.length}</strong>&nbsp;partner hospitals
          </span>
          <span>Live availability</span>
          <span>Free to use</span>
        </div>
      </div>

      <div className="search-card">
        <div className="searchbar" role="search">
          <input
            className="input"
            aria-label="Specialty"
            placeholder="Specialty, e.g. Cardiology"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
          />
          <select
            className="select"
            aria-label="Hospital"
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
          <button className="btn btn-primary btn-lg" onClick={() => void search()} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden /> Searching…
              </>
            ) : (
              "Search"
            )}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {upcoming.length > 0 && (
        <div className="card">
          <h3>Your upcoming visits</h3>
          <div className="row-list">
            {upcoming.map((a) => (
              <div className="row-item" key={a.id}>
                <span className={`pill pill-${a.state}`}>{a.state.replace(/_/g, " ")}</span>
                <div className="grow">
                  <p className="title">{fmt(a.slot_start)}</p>
                </div>
                <Link className="btn btn-sm" to="/visits">
                  Manage
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {busy && results === null && searched && (
        <div className="card" aria-live="polite">
          {[0, 1, 2].map((i) => (
            <div className="skeleton-row" key={i}>
              <div className="avatar skeleton" style={{ width: 54, height: 54, borderRadius: "50%" }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: "45%", marginBottom: 8 }} />
                <div className="skeleton" style={{ width: "70%" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {results !== null && !busy && (
        <>
          <div className="section-head">
            <h2>
              {results.length} doctor{results.length === 1 ? "" : "s"} found
            </h2>
            {specialty.trim() && <span className="muted">for “{specialty.trim()}”</span>}
          </div>
          {results.length > 0 ? (
            <div className="grid-cards">
              {results.map((d) => (
                <div className="card doctor-card" key={d.id}>
                  <div className="avatar" aria-hidden>
                    {initials(d.name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3>{d.name}</h3>
                    <p className="sub">
                      {d.specialty ?? "General"} · {d.hospital_name}
                    </p>
                    {nextSlots[d.id] ? (
                      <span className="next-slot">Next: {fmt(nextSlots[d.id])}</span>
                    ) : (
                      <span className="next-slot checking">Checking availability…</span>
                    )}
                    <div>
                      <button
                        className="btn btn-primary"
                        onClick={() => navigate("/book", { state: { doctor: d } })}
                      >
                        Book visit
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card">
              <div className="empty">
                <div className="empty-icon" aria-hidden>
                  ⌕
                </div>
                <h3>No doctors match your search</h3>
                <p>Try a different specialty or hospital — or ask the assistant for help.</p>
                <Link className="btn btn-primary" to="/chat">
                  Ask the assistant
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
