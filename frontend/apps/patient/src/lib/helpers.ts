/** Shared presentational helpers (no backend calls, no dummy data). */

export function consultationModeLabel(mode: string): string {
  if (mode === "video") return "Video";
  if (mode === "phone") return "Phone";
  return "In person";
}

export function toLocalKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 7 consecutive days starting from `anchor` (inclusive). Powers the
 *  "strip starts from the picked day" behaviour for the calendar popup. */
export function sevenDaysFrom(anchor: Date): { key: string; label: string; sub: string }[] {
  const days: { key: string; label: string; sub: string }[] = [];
  const todayKey = toLocalKey(new Date());
  for (let i = 0; i < 7; i++) {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() + i);
    const key = toLocalKey(d);
    const tomorrow = new Date();
    tomorrow.setDate(new Date().getDate() + 1);
    const label =
      key === todayKey
        ? "Today"
        : key === toLocalKey(tomorrow)
          ? "Tomorrow"
          : d.toLocaleDateString("en-US", { weekday: "short" });
    const sub = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    days.push({ key, label, sub });
  }
  return days;
}

/** "2026-09-19" -> "Sat, Sep 19". Used when the picked day is outside the strip. */
export function formatDayKeyLong(key: string): string {
  const d = parseDayKey(key);
  if (Number.isNaN(d.getTime())) return key;
  return `${d.toLocaleDateString("en-US", { weekday: "short" })}, ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function nextSevenDays(): { key: string; label: string; sub: string }[] {
  const days: { key: string; label: string; sub: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    // Local YYYY-MM-DD (not UTC): backend date_from/date_to are calendar
    // dates, so the key must match the patient's local day to show the
    // doctor's original working hours for the right day.
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const key = `${d.getFullYear()}-${mm}-${dd}`;
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short" });
    const sub = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    days.push({ key, label, sub });
  }
  return days;
}

export function initials(name: string): string {
  const parts = name.replace(/^(Dr\.\s*)/i, "").trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export interface GeoCoords {
  latitude: number;
  longitude: number;
}

/** One-shot browser position (for "near me" ranking — never stored). */
export function readPosition(timeoutMs = 10000): Promise<GeoCoords> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation is not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => reject(new Error("Could not read your location. Check browser permission.")),
      { timeout: timeoutMs },
    );
  });
}
