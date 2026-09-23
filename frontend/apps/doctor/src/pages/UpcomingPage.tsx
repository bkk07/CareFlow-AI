import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { useSchedule } from "../context/ScheduleContext";
import { AppointmentCard } from "../components/appointments/AppointmentCard";
import CalendarPickButton from "../components/calendar/CalendarPickButton";
import { Drawer } from "../components/common/Modal";
import { Button, CardSkeleton, EmptyState, ErrorState, LiveBadge, PageHeader } from "../components/common/ui";
import type { Appointment } from "../types";

const GROUPS: { id: Appointment["dayGroup"]; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This week" },
  { id: "later", label: "Later" },
];

export default function UpcomingPage() {
  const { appointments, loading, error, refresh } = useSchedule();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [qstate, setQstate] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Calendar-icon date jump: pick any day in any month to show just that day.
  const [pickedDate, setPickedDate] = useState<Date | null>(null);

  const pickedLabel = pickedDate
    ? pickedDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    : null;

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    return appointments.filter((a) => {
      if (q && !a.patient.name.toLowerCase().includes(q) && !a.type.toLowerCase().includes(q)) return false;
      if (status !== "all" && a.status !== status) return false;
      if (qstate !== "all" && a.questionnaire !== qstate) return false;
      if (pickedDate) {
        const d = new Date(a.sortKey);
        if (Number.isNaN(d.getTime())) return false;
        if (
          d.getFullYear() !== pickedDate.getFullYear() ||
          d.getMonth() !== pickedDate.getMonth() ||
          d.getDate() !== pickedDate.getDate()
        ) return false;
      }
      return true;
    });
  }, [appointments, query, status, qstate, pickedDate]);

  const searching = query.trim() !== "" || status !== "all" || qstate !== "all" || pickedDate !== null;

  function filterBody() {
    return (
      <div className="space-y-3">
        <label className="block text-[0.83rem] font-bold">Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-base mt-1">
            <option value="all">All statuses</option>
            {["confirmed", "pending", "rescheduled", "completed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block text-[0.83rem] font-bold">Questionnaire
          <select value={qstate} onChange={(e) => setQstate(e.target.value)} className="input-base mt-1">
            <option value="all">Any questionnaire state</option>
            {["completed", "in_progress", "assigned", "not_assigned"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </label>
        <Button variant="outline" className="w-full" onClick={() => { setStatus("all"); setQstate("all"); setQuery(""); setPickedDate(null); }}>Clear all</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Upcoming appointments"
        sub="Grouped by day. Search by patient name or appointment type."
        action={<CalendarPickButton selected={pickedDate ?? new Date()} onPick={setPickedDate} />}
      />

      {pickedDate && (
        <div className="flex items-center gap-2 flex-wrap text-[0.83rem]">
          <span className="font-bold text-navy bg-navy-soft/60 border border-navy/20 rounded-control px-3 py-1.5">
            Showing {pickedLabel} · {visible.length} appointment{visible.length === 1 ? "" : "s"}
          </span>
          <button onClick={() => setPickedDate(null)} className="font-bold text-healthcare hover:underline">Clear date</button>
        </div>
      )}

      <LiveBadge loading={loading} />

      {error && <ErrorState title="We couldn't load upcoming appointments." body={error} onRetry={() => void refresh()} />}

      <div className="card-base p-3.5 flex flex-col sm:flex-row gap-2">
        <div className="flex items-center gap-2 flex-1 bg-background border border-border rounded-control px-3">
          <Search size={16} className="text-ink-faint shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient or type…" aria-label="Search appointments" className="w-full bg-transparent outline-none py-2.5 text-[0.9rem]" />
        </div>
        <div className="hidden sm:flex gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="input-base !w-auto">
            <option value="all">All statuses</option>
            {["confirmed", "pending", "rescheduled", "completed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={qstate} onChange={(e) => setQstate(e.target.value)} aria-label="Filter by questionnaire" className="input-base !w-auto">
            <option value="all">Any form state</option>
            {["completed", "in_progress", "assigned", "not_assigned"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </div>
        <button onClick={() => setFiltersOpen(true)} className="sm:hidden inline-flex items-center justify-center gap-1.5 border border-border rounded-control py-2.5 font-bold text-sm">
          <SlidersHorizontal size={15} /> Filters
        </button>
      </div>

      {loading && visible.length === 0 && !error ? (
        <div className="space-y-2.5">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </div>
      ) : searching ? (
        visible.length === 0 ? (
          <div className="card-base"><EmptyState title={pickedDate ? `No appointments on ${pickedLabel}` : "No matching appointments"} body="Try a different patient name, type, date, or clear the filters." /></div>
        ) : (
          <>
            {pickedDate && (
              <h2 className="section-title">{pickedLabel} <span className="text-ink-faint font-semibold text-[0.8rem]">· {visible.length}</span></h2>
            )}
            <div className="space-y-2.5">{visible.map((a) => <AppointmentCard key={a.id} appointment={a} showDate />)}</div>
          </>
        )
      ) : (
        GROUPS.map((g) => {
          const items = visible.filter((a) => a.dayGroup === g.id);
          if (items.length === 0) return null;
          return (
            <section key={g.id} aria-label={g.label}>
              <h2 className="section-title mb-2">{g.label} <span className="text-ink-faint font-semibold text-[0.8rem]">· {items.length}</span></h2>
              <div className="space-y-2.5">{items.map((a) => <AppointmentCard key={a.id} appointment={a} showDate={g.id !== "today"} />)}</div>
            </section>
          );
        })
      )}
      {visible.length === 0 && !searching && !loading && !error && (
        <div className="card-base"><EmptyState title="Your upcoming schedule is clear." body="New bookings will appear here." action={<Link to="/calendar" className="inline-flex items-center justify-center text-[0.83rem] font-bold bg-white border border-border rounded-control px-4 py-2.5 hover:border-healthcare hover:text-healthcare transition">View calendar</Link>} /></div>
      )}

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">{filterBody()}</Drawer>
    </div>
  );
}
