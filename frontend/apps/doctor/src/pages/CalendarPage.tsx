import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSchedule } from "../context/ScheduleContext";
import { DayView } from "../components/calendar/CalendarViews";
import DayStripWithCalendar from "../components/calendar/DayStripWithCalendar";
import AddEventModal from "../components/calendar/AddEventModal";
import { EmptyState, ErrorState } from "../components/common/ui";
import { parseDayKey, sevenDaysFrom, toLocalKey } from "../lib/helpers";

function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hhmm(totalMinutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(totalMinutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Single-day calendar, same as the patient side: a 7-day strip starting from
 * the picked day + a calendar opened by default pointing at today. Pick any
 * day in any month to fetch and show that day's schedule. No week/day/month
 * switcher.
 */
export default function CalendarPage() {
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [dayKey, setDayKey] = useState(() => toLocalKey(new Date()));
  const [eventModal, setEventModal] = useState({ open: false, date: "", start: "12:00", end: "13:00" });
  const { appointments, blocks, rules, loading, error, refresh } = useSchedule();

  const days = useMemo(() => sevenDaysFrom(anchorDate), [anchorDate]);
  const selectedDate = useMemo(() => {
    const d = parseDayKey(dayKey);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [dayKey]);
  const isToday = toLocalKey(selectedDate) === toLocalKey(new Date());

  /** Pick any calendar day: strip starts from that day, schedule shows it. */
  function pickDate(d: Date) {
    setAnchorDate(d);
    setDayKey(toLocalKey(d));
  }

  function shiftDay(n: number) {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + n);
    // Keep the strip anchored on the shown day when stepping outside it.
    if (!days.some((x) => x.key === toLocalKey(next))) setAnchorDate(next);
    setDayKey(toLocalKey(next));
  }

  function goToday() {
    const t = new Date();
    setAnchorDate(t);
    setDayKey(toLocalKey(t));
  }

  function openAddEvent(date: string, start: string, end: string) {
    setEventModal({ open: true, date, start, end });
  }

  function openDaySlot(day: Date, startMinutes: number, durationMinutes: number) {
    openAddEvent(toInputDate(day), hhmm(startMinutes), hhmm(startMinutes + durationMinutes));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-sub mt-1">Pick a day to see that day's working hours, appointments, and blocked periods.</p>
        </div>
        <Link to="/availability" className="text-[0.83rem] font-bold text-healthcare hover:underline">Edit availability</Link>
      </div>

      <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
        {loading ? "Syncing calendar…" : "Live calendar from your hospital"}
      </p>

      {error && <ErrorState title="Could not load calendar" body={error} onRetry={() => void refresh()} />}

      <div className="card-base p-5 sm:p-6">
        <h3 className="font-bold text-ink mb-2 text-[0.95rem]">Choose a day</h3>
        <DayStripWithCalendar
          days={days}
          dayKey={dayKey}
          anchorDate={anchorDate}
          onSelect={setDayKey}
          onPickDate={pickDate}
          defaultOpen
        />
        {!isToday && (
          <button onClick={goToday} className="text-[0.78rem] font-bold text-healthcare hover:underline mt-1.5">
            Back to today
          </button>
        )}

        <h3 className="font-bold text-ink mt-5 mb-2 text-[0.95rem]">Day schedule</h3>
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-ink-secondary">Syncing schedule…</p>
        ) : appointments.length === 0 && blocks.length === 0 && rules.every((r) => !r.enabled) ? (
          <EmptyState title="No calendar entries" body="Appointments and blocked time will appear here once your hospital schedule syncs." />
        ) : (
          <DayView
            appointments={appointments}
            blocks={blocks}
            rules={rules}
            selected={selectedDate}
            onPrevDay={() => shiftDay(-1)}
            onNextDay={() => shiftDay(1)}
            onToday={goToday}
            onOpenSlot={openDaySlot}
            onPickDate={pickDate}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-[0.76rem] font-semibold text-ink-secondary">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-healthcare-soft border border-healthcare" /> Confirmed</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-warning-soft border border-warning" /> Pending</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success-soft border border-success" /> Completed</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-100 border border-dashed border-border" /> Blocked</span>
      </div>

      <AddEventModal
        open={eventModal.open}
        initialDate={eventModal.date}
        initialStart={eventModal.start}
        initialEnd={eventModal.end}
        onClose={() => setEventModal((m) => ({ ...m, open: false }))}
      />
    </div>
  );
}
