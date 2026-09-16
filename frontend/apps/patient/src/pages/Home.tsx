import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import { EASE, Item, Page, Stagger, itemVariants } from "../motion";

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
    <Page>
      <motion.div
        className="hero"
        initial={{ opacity: 0, y: 24, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08, ease: EASE }}
        >
          Find the right doctor, book in minutes
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.16, ease: EASE }}
        >
          Real availability from live hospital schedules — no phone tag, no waiting rooms.
        </motion.p>
        <motion.div
          className="hero-trust"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.26 }}
        >
          <span>
            <strong>{hospitals.length}</strong>&nbsp;partner hospitals
          </span>
          <span>Live availability</span>
          <span>Free to use</span>
        </motion.div>
      </motion.div>

      <motion.div
        className="search-card"
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: EASE }}
      >
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
          <motion.button
            className="btn btn-primary btn-lg"
            onClick={() => void search()}
            disabled={busy}
            whileHover={busy ? undefined : { scale: 1.03 }}
            whileTap={busy ? undefined : { scale: 0.97 }}
          >
            {busy ? (
              <>
                <span className="spinner" aria-hidden /> Searching…
              </>
            ) : (
              "Search"
            )}
          </motion.button>
        </div>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.p
            className="error"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: "1rem" }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {upcoming.length > 0 && (
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
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
          </motion.div>
        )}
      </AnimatePresence>

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

      <AnimatePresence mode="wait">
        {results !== null && !busy && (
          <motion.div
            key={`results-${results.length}-${specialty}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="section-head">
              <h2>
                {results.length} doctor{results.length === 1 ? "" : "s"} found
              </h2>
              {specialty.trim() && <span className="muted">for “{specialty.trim()}”</span>}
            </div>
            {results.length > 0 ? (
              <Stagger className="grid-cards">
                {results.map((d) => (
                  <Item key={d.id} className="card doctor-card">
                    <div className="avatar" aria-hidden>
                      {initials(d.name)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <h3>{d.name}</h3>
                      <p className="sub">
                        {d.specialty ?? "General"} · {d.hospital_name}
                      </p>
                      <AnimatePresence mode="wait">
                        {nextSlots[d.id] ? (
                          <motion.span
                            key="slot"
                            className="next-slot"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                          >
                            Next: {fmt(nextSlots[d.id])}
                          </motion.span>
                        ) : (
                          <motion.span
                            key="checking"
                            className="next-slot checking"
                            exit={{ opacity: 0, scale: 0.9 }}
                          >
                            Checking availability…
                          </motion.span>
                        )}
                      </AnimatePresence>
                      <div>
                        <motion.button
                          className="btn btn-primary"
                          onClick={() => navigate("/book", { state: { doctor: d } })}
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                        >
                          Book visit
                        </motion.button>
                      </div>
                    </div>
                  </Item>
                ))}
              </Stagger>
            ) : (
              <motion.div
                className="card"
                variants={itemVariants}
                initial="hidden"
                animate="show"
              >
                <div className="empty">
                  <motion.div
                    className="empty-icon"
                    aria-hidden
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
                  >
                    ⌕
                  </motion.div>
                  <h3>No doctors match your search</h3>
                  <p>Try a different specialty or hospital — or ask the assistant for help.</p>
                  <Link className="btn btn-primary" to="/chat">
                    Ask the assistant
                  </Link>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  );
}
