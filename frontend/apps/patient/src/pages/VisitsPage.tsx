import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import {
  apiError as apiErrorText,
  checkAvailability as apiCheckAvailability,
  fetchAppointmentQuestionnaire,
  fetchMyAppointment,
  fetchQuestionnaireResponses,
  submitQuestionnaireAnswers,
  type Questionnaire as ApiQuestionnaire,
  type Slot,
} from "../api";
import { formatSlotDate, formatSlotTime, mapSlot, coerceQuestionnaireAnswers } from "../lib/backend";
import { countAnswered, mapApiQuestions, resumeIndexFor } from "../lib/questionnaires";
import { formatDayKeyLong, sevenDaysFrom, toLocalKey } from "../lib/helpers";
import { useAppState } from "../context/AppStateContext";
import { AppointmentCard } from "../components/appointment/AppointmentCard";
import { AppointmentDetailModal } from "../components/appointment/AppointmentDetailModal";
import DayStripWithCalendar from "../components/appointment/DayStripWithCalendar";
import { SlotPicker } from "../components/appointment/SlotPicker";
import { QuestionnaireFlow } from "../components/questionnaire/QuestionnaireFlow";
import { Button, EmptyState } from "../components/common/ui";
import { Modal, Tabs } from "../components/common/Modal";
import type { Appointment, TimeSlot } from "../types";

type Tab = "upcoming" | "past" | "cancelled";

const UPCOMING = ["confirmed", "pending", "rescheduled", "sync_pending"];

interface QuStatus {
  hasForm: boolean;
  completed: boolean;
  answered: number;
  total: number;
  loading: boolean;
}

