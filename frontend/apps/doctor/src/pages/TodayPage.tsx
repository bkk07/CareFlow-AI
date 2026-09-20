import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSchedule } from "../context/ScheduleContext";
import { AppointmentCard } from "../components/appointments/AppointmentCard";
import CalendarPickButton from "../components/calendar/CalendarPickButton";
import { CardSkeleton, EmptyState, ErrorState } from "../components/common/ui";

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function headerLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export default function TodayPage() {
  const { appointments, blocks, loading, error, refresh } = useSchedule();
  // Selectable day: calendar-icon picker jumps to any day in any month and
  // shows that day's schedule (defaults to today).
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const isToday = sameDay(selectedDate, new Date());

  const dayAppointments = useMemo(() => {
    const list = appointments.filter((a) => {
      const d = new Date(a.sortKey);
      return !Number.isNaN(d.getTime()) && sameDay(d, selectedDate);
    });
    // Fall back to the pre-grouped "today" bucket only when viewing today,
    // so same-day timezone edge cases still render.
    if (list.length === 0 && isToday) {
      return appointments
        .filter((a) => a.dayGroup === "today")
        .sort((x, y) => x.sortKey.localeCompare(y.sortKey));
    }
    return list.sort((x, y) => x.sortKey.localeCompare(y.sortKey));
  }, [appointments, selectedDate, isToday]);

  const dayBlocks = useMemo(() => {
    const out = blocks.filter((b) => {
      const s = new Date(b.startIso);
      if (Number.isNaN(s.getTime())) return false;
      return sameDay(s, selectedDate);
    });
    if (out.length === 0 && isToday) {
      const label = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const todayShort = new Date().toDateString();
      return blocks.filter((b) => {
        if (b.date === "Today") return true;
        try {
          return new Date(`${b.date} ${new Date().getFullYear()}`).toDateString() === todayShort;
        } catch {
          return b.date === label;
        }
      });
    }
    return out;
  }, [blocks, selectedDate, isToday]);

  function shiftDay(n: number) {
    setSelectedDate((d) => {
      const c = new Date(d);
      c.setDate(c.getDate() + n);
      return c;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">{isToday ? "Today's schedule" : headerLabel(selectedDate)}</h1>
          <p className="page-sub mt-1">{dayAppointments.length} appointments · {dayBlocks.length} blocked periods. Times in local time.</p>
        </div>
        <CalendarPickButton selected={selectedDate} onPick={setSelectedDate} />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => shiftDay(-1)} aria-label="Previous day" className="w-8 h-8 rounded-lg border border-border bg-white hover:border-healthcare flex items-center justify-center font-bold text-ink-secondary">‹</button>
        <button onClick={() => shiftDay(1)} aria-label="Next day" className="w-8 h-8 rounded-lg border border-border bg-white hover:border-healthcare flex items-center justify-center font-bold text-ink-secondary">›</button>
        <p className="font-bold text-navy text-sm ml-1">{headerLabel(selectedDate)}</p>
        {!isToday && (
          <button onClick={() => setSelectedDate(new Date())} className="text-[0.78rem] font-bold text-healthcare hover:underline ml-1">Back to today</button>
        )}
      </div>

      <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
        {loading ? "Syncing live schedule…" : "Live schedule from your hospital"}
      </p>

      {error && <ErrorState title="Could not load today's schedule" body={error} onRetry={() => void refresh()} />}

      {loading && dayAppointments.length === 0 && !error ? (
        <div className="space-y-2.5">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
      ) : dayAppointments.length === 0 ? (
        <div className="card-base"><EmptyState title={isToday ? "No appointments today" : `No appointments on ${headerLabel(selectedDate)}`} body="Blocked time and new bookings will appear here." /></div>
      ) : (
        <ol className="space-y-2.5" aria-label="Day appointments timeline">
          {dayAppointments.map((a) => (
            <li key={a.id} className="flex gap-3">
              <span className="hidden sm:block w-16 pt-4 text-[0.75rem] font-bold text-ink-faint tabular-nums shrink-0">{a.time.replace(" ", "\n")}</span>
              <div className="flex-1 min-w-0"><AppointmentCard appointment={a} /></div>
            </li>
          ))}
        </ol>
      )}

      {dayBlocks.length > 0 && (
        <section className="card-base p-4" aria-label="Blocked time">
          <h2 className="section-title">Blocked periods</h2>
          <ul className="mt-2 space-y-1.5">
            {dayBlocks.map((b) => (
              <li key={b.id} className="text-sm flex items-center justify-between gap-2 bg-background border border-dashed border-border rounded-control px-3 py-2">
                <span className="font-semibold text-ink">{b.start} – {b.end} · {b.reason}</span>
                <Link to="/availability" className="text-[0.8rem] font-bold text-healthcare hover:underline shrink-0">Manage</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
