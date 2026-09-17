import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { Appointment, BlockedSlot } from "../../types";
import { StatusBadge } from "../common/ui";

const HOURS = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "01:00", "01:30", "02:00", "02:30", "03:00", "03:30", "04:00", "04:30", "05:00"];

function to24(t: string): number {
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return 9;
  let h = parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h + parseInt(m[2], 10) / 60;
}

export function DayView({ appointments, blocks, dateLabel }: { appointments: Appointment[]; blocks: BlockedSlot[]; dateLabel: string }) {
  const dayBlocks = blocks.filter((b) => b.date === dateLabel || (dateLabel === "Today" && b.date === "Today"));
  return (
    <div className="card-base overflow-hidden" role="grid" aria-label={`Day view ${dateLabel}`}>
      <div className="px-4 py-3 border-b border-border font-bold text-navy text-sm">{dateLabel} · {appointments.length} appointments</div>
      <div className="max-h-[560px] overflow-y-auto">
        {HOURS.map((h) => {
          const appts = appointments.filter((a) => a.time.startsWith(h));
          const blk = dayBlocks.filter((b) => b.start.startsWith(h));
          return (
            <div key={h} className="grid grid-cols-[64px_1fr] border-b border-border/60 last:border-0 min-h-[52px]">
              <div className="px-3 py-2 text-[0.72rem] font-bold text-ink-faint tabular-nums">{h}</div>
              <div className="px-2 py-1.5 space-y-1.5">
                {appts.map((a) => (
                  <Link
                    key={a.id}
                    to={`/appointments/${a.id}`}
                    className={`block rounded-lg border-l-[3px] px-2.5 py-1.5 text-[0.78rem] transition hover:shadow-subtle ${
                      a.status === "completed" ? "bg-success-soft/60 border-success" : a.status === "pending" ? "bg-warning-soft border-warning" : a.status === "cancelled" ? "bg-background border-border opacity-70" : "bg-healthcare-soft border-healthcare"
                    }`}
                  >
                    <span className="font-bold text-ink">{a.time} · {a.patient.name}</span>
                    <span className="block text-ink-secondary">{a.type} · {a.durationMinutes} min</span>
                  </Link>
                ))}
                {blk.map((b) => (
                  <div key={b.id} className="rounded-lg px-2.5 py-1.5 text-[0.78rem] bg-slate-100 border border-dashed border-border text-ink-secondary">
                    <span className="font-bold">{b.start}–{b.end} · Blocked: {b.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WeekView({ appointments, blocks }: { appointments: Appointment[]; blocks: BlockedSlot[] }) {
  const days = ["Mon 21", "Tue 22", "Wed 23", "Today", "Fri 25"];
  return (
    <div className="card-base overflow-hidden">
      <div className="overflow-x-auto">
        <div className="grid min-w-[720px]" style={{ gridTemplateColumns: "64px repeat(5, 1fr)" }}>
          <div />
          {days.map((d) => (
            <div key={d} className={`px-2 py-2.5 text-center text-[0.78rem] font-bold border-b border-border ${d === "Today" ? "text-healthcare bg-healthcare-faint" : "text-ink-secondary"}`}>{d}</div>
          ))}
          {HOURS.slice(2, 14).map((h) => (
            <div key={h} className="contents">
              <div className="px-2 py-2 text-[0.7rem] font-bold text-ink-faint border-b border-border/50">{h}</div>
              {days.map((d) => {
                const inDay = d === "Today" ? appointments.filter((a) => a.dayGroup === "today" && a.time.startsWith(h)) : [];
                const blk = d === "Today" ? blocks.filter((b) => b.date === "Today" && b.start.startsWith(h)) : [];
                return (
                  <div key={d} className={`px-1 py-1 border-b border-l border-border/50 min-h-[44px] ${d === "Today" ? "bg-healthcare-faint/40" : ""}`}>
                    {inDay.map((a) => (
                      <Link key={a.id} to={`/appointments/${a.id}`} className="block text-[0.7rem] font-bold bg-white border border-healthcare/30 border-l-[3px] border-l-healthcare rounded px-1.5 py-1 mb-1 truncate">
                        {a.patient.name}
                      </Link>
                    ))}
                    {blk.map((b) => (
                      <div key={b.id} className="text-[0.7rem] bg-slate-100 border border-dashed border-border rounded px-1.5 py-1 text-ink-secondary truncate">{b.reason}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MonthView({ appointments }: { appointments: Appointment[] }) {
  const weeks: { label: string; count: number; today?: boolean }[] = [
    { label: "Mon 21", count: 0 },
    { label: "Tue 22", count: 0 },
    { label: "Wed 23", count: 0 },
    { label: "Today", count: appointments.filter((a) => a.dayGroup === "today").length, today: true },
    { label: "Fri 25", count: appointments.filter((a) => a.dayGroup === "week").length },
    { label: "Mon 28", count: appointments.filter((a) => a.dayGroup === "later").length },
  ];
  void to24;
  return (
    <div className="card-base p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {weeks.map((w) => (
          <motion.div key={w.label} whileHover={{ y: -2 }} className={`border rounded-control p-3 ${w.today ? "border-healthcare bg-healthcare-faint" : "border-border"}`}>
            <p className={`text-[0.8rem] font-bold ${w.today ? "text-healthcare" : "text-ink"}`}>{w.label}</p>
            <p className="text-[0.78rem] text-ink-secondary mt-0.5">{w.count === 0 ? "No clinic" : `${w.count} appointments`}</p>
            {w.count > 0 && <StatusBadge status="confirmed" />}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
