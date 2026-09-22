import { useState } from "react";
import { Plus } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, EmptyState, LivePill, PageHeader, StatusBadge, TableSkeleton } from "../../components/common/ui";
import { Modal, ResponsiveTable } from "../../components/common/Modal";
import { Pagination, usePagination } from "../../components/common/Pagination";

export default function StaffPage() {
  const { staff, inviteStaff, deactivateStaff, live, loading, syncing, backendError, refreshSection } = useAdmin();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendInvite() {
    setError(null);
    setBusy(true);
    try {
      await inviteStaff(email.trim(), password);
      setOpen(false);
      setEmail("");
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invite failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(id: string) {
    setError(null);
    try {
      await deactivateStaff(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not deactivate.");
    }
  }

  const pager = usePagination(staff, { initialSize: 10 });
  const isInitial = loading && staff.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Staff & Access"
        sub="Who can administer this hospital."
        count={`${staff.length}`}
        actions={<Button size="sm" onClick={() => setOpen(true)}><Plus size={15} /> Invite</Button>}
      />
      {live && <LivePill syncing={syncing} loading={loading} text="Live roster — invites create hospital-admin logins; deactivation is reversible by re-invite." />}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-xl px-3.5 py-2.5">{error ?? backendError}</p>
      )}
      {isInitial ? (
        <TableSkeleton rows={6} cols={4} />
      ) : staff.length === 0 ? (
        <div className="card-base"><EmptyState title="No staff members" body="Invite your first hospital administrator." action={<Button size="sm" variant="outline" onClick={() => void refreshSection("staff")}>Refresh</Button>} /></div>
      ) : (
        <ResponsiveTable
          headers={["Name", "Role", "Status", "Last active", "Actions"]}
          footer={
            <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} start={pager.start} end={pager.end} pageSize={pager.pageSize} onPage={pager.setPage} onSize={pager.setPageSize} />
          }
        >
          {pager.pageItems.map((s) => (
            <tr key={s.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{s.name}</td>
              <td className="td-cell">{s.role}</td>
              <td className="td-cell"><StatusBadge status={s.status} /></td>
              <td className="td-cell text-ink-secondary">{s.lastActive}</td>
              <td className="td-cell">
                {s.status !== "deactivated" ? (
                  <button onClick={() => void deactivate(s.id)} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Deactivate</button>
                ) : (
                  <span className="text-[0.78rem] text-ink-faint">Deactivated</span>
                )}
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Invite staff">
        <div className="space-y-3">
          <label className="block text-[0.83rem] font-bold">Work email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@example.org" className="input-base mt-1" /></label>
          <label className="block text-[0.83rem] font-bold">Initial password (min 8 chars)<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-base mt-1" /></label>
          <p className="text-[0.78rem] text-ink-secondary">Creates a hospital-admin login for this hospital.</p>
          {error && <p role="alert" className="text-[0.83rem] font-semibold text-danger">{error}</p>}
          <Button className="w-full" disabled={!email.trim() || password.length < 8 || busy} onClick={() => void sendInvite()}>
            {busy ? "Sending…" : "Send invite"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
