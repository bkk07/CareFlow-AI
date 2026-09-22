import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, EmptyState, LivePill, PageHeader, StatusBadge, TableSkeleton } from "../../components/common/ui";
import { Modal, ResponsiveTable } from "../../components/common/Modal";
import { Pagination, usePagination } from "../../components/common/Pagination";

export function DepartmentsPage() {
  const { departments, addDepartment, renameDepartment, deleteDepartment, live, loading, syncing, backendError, refreshSection } = useAdmin();
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

  const pager = usePagination(departments, { initialSize: 10 });
  const isInitial = loading && departments.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Departments"
        sub="Clinical units and their coverage."
        count={`${departments.length}`}
        actions={<Button size="sm" onClick={() => setAddOpen(true)}><Plus size={15} /> Add department</Button>}
      />
      {live && <LivePill syncing={syncing} loading={loading} text="Live catalog — deletes are blocked while doctors reference a row." />}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-xl px-3.5 py-2.5">{error ?? backendError}</p>
      )}
      {isInitial ? (
        <TableSkeleton rows={6} cols={4} />
      ) : departments.length === 0 ? (
        <div className="card-base"><EmptyState title="No departments found" body="Add your first clinical department to get started." action={<Button size="sm" variant="outline" onClick={() => void refreshSection("departments")}>Refresh</Button>} /></div>
      ) : (
        <ResponsiveTable
          headers={["Department", "Specialties", "Doctors", "Status", "Updated", "Actions"]}
          footer={
            <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} start={pager.start} end={pager.end} pageSize={pager.pageSize} onPage={pager.setPage} onSize={pager.setPageSize} />
          }
        >
          {pager.pageItems.map((d) => (
            <tr key={d.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{d.name}</td>
              <td className="td-cell text-ink-secondary text-[0.8rem]">{d.specialtyNames.length > 0 ? d.specialtyNames.join(", ") : "—"}</td>
              <td className="td-cell tabular-nums">{d.doctors}</td>
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
  const { specialties, addSpecialty, renameSpecialty, deleteSpecialty, live, loading, syncing, backendError, refreshSection } = useAdmin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void> | void) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Operation failed."));
    }
  }

  const pager = usePagination(specialties, { initialSize: 10 });
  const isInitial = loading && specialties.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Specialties"
        sub="Care areas within departments."
        count={`${specialties.length}`}
        actions={<Button size="sm" onClick={() => setOpen(true)}><Plus size={15} /> Add specialty</Button>}
      />
      {live && <LivePill syncing={syncing} loading={loading} text="Live specialties — deletes are blocked while doctors reference a row." />}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-xl px-3.5 py-2.5">{error ?? backendError}</p>
      )}
      {isInitial ? (
        <TableSkeleton rows={6} cols={4} />
      ) : specialties.length === 0 ? (
        <div className="card-base"><EmptyState title="No specialties found" body="Add your first specialty to get started." action={<Button size="sm" variant="outline" onClick={() => void refreshSection("specialties")}>Refresh</Button>} /></div>
      ) : (
        <ResponsiveTable
          headers={["Specialty", "Department", "Doctors", "Status", "Actions"]}
          footer={
            <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} start={pager.start} end={pager.end} pageSize={pager.pageSize} onPage={pager.setPage} onSize={pager.setPageSize} />
          }
        >
          {pager.pageItems.map((s) => (
            <tr key={s.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{s.name}</td>
              <td className="td-cell text-ink-secondary text-[0.8rem]">{s.department || "—"}</td>
              <td className="td-cell tabular-nums">{s.doctors}</td>
              <td className="td-cell"><StatusBadge status={s.status} /></td>
              <td className="td-cell">
                <div className="flex gap-1.5">
                  <button onClick={() => setEditing({ id: s.id, name: s.name })} className="text-[0.78rem] font-bold text-healthcare hover:underline inline-flex items-center gap-1"><Pencil size={12} /> Rename</button>
                  <button onClick={() => void run(() => deleteSpecialty(s.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Delete</button>
                </div>
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
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Rename specialty">
        <label className="block text-[0.83rem] font-bold">Name<input value={editing?.name ?? ""} onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))} className="input-base mt-1" /></label>
        <Button className="w-full mt-4" onClick={() => { if (editing) void run(async () => { await renameSpecialty(editing.id, editing.name); setEditing(null); }); }}>Save</Button>
      </Modal>
    </div>
  );
}

export function AppointmentTypesPage() {
  const { types, addType, updateType, deleteType, live, loading, syncing, backendError, refreshSection } = useAdmin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [editing, setEditing] = useState<{ id: string; name: string; duration: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void> | void) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Operation failed."));
    }
  }

  const pager = usePagination(types, { initialSize: 10 });
  const isInitial = loading && types.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Appointment Types"
        sub="Visit kinds, durations, and modes."
        count={`${types.length}`}
        actions={<Button size="sm" onClick={() => setOpen(true)}><Plus size={15} /> Add type</Button>}
      />
      {live && <LivePill syncing={syncing} loading={loading} text="Live visit types — durations drive slot math." />}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-xl px-3.5 py-2.5">{error ?? backendError}</p>
      )}
      {isInitial ? (
        <TableSkeleton rows={6} cols={4} />
      ) : types.length === 0 ? (
        <div className="card-base"><EmptyState title="No appointment types found" body="Add your first visit type to get started." action={<Button size="sm" variant="outline" onClick={() => void refreshSection("types")}>Refresh</Button>} /></div>
      ) : (
        <ResponsiveTable
          headers={["Name", "Description", "Duration", "Mode", "Status", "Actions"]}
          footer={
            <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} start={pager.start} end={pager.end} pageSize={pager.pageSize} onPage={pager.setPage} onSize={pager.setPageSize} />
          }
        >
          {pager.pageItems.map((t) => (
            <tr key={t.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{t.name}</td>
              <td className="td-cell text-ink-secondary">{t.description}</td>
              <td className="td-cell font-semibold tabular-nums">{t.duration} min</td>
              <td className="td-cell">{t.mode}</td>
              <td className="td-cell"><StatusBadge status={t.status} /></td>
              <td className="td-cell">
                <div className="flex gap-1.5">
                  <button onClick={() => setEditing({ id: t.id, name: t.name, duration: String(t.duration) })} className="text-[0.78rem] font-bold text-healthcare hover:underline inline-flex items-center gap-1"><Pencil size={12} /> Edit</button>
                  <button onClick={() => void run(() => deleteType(t.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Delete</button>
                </div>
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
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit appointment type">
        <div className="space-y-3">
          <label className="block text-[0.83rem] font-bold">Name<input value={editing?.name ?? ""} onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))} className="input-base mt-1" /></label>
          <label className="block text-[0.83rem] font-bold">Duration (min)
            <select value={editing?.duration ?? "30"} onChange={(e) => setEditing((p) => (p ? { ...p, duration: e.target.value } : p))} className="input-base mt-1">
              {["15", "30", "45", "60"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <Button className="w-full" onClick={() => { if (editing) void run(async () => { await updateType(editing.id, { name: editing.name.trim(), duration: parseInt(editing.duration, 10) }); setEditing(null); }); }}>Save</Button>
        </div>
      </Modal>
    </div>
  );
}
