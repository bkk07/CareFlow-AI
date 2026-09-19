import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import {
  apiError as apiErrorText,
  checkAvailability as apiCheckAvailability,
  fetchAppointmentQuestionnaire,
  fetchMyAppointment,
  submitQuestionnaireAnswers,
  type Questionnaire as ApiQuestionnaire,
  type Slot,
} from "../api";
import { formatSlotDate, formatSlotTime, mapSlot, coerceQuestionnaireAnswers } from "../lib/backend";
import { nextSevenDays } from "../lib/helpers";
import { useAppState } from "../context/AppStateContext";
import { AppointmentCard } from "../components/appointment/AppointmentCard";
import { AppointmentDetailModal } from "../components/appointment/AppointmentDetailModal";
import { SlotPicker } from "../components/appointment/SlotPicker";
import { QuestionnaireFlow } from "../components/questionnaire/QuestionnaireFlow";
import { Button, EmptyState } from "../components/common/ui";
import { Modal, Tabs } from "../components/common/Modal";
import type { Appointment, QuestionnaireQuestion, TimeSlot } from "../types";

type Tab = "upcoming" | "past" | "cancelled";

const UPCOMING = ["confirmed", "pending", "rescheduled", "sync_pending"];

function mapApiQuestions(q: ApiQuestionnaire): QuestionnaireQuestion[] {
  return q.questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      id: item.id,
      order: item.order,
      type: (item.type === "choice" ? "single_choice" : item.type) as QuestionnaireQuestion["type"],
      prompt: item.prompt,
      options: item.options ?? undefined,
      required: item.required,
    }));
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
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Deep-link intents from Home/cards
  useEffect(() => {
    const s = location.state as { rescheduleId?: string; cancelId?: string } | null;
    if (s?.rescheduleId) setRescheduleId(s.rescheduleId);
    if (s?.cancelId) setCancelId(s.cancelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live: load the real pre-visit form when the modal opens.
  useEffect(() => {
    if (!live || !questionnaireFor) return;
    setQuForm(null);
    setQuError(null);
    setQuLoading(true);
    fetchAppointmentQuestionnaire(questionnaireFor)
      .then((form) => {
        if (!form) setQuError("No questionnaire is assigned to this visit yet.");
        else setQuForm(form);
      })
      .catch(() => setQuError("Could not load the questionnaire. Try again."))
      .finally(() => setQuLoading(false));
  }, [live, questionnaireFor]);

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
  const upcomingForForms = useMemo(() => appointments.filter((a) => UPCOMING.includes(a.status)), [appointments]);

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
              />
            ))
          )}
        </motion.div>
      </AnimatePresence>

      {/* Questionnaires */}
      <section className="card-base p-5">
        <h2 className="section-title">Questionnaires</h2>
        <p className="text-[0.83rem] text-ink-secondary mt-1">Administrative pre-visit forms — never a diagnosis.</p>
        {upcomingForForms.length === 0 ? (
          <p className="text-[0.83rem] text-ink-secondary mt-3">Book a visit first — its pre-visit form will appear here.</p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {upcomingForForms.map((a) => (
              <div key={a.id} className="border border-border rounded-control p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[0.9rem] text-ink">Pre-visit form</p>
                  <p className="text-[0.78rem] text-ink-secondary">{a.doctorName} · {a.date} at {a.time}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setQuestionnaireFor(a.id)}>
                  Start
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <AppointmentDetailModal
        appointment={detail}
        open={!!detail}
        onClose={() => setDetailId(null)}
        onReschedule={(a) => { setDetailId(null); setRescheduleId(a.id); }}
        onCancel={(a) => { setDetailId(null); setCancelId(a.id); }}
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
            questions={mapApiQuestions(quForm)}
            onComplete={(answers) => {
              if (!questionnaireFor) return;
              void submitQuestionnaireAnswers(questionnaireFor, coerceQuestionnaireAnswers(quForm, answers))
                .then(() => {
                  pushNotification({
                    category: "questionnaires",
                    title: "Questionnaire submitted",
                    body: `${quForm.name} was sent to the care team.`,
                    unread: true,
                  });
                })
                .catch(() => undefined);
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
  const days = nextSevenDays();
  const [step, setStep] = useState(0);
  const [dayKey, setDayKey] = useState(days[0].key);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [rawById, setRawById] = useState<Record<string, Slot>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TimeSlot | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
  }, [open, dayKey, live]);

  if (!appointment) return null;
  const dayLabel = days.find((d) => d.key === dayKey);

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
      setSaveError("Could not move this visit — the slot may be taken. Pick another time.");
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
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 mb-3">
            {days.map((d) => (
              <button
                key={d.key}
                onClick={() => setDayKey(d.key)}
                className={`min-w-[80px] px-3 py-2 rounded-control border text-center shrink-0 ${dayKey === d.key ? "bg-healthcare text-white border-healthcare-dark" : "bg-white border-border"}`}
              >
                <span className="block text-[0.76rem] font-bold">{d.label}</span>
                <span className="block text-[0.72rem] opacity-80">{d.sub}</span>
              </button>
            ))}
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
