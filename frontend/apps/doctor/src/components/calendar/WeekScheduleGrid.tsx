import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { useSchedule } from "../../context/ScheduleContext";
import { Button } from "../common/ui";
import type { Appointment, AvailabilityRule, BlockedSlot } from "../../types";

const ROW_H = 56; // px per hour
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function startOfWeekMonday(d: Date): Date {
  const c = new Date(d);
  const dow = (c.getDay() + 6) % 7;
  c.setDate(c.getDate() - dow);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local minutes since midnight for an ISO datetime; null when unparseable. */
function localMinutes(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

export function hhmm(totalMinutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(totalMinutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function parseRuleTime(t: string): number {
  const m = t.match(/(\d+):(\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function statusChip(status: Appointment["status"]): string {
  if (status === "completed") return "bg-success-soft/90 border-success text-ink";
  if (status === "cancelled" || status === "no_show") return "bg-background border-border text-ink-secondary opacity-70";
  if (status === "pending" || status === "sync_pending" || status === "requested")
    return "bg-warning-soft/90 border-warning text-ink";
  return "bg-healthcare-soft/90 border-healthcare text-ink";
}

interface PlacedEvent {
  key: string;
  top: number;
  height: number;
  kind: "appointment" | "block";
  appointment?: Appointment;
  block?: BlockedSlot;
}

export default function WeekScheduleGrid({
  monday,
  onMondayChange,
  onAddEvent,
}: {
  monday: Date;
  onMondayChange: (d: Date) => void;
  /** Open the shared Add Event dialog (owned by the page). */
  onAddEvent: (date: string, start: string, end: string) => void;
}) {
  const { appointments, blocks, rules, loading, deleteBlock, refresh } = useSchedule();

  const days = useMemo(() => WEEKDAYS.map((_, i) => addDays(monday, i)), [monday]);
  const today = new Date();

  const ruleByDay = useMemo(() => {
    const map = new Map<string, AvailabilityRule>();
    for (const r of rules) map.set(r.day, r);
    return map;
  }, [rules]);

  // Grid spans the working hours across Mon–Fri (fallback 8:00–18:00).
  const [gridStartH, gridEndH] = useMemo(() => {
    let lo = 8 * 60;
    let hi = 18 * 60;
    let any = false;
    for (const name of WEEKDAYS) {
      const r = ruleByDay.get(name);
      if (!r?.enabled) continue;
      lo = Math.min(lo, Math.floor(parseRuleTime(r.start) / 60) * 60);
      hi = Math.max(hi, Math.ceil(parseRuleTime(r.end) / 60) * 60);
      any = true;
    }
    if (!any) return [8, 18];
    return [Math.max(0, lo / 60), Math.min(24, hi / 60)];
  }, [ruleByDay]);

  const gridPx = (gridEndH - gridStartH) * ROW_H;

  // Appointments grouped per weekday of the shown week.
  const apptsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const d = new Date(a.sortKey);
      if (Number.isNaN(d.getTime())) continue;
      const k = toInputDate(d);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return map;
  }, [appointments]);

  const blocksByDay = useMemo(() => {
    const map = new Map<string, BlockedSlot[]>();
    for (const b of blocks) {
      const s = new Date(b.startIso);
      if (Number.isNaN(s.getTime())) continue;
      const k = toInputDate(s);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    }
    return map;
  }, [blocks]);

  function eventsFor(day: Date): { inside: PlacedEvent[]; outside: PlacedEvent[] } {
    const inside: PlacedEvent[] = [];
    const outside: PlacedEvent[] = [];
    const key = toInputDate(day);
    for (const a of apptsByDay.get(key) ?? []) {
      const startMin = localMinutes(a.sortKey);
      if (startMin === null) continue;
      const endMin = startMin + (a.durationMinutes || 30);
      const top = ((startMin - gridStartH * 60) / 60) * ROW_H;
      const height = Math.max(26, ((endMin - startMin) / 60) * ROW_H - 3);
      const ev: PlacedEvent = { key: a.id, top, height, kind: "appointment", appointment: a };
      if (endMin <= gridStartH * 60 || startMin >= gridEndH * 60) outside.push(ev);
      else {
        ev.top = Math.max(0, top);
        inside.push(ev);
      }
    }
    for (const b of blocksByDay.get(key) ?? []) {
      const startMin = localMinutes(b.startIso);
      const endMin = localMinutes(b.endIso);
      if (startMin === null || endMin === null) continue;
      const top = ((startMin - gridStartH * 60) / 60) * ROW_H;
      const height = Math.max(26, ((endMin - startMin) / 60) * ROW_H - 3);
      const ev: PlacedEvent = { key: b.id, top, height, kind: "block", block: b };
      if (endMin <= gridStartH * 60 || startMin >= gridEndH * 60) outside.push(ev);
      else {
        ev.top = Math.max(0, top);
        inside.push(ev);
      }
    }
    return { inside, outside };
  }

  function openAddEvent(day: Date, minutes?: number) {
    const date = toInputDate(day);
    if (minutes !== undefined) {
      const snapped = Math.round(minutes / 15) * 15;
      onAddEvent(date, hhmm(snapped), hhmm(snapped + 60));
    } else {
      onAddEvent(date, "12:00", "13:00");
    }
  }

  function onColumnClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = gridStartH * 60 + ((e.clientY - rect.top) / ROW_H) * 60;
    openAddEvent(day, minutes);
  }

  async function removeBlock(id: string) {
    try {
      await deleteBlock(id);
    } catch {
      await refresh();
    }
  }

  const hours: number[] = [];
  for (let h = gridStartH; h < gridEndH; h++) hours.push(h);

  const weekLabel = `${days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${days[5].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const outsideAll = days.flatMap((d) => eventsFor(d).outside.map((ev) => ({ day: d, ev })));

  return (
    <div className="card-base overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => onMondayChange(addDays(monday, -7))} aria-label="Previous week" className="w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center font-bold text-ink-secondary">‹</button>
          <button onClick={() => onMondayChange(addDays(monday, 7))} aria-label="Next week" className="w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center font-bold text-ink-secondary">›</button>
          <p className="font-bold text-navy text-sm ml-1">{weekLabel}</p>
          <label className="inline-flex items-center gap-1.5 text-[0.78rem] font-bold border border-border rounded-control px-2.5 py-1.5 hover:border-healthcare hover:text-healthcare transition bg-white cursor-pointer ml-1" title="Pick any date — the week starts from that day">
            <span aria-hidden>📅</span>
            <input
              type="date"
              aria-label="Pick any date — the week starts from that day"
              value={toInputDate(monday)}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const [y, m, d] = v.split("-").map((n) => parseInt(n, 10));
                if (!y || !m || !d) return;
                onMondayChange(startOfWeekMonday(new Date(y, m - 1, d)));
              }}
              className="outline-none bg-transparent cursor-pointer text-ink-secondary max-w-[118px]"
            />
          </label>
          {!sameDay(monday, startOfWeekMonday(today)) && (
            <button onClick={() => onMondayChange(startOfWeekMonday(new Date()))} className="text-[0.78rem] font-bold text-healthcare hover:underline ml-1">This week</button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/availability" className="inline-flex items-center gap-1.5 text-[0.8rem] font-bold border border-border rounded-control px-3 py-2 text-ink-secondary hover:border-healthcare hover:text-healthcare transition">
            <Settings2 size={14} /> Configure
          </Link>
          <Button size="sm" onClick={() => openAddEvent(new Date())}><Plus size={15} /> Add Event</Button>
        </div>
      </div>

      {loading ? (
        <p className="px-4 py-8 text-center text-sm text-ink-secondary">Syncing schedule…</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[840px]">
            <div className="grid" style={{ gridTemplateColumns: "64px repeat(6, 1fr)" }}>
              <div />
              {days.map((d) => {
                const isT = sameDay(d, today);
                return (
                  <div key={toInputDate(d)} className={`px-2 py-2.5 text-center border-l border-border/60 ${isT ? "bg-healthcare-faint/60" : "bg-background/50"}`}>
                    <p className={`text-[0.72rem] font-bold uppercase tracking-wide ${isT ? "text-healthcare" : "text-ink-faint"}`}>
                      {d.toLocaleDateString("en-US", { weekday: "short" })}
                    </p>
                    <p className={`text-[1.05rem] font-extrabold tabular-nums ${isT ? "text-healthcare" : "text-navy"}`}>{d.getDate()}</p>
                  </div>
                );
              })}
            </div>
            <div className="grid" style={{ gridTemplateColumns: "64px repeat(6, 1fr)" }}>
              <div className="relative" style={{ height: gridPx }}>
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border/50 px-2" style={{ top: (h - gridStartH) * ROW_H }}>
                    <span className="text-[0.7rem] font-bold text-ink-faint tabular-nums">
                      {h % 12 === 0 ? 12 : h % 12}:00
                    </span>
                  </div>
                ))}
              </div>
              {days.map((day) => {
                const rule = ruleByDay.get(WEEKDAYS[(day.getDay() + 6) % 7]);
                const open = !!rule?.enabled;
                const { inside } = eventsFor(day);
                const isT = sameDay(day, today);
                return (
                  <div
                    key={toInputDate(day)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Add event on ${day.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("[data-event]")) return;
                      onColumnClick(day, e);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") openAddEvent(day);
                    }}
                    className={`relative border-l border-border/60 cursor-pointer hover:bg-healthcare-faint/30 transition ${isT ? "bg-healthcare-faint/30" : ""}`}
                    style={{ height: gridPx }}
                  >
                    {hours.map((h) => (
                      <div key={h} className="absolute inset-x-0 border-t border-border/40 pointer-events-none" style={{ top: (h - gridStartH) * ROW_H }} />
                    ))}
                    {!open && (
                      <div className="absolute inset-0 bg-slate-100/80 flex items-start justify-center pt-2 pointer-events-none">
                        <span className="text-[0.7rem] font-bold text-ink-faint uppercase tracking-wide">Closed</span>
                      </div>
                    )}
                    {open && rule && (
                      <>
                        {parseRuleTime(rule.start) > gridStartH * 60 && (
                          <div className="absolute inset-x-0 top-0 bg-slate-100/60 pointer-events-none" style={{ height: ((parseRuleTime(rule.start) - gridStartH * 60) / 60) * ROW_H }} />
                        )}
                        {parseRuleTime(rule.end) < gridEndH * 60 && (
                          <div className="absolute inset-x-0 bottom-0 bg-slate-100/60 pointer-events-none" style={{ height: ((gridEndH * 60 - parseRuleTime(rule.end)) / 60) * ROW_H }} />
                        )}
                      </>
                    )}
                    {inside.map((ev) =>
                      ev.kind === "appointment" && ev.appointment ? (
                        <Link
                          key={ev.key}
                          data-event
                          to={`/appointments/${ev.appointment.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className={`absolute inset-x-1 rounded-lg border-l-[3px] px-1.5 py-1 text-[0.7rem] leading-tight overflow-hidden transition hover:shadow-subtle ${statusChip(ev.appointment.status)}`}
                          style={{ top: ev.top, height: ev.height }}
                        >
                          <span className="font-bold block truncate">{ev.appointment.time} · {ev.appointment.patient.name}</span>
                          <span className="block truncate opacity-80">{ev.appointment.type}</span>
                        </Link>
                      ) : ev.block ? (
                        <div
                          key={ev.key}
                          data-event
                          className="absolute inset-x-1 rounded-lg px-1.5 py-1 text-[0.7rem] leading-tight overflow-hidden bg-slate-200/90 border border-dashed border-border text-ink-secondary"
                          style={{ top: ev.top, height: ev.height }}
                        >
                          <span className="font-bold block truncate">{ev.block.start} · {ev.block.reason}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeBlock(ev.block!.id);
                            }}
                            aria-label={`Remove block ${ev.block.reason}`}
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded flex items-center justify-center hover:text-danger hover:bg-white/70"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ) : null,
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {outsideAll.length > 0 && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-[0.76rem] font-bold text-ink-secondary uppercase tracking-wide">Outside working hours</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {outsideAll.map(({ day, ev }) => (
              <Link
                key={ev.key}
                to={ev.kind === "appointment" && ev.appointment ? `/appointments/${ev.appointment.id}` : "#"}
                onClick={ev.kind === "block" ? (e) => e.preventDefault() : undefined}
                className="text-[0.74rem] font-semibold border border-border rounded-full px-2.5 py-1 hover:border-healthcare"
              >
                {day.toLocaleDateString("en-US", { weekday: "short" })} ·{" "}
                {ev.kind === "appointment" && ev.appointment
                  ? `${ev.appointment.time} · ${ev.appointment.patient.name}`
                  : ev.block
                    ? `${ev.block.start} · ${ev.block.reason}`
                    : ""}
              </Link>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
