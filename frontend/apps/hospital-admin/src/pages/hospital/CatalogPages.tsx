import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, EmptyState, StatusBadge } from "../../components/common/ui";
import { Modal, ResponsiveTable } from "../../components/common/Modal";

export function DepartmentsPage() {
  const { departments, addDepartment, renameDepartment, toggleDepartment, deleteDepartment, live, loading, backendError } = useAdmin();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch {
      setError(backendError ?? "Operation failed.");
    }
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
      {(error ?? backendError) && live && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      {departments.length === 0 ? (
        <div className="card-base"><EmptyState title="No departments found" body="Add your first clinical department to get started." /></div>
      ) : (
        <ResponsiveTable headers={["Department", "Specialties", "Doctors", "Status", "Updated", "Actions"]}>
          {departments.map((d) => (
            <tr key={d.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{d.name}</td>
              <td className="td-cell">{live ? "—" : d.specialties}</td>
              <td className="td-cell">{d.doctors}</td>
              <td className="td-cell"><StatusBadge status={d.status} /></td>
              <td className="td-cell text-ink-secondary">{d.updated}</td>
              <td className="td-cell">
                <div className="flex gap-1.5">
                  <button onClick={() => setEditing({ id: d.id, name: d.name })} className="text-[0.78rem] font-bold text-healthcare hover:underline inline-flex items-center gap-1"><Pencil size={12} /> Rename</button>
                  {live ? (
                    <button onClick={() => void run(() => deleteDepartment(d.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Delete</button>
                  ) : (
                    <button onClick={() => void toggleDepartment(d.id)} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">{d.status === "active" ? "Deactivate" : "Activate"}</button>
                  )}
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
  const { specialties, addSpecialty, toggleSpecialty, deleteSpecialty, live, backendError } = useAdmin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dept, setDept] = useState("Cardiology");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void> | void) {
    setError(null);
    try {
      await fn();
    } catch {
      setError(backendError ?? "Operation failed.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="page-title">Specialties</h1><p className="page-sub mt-1">Care areas within departments.</p></div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus size={15} /> Add specialty</Button>
      </div>
      {(error ?? backendError) && live && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      <ResponsiveTable headers={["Specialty", "Department", "Doctors", "Status", "Actions"]}>
        {specialties.map((s) => (
          <tr key={s.id} className="hover:bg-background/60 transition">
            <td className="td-cell font-bold">{s.name}</td>
            <td className="td-cell">{live ? "—" : s.department}</td>
            <td className="td-cell">{s.doctors}</td>
            <td className="td-cell"><StatusBadge status={s.status} /></td>
            <td className="td-cell">
              {live ? (
                <button onClick={() => void run(() => deleteSpecialty(s.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Delete</button>
              ) : (
                <button onClick={() => toggleSpecialty(s.id)} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">{s.status === "active" ? "Deactivate" : "Activate"}</button>
              )}
            </td>
          </tr>
        ))}
      </ResponsiveTable>
      <Modal open={open} onClose={() => setOpen(false)} title="Add specialty">
        <div className="space-y-3">
          <label className="block text-[0.83rem] font-bold">Name<input value={name} onChange={(e) => setName(e.target.value)} className="input-base mt-1" /></label>
          {!live && (
            <label className="block text-[0.83rem] font-bold">Department
              <select value={dept} onChange={(e) => setDept(e.target.value)} className="input-base mt-1">
                {["Cardiology", "Neurology", "Orthopedics", "Dermatology", "Pediatrics"].map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
          )}
          <Button className="w-full" disabled={!name.trim()} onClick={() => void run(async () => { await addSpecialty(name.trim(), dept); setName(""); setOpen(false); })}>Add specialty</Button>
        </div>
      </Modal>
    </div>
  );
}

export function AppointmentTypesPage() {
  const { types, addType, toggleType, deleteType, live, backendError } = useAdmin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [mode, setMode] = useState("In person");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void> | void) {
    setError(null);
    try {
      await fn();
    } catch {
      setError(backendError ?? "Operation failed.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="page-title">Appointment Types</h1><p className="page-sub mt-1">Visit kinds, durations, and modes.</p></div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus size={15} /> Add type</Button>
      </div>
      {(error ?? backendError) && live && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}
      <ResponsiveTable headers={["Name", "Description", "Duration", "Mode", "Status", "Actions"]}>
        {types.map((t) => (
          <tr key={t.id} className="hover:bg-background/60 transition">
            <td className="td-cell font-bold">{t.name}</td>
            <td className="td-cell text-ink-secondary">{t.description}</td>
            <td className="td-cell font-semibold">{t.duration} min</td>
            <td className="td-cell">{t.mode}</td>
            <td className="td-cell"><StatusBadge status={t.status} /></td>
            <td className="td-cell">
              {live ? (
                <button onClick={() => void run(() => deleteType(t.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Delete</button>
              ) : (
                <button onClick={() => toggleType(t.id)} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">{t.status === "active" ? "Deactivate" : "Activate"}</button>
              )}
            </td>
          </tr>
        ))}
      </ResponsiveTable>
      <Modal open={open} onClose={() => setOpen(false)} title="Add appointment type">
        <div className="space-y-3">
          <label className="block text-[0.83rem] font-bold">Name<input value={name} onChange={(e) => setName(e.target.value)} className="input-base mt-1" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[0.83rem] font-bold">Duration (min)
              <select value={duration} onChange={(e) => setDuration(e.target.value)} className="input-base mt-1">
                {["15", "30", "45", "60"].map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
            {!live && (
              <label className="block text-[0.83rem] font-bold">Mode
                <select value={mode} onChange={(e) => setMode(e.target.value)} className="input-base mt-1">
                  {["In person", "Video", "Phone", "In person / Video"].map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
            )}
          </div>
          <Button className="w-full" disabled={!name.trim()} onClick={() => void run(async () => { await addType({ name: name.trim(), description: "Custom visit type", duration: parseInt(duration, 10), mode }); setName(""); setOpen(false); })}>Add type</Button>
        </div>
      </Modal>
    </div>
  );
}
