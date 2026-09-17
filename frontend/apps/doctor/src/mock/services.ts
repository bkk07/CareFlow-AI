/** Local mock services — no HTTP. Operate on in-memory mock data only. */

export function mockDelay<T>(value: T, ms = 400): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function consultationModeLabel(mode: string): string {
  if (mode === "video") return "Video";
  if (mode === "phone") return "Phone";
  return "In person";
}
