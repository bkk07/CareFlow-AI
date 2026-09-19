import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, EmptyState, StatusBadge } from "../../components/common/ui";
import { Modal, ResponsiveTable } from "../../components/common/Modal";

export function DepartmentsPage() {
  const { departments, addDepartment, renameDepartment, deleteDepartment, live, loading, backendError, refreshAll } = useAdmin();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Operation failed."));
    }
  }

  if (loading && departments.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div><h1 className="page-title">Departments</h1><p className="page-sub mt-1">Clinical units and their coverage.</p></div>
        </div>
        <div className="card-base p-5 text-sm text-ink-secondary">Loading departments…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="page-title">Departments</h1><p className="page-sub mt-1">Clinical units and their coverage.</p></div>
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus size={15} /> Add department</Button>
      </div>
      {live && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
          {loading ? "Syncing…" : "Live catalog — deletes are blocked while doctors reference a row."}
        </p>
      )}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      {departments.length === 0 ? (
        <div className="card-base"><EmptyState title="No departments found" body="Add your first clinical department to get started." action={<Button size="sm" variant="outline" onClick={() => void refreshAll()}>Refresh</Button>} /></div>
      ) : (
        <ResponsiveTable headers={["Department", "Specialties", "Doctors", "Status", "Updated", "Actions"]}>
          {departments.map((d) => (
            <tr key={d.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{d.name}</td>
              <td className="td-cell text-ink-secondary text-[0.8rem]">{d.specialtyNames.length > 0 ? d.specialtyNames.join(", ") : "—"}</td>
              <td className="td-cell">{d.doctors}</td>
              <td className="td-cell"><StatusBadge status={d.status} /></td>
              <td className="td-cell text-ink-secondary">{d.updated}</td>
              <td className="td-cell">
                <div className="flex gap-1.5">
                  <button onClick={() => setEditing({ id: d.id, name: d.name })} className="text-[0.78rem] font-bold text-healthcare hover:underline inline-flex items-center gap-1"><Pencil size={12} /> Rename</button>
                  <button onClick={() => void run(() => deleteDepartment(d.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add department">
        <label className="block text-[0.83rem] font-bold">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Oncology" className="input-base mt-1" /></label>
        <Button className="w-full mt-4" disabled={!name.trim()} onClick={() => void run(async () => { await addDepartment(name.trim()); setName(""); setAddOpen(false); })}>Add department</Button>
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Rename department">
        <label className="block text-[0.83rem] font-bold">Name<input value={editing?.name ?? ""} onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))} className="input-base mt-1" /></label>
        <Button className="w-full mt-4" onClick={() => { if (editing) void run(async () => { await renameDepartment(editing.id, editing.name); setEditing(null); }); }}>Save</Button>
      </Modal>
    </div>
  );
}

export function SpecialtiesPage() {
  const { specialties, addSpecialty, deleteSpecialty, live, loading, backendError, refreshAll } = useAdmin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void> | void) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Operation failed."));
    }
  }

  if (loading && specialties.length === 0) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Specialties</h1><p className="page-sub mt-1">Care areas within departments.</p></div>
        <div className="card-base p-5 text-sm text-ink-secondary">Loading specialties…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="page-title">Specialties</h1><p className="page-sub mt-1">Care areas within departments.</p></div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus size={15} /> Add specialty</Button>
      </div>
      {live && loading && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">Syncing…</p>
      )}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      {specialties.length === 0 ? (
        <div className="card-base"><EmptyState title="No specialties found" body="Add your first specialty to get started." action={<Button size="sm" variant="outline" onClick={() => void refreshAll()}>Refresh</Button>} /></div>
      ) : (
        <ResponsiveTable headers={["Specialty", "Department", "Doctors", "Status", "Actions"]}>
          {specialties.map((s) => (
            <tr key={s.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{s.name}</td>
              <td className="td-cell text-ink-secondary text-[0.8rem]">{s.department || "—"}</td>
              <td className="td-cell">{s.doctors}</td>
              <td className="td-cell"><StatusBadge status={s.status} /></td>
              <td className="td-cell">
                <button onClick={() => void run(() => deleteSpecialty(s.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Delete</button>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add specialty">
        <div className="space-y-3">
          <label className="block text-[0.83rem] font-bold">Name<input value={name} onChange={(e) => setName(e.target.value)} className="input-base mt-1" /></label>
          <Button className="w-full" disabled={!name.trim()} onClick={() => void run(async () => { await addSpecialty(name.trim()); setName(""); setOpen(false); })}>Add specialty</Button>
        </div>
      </Modal>
    </div>
  );
}

export function AppointmentTypesPage() {
  const { types, addType, deleteType, live, loading, backendError, refreshAll } = useAdmin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void> | void) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Operation failed."));
    }
  }

  if (loading && types.length === 0) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Appointment Types</h1><p className="page-sub mt-1">Visit kinds, durations, and modes.</p></div>
        <div className="card-base p-5 text-sm text-ink-secondary">Loading appointment types…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="page-title">Appointment Types</h1><p className="page-sub mt-1">Visit kinds, durations, and modes.</p></div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus size={15} /> Add type</Button>
      </div>
      {live && loading && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">Syncing…</p>
      )}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      {types.length === 0 ? (
        <div className="card-base"><EmptyState title="No appointment types found" body="Add your first visit type to get started." action={<Button size="sm" variant="outline" onClick={() => void refreshAll()}>Refresh</Button>} /></div>
      ) : (
        <ResponsiveTable headers={["Name", "Description", "Duration", "Mode", "Status", "Actions"]}>
          {types.map((t) => (
            <tr key={t.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{t.name}</td>
              <td className="td-cell text-ink-secondary">{t.description}</td>
              <td className="td-cell font-semibold">{t.duration} min</td>
              <td className="td-cell">{t.mode}</td>
              <td className="td-cell"><StatusBadge status={t.status} /></td>
              <td className="td-cell">
                <button onClick={() => void run(() => deleteType(t.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Delete</button>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add appointment type">
        <div className="space-y-3">
          <label className="block text-[0.83rem] font-bold">Name<input value={name} onChange={(e) => setName(e.target.value)} className="input-base mt-1" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[0.83rem] font-bold">Duration (min)
              <select value={duration} onChange={(e) => setDuration(e.target.value)} className="input-base mt-1">
                {["15", "30", "45", "60"].map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
          </div>
          <Button className="w-full" disabled={!name.trim()} onClick={() => void run(async () => { await addType({ name: name.trim(), description: "Custom visit type", duration: parseInt(duration, 10), mode: "In person" }); setName(""); setOpen(false); })}>Add type</Button>
        </div>
      </Modal>
    </div>
  );
}
