import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { Appointment, AvailabilityRule, BlockedSlot } from "../../types";
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

const ROW_H = 56; // px per hour — same timeline rhythm as the patient side

function localMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
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

const FALLBACK_START_HOUR = 6;
const FALLBACK_END_HOUR = 22;

export function DayView({
  appointments,
  blocks,
  rules,
  selected,
  onPrevDay,
  onNextDay,
  onToday,
  onOpenSlot,
  onPickDate,
}: {
  appointments: Appointment[];
  blocks: BlockedSlot[];
  rules: AvailabilityRule[];
  selected: Date;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  /** Tap an open 30-min chip to block it (opens Add Event prefilled). */
  onOpenSlot: (day: Date, startMinutes: number, durationMinutes: number) => void;
  /** Jump to any calendar day (calendar-icon picker in the header). */
  onPickDate?: (d: Date) => void;
}) {
  const isToday = sameDay(selected, new Date());
  const weekday = selected.toLocaleDateString("en-US", { weekday: "long" });
  const rule = rules.find((r) => r.day === weekday);
  const open = !!rule?.enabled;
  const [rangeStartH, rangeEndH] = (() => {
    if (rule?.enabled) {
      const s = rule.start.match(/(\d+):(\d+)/);
      const e = rule.end.match(/(\d+):(\d+)/);
      if (s && e) {
        return [
          Math.max(0, Math.floor(parseInt(s[1], 10))),
          Math.min(24, Math.ceil(parseInt(e[1], 10) + (parseInt(e[2], 10) > 0 ? 1 : 0))),
        ] as const;
      }
    }
    return [FALLBACK_START_HOUR, FALLBACK_END_HOUR] as const;
  })();
  const dayAppts = appointments
    .map((a) => ({ a, d: apptDate(a) }))
    .filter(
      (x): x is { a: Appointment; d: Date } =>
        x.d !== null && sameDay(x.d, selected),
    )
    .sort((x, y) => x.d.getTime() - y.d.getTime());
  const label = blockDayLabel(selected);
  const dayBlocks = blocks.filter((b) => {
    const s = new Date(b.startIso);
    if (!Number.isNaN(s.getTime())) return sameDay(s, selected);
    return b.date === label;
  });
  const hours: number[] = [];
  for (let h = rangeStartH; h < rangeEndH; h++) hours.push(h);
  const gridPx = Math.max(0, (rangeEndH - rangeStartH) * ROW_H);
  const topForMin = (min: number) => ((min - rangeStartH * 60) / 60) * ROW_H;

  /** Click empty timeline space to block it (opens Add Event prefilled, snapped to 30 min). */
  function onTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-event]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = rangeStartH * 60 + ((e.clientY - rect.top) / ROW_H) * 60;
    const snapped = Math.max(rangeStartH * 60, Math.min(rangeEndH * 60 - 30, Math.round(raw / 30) * 30));
    onOpenSlot(selected, snapped, 30);
  }

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
          <span className={`text-[0.72rem] font-bold px-2 py-0.5 rounded-full ${open ? "bg-healthcare-faint text-healthcare" : "bg-background text-ink-faint"}`}>
            {open && rule ? `Working ${rule.start.slice(0, 5)}–${rule.end.slice(0, 5)}` : "Closed"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {onPickDate && (
            <label className="inline-flex items-center gap-1.5 text-[0.78rem] font-bold border border-border rounded-control px-2.5 py-1.5 hover:border-healthcare hover:text-healthcare transition bg-white cursor-pointer" title="Pick any date">
              <span aria-hidden>📅</span>
              <input
                type="date"
                aria-label="Pick any date"
                value={`${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const [y, m, d] = v.split("-").map((n) => parseInt(n, 10));
                  if (!y || !m || !d) return;
                  onPickDate(new Date(y, m - 1, d));
                }}
                className="outline-none bg-transparent cursor-pointer text-ink-secondary max-w-[118px]"
              />
            </label>
          )}
          {!isToday && (
            <button
              onClick={onToday}
              className="text-[0.78rem] font-bold text-healthcare hover:underline"
            >
              Back to today
            </button>
          )}
        </div>
      </div>
      <div className="max-h-[560px] overflow-y-auto">
        {!open ? (
          <p className="px-4 py-8 text-center text-sm text-ink-secondary">
            Closed this day — enable working hours in Availability to open it.
          </p>
        ) : (
          /* Patient-style single-day timeline: hour gutter + continuous
             schedule column. Appointments/blocks overlay by time; empty space
             stays clean (click it to block that 30-min slot). */
          <div className="border border-border rounded-control overflow-hidden m-3" aria-label="Doctor's day schedule">
            <div className="grid" style={{ gridTemplateColumns: "64px 1fr" }}>
              <div className="relative bg-background/60" style={{ height: gridPx }}>
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border/50 px-1.5" style={{ top: topForMin(h * 60) }}>
                    <span className="text-[0.68rem] font-bold text-ink-faint tabular-nums">
                      {hourLabel(h)}
                    </span>
                  </div>
                ))}
              </div>
              <div
                className="relative cursor-pointer"
                style={{ height: gridPx }}
                role="button"
                tabIndex={0}
                aria-label={`Day timeline ${headerLabel(selected)}. Activate to block a time.`}
                title="Click an empty time to block it"
                onClick={onTimelineClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpenSlot(selected, rangeStartH * 60, 30);
                }}
              >
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border/40 pointer-events-none" style={{ top: topForMin(h * 60) }} />
                ))}
                {dayBlocks.map((b) => {
                  const s = new Date(b.startIso);
                  const e = new Date(b.endIso);
                  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
                  const sMin = Math.max(localMinutes(s), rangeStartH * 60);
                  const eMin = Math.min(localMinutes(e), rangeEndH * 60);
                  if (eMin <= sMin) return null;
                  const hPx = Math.max(26, ((eMin - sMin) / 60) * ROW_H - 4);
                  return (
                    <div
                      key={b.id}
                      data-event
                      aria-label={`Blocked ${b.start} to ${b.end}`}
                      className="absolute inset-x-2 rounded-lg border px-2 py-1 text-left text-[0.74rem] leading-tight overflow-hidden bg-slate-100 border-dashed border-border text-ink-secondary"
                      style={{ top: topForMin(sMin) + 2, height: hPx }}
                    >
                      <span className="font-bold block truncate">Blocked: {b.reason}</span>
                      {hPx >= 38 && (
                        <span className="block truncate opacity-80">
                          {b.start} – {b.end}
                        </span>
                      )}
                    </div>
                  );
                })}
                {dayAppts.map(({ a, d }) => {
                  const sMin = Math.max(localMinutes(d), rangeStartH * 60);
                  const eMin = Math.min(sMin + (a.durationMinutes || 30), rangeEndH * 60);
                  if (eMin <= sMin) return null;
                  const hPx = Math.max(30, ((eMin - sMin) / 60) * ROW_H - 4);
                  return (
                    <Link
                      key={a.id}
                      data-event
                      to={`/appointments/${a.id}`}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${a.time} to ${a.endTime}, ${a.patient.name}`}
                      className={`absolute inset-x-2 rounded-lg border px-2 py-1 text-left text-[0.76rem] leading-tight overflow-hidden shadow-subtle transition hover:shadow-card ${statusTone(a.status)}`}
                      style={{ top: topForMin(sMin) + 2, height: hPx }}
                    >
                      <span className="font-bold block truncate text-ink">
                        {a.time} – {a.endTime} · {a.patient.name}
                      </span>
                      {hPx >= 38 && (
                        <span className="block truncate text-ink-secondary">
                          {a.type} · {a.durationMinutes} min
                        </span>
                      )}
                    </Link>
                  );
                })}
                {dayAppts.length === 0 && dayBlocks.length === 0 && (
                  <span className="sr-only">No appointments this day — enjoy the gap.</span>
                )}
              </div>
            </div>
          </div>
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
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const title = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  // Monday-first offset.
  const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const dim = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const byDay = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const d = apptDate(a);
    if (!d || d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear())
      continue;
    const k = dayKey(d);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(a);
  }
  const cells: (Date | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: dim }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];
  const isCurrentMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();

  return (
    <div className="card-base p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="Previous month"
            className="w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center font-bold text-ink-secondary"
          >
            ‹
          </button>
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Next month"
            className="w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center font-bold text-ink-secondary"
          >
            ›
          </button>
          <p className="font-extrabold text-navy ml-1">{title}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="inline-flex items-center gap-1.5 text-[0.78rem] font-bold border border-border rounded-control px-2.5 py-1.5 hover:border-healthcare hover:text-healthcare transition bg-white cursor-pointer" title="Pick any date">
            <span aria-hidden>📅</span>
            <input
              type="date"
              aria-label="Pick any date"
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const [y, m, d] = v.split("-").map((n) => parseInt(n, 10));
                if (!y || !m || !d) return;
                const picked = new Date(y, m - 1, d);
                setMonth(new Date(picked.getFullYear(), picked.getMonth(), 1));
                onPickDay(picked);
              }}
              className="outline-none bg-transparent cursor-pointer text-ink-secondary max-w-[118px]"
            />
          </label>
          {!isCurrentMonth && (
            <button
              onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
              className="text-[0.78rem] font-bold text-healthcare hover:underline"
            >
              This month
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 mt-3 text-center text-[0.7rem] font-bold text-ink-faint">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 mt-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`blank-${i}`} />;
          const list = byDay.get(dayKey(d)) ?? [];
          const isT = sameDay(d, today);
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

// --- mini month picker ----------------------------------------------------------
// Compact calendar for jumping to any day: pick a date to see that day's full
// schedule in Day view. Dots mark days that carry appointments.

export function MiniMonthPicker({
  selected,
  appointments,
  onSelect,
}: {
  selected: Date;
  appointments: Appointment[];
  onSelect: (d: Date) => void;
}) {
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));

  useEffect(() => {
    setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [selected]);

  const counts = new Map<string, number>();
  for (const a of appointments) {
    const d = apptDate(a);
    if (!d) continue;
    const k = dayKey(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const title = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const dim = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: dim }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];
  const now = new Date();

  return (
    <div className="card-base p-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" className="w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center font-bold text-ink-secondary">‹</button>
        <p className="font-extrabold text-navy text-[0.9rem]">{title}</p>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" className="w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center font-bold text-ink-secondary">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mt-2 text-center text-[0.66rem] font-bold text-ink-faint">
        {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
          <div key={`${w}-${i}`} className="py-0.5">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5 mt-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={`blank-${i}`} />;
          const n = counts.get(dayKey(d)) ?? 0;
          const isSel = sameDay(d, selected);
          const isT = sameDay(d, now);
          return (
            <button
              key={dayKey(d)}
              onClick={() => onSelect(d)}
              aria-label={`${headerLabel(d)}, ${n} appointments`}
              className={`rounded-lg py-1 text-center transition min-h-[34px] ${
                isSel ? "bg-navy text-white" : "hover:bg-background"
              } ${isT && !isSel ? "ring-1 ring-healthcare" : ""}`}
            >
              <span className={`block text-[0.76rem] font-extrabold tabular-nums ${isSel ? "text-white" : "text-ink"}`}>
                {d.getDate()}
              </span>
              <span className="flex items-center justify-center gap-0.5 h-1.5 mt-0.5">
                {Array.from({ length: Math.min(3, n) }).map((_, j) => (
                  <span key={j} className={`w-1 h-1 rounded-full ${isSel ? "bg-white" : "bg-healthcare"}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {!sameDay(selected, now) && (
        <button
          onClick={() => onSelect(new Date())}
          className="w-full mt-2.5 text-[0.78rem] font-bold border border-border rounded-control py-2 hover:border-healthcare hover:text-healthcare transition bg-white"
        >
          Today
        </button>
      )}
    </div>
  );
}
