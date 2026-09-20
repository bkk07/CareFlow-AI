import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";

export function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
 * Calendar-icon button + month popup. Pick any day in any month; the parent
 * re-anchors its view to start from that day and shows that day's schedule.
 */
export default function CalendarPickButton({
  selected,
  onPick,
  label = "Pick any date",
}: {
  selected: Date;
  onPick: (d: Date) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [open, selected]);

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

  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const title = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const cells = monthCells(month.getFullYear(), month.getMonth());

  function pick(d: Date) {
    onPick(d);
    setOpen(false);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={`inline-flex items-center gap-1.5 text-[0.8rem] font-bold border rounded-control px-3.5 py-2.5 transition bg-white ${
          open ? "border-navy text-navy" : "border-border hover:border-healthcare hover:text-healthcare"
        }`}
      >
        <CalendarDays size={16} />
        <span className="hidden sm:inline">Calendar</span>
      </button>

      {open && (
        <div
          className="absolute z-30 mt-2 right-0 bg-white border border-border rounded-card shadow-card p-4 w-[300px]"
          role="dialog"
          aria-label="Choose a date"
        >
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
              const isSel = sameDay(d, selected);
              const isT = sameDay(d, today);
              return (
                <button
                  key={toInputDate(d)}
                  onClick={() => pick(d)}
                  aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  className={`rounded-lg py-1.5 text-center transition text-[0.78rem] font-extrabold tabular-nums ${
                    isSel ? "bg-navy text-white" : "text-ink hover:bg-background"
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
          <p className="text-[0.72rem] text-ink-secondary mt-2 text-center">Pick any day — the view starts from that day.</p>
        </div>
      )}
    </div>
  );
}