export default function VisitsPage() {
  const location = useLocation();
  const { appointments, cancelAppointment, pushNotification, live } = useAppState();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [questionnaireFor, setQuestionnaireFor] = useState<string | null>(null);
  const [quForm, setQuForm] = useState<ApiQuestionnaire | null>(null);
  const [quLoading, setQuLoading] = useState(false);
  const [quError, setQuError] = useState<string | null>(null);
  const [quAnswers, setQuAnswers] = useState<Record<string, unknown>>({});
  const [quCompleted, setQuCompleted] = useState(false);
  const [quResumeIndex, setQuResumeIndex] = useState(0);
  const [quSaving, setQuSaving] = useState(false);
  const [quStatus, setQuStatus] = useState<Record<string, QuStatus>>({});
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Deep-link intents from Home/cards (works on mount and when already here).
  const locationState = location.state as { rescheduleId?: string; cancelId?: string; questionnaireFor?: string } | null;
  useEffect(() => {
    const s = locationState;
    if (s?.rescheduleId) setRescheduleId(s.rescheduleId);
    if (s?.cancelId) setCancelId(s.cancelId);
    if (s?.questionnaireFor) setQuestionnaireFor(s.questionnaireFor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Live: load the real pre-visit form + any saved draft when the modal opens.
  useEffect(() => {
    if (!live || !questionnaireFor) return;
    let cancelled = false;
    setQuForm(null);
    setQuError(null);
    setQuAnswers({});
    setQuCompleted(false);
    setQuResumeIndex(0);
    setQuLoading(true);
    (async () => {
      try {
        const form = await fetchAppointmentQuestionnaire(questionnaireFor);
        if (cancelled) return;
        if (!form) {
          setQuError("No questionnaire is assigned to this visit yet.");
          return;
        }
        setQuForm(form);
        const mapped = mapApiQuestions(form);
        try {
          const responses = await fetchQuestionnaireResponses(questionnaireFor);
          if (cancelled) return;
          const latest = responses[responses.length - 1];
          if (latest) {
            const saved = (latest.answers ?? {}) as Record<string, unknown>;
            setQuAnswers(saved);
            setQuCompleted(!!latest.completed);
            setQuResumeIndex(latest.completed ? 0 : resumeIndexFor(mapped, saved));
            setQuStatus((prev) => ({
              ...prev,
              [questionnaireFor]: {
                hasForm: true,
                completed: !!latest.completed,
                answered: countAnswered(mapped, saved),
                total: mapped.length,
                loading: false,
              },
            }));
          }
        } catch {
          // No saved draft yet — start fresh.
        }
      } catch {
        if (!cancelled) setQuError("Could not load the questionnaire. Try again.");
      } finally {
        if (!cancelled) setQuLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, questionnaireFor]);

  // Live: preload Start / Continue x/y / Completed state for every upcoming visit,
  // so a filled form never still shows "Start".
  useEffect(() => {
    if (!live) return;
    const ids = appointments
      .filter((a) => UPCOMING.includes(a.status))
      .map((a) => a.id);
    if (ids.length === 0) return;
    let cancelled = false;
    setQuStatus((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (!next[id]) next[id] = { hasForm: true, completed: false, answered: 0, total: 0, loading: true };
        else next[id] = { ...next[id], loading: true };
      }
      return next;
    });
    void Promise.all(
      ids.map(async (id) => {
        try {
          const form = await fetchAppointmentQuestionnaire(id);
          if (!form) {
            if (!cancelled)
              setQuStatus((prev) => ({ ...prev, [id]: { hasForm: false, completed: false, answered: 0, total: 0, loading: false } }));
            return;
          }
          const mapped = mapApiQuestions(form);
          let saved: Record<string, unknown> = {};
          let completed = false;
          try {
            const responses = await fetchQuestionnaireResponses(id);
            const latest = responses[responses.length - 1];
            if (latest) {
              saved = (latest.answers ?? {}) as Record<string, unknown>;
              completed = !!latest.completed;
            }
          } catch {
            // Treat as fresh when responses are unreadable.
          }
          if (!cancelled)
            setQuStatus((prev) => ({
              ...prev,
              [id]: { hasForm: true, completed, answered: countAnswered(mapped, saved), total: mapped.length, loading: false },
            }));
        } catch {
          if (!cancelled)
            setQuStatus((prev) => ({
              ...prev,
              [id]: { hasForm: true, completed: false, answered: 0, total: 0, loading: false },
            }));
        }
      }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, appointments.map((a) => a.id).join(",")]);

  const counts = useMemo(
    () => ({
      upcoming: appointments.filter((a) => UPCOMING.includes(a.status)).length,
      past: appointments.filter((a) => a.status === "completed").length,
      cancelled: appointments.filter((a) => a.status === "cancelled").length,
    }),
    [appointments],
  );

  const visible = useMemo(() => {
    if (tab === "upcoming") return appointments.filter((a) => UPCOMING.includes(a.status));
    if (tab === "past") return appointments.filter((a) => a.status === "completed");
    return appointments.filter((a) => a.status === "cancelled");
  }, [appointments, tab]);

  const detail = detailId ? (appointments.find((a) => a.id === detailId) ?? null) : null;
  const rescheduleAppt = rescheduleId ? (appointments.find((a) => a.id === rescheduleId) ?? null) : null;
  const cancelAppt = cancelId ? (appointments.find((a) => a.id === cancelId) ?? null) : null;
  const questionnaireAppt = questionnaireFor ? (appointments.find((a) => a.id === questionnaireFor) ?? null) : null;
  async function confirmCancel() {
    if (!cancelAppt) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelAppointment(cancelAppt.id);
      pushNotification({
        category: "appointments",
        title: "Appointment cancelled",
        body: `${cancelAppt.specialty} with ${cancelAppt.doctorName} on ${cancelAppt.date} was cancelled.`,
        unread: true,
      });
      setCancelId(null);
    } catch {
      setCancelError("Could not cancel this visit. It may already have changed state — pull to refresh and try again.");
    } finally {
      setCancelling(false);
    }
  }

  /** POST answers (draft or final) and refresh the Start/Continue/Completed badge. */
  async function persistAnswers(
    appointmentId: string,
    form: ApiQuestionnaire,
    answers: Record<string, unknown>,
    opts: { final: boolean },
  ) {
    setQuSaving(true);
    try {
      const out = await submitQuestionnaireAnswers(
        appointmentId,
        coerceQuestionnaireAnswers(form, answers),
      );
      const mapped = mapApiQuestions(form);
      const saved = (out.answers ?? {}) as Record<string, unknown>;
      setQuStatus((prev) => ({
        ...prev,
        [appointmentId]: {
          hasForm: true,
          completed: out.completed,
          answered: countAnswered(mapped, saved),
          total: mapped.length,
          loading: false,
        },
      }));
      if (questionnaireFor === appointmentId) {
        setQuAnswers(saved);
        setQuCompleted(out.completed);
        if (!out.completed) setQuResumeIndex(resumeIndexFor(mapped, saved));
      }
      if (out.completed) {
        pushNotification({
          category: "questionnaires",
          title: "Questionnaire submitted",
          body: `${form.name} was sent to the care team.`,
          unread: true,
        });
      } else if (opts.final) {
        pushNotification({
          category: "questionnaires",
          title: "Progress saved",
          body: `Draft saved — ${countAnswered(mapped, saved)} of ${mapped.length} answered.`,
          unread: true,
        });
      }
      return out;
    } finally {
      setQuSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">My visits</h1>
        <p className="page-sub mt-1">Upcoming, past, and cancelled appointments in one place.</p>
      </div>

      <Tabs<Tab>
        tabs={[
          { id: "upcoming", label: "Upcoming", count: counts.upcoming },
          { id: "past", label: "Past", count: counts.past },
          { id: "cancelled", label: "Cancelled", count: counts.cancelled },
        ]}
        active={tab}
        onChange={setTab}
      />

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-3">
          {visible.length === 0 ? (
            <div className="card-base">
              <EmptyState
                title={tab === "upcoming" ? "No upcoming appointments" : tab === "past" ? "No past visits yet" : "No cancelled appointments"}
                body={
                  tab === "upcoming"
                    ? "Book your first visit — it takes less than two minutes."
                    : tab === "past"
                      ? "Completed visits will appear here with summaries."
                      : "Cancelled appointments will be listed here for your records."
                }
              />
            </div>
          ) : (
            visible.map((a) => (
              <AppointmentCard
                key={a.id}
                appointment={a}
                compact={tab !== "upcoming"}
                onView={() => setDetailId(a.id)}
                onReschedule={() => setRescheduleId(a.id)}
                onCancel={() => setCancelId(a.id)}
                questionnaire={quStatus[a.id] ?? null}
                onQuestionnaire={() => setQuestionnaireFor(a.id)}
              />
            ))
          )}
        </motion.div>
      </AnimatePresence>

      <AppointmentDetailModal
        appointment={detail}
        open={!!detail}
        onClose={() => setDetailId(null)}
        onReschedule={(a) => { setDetailId(null); setRescheduleId(a.id); }}
        onCancel={(a) => { setDetailId(null); setCancelId(a.id); }}
        questionnaire={detail ? (quStatus[detail.id] ?? null) : null}
        onQuestionnaire={(a) => { setDetailId(null); setQuestionnaireFor(a.id); }}
      />

      <RescheduleModal
        appointment={rescheduleAppt}
        open={!!rescheduleAppt}
        onClose={() => setRescheduleId(null)}
      />

      <Modal open={!!cancelAppt} onClose={() => setCancelId(null)} title="Cancel appointment">
        {cancelAppt && (
          <div>
            <div className="bg-background border border-border rounded-control p-3.5 text-sm">
              <p className="font-bold text-ink">{cancelAppt.doctorName}</p>
              <p className="text-ink-secondary">{cancelAppt.specialty} · {cancelAppt.date} at {cancelAppt.time}</p>
              <p className="text-ink-secondary">{cancelAppt.hospitalName}</p>
            </div>
            <p className="font-bold text-ink mt-4">Are you sure you want to cancel this appointment?</p>
            <p className="text-sm text-ink-secondary mt-1">The time slot will be released. You can book again any time.</p>
            {cancelError && (
              <p role="alert" className="mt-3 text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">
                {cancelError}
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button variant="outline" onClick={() => setCancelId(null)} className="flex-1">Keep appointment</Button>
              <Button variant="danger" onClick={() => void confirmCancel()} disabled={cancelling} className="flex-1">
                {cancelling ? "Cancelling…" : "Cancel appointment"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!questionnaireFor} onClose={() => setQuestionnaireFor(null)} title={`Pre-visit form${questionnaireAppt ? ` · ${questionnaireAppt.doctorName}` : ""}`} wide>
        {quLoading ? (
          <p className="text-sm text-ink-secondary py-8 text-center">Loading your form…</p>
        ) : quError || !quForm ? (
          <div className="py-6 text-center">
            <p className="text-sm font-semibold text-ink">{quError ?? "No form available."}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setQuestionnaireFor(null)}>Close</Button>
          </div>
        ) : (
          <QuestionnaireFlow
            key={`${questionnaireFor ?? "none"}-${quForm.id}-${quCompleted ? "done" : "open"}`}
            questions={mapApiQuestions(quForm)}
            initialAnswers={quAnswers}
            initialIndex={quResumeIndex}
            alreadyCompleted={quCompleted}
            saving={quSaving}
            onSaveDraft={(answers) => {
              if (!questionnaireFor || !quForm) return;
              return persistAnswers(questionnaireFor, quForm, answers, { final: false }).then(() => undefined);
            }}
            onComplete={(answers) => {
              if (!questionnaireFor || !quForm) return;
              return persistAnswers(questionnaireFor, quForm, answers, { final: true }).then(() => undefined);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function RescheduleModal({
  appointment,
  open,
  onClose,
}: {
  appointment: Appointment | null;
  open: boolean;
  onClose: () => void;
}) {
  const { live, rescheduleLive, pushNotification } = useAppState();
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const days = sevenDaysFrom(anchorDate);
  const [step, setStep] = useState(0);
  const [dayKey, setDayKey] = useState(() => toLocalKey(new Date()));
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [rawById, setRawById] = useState<Record<string, Slot>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TimeSlot | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Bumped after a taken-slot conflict so the stale time disappears.
  const [refreshKey, setRefreshKey] = useState(0);

  // Reset the flow only when a different appointment is opened.
  useEffect(() => {
    if (open) {
      setStep(0);
      setSelected(null);
      setSaveError(null);
      setLoadError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointment?.id]);

  useEffect(() => {
    if (!open || !appointment) return;
    let cancelled = false;
    setSelected(null);
    setLoadError(null);
    setLoading(true);
    // Live: resolve the visit type, then ask for real open slots from the
    // doctor's original working hours (rules minus blocks minus bookings).
    fetchMyAppointment(appointment.id)
      .then((detail) =>
        apiCheckAvailability({
          doctor_id: detail.doctor_id,
          appointment_type_id: detail.appointment_type_id,
          date_from: dayKey,
          date_to: dayKey,
        }),
      )
      .then((found) => {
        if (cancelled) return;
        const byId: Record<string, Slot> = {};
        setSlots(
          found.map((s, i) => {
            const mapped = mapSlot(s, i);
            byId[mapped.id] = s;
            return mapped;
          }),
        );
        setRawById(byId);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dayKey, live, refreshKey]);

  if (!appointment) return null;
  const dayLabel = days.find((d) => d.key === dayKey) ?? { key: dayKey, label: formatDayKeyLong(dayKey), sub: "" };

  async function save() {
    if (!selected || !dayLabel || !appointment) return;
    setSaving(true);
    setSaveError(null);
    try {
      const raw = rawById[selected.id];
      if (!raw) throw new Error("slot-missing");
      await rescheduleLive(appointment.id, raw.start, raw.end);
      pushNotification({
        category: "appointments",
        title: "Appointment rescheduled",
        body: `${appointment.specialty} with ${appointment.doctorName} moved to ${formatSlotDate(raw.start)} at ${formatSlotTime(raw.start)}.`,
        unread: true,
      });
      onClose();
    } catch {
      // Taken slot: refresh the list so it disappears instead of staying
      // selectable from the stale response.
      setRefreshKey((k) => k + 1);
      setSelected(null);
      setSaveError("That time was just taken — the list has been refreshed. Pick another time.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Reschedule appointment" wide>
      <div className="flex gap-1.5 mb-4">
        {["Current", "New time"].map((l, i) => (
          <span key={l} className={`text-[0.75rem] font-bold border rounded-full px-2.5 py-1 ${step >= i ? "bg-navy text-white border-navy" : "bg-white text-ink-faint border-border"}`}>
            {i + 1} · {l}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div>
          <div className="bg-background border border-border rounded-control p-3.5 text-sm">
            <p className="font-bold">{appointment.doctorName} · {appointment.specialty}</p>
            <p className="text-ink-secondary">Currently: {appointment.date} at {appointment.time}</p>
          </div>
          <p className="text-[0.82rem] text-ink-secondary mt-3">Your current appointment will remain unchanged until the new slot is confirmed.</p>
          <Button onClick={() => setStep(1)} className="w-full mt-4">Choose a new time</Button>
        </div>
      )}

      {step === 1 && (
        <div>
          <div className="mb-3">
            <DayStripWithCalendar
              days={days}
              dayKey={dayKey}
              anchorDate={anchorDate}
              onSelect={setDayKey}
              onPickDate={(d) => { setAnchorDate(d); setDayKey(toLocalKey(d)); }}
            />
          </div>
          {loadError ? (
            <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{loadError}</p>
          ) : (
            <>
              <p className="text-[0.78rem] text-ink-secondary mb-2">Pick a time to select it — nothing changes until you confirm.</p>
              <SlotPicker slots={slots} selectedId={selected?.id ?? null} onSelect={setSelected} loading={loading} />
            </>
          )}
          {saveError && (
            <p role="alert" className="mt-3 text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{saveError}</p>
          )}
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={() => setStep(0)} className="flex-1">Back</Button>
            <Button disabled={!selected || saving} onClick={() => void save()} className="flex-1">
              {saving ? "Confirming…" : "Confirm change"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
