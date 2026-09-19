import { useState } from "react";
import { Plus } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, EmptyState, StatusBadge } from "../../components/common/ui";
import { Modal, ResponsiveTable } from "../../components/common/Modal";

export default function StaffPage() {
  const { staff, inviteStaff, deactivateStaff, live, loading, backendError, refreshAll } = useAdmin();
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

  if (loading && staff.length === 0) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Staff & Access</h1><p className="page-sub mt-1">Who can administer this hospital.</p></div>
        <div className="card-base p-5 text-sm text-ink-secondary">Loading staff…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="page-title">Staff & Access</h1><p className="page-sub mt-1">Who can administer this hospital.</p></div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus size={15} /> Invite</Button>
      </div>
      {live && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
          {loading ? "Syncing…" : "Live roster — invites create hospital-admin logins; deactivation is reversible by re-invite."}
        </p>
      )}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      {staff.length === 0 ? (
        <div className="card-base"><EmptyState title="No staff members" body="Invite your first hospital administrator." action={<Button size="sm" variant="outline" onClick={() => void refreshAll()}>Refresh</Button>} /></div>
      ) : (
        <ResponsiveTable headers={["Name", "Role", "Status", "Last active", "Actions"]}>
          {staff.map((s) => (
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
