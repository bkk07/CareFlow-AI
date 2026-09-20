import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { formatSlotTime } from "../../lib/backend";
import type { DayScheduleWindow } from "../../api";

const ROW_H = 56; // px per hour
const STEP_MIN = 30; // start-time dropdown granularity
const IST_OFFSET_MIN = 5 * 60 + 30; // backend rules are IST wall time (no DST)

export interface StartOption {
  iso: string;
  label: string;
}

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

/** "2026-10-05" + 14:30 (IST wall time, as the patient entered it) -> UTC ISO. */
export function istWallToUtcIso(dayKey: string, hh: number, mm: number): string {
  const [y, mo, d] = dayKey.split("-").map((n) => parseInt(n, 10));
  const utc = Date.UTC(y, mo - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000;
  return new Date(utc).toISOString();
}

export function endIsoFor(startIso: string, durationMinutes: number): string {
  return new Date(toMs(startIso) + durationMinutes * 60_000).toISOString();
}

export function fmtRange(startIso: string, endIso: string): string {
  return `${formatSlotTime(startIso)} → ${formatSlotTime(endIso)}`;
}

export type RangeProblem =
  | { ok: true }
  | { ok: false; reason: "outside" | "overrun" | "overlap" };

/** Client-side check for immediate feedback; the backend re-validates on booking. */
export function checkRange(
  workingHours: DayScheduleWindow[],
  busy: DayScheduleWindow[],
  startMs: number,
  endMs: number,
): RangeProblem {
  const containing = workingHours.some(
    (w) => toMs(w.start) <= startMs && endMs <= toMs(w.end),
  );
  if (!containing) {
    const startsInside = workingHours.some(
      (w) => toMs(w.start) <= startMs && startMs < toMs(w.end),
    );
    return { ok: false, reason: startsInside ? "overrun" : "outside" };
  }
  const clash = busy.some((b) => startMs < toMs(b.end) && toMs(b.start) < endMs);
  if (clash) return { ok: false, reason: "overlap" };
  return { ok: true };
}

export function isRangeAvailable(
  workingHours: DayScheduleWindow[],
  busy: DayScheduleWindow[],
  startIso: string,
  endIso: string,
): boolean {
  return checkRange(workingHours, busy, toMs(startIso), toMs(endIso)).ok;
}

/** 30-minute start-time candidates inside the working windows. */
export function buildStartOptions(
  workingHours: DayScheduleWindow[],
  durationMinutes: number,
): StartOption[] {
  const stepMs = STEP_MIN * 60_000;
  const durMs = durationMinutes * 60_000;
  const seen = new Set<string>();
  const out: StartOption[] = [];
  for (const w of workingHours) {
    const s = toMs(w.start);
    const e = toMs(w.end);
    for (let t = s; t + durMs <= e + 1_000; t += stepMs) {
      const iso = new Date(t).toISOString();
      if (seen.has(iso)) continue;
      seen.add(iso);
      out.push({ iso, label: formatSlotTime(iso) });
    }
  }
  return out.sort((a, b) => (a.iso < b.iso ? -1 : 1));
}

const BUSY_STYLES = [
  "bg-teal-soft/80 border-teal/40 text-teal-dark",
  "bg-navy-soft/80 border-navy/30 text-navy",
  "bg-success-soft/80 border-success/30 text-success",
  "bg-warning-soft/80 border-warning/30 text-warning",
  "bg-healthcare-soft/80 border-healthcare/40 text-navy",
];

export default function DaySchedulePicker({
  workingHours,
  busy,
  durationMinutes,
  dayKey,
  selectedStart,
  onSelect,
  loading,
}: {
  workingHours: DayScheduleWindow[];
  busy: DayScheduleWindow[];
  durationMinutes: number;
  /** YYYY-MM-DD calendar date (anchors manual time entry to IST). */
  dayKey: string;
  /** UTC ISO of the chosen start, or null. */
  selectedStart: string | null;
  onSelect: (startIso: string | null) => void;
  loading: boolean;
}) {
  const [manualTime, setManualTime] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const options = useMemo(
    () => buildStartOptions(workingHours, durationMinutes),
    [workingHours, durationMinutes],
  );

  const selectedEnd = selectedStart ? endIsoFor(selectedStart, durationMinutes) : null;
  const selectionCheck: RangeProblem | null = useMemo(() => {
    if (!selectedStart || !selectedEnd) return null;
    return checkRange(workingHours, busy, toMs(selectedStart), toMs(selectedEnd));
  }, [workingHours, busy, selectedStart, selectedEnd]);

  const span = useMemo(() => {
    if (workingHours.length === 0) return null;
    const lo = Math.min(...workingHours.map((w) => toMs(w.start)));
    const hi = Math.max(...workingHours.map((w) => toMs(w.end)));
    const start = Math.floor(lo / 3_600_000) * 3_600_000;
    const end = Math.ceil(hi / 3_600_000) * 3_600_000;
    return { start, end };
  }, [workingHours]);

  const hours: number[] = useMemo(() => {
    if (!span) return [];
    const out: number[] = [];
    for (let t = span.start; t < span.end; t += 3_600_000) out.push(t);
    return out;
  }, [span]);

  const gridPx = span ? ((span.end - span.start) / 3_600_000) * ROW_H : 0;
  const topFor = (ms: number) =>
    span ? ((ms - span.start) / 3_600_000) * ROW_H : 0;

  function applyManualTime() {
    setManualError(null);
    const m = manualTime.match(/^(\d{1,2}):(\d{2})/);
    if (!m) {
      setManualError("Enter a start time first.");
      return;
    }
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh > 23 || mm > 59) {
      setManualError("That time doesn't look right — use HH:MM.");
      return;
    }
    const iso = istWallToUtcIso(dayKey, hh, mm);
    const end = endIsoFor(iso, durationMinutes);
    const check = checkRange(workingHours, busy, toMs(iso), toMs(end));
    if (!check.ok) {
      setManualError(problemText(check, iso, end));
      return;
    }
    onSelect(iso);
  }

  if (loading) {
    return (
      <div aria-live="polite" className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton-row">
            <div className="skeleton" style={{ width: 90, height: 24, borderRadius: 999 }} />
            <div className="skeleton" style={{ flex: 1 }} />
          </div>
        ))}
      </div>
    );
  }

  if (workingHours.length === 0) {
    return (
      <p className="text-[0.86rem] text-ink-secondary border border-dashed border-border rounded-control px-4 py-6 text-center">
        The doctor is not available this day — try another day.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[0.85rem] font-bold text-ink">
        Appointment duration{" "}
        <span className="text-ink-secondary font-semibold">· {durationMinutes} minutes</span>
      </p>

      {/* Working-day timeline: existing appointments are anonymous colored blocks. */}
      <div className="border border-border rounded-control overflow-hidden" aria-label="Doctor's day schedule">
        <div className="grid" style={{ gridTemplateColumns: "64px 1fr" }}>
          <div className="relative bg-background/60" style={{ height: gridPx }}>
            {hours.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-border/50 px-1.5" style={{ top: topFor(t) }}>
                <span className="text-[0.68rem] font-bold text-ink-faint tabular-nums">
                  {formatSlotTime(new Date(t).toISOString())}
                </span>
              </div>
            ))}
          </div>
          <div className="relative" style={{ height: gridPx }}>
            {hours.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-border/40 pointer-events-none" style={{ top: topFor(t) }} />
            ))}
            {busy.map((b, i) => {
              if (!span) return null;
              const s = Math.max(toMs(b.start), span.start);
              const e = Math.min(toMs(b.end), span.end);
              if (e <= s) return null;
              const h = Math.max(22, ((e - s) / 3_600_000) * ROW_H - 4);
              return (
                <div
                  key={i}
                  aria-label={`Existing appointment ${formatSlotTime(b.start)} to ${formatSlotTime(b.end)}`}
                  className={`absolute inset-x-2 rounded-lg border px-2 py-1 text-left text-[0.74rem] leading-tight overflow-hidden ${BUSY_STYLES[i % BUSY_STYLES.length]}`}
                  style={{ top: topFor(s) + 2, height: h }}
                >
                  <span className="font-bold block truncate">Existing appointment</span>
                  {h >= 38 && (
                    <span className="block truncate opacity-80">
                      {formatSlotTime(b.start)} – {formatSlotTime(b.end)}
                    </span>
                  )}
                </div>
              );
            })}
            {selectedStart && selectedEnd && span && (() => {
              const s = toMs(selectedStart);
              const e = toMs(selectedEnd);
              if (e <= span.start || s >= span.end) return null;
              const h = Math.max(30, ((Math.min(e, span.end) - Math.max(s, span.start)) / 3_600_000) * ROW_H - 4);
              const valid = selectionCheck?.ok === true;
              return (
                <div
                  aria-label={`Your appointment ${fmtRange(selectedStart, selectedEnd)}`}
                  className={`absolute inset-x-2 rounded-lg border-l-4 px-2 py-1 text-left text-[0.76rem] leading-tight overflow-hidden shadow-subtle z-10 ${
                    valid
                      ? "bg-healthcare text-white border-healthcare-dark"
                      : "bg-danger-soft text-danger border-danger"
                  }`}
                  style={{ top: topFor(Math.max(s, span.start)) + 2, height: h }}
                >
                  <span className="font-bold block truncate">
                    {valid ? "✓ Your appointment" : "✕ Unavailable"}
                  </span>
                  {h >= 38 && (
                    <span className={`block truncate ${valid ? "text-white/85" : ""}`}>
                      {fmtRange(selectedStart, selectedEnd)}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Start time: dropdown (preferred) or manual entry. End is automatic. */}
      <div>
        <label className="text-[0.83rem] font-bold text-ink" htmlFor="start-time-select">
          Choose your preferred start time
        </label>
        <p className="text-[0.78rem] text-ink-secondary mt-0.5">
          You choose when to start — the system calculates when it ends ({durationMinutes} minutes).
        </p>
        {options.length === 0 ? (
          <p className="text-[0.85rem] font-semibold text-warning bg-warning-soft border border-warning/25 rounded-control px-3.5 py-2.5 mt-2">
            Fully booked this day — every {durationMinutes}-minute visit would overlap. Try another day.
          </p>
        ) : (
          <select
            id="start-time-select"
            value={selectedStart ?? ""}
            onChange={(e) => {
              setManualError(null);
              onSelect(e.target.value || null);
            }}
            className="input-base mt-2"
          >
            <option value="">Select start time…</option>
            {options.map((o) => (
              <option key={o.iso} value={o.iso}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end mt-2">
          <label className="text-[0.8rem] font-semibold text-ink-secondary flex-1">
            Or enter a start time
            <input
              type="time"
              value={manualTime}
              onChange={(e) => setManualTime(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyManualTime()}
              aria-label="Preferred start time"
              className="input-base mt-1"
            />
          </label>
          <button
            onClick={applyManualTime}
            className="text-[0.83rem] font-bold border border-border rounded-control px-4 py-2.5 hover:border-healthcare hover:text-healthcare transition shrink-0"
          >
            Use this time
          </button>
        </div>
        {manualError && <p role="alert" className="text-[0.8rem] font-semibold text-danger mt-1.5">{manualError}</p>}
      </div>

      {/* Calculated range + availability status. */}
      {selectedStart && selectedEnd && (
        <div
          role="status"
          className={`rounded-control border px-4 py-3.5 ${
            selectionCheck?.ok === true
              ? "bg-success-soft/60 border-success/30"
              : "bg-danger-soft/60 border-danger/30"
          }`}
        >
          {selectionCheck?.ok === true ? (
            <div className="flex items-start gap-2.5">
              <CheckCircle2 size={20} className="text-success shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-ink text-[0.9rem]">Available</p>
                <p className="text-[0.85rem] text-ink-secondary mt-0.5">
                  {fmtRange(selectedStart, selectedEnd)} · {durationMinutes} minutes
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5">
              <XCircle size={20} className="text-danger shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-ink text-[0.9rem]">Time unavailable</p>
                <p className="text-[0.85rem] text-ink-secondary mt-0.5">
                  {selectedStart && selectedEnd && selectionCheck && !selectionCheck.ok
                    ? problemText(selectionCheck, selectedStart, selectedEnd)
                    : "Pick another start time."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function problemText(
  check: Exclude<RangeProblem, { ok: true }>,
  startIso: string,
  endIso: string,
): string {
  const range = fmtRange(startIso, endIso);
  if (check.reason === "overlap")
    return `${range} overlaps with an existing appointment. Pick another start time.`;
  if (check.reason === "overrun")
    return `${range} extends beyond the doctor's working hours. Pick an earlier start time.`;
  return `${range} is outside the doctor's working hours. Pick a time inside the working day.`;
}
