import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import { EASE, Page, popVariants } from "../motion";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, SearchIcon } from "../icons";

interface LocationState {
  doctor?: DoctorResult;
}

function localDay(iso: string): string {
  // Group by the patient's LOCAL day: slot labels render local time, so the
  // column header must use the same frame (UTC grouping orphaned late slots).
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function dayLabel(day: string): string {
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString(undefined, {
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
      <Page>
        <div className="card">
          <div className="empty">
            <motion.div
              className="empty-icon"
              aria-hidden
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 16 }}
            >
              <SearchIcon size={26} />
            </motion.div>
            <h3>Pick a doctor first</h3>
            <p>Search live availability, then choose a time that suits you.</p>
            <motion.button
              className="btn btn-primary"
              onClick={() => navigate("/")}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
            >
              Find care
            </motion.button>
          </div>
        </div>
      </Page>
    );
  }

  const byDay = new Map<string, Slot[]>();
  for (const s of slots) {
    const day = localDay(s.start);
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
    <Page>
      <motion.div
        className="card"
        layout
        transition={{ duration: 0.3, ease: EASE }}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          {doctor.specialty ?? "General"} · {doctor.hospital_name}
        </p>
        <h2 style={{ marginTop: 0 }}>Book with {doctor.name}</h2>
        <div className="steps" aria-label="Booking progress">
          {(["Visit type", "Time", "Confirm"] as const).map((label, i) => {
            const n = i + 1;
            const cls =
              step > n ? "step done" : step === n ? "step active" : "step";
            return (
              <motion.span
                key={label}
                className={cls}
                layout
                animate={step === n ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                {step > n ? <CheckIcon size={13} /> : n} · {label}
              </motion.span>
            );
          })}
        </div>
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
          {notice && (
            <motion.p
              className="notice"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              {notice}
            </motion.p>
          )}
        </AnimatePresence>
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
          <motion.button
            className="btn btn-sm"
            onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
            disabled={weekOffset === 0 || loadingSlots}
            whileTap={{ scale: 0.95 }}
          >
            <ChevronLeftIcon size={15} /> Prev week
          </motion.button>
          <motion.button
            className="btn btn-sm"
            onClick={() => setWeekOffset((w) => Math.min(8, w + 1))}
            disabled={loadingSlots}
            whileTap={{ scale: 0.95 }}
          >
            Next week <ChevronRightIcon size={15} />
          </motion.button>
          <span className="spacer" />
          {loadingSlots && (
            <span className="muted">
              <span className="spinner" aria-hidden /> Loading real availability…
            </span>
          )}
        </div>
        <AnimatePresence mode="wait">
          {loadingSlots ? (
            <motion.div
              className="slot-grid"
              key={`loading-${weekOffset}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              aria-live="polite"
            >
              {[0, 1, 2, 3].map((i) => (
                <div className="slot-day" key={i}>
                  <div className="skeleton" style={{ width: "60%", marginBottom: 10 }} />
                  <div className="skeleton" style={{ height: 34, marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 34, marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 34 }} />
                </div>
              ))}
            </motion.div>
          ) : byDay.size > 0 ? (
            <motion.div
              className="slot-grid"
              key={`slots-${weekOffset}-${typeId}`}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.04 } },
              }}
            >
              {[...byDay.entries()].map(([day, list]) => (
                <motion.div
                  className="slot-day"
                  key={day}
                  layout
                  variants={{
                    hidden: { opacity: 0, y: 14 },
                    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
                  }}
                >
                  <h4>{dayLabel(day)}</h4>
                  {list.map((s) => (
                    <motion.button
                      key={s.start}
                      layout
                      className={`slot${selected?.start === s.start ? " selected" : ""}`}
                      onClick={() => setSelected(s)}
                      aria-pressed={selected?.start === s.start}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.94 }}
                    >
                      {slotLabel(s.start)}
                    </motion.button>
                  ))}
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              className="empty"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className="empty-icon" aria-hidden>
                <ClockIcon size={26} />
              </div>
              <h3>No open slots this week</h3>
              <p>Try the next week — new availability opens regularly.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <AnimatePresence>
        {selected && (
          <motion.div
            className="card"
            variants={popVariants}
            initial="hidden"
            animate="show"
            exit="exit"
          >
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
              <motion.button
                className="btn btn-primary btn-lg"
                onClick={() => void confirm()}
                disabled={busy}
                whileHover={busy ? undefined : { scale: 1.03 }}
                whileTap={busy ? undefined : { scale: 0.97 }}
              >
                {busy ? (
                  <>
                    <span className="spinner" aria-hidden /> Booking…
                  </>
                ) : (
                  "Confirm booking"
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  );
}
