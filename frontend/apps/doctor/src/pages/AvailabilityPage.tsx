import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, CheckCircle2, Phone, Plus, Trash2, Video } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useSchedule } from "../context/ScheduleContext";
import { Button, EmptyState } from "../components/common/ui";
import { Modal } from "../components/common/Modal";
import type { BlockedSlot, ConsultationMode } from "../types";

const DURATIONS = [15, 30, 45, 60];
const REASONS: BlockedSlot["reason"][] = ["Lunch", "Meeting", "Leave", "Administrative work", "Personal time"];

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onChange} className={`w-11 h-6 rounded-full p-0.5 transition shrink-0 ${on ? "bg-healthcare" : "bg-border"}`}>
      <motion.span layout className={`block w-5 h-5 rounded-full bg-white shadow ${on ? "ml-5" : "ml-0"}`} transition={{ duration: 0.18 }} />
    </button>
  );
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AvailabilityPage() {
  const { doctor, updateDoctor } = useAuth();
  const {
    live,
    loading,
    rules,
    blocks,
    accepting,
    setAccepting,
    toggleRule,
    updateRule,
    addBlock,
    addLiveBlock,
    deleteBlock,
    refresh,
  } = useSchedule();
  const [blockOpen, setBlockOpen] = useState(false);
  // Mock-mode block form (display strings, local only).
  const [date, setDate] = useState("Fri, Sep 26");
  const [start, setStart] = useState("12:00 PM");
  const [end, setEnd] = useState("01:00 PM");
  // Live-mode block form (real datetimes for the API).
  const [liveDate, setLiveDate] = useState(todayInput);
  const [liveStart, setLiveStart] = useState("12:00");
  const [liveEnd, setLiveEnd] = useState("13:00");
  const [reason, setReason] = useState<BlockedSlot["reason"]>("Meeting");
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const acceptingShown = live ? accepting : doctor.acceptingAppointments;

  function flash(msg: string) {
    setSaved(msg);
    setSaveError(null);
    setTimeout(() => setSaved(null), 2200);
  }

  function fail(msg: string) {
    setSaveError(msg);
    setTimeout(() => setSaveError(null), 3200);
  }

  async function toggleMode(m: ConsultationMode) {
    const has = doctor.consultationTypes.includes(m);
    const next = has
      ? doctor.consultationTypes.filter((x) => x !== m)
      : [...doctor.consultationTypes, m];
    try {
      await updateDoctor({ consultationTypes: next });
      flash("Consultation types updated");
    } catch {
      fail("Could not save consultation types.");
    }
  }

  async function flipAccepting() {
    if (!live) {
      await updateDoctor({ acceptingAppointments: !doctor.acceptingAppointments });
      flash("Availability status updated");
      return;
    }
    try {
      await setAccepting(!accepting);
      flash("Availability status updated");
    } catch {
      fail("Could not update calendar status.");
    }
  }

  async function saveBlock() {
    try {
      if (live) {
        await addLiveBlock(liveDate, liveStart, liveEnd, reason);
        flash(`Blocked ${liveDate} · ${liveStart}–${liveEnd}`);
      } else {
        await addBlock({ date, start, end, reason });
        flash(`Blocked ${date} · ${start}–${end}`);
      }
      setBlockOpen(false);
    } catch {
      fail("Could not save blocked time. Check the times and try again.");
    }
  }

  async function removeBlock(id: string) {
    try {
      await deleteBlock(id);
      flash("Blocked period removed");
    } catch {
      fail("Could not remove blocked time.");
    }
  }

  async function setDuration(d: number) {
    try {
      await updateDoctor({ appointmentDuration: d });
      flash(`Duration set to ${d} min`);
    } catch {
      fail("Could not save visit length.");
    }
  }

  const modeCards: { id: ConsultationMode; label: string; desc: string; icon: React.ElementType }[] = [
    { id: "in_person", label: "In-person", desc: "Clinic rooms", icon: Building2 },
    { id: "video", label: "Video", desc: "Secure link", icon: Video },
    { id: "phone", label: "Telephone", desc: "Call patient", icon: Phone },
  ];

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="page-title">Availability</h1>
        <p className="page-sub mt-1">
          {live ? "Working hours, visit length, consultation types, and blocked time — synced with your hospital." : "Working hours, visit length, consultation types, and blocked time. All saved locally."}
        </p>
      </div>

      {live && loading && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">Syncing availability…</p>
      )}

      <AnimatePresence>
        {saved && (
          <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-[0.85rem] font-bold text-success bg-success-soft border border-success/25 rounded-control px-3.5 py-2.5">
            <CheckCircle2 size={16} /> {saved}
          </motion.p>
        )}
      </AnimatePresence>
      {saveError && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3.5 py-2.5">{saveError}</p>
      )}

      <section className="card-base p-5" aria-label="Availability status">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="section-title">{acceptingShown ? "Accepting appointments" : "Not accepting new appointments"}</h2>
            <p className="text-[0.83rem] text-ink-secondary mt-0.5">
              {acceptingShown ? "Patients can book your open periods." : doctor.status === "suspended" ? "Appointments temporarily unavailable." : "Booking is paused; existing visits stay unchanged."}
            </p>
          </div>
          <Toggle on={acceptingShown} onChange={() => void flipAccepting()} label="Accepting appointments" />
        </div>
      </section>

      <section className="card-base p-5" aria-label="Working hours">
        <h2 className="section-title">Working hours</h2>
        <ul className="mt-3 divide-y divide-border">
          {rules.map((r) => (
            <li key={r.id} className="py-2.5 flex items-center gap-3 flex-wrap">
              <span className="w-24 font-bold text-[0.88rem] text-ink">{r.day}</span>
              <Toggle on={r.enabled} onChange={() => void toggleRule(r.id).catch(() => fail("Could not update working hours."))} label={`${r.day} enabled`} />
              {r.enabled ? (
                <span className="flex items-center gap-1.5 text-sm">
                  <input type="time" value={r.start} onChange={(e) => void updateRule(r.id, { start: e.target.value }).catch(() => fail("Could not update working hours."))} aria-label={`${r.day} start`} className="border border-border rounded-lg px-2 py-1.5 text-sm" />
                  <span className="text-ink-faint">–</span>
                  <input type="time" value={r.end} onChange={(e) => void updateRule(r.id, { end: e.target.value }).catch(() => fail("Could not update working hours."))} aria-label={`${r.day} end`} className="border border-border rounded-lg px-2 py-1.5 text-sm" />
                </span>
              ) : (
                <span className="text-[0.82rem] text-ink-faint font-semibold">Closed</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card-base p-5" aria-label="Appointment duration">
        <h2 className="section-title">Appointment duration</h2>
        <div className="grid grid-cols-4 gap-2 mt-3">
          {DURATIONS.map((d) => (
            <button
              key={d}
              onClick={() => void setDuration(d)}
              aria-pressed={doctor.appointmentDuration === d}
              className={`py-2.5 rounded-control border font-bold text-sm transition ${doctor.appointmentDuration === d ? "bg-navy text-white border-navy" : "bg-white border-border hover:border-healthcare"}`}
            >
              {d} min
            </button>
          ))}
        </div>
        <p className="text-[0.8rem] text-ink-secondary mt-2">Currently <strong className="text-ink">{doctor.appointmentDuration} min</strong> per visit.</p>
      </section>

      <section className="card-base p-5" aria-label="Consultation types">
        <h2 className="section-title">Consultation types</h2>
        <div className="grid sm:grid-cols-3 gap-2 mt-3">
          {modeCards.map((m) => {
            const on = doctor.consultationTypes.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => void toggleMode(m.id)}
                aria-pressed={on}
                className={`text-left border rounded-control p-3.5 transition ${on ? "border-healthcare bg-healthcare-faint" : "border-border bg-white hover:border-healthcare"}`}
              >
                <m.icon size={18} className={on ? "text-healthcare" : "text-ink-faint"} />
                <p className="font-bold text-[0.87rem] text-ink mt-1.5">{m.label}</p>
                <p className="text-[0.76rem] text-ink-secondary">{m.desc}</p>
                <p className={`text-[0.72rem] font-bold mt-1 ${on ? "text-healthcare" : "text-ink-faint"}`}>{on ? "Enabled" : "Disabled"}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card-base p-5" aria-label="Blocked time">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Blocked time</h2>
          <Button size="sm" onClick={() => { setSaveError(null); setBlockOpen(true); }}><Plus size={15} /> Block time</Button>
        </div>
        {blocks.length === 0 ? (
          <div className="mt-2"><EmptyState title="No blocked periods" body="Lunch, meetings, or leave will appear here and on your calendar." /></div>
        ) : (
          <ul className="mt-3 space-y-2">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 border border-border rounded-control px-3.5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-bold text-ink block">{b.date} · {b.start} – {b.end}</span>
                  <span className="text-ink-secondary text-[0.8rem]">{b.reason}{b.note ? ` · ${b.note}` : ""}</span>
                </span>
                <button onClick={() => void removeBlock(b.id)} aria-label={`Remove block ${b.date} ${b.reason}`} className="w-9 h-9 rounded-lg hover:bg-danger-soft text-ink-faint hover:text-danger flex items-center justify-center transition shrink-0">
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {live && (
          <button onClick={() => void refresh()} className="mt-3 text-[0.8rem] font-bold text-healthcare hover:underline">Refresh from hospital</button>
        )}
      </section>

      <Modal open={blockOpen} onClose={() => setBlockOpen(false)} title="Block time">
        <div className="space-y-3">
          {live ? (
            <>
              <label className="block text-[0.83rem] font-bold">Date
                <input type="date" value={liveDate} onChange={(e) => setLiveDate(e.target.value)} className="input-base mt-1" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[0.83rem] font-bold">Start<input type="time" value={liveStart} onChange={(e) => setLiveStart(e.target.value)} className="input-base mt-1" /></label>
                <label className="block text-[0.83rem] font-bold">End<input type="time" value={liveEnd} onChange={(e) => setLiveEnd(e.target.value)} className="input-base mt-1" /></label>
              </div>
            </>
          ) : (
            <>
              <label className="block text-[0.83rem] font-bold">Date
                <select value={date} onChange={(e) => setDate(e.target.value)} className="input-base mt-1">
                  {["Today", "Tomorrow", "Fri, Sep 26", "Mon, Sep 28"].map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[0.83rem] font-bold">Start<input value={start} onChange={(e) => setStart(e.target.value)} className="input-base mt-1" /></label>
                <label className="block text-[0.83rem] font-bold">End<input value={end} onChange={(e) => setEnd(e.target.value)} className="input-base mt-1" /></label>
              </div>
            </>
          )}
          <label className="block text-[0.83rem] font-bold">Reason
            <select value={reason} onChange={(e) => setReason(e.target.value as BlockedSlot["reason"])} className="input-base mt-1">
              {REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <Button onClick={() => void saveBlock()} className="w-full">Save blocked time</Button>
        </div>
      </Modal>
    </div>
  );
}
