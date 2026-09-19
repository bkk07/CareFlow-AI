import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useSchedule } from "../context/ScheduleContext";
import { AppointmentCard } from "../components/appointments/AppointmentCard";
import { CardSkeleton, EmptyState, ErrorState } from "../components/common/ui";

export default function TodayPage() {
  const { appointments, blocks, loading, error, refresh } = useSchedule();
  const today = useMemo(() => appointments.filter((a) => a.dayGroup === "today").sort((x, y) => x.sortKey.localeCompare(y.sortKey)), [appointments]);
  const todayBlocks = useMemo(() => {
    // Live blocks carry formatted dates like "Fri, Sep 26" — match today's label.
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
  }, [blocks]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Today&apos;s schedule</h1>
        <p className="page-sub mt-1">{today.length} appointments · {todayBlocks.length} blocked periods. Times in local time.</p>
      </div>

      <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
        {loading ? "Syncing live schedule…" : "Live schedule from your hospital"}
      </p>

      {error && <ErrorState title="Could not load today's schedule" body={error} onRetry={() => void refresh()} />}

      {loading && today.length === 0 && !error ? (
        <div className="space-y-2.5">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
      ) : today.length === 0 ? (
        <div className="card-base"><EmptyState title="No appointments today" body="Your upcoming schedule is clear. Blocked time and new bookings will appear here." /></div>
      ) : (
        <ol className="space-y-2.5" aria-label="Today appointments timeline">
          {today.map((a) => (
            <li key={a.id} className="flex gap-3">
              <span className="hidden sm:block w-16 pt-4 text-[0.75rem] font-bold text-ink-faint tabular-nums shrink-0">{a.time.replace(" ", "\n")}</span>
              <div className="flex-1 min-w-0"><AppointmentCard appointment={a} /></div>
            </li>
          ))}
        </ol>
      )}

      {todayBlocks.length > 0 && (
        <section className="card-base p-4" aria-label="Blocked time today">
          <h2 className="section-title">Blocked periods</h2>
          <ul className="mt-2 space-y-1.5">
            {todayBlocks.map((b) => (
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
