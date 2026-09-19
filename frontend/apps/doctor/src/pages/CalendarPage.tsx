import { useState } from "react";
import { Link } from "react-router-dom";
import { useSchedule } from "../context/ScheduleContext";
import { DayView, MonthView, WeekView } from "../components/calendar/CalendarViews";
import { Tabs } from "../components/common/Modal";
import { EmptyState, ErrorState } from "../components/common/ui";

type View = "day" | "week" | "month";

export default function CalendarPage() {
  const [view, setView] = useState<View>("day");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const { appointments, blocks, loading, error, refresh } = useSchedule();

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
          <h1 className="page-title">Calendar</h1>
          <p className="page-sub mt-1">Working hours, appointments, and blocked periods.</p>
        </div>
        <Link to="/availability" className="text-[0.83rem] font-bold text-healthcare hover:underline">Edit availability</Link>
      </div>

      <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
        {loading ? "Syncing calendar…" : "Live calendar from your hospital"}
      </p>

      {error && <ErrorState title="Could not load calendar" body={error} onRetry={() => void refresh()} />}

      <div className="card-base px-2">
        <Tabs<View> tabs={[{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }]} active={view} onChange={setView} />
      </div>

      {appointments.length === 0 && blocks.length === 0 && !loading && !error ? (
        <div className="card-base"><EmptyState title="No calendar entries" body="Appointments and blocked time will appear here once your hospital schedule syncs." /></div>
      ) : (
        <>
          {view === "day" && (
            <DayView
              appointments={appointments}
              blocks={blocks}
              selected={selectedDate}
              onPrevDay={() => shiftDay(-1)}
              onNextDay={() => shiftDay(1)}
              onToday={() => setSelectedDate(new Date())}
            />
          )}
          {view === "week" && <WeekView appointments={appointments} blocks={blocks} />}
          {view === "month" && (
            <MonthView
              appointments={appointments}
              onPickDay={(d) => {
                setSelectedDate(d);
                setView("day");
              }}
            />
          )}
        </>
      )}

      <div className="flex flex-wrap gap-3 text-[0.76rem] font-semibold text-ink-secondary">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-healthcare-soft border border-healthcare" /> Confirmed</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-warning-soft border border-warning" /> Pending</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success-soft border border-success" /> Completed</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-100 border border-dashed border-border" /> Blocked</span>
      </div>
    </div>
  );
}
