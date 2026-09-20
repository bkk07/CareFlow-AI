import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { parseDayKey, toLocalKey, type DayItem } from "../../lib/helpers";

function monthCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const dim = new Date(year, month + 1, 0).getDate();
  return [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: dim }, (_, i) => new Date(year, month, i + 1)),
  ];
}

/**
 * Same single-day strip as the patient side: a 7-day strip starting from the
 * anchor day + a calendar-icon button that opens a month grid. Any day in any
 * month can be picked; the parent re-anchors the strip to start from that day
 * and shows that day's schedule.
 */
export default function DayStripWithCalendar({
  days,
  dayKey,
  anchorDate,
  onSelect,
  onPickDate,
  defaultOpen = false,
}: {
  days: DayItem[];
  dayKey: string;
  anchorDate: Date;
  onSelect: (key: string) => void;
  /** Called with the picked calendar day — parent re-anchors the strip. */
  onPickDate: (d: Date) => void;
  /** Calendar page opens the calendar by default, pointing at today. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [month, setMonth] = useState(() => new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1));
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setMonth(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1));
  }, [open, anchorDate]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fn);
      window.removeEventListener("keydown", esc);
    };
  }, [open ]);

  const selected = parseDayKey(dayKey);
  const today = new Date();
  const title = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const cells = monthCells(month.getFullYear(), month.getMonth());

  function pick(d: Date) {
    onPickDate(d);
    onSelect(toLocalKey(d));
    setOpen(false);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1" role="tablist" aria-label="Days">
        {days.map((d) => (
          <button
            key={d.key}
            role="tab"
            aria-selected={dayKey === d.key}
            onClick={() => onSelect(d.key)}
            className={`min-w-[86px] px-3 py-2.5 rounded-control border text-center transition shrink-0 ${
              dayKey === d.key ? "bg-healthcare text-white border-healthcare-dark" : "bg-white border-border hover:border-healthcare"
            }`}
          >
            <span className="block text-[0.78rem] font-bold">{d.label}</span>
            <span className={`block text-[0.75rem] ${dayKey === d.key ? "text-white/85" : "text-ink-secondary"}`}>{d.sub}</span>
          </button>
        ))}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Open calendar to pick any date"
          aria-expanded={open}
          title="Pick any date"
          className={`min-w-[52px] px-3 py-2.5 rounded-control border text-center transition shrink-0 flex flex-col items-center justify-center gap-0.5 ${
            open ? "bg-navy text-white border-navy" : "bg-white border-border hover:border-healthcare hover:text-healthcare"
          }`}
        >
          <CalendarDays size={18} />
          <span className="block text-[0.7rem] font-bold">Calendar</span>
        </button>
      </div>

      {open && (
        <div className="absolute z-30 mt-2 left-0 bg-white border border-border rounded-card shadow-card p-4 w-[300px]" role="dialog" aria-label="Choose a date">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              aria-label="Previous month"
              className="w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center font-bold text-ink-secondary"
            >
              ‹
            </button>
            <p className="font-extrabold text-navy text-[0.9rem]">{title}</p>
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              aria-label="Next month"
              className="w-8 h-8 rounded-lg hover:bg-background flex items-center justify-center font-bold text-ink-secondary"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mt-2 text-center text-[0.66rem] font-bold text-ink-faint">
            {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
              <div key={`${w}-${i}`} className="py-0.5">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5 mt-0.5">
            {cells.map((d, i) => {
              if (!d) return <div key={`blank-${i}`} />;
              const isSel =
                !Number.isNaN(selected.getTime()) &&
                d.getFullYear() === selected.getFullYear() &&
                d.getMonth() === selected.getMonth() &&
                d.getDate() === selected.getDate();
              const isT =
                d.getFullYear() === today.getFullYear() &&
                d.getMonth() === today.getMonth() &&
                d.getDate() === today.getDate();
              return (
                <button
                  key={toLocalKey(d)}
                  onClick={() => pick(d)}
                  aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  className={`rounded-lg py-1.5 text-center transition text-[0.78rem] font-extrabold tabular-nums ${
                    isSel ? "bg-healthcare text-white" : "text-ink hover:bg-background"
                  } ${isT && !isSel ? "ring-1 ring-healthcare" : ""}`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => pick(new Date())}
              className="flex-1 text-[0.78rem] font-bold border border-border rounded-control py-2 hover:border-healthcare hover:text-healthcare transition bg-white"
            >
              Today
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 text-[0.78rem] font-bold border border-border rounded-control py-2 text-ink-secondary hover:text-ink transition bg-white"
            >
              Close
            </button>
          </div>
          <p className="text-[0.72rem] text-ink-secondary mt-2 text-center">Pick any day — the strip starts from that day.</p>
        </div>
      )}
    </div>
  );
}
