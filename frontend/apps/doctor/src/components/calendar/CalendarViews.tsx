import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { Appointment, BlockedSlot } from "../../types";
import { formatDateLabel } from "../../lib/backend";

// --- shared date helpers (local calendar days) -------------------------------

function apptDate(a: Appointment): Date | null {
  const d = new Date(a.sortKey);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function startOfWeekMonday(d: Date): Date {
  const c = new Date(d);
  const dow = (c.getDay() + 6) % 7; // Mon=0..Sun=6
  c.setDate(c.getDate() - dow);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** "Tue, Sep 22" for headers (local). */
function headerLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function hourLabel(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}

/** Blocks carry display strings; match by the same formatted day label. */
function blockDayLabel(d: Date): string {
  const noon = new Date(d);
  noon.setHours(12, 0, 0, 0);
  return formatDateLabel(noon.toISOString());
}

function statusTone(status: Appointment["status"]): string {
  if (status === "completed") return "bg-success-soft/70 border-success";
  if (status === "cancelled" || status === "no_show")
    return "bg-background border-border opacity-70";
  if (status === "pending" || status === "sync_pending" || status === "requested")
    return "bg-warning-soft/70 border-warning";
  return "bg-healthcare-soft/70 border-healthcare";
}

function dotTone(status: Appointment["status"]): string {
  if (status === "completed") return "bg-success";
  if (status === "cancelled" || status === "no_show") return "bg-border";
  if (status === "pending" || status === "sync_pending" || status === "requested")
    return "bg-warning";
  return "bg-healthcare";
}

// --- day view -----------------------------------------------------------------

const DAY_START_HOUR = 6; // 6 AM
const DAY_END_HOUR = 22; // 10 PM

export function DayView({
  appointments,
  blocks,
  selected,
  onPrevDay,
  onNextDay,
  onToday,
}: {
  appointments: Appointment[];
  blocks: BlockedSlot[];
  selected: Date;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}) {
  const isToday = sameDay(selected, new Date());
  const dayAppts = appointments
    .map((a) => ({ a, d: apptDate(a) }))
    .filter(
      (x): x is { a: Appointment; d: Date } =>
        x.d !== null && sameDay(x.d, selected),
    )
    .sort((x, y) => x.d.getTime() - y.d.getTime());
  const label = blockDayLabel(selected);
  const dayBlocks = blocks.filter((b) => b.date === label);
  const hours: number[] = [];
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) hours.push(h);

  return (
    <div className="card-base overflow-hidden" role="grid" aria-label={`Day view ${headerLabel(selected)}`}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onPrevDay}
            aria-label="Previous day"
            className="w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center font-bold text-ink-secondary"
          >
            ‹
          </button>
          <button
            onClick={onNextDay}
            aria-label="Next day"
            className="w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center font-bold text-ink-secondary"
          >
            ›
          </button>
          <p className="font-bold text-navy text-sm ml-1">
            {headerLabel(selected)} · {dayAppts.length}{" "}
            {dayAppts.length === 1 ? "appointment" : "appointments"}
          </p>
        </div>
        {!isToday && (
          <button
            onClick={onToday}
            className="text-[0.78rem] font-bold text-healthcare hover:underline"
          >
            Back to today
          </button>
        )}
      </div>
      <div className="max-h-[560px] overflow-y-auto">
        {dayAppts.length === 0 && dayBlocks.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-secondary">
            No appointments this day — enjoy the gap.
          </p>
        ) : (
          hours.map((h) => {
            const appts = dayAppts.filter((x) => x.d.getHours() === h);
            const blk = dayBlocks.filter((b) => {
              const m = b.start.match(/(\d+):(\d+)\s*(AM|PM)/i);
              if (!m) return false;
              let hh = parseInt(m[1], 10) % 12;
              if (/pm/i.test(m[3])) hh += 12;
              return hh === h;
            });
            if (appts.length === 0 && blk.length === 0) return null;
            return (
              <div
                key={h}
                className="grid grid-cols-[64px_1fr] border-b border-border/60 last:border-0 min-h-[52px]"
              >
                <div className="px-3 py-2 text-[0.72rem] font-bold text-ink-faint tabular-nums">
                  {hourLabel(h)}
                </div>
                <div className="px-2 py-1.5 space-y-1.5">
                  {appts.map(({ a }) => (
                    <Link
                      key={a.id}
                      to={`/appointments/${a.id}`}
                      className={`block rounded-lg border-l-[3px] px-2.5 py-1.5 text-[0.78rem] transition hover:shadow-subtle ${statusTone(a.status)}`}
                    >
                      <span className="font-bold text-ink">
                        {a.time}–{a.endTime} · {a.patient.name}
                      </span>
                      <span className="block text-ink-secondary">
                        {a.type} · {a.durationMinutes} min
                      </span>
                    </Link>
                  ))}
                  {blk.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-lg px-2.5 py-1.5 text-[0.78rem] bg-slate-100 border border-dashed border-border text-ink-secondary"
                    >
                      <span className="font-bold">
                        {b.start}–{b.end} · Blocked: {b.reason}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// --- week view ------------------------------------------------------------------

export function WeekView({
  appointments,
  blocks,
}: {
  appointments: Appointment[];
  blocks: BlockedSlot[];
}) {
  const monday = startOfWeekMonday(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const today = new Date();
  const byDay = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const d = apptDate(a);
    if (!d) continue;
    const k = dayKey(d);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(a);
  }
  for (const list of byDay.values()) {
    list.sort((x, y) => x.sortKey.localeCompare(y.sortKey));
  }

  return (
    <div className="card-base overflow-hidden">
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px]" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
          {days.map((d) => {
            const isT = sameDay(d, today);
            return (
              <div
                key={dayKey(d)}
                className={`px-2 py-2.5 text-center border-b border-border ${
                  isT ? "bg-healthcare-faint" : ""
                }`}
              >
                <p className={`text-[0.72rem] font-bold uppercase tracking-wide ${isT ? "text-healthcare" : "text-ink-faint"}`}>
                  {d.toLocaleDateString("en-US", { weekday: "short" })}
                </p>
                <p className={`text-[1.05rem] font-extrabold tabular-nums ${isT ? "text-healthcare" : "text-navy"}`}>
                  {d.getDate()}
                </p>
              </div>
            );
          })}
          {days.map((d) => {
            const k = dayKey(d);
            const list = byDay.get(k) ?? [];
            const blk = blocks.filter((b) => b.date === blockDayLabel(d));
            const isT = sameDay(d, today);
            return (
              <div
                key={k}
                className={`px-1.5 py-1.5 border-l border-border/50 first:border-l-0 min-h-[120px] space-y-1 ${
                  isT ? "bg-healthcare-faint/40" : ""
                }`}
              >
                {list.map((a) => (
                  <Link
                    key={a.id}
                    to={`/appointments/${a.id}`}
                    className={`block text-[0.72rem] rounded-lg border-l-[3px] px-1.5 py-1 ${statusTone(a.status)}`}
                  >
                    <span className="font-bold text-ink block truncate">
                      {a.time} · {a.patient.name}
                    </span>
                    <span className="text-ink-secondary block truncate">{a.type}</span>
                  </Link>
                ))}
                {blk.map((b) => (
                  <div
                    key={b.id}
                    className="text-[0.7rem] bg-slate-100 border border-dashed border-border rounded px-1.5 py-1 text-ink-secondary truncate"
                  >
                    {b.start} · {b.reason}
                  </div>
                ))}
                {list.length === 0 && blk.length === 0 && (
                  <p className="text-[0.7rem] text-ink-faint px-1 py-1">—</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- month view -------------------------------------------------------------------

export function MonthView({
  appointments,
  onPickDay,
}: {
  appointments: Appointment[];
  onPickDay: (d: Date) => void;
}) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const title = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  // Monday-first offset.
  const lead = (first.getDay() + 6) % 7;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const byDay = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const d = apptDate(a);
    if (!d || d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())
      continue;
    const k = dayKey(d);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(a);
  }
  const cells: (Date | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: dim }, (_, i) => new Date(now.getFullYear(), now.getMonth(), i + 1)),
  ];

  return (
    <div className="card-base p-4">
      <p className="font-extrabold text-navy">{title}</p>
      <div className="grid grid-cols-7 gap-1 mt-3 text-center text-[0.7rem] font-bold text-ink-faint">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 mt-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`blank-${i}`} />;
          const list = byDay.get(dayKey(d)) ?? [];
          const isT = sameDay(d, now);
          return (
            <motion.button
              key={dayKey(d)}
              whileHover={{ y: -2 }}
              onClick={() => onPickDay(d)}
              className={`border rounded-control p-1.5 min-h-[56px] text-left transition ${
                isT ? "border-healthcare bg-healthcare-faint" : "border-border hover:border-healthcare/50"
              }`}
              aria-label={`${headerLabel(d)}, ${list.length} appointments`}
            >
              <span className={`text-[0.78rem] font-extrabold tabular-nums ${isT ? "text-healthcare" : "text-ink"}`}>
                {d.getDate()}
              </span>
              {list.length > 0 && (
                <span className="flex items-center gap-0.5 mt-1 flex-wrap">
                  {list.slice(0, 3).map((a) => (
                    <span key={a.id} className={`w-1.5 h-1.5 rounded-full ${dotTone(a.status)}`} />
                  ))}
                  <span className="text-[0.68rem] font-bold text-ink-secondary ml-0.5">
                    {list.length}
                  </span>
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
      <p className="text-[0.75rem] text-ink-secondary mt-3">Tap a day to open it in Day view.</p>
    </div>
  );
}
