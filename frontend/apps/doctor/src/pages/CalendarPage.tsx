import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSchedule } from "../context/ScheduleContext";
import { DayView, MonthView, WeekView } from "../components/calendar/CalendarViews";
import DayStripWithCalendar from "../components/calendar/DayStripWithCalendar";
import AddEventModal from "../components/calendar/AddEventModal";
import { EmptyState, ErrorState, LiveBadge, PageHeader } from "../components/common/ui";
import { parseDayKey, sevenDaysFrom, toLocalKey } from "../lib/helpers";

function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hhmm(totalMinutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(totalMinutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

type ViewMode = "day" | "week" | "month";

/**
 * Professional scheduling workspace: Day timeline, Week overview, Month
 * overview. All views render the same live appointments, blocked time, and
 * working hours — no invented entries.
 */
export default function CalendarPage() {
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [dayKey, setDayKey] = useState(() => toLocalKey(new Date()));
  const [view, setView] = useState<ViewMode>("day");
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

  const emptyCalendar = appointments.length === 0 && blocks.length === 0 && rules.every((r) => !r.enabled);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendar"
        sub="Appointments, blocked time, and working hours in one place."
        action={<Link to="/availability" className="text-[0.83rem] font-bold text-healthcare hover:underline">Edit availability</Link>}
      />

      <LiveBadge loading={loading} />
      {error && <ErrorState title="We couldn't load your calendar." body={error} onRetry={() => void refresh()} />}

      {/* View switcher */}
      <div className="card-base p-2 flex gap-1 w-fit" role="tablist" aria-label="Calendar view">
        {(["day", "week", "month"] as ViewMode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={view === m}
            onClick={() => setView(m)}
            className={`px-4 py-2 rounded-lg text-[0.85rem] font-bold transition ${view === m ? "bg-navy text-white" : "text-ink-secondary hover:text-ink hover:bg-background"}`}
          >
            {m === "day" ? "Day" : m === "week" ? "Week" : "Month"}
          </button>
        ))}
      </div>

      {view === "day" && (
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
          ) : emptyCalendar ? (
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
      )}

      {view === "week" && (
        <div className="space-y-3">
          {loading ? (
            <p className="card-base px-4 py-8 text-center text-sm text-ink-secondary">Syncing schedule…</p>
          ) : emptyCalendar ? (
            <div className="card-base"><EmptyState title="No calendar entries" body="Appointments and blocked time will appear here once your hospital schedule syncs." /></div>
          ) : (
            <WeekView appointments={appointments} blocks={blocks} />
          )}
          <button onClick={goToday} className="text-[0.8rem] font-bold text-healthcare hover:underline">Back to today</button>
        </div>
      )}

      {view === "month" && (
        <div className="space-y-3">
          {loading ? (
            <p className="card-base px-4 py-8 text-center text-sm text-ink-secondary">Syncing schedule…</p>
          ) : (
            <MonthView
              appointments={appointments}
              onPickDay={(d) => { pickDate(d); setView("day"); }}
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-[0.76rem] font-semibold text-ink-secondary" aria-label="Calendar legend">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-healthcare-soft border border-healthcare" aria-hidden /> Confirmed</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-warning-soft border border-warning" aria-hidden /> Pending</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success-soft border border-success" aria-hidden /> Completed</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-100 border border-dashed border-border" aria-hidden /> Blocked</span>
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
