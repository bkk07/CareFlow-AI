import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  api,
  apiError,
  checkAvailability,
  listAppointmentTypes,
  newKey,
  type AppointmentType,
  type DoctorResult,
  type Slot,
} from "../api";

interface LocationState {
  doctor?: DoctorResult;
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function slotLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Guided booking: doctor -> visit type -> day -> slot -> confirm. */
export default function Book({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const preselected = (location.state as LocationState | null)?.doctor ?? null;

  const [doctor] = useState<DoctorResult | null>(preselected);
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [typeId, setTypeId] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!doctor) return;
    listAppointmentTypes(doctor.hospital_id)
      .then((t) => {
        setTypes(t);
        if (t.length > 0) setTypeId(t[0].id);
      })
      .catch((e) => setError(apiError(e)));
  }, [doctor]);

  useEffect(() => {
    if (!doctor || !typeId) return;
    const from = new Date(Date.now() + weekOffset * 7 * 864e5);
    const to = new Date(from.getTime() + 6 * 864e5);
    setBusy(true);
    checkAvailability({
      doctor_id: doctor.id,
      appointment_type_id: typeId,
      date_from: from.toISOString().slice(0, 10),
      date_to: to.toISOString().slice(0, 10),
    })
      .then((s) => {
        setSlots(s);
        setSelected(null);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setBusy(false));
  }, [doctor, typeId, weekOffset]);

  if (!doctor) {
    return (
      <div className="card">
        <h2>Book a visit</h2>
        <p className="muted">
          Pick a doctor first — <button className="btn" onClick={() => navigate("/")}>find care</button>
        </p>
      </div>
    );
  }

  const byDay = new Map<string, Slot[]>();
  for (const s of slots) {
    const day = s.start.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(s);
    byDay.set(day, list);
  }

  async function confirm() {
    if (!selected || !doctor) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { data } = await api.post("/appointments", {
        patient_id: patientId,
        doctor_id: doctor.id,
        appointment_type_id: typeId,
        slot_start: selected.start,
        slot_end: selected.end,
        idempotency_key: newKey(),
      });
      if (data.state === "reconciliation_required" || data.state === "sync_pending") {
        setNotice("Booked — your slot is held while we confirm with the clinic.");
      } else {
        setNotice("Booked! See you soon.");
      }
      setTimeout(() => navigate("/visits"), 1200);
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 202) {
        setNotice("Booked — your slot is held while we confirm with the clinic.");
        setTimeout(() => navigate("/visits"), 1200);
      } else {
        setError(apiError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  const step = !typeId ? 1 : !selected ? 2 : 3;

  return (
    <>
      <div className="card">
        <h2>
          Book with {doctor.name} <span className="muted">· {doctor.hospital_name}</span>
        </h2>
        <div className="steps">
          <span className={`step ${step > 1 ? "done" : step === 1 ? "active" : ""}`}>1 · Visit type</span>
          <span className={`step ${step > 2 ? "done" : step === 2 ? "active" : ""}`}>2 · Time</span>
          <span className={`step ${step === 3 ? "active" : ""}`}>3 · Confirm</span>
        </div>
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <div className="field">
          <label>Visit type</label>
          <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.duration_minutes} min
              </option>
            ))}
          </select>
        </div>
        <div>
          <button className="btn" onClick={() => setWeekOffset((w) => Math.max(0, w - 1))} disabled={weekOffset === 0 || busy}>
            ← Prev week
          </button>
          <button className="btn" onClick={() => setWeekOffset((w) => Math.min(8, w + 1))} disabled={busy}>
            Next week →
          </button>
        </div>
        {busy && <p className="muted">Loading real availability…</p>}
        <div className="slot-grid">
          {[...byDay.entries()].map(([day, list]) => (
            <div className="slot-day" key={day}>
              <h4>{dayLabel(day)}</h4>
              {list.map((s) => (
                <button
                  key={s.start}
                  className={`slot${selected?.start === s.start ? " selected" : ""}`}
                  onClick={() => setSelected(s)}
                >
                  {slotLabel(s.start)}
                </button>
              ))}
            </div>
          ))}
        </div>
        {byDay.size === 0 && !busy && (
          <p className="muted">No open slots this week — try the next one.</p>
        )}
      </div>
      {selected && (
        <div className="card">
          <h3>Confirm your visit</h3>
          <p>
            {doctor.name} · {new Date(selected.start).toLocaleString()} –{" "}
            {new Date(selected.end).toLocaleTimeString()}
          </p>
          <button className="btn btn-primary" onClick={() => void confirm()} disabled={busy}>
            Confirm booking
          </button>
        </div>
      )}
    </>
  );
}
