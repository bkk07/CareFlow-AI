/** Shared presentational helpers (no backend calls, no dummy data). */

export function consultationModeLabel(mode: string): string {
  if (mode === "video") return "Video";
  if (mode === "phone") return "Phone";
  return "In person";
}

export function nextSevenDays(): { key: string; label: string; sub: string }[] {
  const days: { key: string; label: string; sub: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const key = d.toISOString().slice(0, 10);
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
