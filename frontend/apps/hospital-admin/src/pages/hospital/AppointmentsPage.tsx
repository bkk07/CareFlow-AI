import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { getAppointmentDetail } from "../../api";
import { Button, EmptyState, LivePill, PageHeader, StatusBadge, TableSkeleton } from "../../components/common/ui";
import { ConfirmDialog, Drawer, ResponsiveTable } from "../../components/common/Modal";
import { Pagination, usePagination } from "../../components/common/Pagination";
import type { Appointment } from "../../types";

const TIMELINES: Record<string, string[]> = {
  confirmed: ["Requested", "Created", "Verified", "Confirmed"],
  pending: ["Requested", "Created"],
  sync_pending: ["Requested", "Created", "Verification pending"],
  cancelled: ["Created", "Cancelled", "Synchronized"],
  completed: ["Requested", "Created", "Verified", "Confirmed", "Completed"],
  rescheduled: ["Requested", "Created", "Rescheduled", "Confirmed"],
};

export default function AppointmentsPage() {
  const { appointments, cancelAppointment, completeAppointment, markNoShow, confirmAppointment, live, loading, syncing, backendError, refreshSection } = useAdmin();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ from_state: string; to_state: string; reason: string | null; created_at: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!selected) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    getAppointmentDetail(selected.id)
      .then((d) => {
        if (!cancelled) setHistory(d.history ?? []);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const shortId = (id: string) => (id.includes("-") ? id.slice(0, 8).toUpperCase() : id);

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    return appointments.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (q && !a.patient.toLowerCase().includes(q) && !a.doctor.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [appointments, query, status]);

  const pager = usePagination(visible, { initialSize: 10 });
  const isInitial = loading && appointments.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Appointments"
        sub="Hospital-wide scheduling across all doctors."
        count={`${visible.length}`}
      />

      {live && <LivePill syncing={syncing} loading={loading} text="Live bookings — cancelling notifies the patient." />}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-xl px-3.5 py-2.5">{error ?? backendError}</p>
      )}

      <div className="card-base p-3.5 flex flex-col sm:flex-row gap-2 sticky top-[60px] z-10">
        <div className="flex items-center gap-2 flex-1 bg-background border border-border rounded-xl px-3 focus-within:border-healthcare focus-within:ring-2 focus-within:ring-healthcare/15 transition">
          <Search size={15} className="text-ink-faint shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient or doctor…" aria-label="Search appointments" className="w-full bg-transparent outline-none py-2 text-[0.86rem]" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="input-base sm:!w-44">
          <option value="all">All statuses</option>
          {["confirmed", "pending", "sync_pending", "rescheduled", "completed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {isInitial ? (
        <TableSkeleton rows={8} cols={5} />
      ) : visible.length === 0 ? (
        <div className="card-base"><EmptyState title="No appointments found" body={appointments.length === 0 ? "No appointments recorded yet — new bookings will appear here." : "Try a different search or status filter."} action={appointments.length === 0 ? <Button size="sm" variant="outline" onClick={() => void refreshSection("appointments")}>Refresh</Button> : undefined} /></div>
      ) : (
        <ResponsiveTable
          headers={["Patient", "Doctor", "Date", "Type", "Status", "Form", "Actions"]}
          footer={
            <Pagination
              page={pager.page}
              totalPages={pager.totalPages}
              total={pager.total}
              start={pager.start}
              end={pager.end}
              pageSize={pager.pageSize}
              onPage={pager.setPage}
              onSize={pager.setPageSize}
            />
          }
        >
          {pager.pageItems.map((a) => (
            <tr key={a.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{a.patient}<span className="block text-[0.72rem] font-semibold text-ink-faint">{shortId(a.id)}</span></td>
              <td className="td-cell">{a.doctor}<span className="block text-[0.72rem] text-ink-secondary">{a.specialty}</span></td>
              <td className="td-cell whitespace-nowrap tabular-nums">{a.date} · {a.time}</td>
              <td className="td-cell">{a.type}</td>
              <td className="td-cell"><StatusBadge status={a.status} /></td>
              <td className="td-cell"><StatusBadge status={a.questionnaire === "none" ? "not_assigned" : a.questionnaire} /></td>
              <td className="td-cell">
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setSelected(a)} className="text-[0.78rem] font-bold text-healthcare hover:underline">Detail</button>
                  {(a.status === "confirmed" || a.status === "rescheduled") && (
                    <button onClick={() => setCancelId(a.id)} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Cancel</button>
                  )}
                  {(a.status === "pending" || a.status === "sync_pending") && (
                    <button onClick={() => { setError(null); confirmAppointment(a.id).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not confirm appointment.")); }} className="text-[0.78rem] font-bold text-success hover:underline">Confirm</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={`Appointment ${selected ? shortId(selected.id) : ""}`}>
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2"><StatusBadge status={selected.status} /><StatusBadge status={selected.questionnaire === "none" ? "not_assigned" : `form ${selected.questionnaire}`} /></div>
            <dl className="border border-border rounded-xl overflow-hidden">
              {[["Patient", selected.patient], ["Doctor", selected.doctor], ["Hospital", selected.hospital], ["Department", "—"], ["Date", `${selected.date} · ${selected.time}`], ["Type", selected.type], ["Created", selected.created]].map(([k, v], i) => (
                <div key={k} className={`flex justify-between gap-3 px-4 py-2.5 ${i % 2 ? "bg-background/60" : "bg-white"}`}>
                  <dt className="text-ink-secondary">{k}</dt><dd className="font-semibold text-right">{v}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h4 className="font-bold">Timeline</h4>
              {historyLoading ? (
                <p className="text-[0.83rem] text-ink-secondary mt-2">Loading history…</p>
              ) : history.length > 0 ? (
                <ol className="mt-2 space-y-0">
                  {history.map((h) => (
                    <li key={`${h.created_at}-${h.to_state}`} className="flex gap-2.5 pb-3 last:pb-0 relative">
                      <span className="w-[15px] h-[15px] rounded-full bg-success border-2 border-white shadow shrink-0 mt-0.5" aria-hidden />
                      <span className="font-semibold text-[0.84rem]">{h.from_state} → {h.to_state}{h.reason ? <span className="block text-[0.75rem] font-medium text-ink-secondary">{h.reason}</span> : null}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <ol className="mt-2 space-y-0">
                  {(TIMELINES[selected.status] ?? ["Created"]).map((s, i, arr) => (
                    <li key={s} className="flex gap-2.5 pb-3 last:pb-0 relative">
                      {i < arr.length - 1 && <span className="absolute left-[7px] top-5 bottom-0 w-px bg-border" aria-hidden />}
                      <span className="w-[15px] h-[15px] rounded-full bg-success border-2 border-white shadow shrink-0 mt-0.5" aria-hidden />
                      <span className="font-semibold text-[0.84rem]">{s}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            {(selected.status === "confirmed" || selected.status === "rescheduled") && (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setError(null); completeAppointment(selected.id).then(() => setSelected(null)).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not complete appointment.")); }}>Complete</Button>
                <Button variant="outline" className="flex-1" onClick={() => { setError(null); markNoShow(selected.id).then(() => setSelected(null)).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not mark no-show.")); }}>No-show</Button>
              </div>
            )}
            {(selected.status === "confirmed" || selected.status === "rescheduled") && (
              <Button variant="danger" className="w-full" onClick={() => { setCancelId(selected.id); }}>Cancel appointment</Button>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!cancelId}
        onClose={() => setCancelId(null)}
        title="Cancel appointment"
        body="The slot will be released and the patient notified. This cannot be undone from here."
        confirmLabel="Cancel appointment"
        danger
        onConfirm={() => {
          if (cancelId) {
            setError(null);
            cancelAppointment(cancelId).then(() => setSelected(null)).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not cancel appointment."));
          }
          setCancelId(null);
        }}
      />
    </div>
  );
}
