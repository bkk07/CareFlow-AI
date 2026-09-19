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
