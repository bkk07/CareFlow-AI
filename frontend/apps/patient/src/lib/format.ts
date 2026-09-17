export function formatTimeLabel(isoOrLabel: string): string {
  return isoOrLabel;
}

export function statusTone(status: string): "success" | "warning" | "info" | "neutral" | "danger" {
  const s = status.toLowerCase();
  if (["confirmed", "completed"].includes(s)) return "success";
  if (["pending", "sync_pending"].includes(s)) return "warning";
  if (["rescheduled"].includes(s)) return "info";
  if (["cancelled"].includes(s)) return "neutral";
  return "danger";
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
