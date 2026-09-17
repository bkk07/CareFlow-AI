import type {
  Escalation as ApiEscalation,
  Operation as ApiOperation,
  OpsReconciliation,
} from "../api";
import type {
  Escalation,
  Operation,
  Reconciliation,
} from "../types";

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

function opStatus(status: string): Operation["status"] {
  switch (status) {
    case "failed":
    case "timed_out":
      return "failed";
    case "unknown":
      return "unknown";
    case "succeeded":
    case "sent":
      return "resolved";
    default:
      return "unknown";
  }
}

export function mapOperation(o: ApiOperation): Operation {
  const st = opStatus(o.status);
  return {
    // Full backend id (pages slice for display); actions need the UUID.
    id: o.id,
    type: o.operation_type,
    appointment: o.appointment_id,
    patient: "—",
    system: "Mock EHR",
    status: st,
    started: formatDateTime(o.created_at),
    lastAttempt: formatDateTime(o.created_at),
    attempts: o.attempt_number,
    nextRetry: st === "failed" ? "In 15 min" : "—",
    error: o.error ?? "",
    timeline: [
      { label: "External request sent", state: "done" as const, detail: o.operation_type },
      {
        label: st === "failed" ? "Request failed" : st === "unknown" ? "Outcome unknown" : "Vendor confirmed",
        state: st === "failed" ? ("failed" as const) : st === "unknown" ? ("unknown" as const) : ("done" as const),
        detail: o.error ?? undefined,
      },
    ],
    correlationId: o.correlation_id,
  };
}

export function mapReconciliation(r: OpsReconciliation): Reconciliation {
  return {
    // Full backend ids (pages slice for display); actions need the UUIDs.
    id: r.id,
    operationId: r.operation_id ?? r.appointment_id,
    appointmentId: r.appointment_id,
    externalId: r.external_id,
    error: r.error,
    attempts: r.attempts,
    externalStatus: r.external_status ?? "—",
    internalState: r.internal_status,
    resolution:
      r.resolution_status === "open"
        ? "open"
        : r.resolution_status === "escalated"
          ? "escalated"
          : "resolved",
    updated: formatDateTime(r.created_at),
    note: r.note,
  };
}

export function mapEscalation(e: ApiEscalation): Escalation {
  return {
    // Full backend id (pages slice for display); resolve needs the UUID.
    id: e.id,
    title: `Escalation ${e.id.slice(0, 8)}`,
    priority: "medium",
    appointment: e.appointment_id ?? "—",
    issue: e.reason,
    assignee: "Unassigned",
    created: formatDateTime(e.created_at),
    status: e.status === "resolved" ? "resolved" : "new",
  };
}
