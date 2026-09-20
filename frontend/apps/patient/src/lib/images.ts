/** Local demo artwork fallbacks.
 *
 * Doctor/hospital rows in demo data usually carry no photo URL, so cards
 * would render as bare initial boxes. These deterministic picks from the
 * bundled `/images/...` set guarantee every card shows real artwork —
 * offline-friendly (no external image host to break).
 */

const DOCTOR_SHOTS = [
  "/images/doctors/doctor-1.svg",
  "/images/doctors/doctor-2.svg",
  "/images/doctors/doctor-3.svg",
  "/images/doctors/doctor-4.svg",
  "/images/doctors/doctor-5.svg",
  "/images/doctors/doctor-6.svg",
];

const HOSPITAL_SHOTS = [
  "/images/hospitals/hospital-1.svg",
  "/images/hospitals/hospital-2.svg",
  "/images/hospitals/hospital-3.svg",
  "/images/hospitals/hospital-4.svg",
];

function pick(list: string[], seed: string): string {
  let hash = 0;
  const s = seed || "?";
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return list[hash % list.length];
}

/** Stable demo portrait for a doctor (seeded by id or name). */
export function doctorImage(seed: string): string {
  return pick(DOCTOR_SHOTS, seed);
}

/** Stable demo cover for a hospital (seeded by id or name). */
export function hospitalImage(seed: string): string {
  return pick(HOSPITAL_SHOTS, seed);
}

/** First usable source: explicit URL wins, otherwise the demo fallback. */
export function withFallback(url: string | null | undefined, fallback: string): string {
  const clean = (url ?? "").trim();
  return clean ? clean : fallback;
}
