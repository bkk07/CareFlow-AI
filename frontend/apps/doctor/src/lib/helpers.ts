/** Pure presentational helpers (no dummy data, no I/O). */

export function consultationModeLabel(mode: string): string {
  if (mode === "video") return "Video";
  if (mode === "phone") return "Phone";
  return "In person";
}

export function doctorInitials(name: string): string {
  return name
    .replace(/^(Dr\.\s*)/i, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function toLocalKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

export interface DayItem {
  key: string;
  label: string;
  sub: string;
}

/** 7 consecutive days starting from `anchor` (inclusive) — same single-day
 *  strip behaviour as the patient side. */
export function sevenDaysFrom(anchor: Date): DayItem[] {
  const days: DayItem[] = [];
  const todayKey = toLocalKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(new Date().getDate() + 1);
  const tomorrowKey = toLocalKey(tomorrow);
  for (let i = 0; i < 7; i++) {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() + i);
    const key = toLocalKey(d);
    const label =
      key === todayKey
        ? "Today"
        : key === tomorrowKey
          ? "Tomorrow"
          : d.toLocaleDateString("en-US", { weekday: "short" });
    const sub = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    days.push({ key, label, sub });
  }
  return days;
}
