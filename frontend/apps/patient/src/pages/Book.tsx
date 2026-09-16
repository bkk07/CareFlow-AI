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

/** Guided booking: visit type -> week slot grid -> confirm. */
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
  const [loadingSlots, setLoadingSlots] = useState(false);

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
    setLoadingSlots(true);
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
      .finally(() => setLoadingSlots(false));
  }, [doctor, typeId, weekOffset]);

  if (!doctor) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-icon" aria-hidden>
            ⌕
          </div>
          <h3>Pick a doctor first</h3>
          <p>Search live availability, then choose a time that suits you.</p>
          <button className="btn btn-primary" onClick={() => navigate("/")}>
            Find care
          </button>
        </div>
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
  const activeType = types.find((t) => t.id === typeId);

  return (
    <>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {doctor.specialty ?? "General"} · {doctor.hospital_name}
        </p>
        <h2 style={{ marginTop: 0 }}>Book with {doctor.name}</h2>
        <div className="steps" aria-label="Booking progress">
          <span className={`step ${step > 1 ? "done" : step === 1 ? "active" : ""}`}>
            {step > 1 ? "✓" : "1"} · Visit type
          </span>
          <span className={`step ${step > 2 ? "done" : step === 2 ? "active" : ""}`}>
            {step > 2 ? "✓" : "2"} · Time
          </span>
          <span className={`step ${step === 3 ? "active" : ""}`}>3 · Confirm</span>
        </div>
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="visit-type">Visit type</label>
          <select
            id="visit-type"
            className="select"
            style={{ width: "100%" }}
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.duration_minutes} min
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar">
          <button
            className="btn btn-sm"
            onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
            disabled={weekOffset === 0 || loadingSlots}
          >
            ← Prev week
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setWeekOffset((w) => Math.min(8, w + 1))}
            disabled={loadingSlots}
          >
            Next week →
          </button>
          <span className="spacer" />
          {loadingSlots && (
            <span className="muted">
              <span className="spinner" aria-hidden /> Loading real availability…
            </span>
          )}
        </div>
        {loadingSlots ? (
          <div className="slot-grid" aria-live="polite">
            {[0, 1, 2, 3].map((i) => (
              <div className="slot-day" key={i}>
                <div className="skeleton" style={{ width: "60%", marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 34, marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 34, marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 34 }} />
              </div>
            ))}
          </div>
        ) : byDay.size > 0 ? (
          <div className="slot-grid">
            {[...byDay.entries()].map(([day, list]) => (
              <div className="slot-day" key={day}>
                <h4>{dayLabel(day)}</h4>
                {list.map((s) => (
                  <button
                    key={s.start}
                    className={`slot${selected?.start === s.start ? " selected" : ""}`}
                    onClick={() => setSelected(s)}
                    aria-pressed={selected?.start === s.start}
                  >
                    {slotLabel(s.start)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon" aria-hidden>
              ◷
            </div>
            <h3>No open slots this week</h3>
            <p>Try the next week — new availability opens regularly.</p>
          </div>
        )}
      </div>
      {selected && (
        <div className="card">
          <h3>Confirm your visit</h3>
          <div className="row-item">
            <div className="grow">
              <p className="title">
                {new Date(selected.start).toLocaleString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
              <p className="sub">
                {doctor.name} · {activeType?.name} · ends{" "}
                {new Date(selected.end).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <button className="btn btn-primary btn-lg" onClick={() => void confirm()} disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner" aria-hidden /> Booking…
                </>
              ) : (
                "Confirm booking"
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
