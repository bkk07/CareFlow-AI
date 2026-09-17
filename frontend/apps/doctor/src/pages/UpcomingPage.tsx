import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { useSchedule } from "../context/ScheduleContext";
import { AppointmentCard } from "../components/appointments/AppointmentCard";
import { Drawer } from "../components/common/Modal";
import { Button, EmptyState } from "../components/common/ui";
import type { Appointment } from "../types";

const GROUPS: { id: Appointment["dayGroup"]; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This week" },
  { id: "later", label: "Later" },
];

export default function UpcomingPage() {
  const { appointments, live, loading } = useSchedule();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [qstate, setQstate] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    return appointments.filter((a) => {
      if (q && !a.patient.name.toLowerCase().includes(q) && !a.type.toLowerCase().includes(q)) return false;
      if (status !== "all" && a.status !== status) return false;
      if (qstate !== "all" && a.questionnaire !== qstate) return false;
      return true;
    });
  }, [appointments, query, status, qstate]);

  const searching = query.trim() !== "" || status !== "all" || qstate !== "all";

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
        <Button variant="outline" className="w-full" onClick={() => { setStatus("all"); setQstate("all"); setQuery(""); }}>Clear all</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Upcoming appointments</h1>
        <p className="page-sub mt-1">Grouped by day. Search by patient name or appointment type.</p>
      </div>

      {live && loading && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">Syncing live schedule…</p>
      )}

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

      {searching ? (
        visible.length === 0 ? (
          <div className="card-base"><EmptyState title="No matching appointments" body="Try a different patient name, type, or clear the filters." /></div>
        ) : (
          <div className="space-y-2.5">{visible.map((a) => <AppointmentCard key={a.id} appointment={a} showDate />)}</div>
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
      {visible.length === 0 && !searching && (
        <div className="card-base"><EmptyState title="No upcoming appointments" body="Your upcoming schedule is clear." /></div>
      )}

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">{filterBody()}</Drawer>
    </div>
  );
}
