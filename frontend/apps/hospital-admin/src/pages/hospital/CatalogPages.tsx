import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Building2, ClipboardList, HeartPulse, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, EmptyState, StatusBadge, TableSkeleton } from "../../components/common/ui";
import { CountBar } from "../../components/common/ops";
import { Modal, ResponsiveTable } from "../../components/common/Modal";
import { Pagination, usePagination } from "../../components/common/Pagination";

const TABS = [
  { to: "/catalog/departments", label: "Departments", icon: Building2 },
  { to: "/catalog/specialties", label: "Specialties", icon: HeartPulse },
  { to: "/catalog/types", label: "Appointment Types", icon: ClipboardList },
];

function CatalogTabs() {
  const { pathname } = useLocation();
  return (
    <nav className="flex gap-1 overflow-x-auto no-scrollbar border-b border-border" aria-label="Catalog sections">
      {TABS.map((t) => {
        const active = pathname === t.to;
        return (
          <Link
            key={t.to}
            to={t.to}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 px-4 py-2.5 text-[0.83rem] font-bold whitespace-nowrap border-b-2 -mb-px transition-colors duration-150 ${active ? "text-healthcare border-healthcare" : "text-ink-secondary border-transparent hover:text-ink"}`}
          >
            <t.icon size={15} /> {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function CatalogHeader({
  eyebrow,
  title,
  sub,
  count,
  addLabel,
  onAdd,
  liveText,
  live,
  syncing,
  loading,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  count: number;
  addLabel: string;
  onAdd: () => void;
  liveText: string;
  live: boolean;
  syncing: boolean;
  loading: boolean;
}) {
  return (
    <div>
      <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-teal-dark">{eyebrow}</p>
      <div className="flex items-start justify-between gap-3 flex-wrap mt-1.5">
        <div className="min-w-0">
          <h1 className="text-[1.45rem] sm:text-[1.7rem] font-extrabold text-navy tracking-tight leading-tight">
            {title} <span className="text-[0.95rem] font-bold text-ink-faint tabular-nums align-middle">{count}</span>
          </h1>
          <p className="text-[0.85rem] text-ink-secondary mt-1 flex items-center gap-2 flex-wrap">
            {sub}
            {live && (
              <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-bold text-teal-dark">
                <span className={`w-1.5 h-1.5 rounded-full ${syncing || loading ? "bg-teal-dark animate-pulse" : "bg-success"}`} aria-hidden />
                {syncing || loading ? "Syncing" : "Live"}
              </span>
            )}
          </p>
          {live && <p className="sr-only">{liveText}</p>}
        </div>
        <Button size="sm" onClick={onAdd} className="!min-h-[2.6rem] !px-5">
          <Plus size={15} /> {addLabel}
        </Button>
      </div>
      <div className="mt-4"><CatalogTabs /></div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex items-center gap-2.5 bg-white border border-border rounded-xl px-3.5 focus-within:border-healthcare focus-within:ring-2 focus-within:ring-healthcare/15 transition">
      <Search size={15} className="text-ink-faint shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full bg-transparent outline-none py-2.5 text-[0.86rem] placeholder:text-ink-faint"
      />
      {value && (
        <button onClick={() => onChange("")} aria-label="Clear search" className="text-[0.75rem] font-bold text-ink-faint hover:text-ink shrink-0">
          Clear
        </button>
      )}
    </label>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-[0.83rem] font-medium text-danger bg-danger-soft border border-danger/20 rounded-xl px-3.5 py-2.5">
      <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0 mt-[7px]" aria-hidden />
      {message}
    </p>
  );
}

const fieldLabel = "block text-[0.85rem] font-semibold text-ink";
const fieldInput = "input-base !min-h-[48px] mt-1.5";

/* ------------------------------- DEPARTMENTS ------------------------------- */

export function DepartmentsPage() {
  const { departments, addDepartment, renameDepartment, deleteDepartment, live, loading, syncing, backendError, refreshSection } = useAdmin();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Operation failed."));
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter((d) => d.name.toLowerCase().includes(q) || d.specialtyNames.some((s) => s.toLowerCase().includes(q)));
  }, [departments, query]);
  const pager = usePagination(filtered, { initialSize: 9 });
  const isInitial = loading && departments.length === 0;
  const maxDocs = useMemo(() => filtered.reduce((m, d) => Math.max(m, d.doctors), 0), [filtered]);
  const totalDocs = useMemo(() => departments.reduce((s, d) => s + d.doctors, 0), [departments]);

  return (
    <div className="space-y-4">
      <CatalogHeader
        eyebrow="Catalog"
        title="Departments"
        sub={`Clinical units covering ${totalDocs} doctor assignment${totalDocs === 1 ? "" : "s"}. Deletes are blocked while doctors reference a row.`}
        count={departments.length}
        addLabel="Add department"
        onAdd={() => setAddOpen(true)}
        liveText="Live catalog — deletes are blocked while doctors reference a row."
        live={live} syncing={syncing} loading={loading}
      />
      <FormError message={error ?? backendError} />
      <SearchBox value={query} onChange={setQuery} placeholder="Search departments or specialties…" />
      {isInitial ? (
        <TableSkeleton rows={6} cols={3} />
      ) : filtered.length === 0 ? (
        <div className="card-base">
          {departments.length === 0
            ? <EmptyState title="No departments found" body="Add your first clinical department to get started." action={<Button size="sm" variant="outline" onClick={() => void refreshSection("departments")}>Refresh</Button>} />
            : <EmptyState title="No matches" body={`Nothing matches “${query.trim()}”.`} />}
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {pager.pageItems.map((d) => (
              <article key={d.id} className="card-base p-4 flex flex-col hover:shadow-card transition-shadow duration-200">
                <div className="flex items-start gap-2.5">
                  <span className="w-10 h-10 rounded-xl bg-healthcare-soft text-healthcare flex items-center justify-center shrink-0">
                    <Building2 size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-bold text-navy text-[0.95rem] truncate">{d.name}</h2>
                    <p className="text-[0.72rem] text-ink-secondary">Updated {d.updated}</p>
                  </div>
                  <StatusBadge status={d.status} />
                </div>
                <div className="mt-3">
                  <CountBar label="Doctors" count={d.doctors} max={Math.max(maxDocs, 1)} tone="bg-teal" />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3 min-h-[1.6rem]">
                  {d.specialtyNames.length > 0 ? (
                    d.specialtyNames.slice(0, 3).map((s) => (
                      <span key={s} className="text-[0.68rem] font-semibold bg-background border border-border rounded-full px-2 py-0.5 text-ink-secondary">{s}</span>
                    ))
                  ) : (
                    <span className="text-[0.72rem] text-ink-faint">No specialties linked</span>
                  )}
                  {d.specialtyNames.length > 3 && (
                    <span className="text-[0.68rem] font-bold text-ink-faint">+{d.specialtyNames.length - 3}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/70">
                  <button onClick={() => setEditing({ id: d.id, name: d.name })} className="inline-flex items-center gap-1 text-[0.78rem] font-bold text-healthcare hover:underline px-2 py-1.5 -ml-2 rounded-lg">
                    <Pencil size={12} /> Rename
                  </button>
                  <button onClick={() => void run(() => deleteDepartment(d.id))} className="inline-flex items-center gap-1 text-[0.78rem] font-bold text-ink-faint hover:text-danger px-2 py-1.5 rounded-lg transition-colors duration-150">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          {pager.totalPages > 1 && (
            <div className="card-base overflow-hidden">
              <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} start={pager.start} end={pager.end} pageSize={pager.pageSize} onPage={pager.setPage} onSize={pager.setPageSize} />
            </div>
          )}
        </>
      )}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add department">
        <label className={fieldLabel}>Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Oncology" className={fieldInput} aria-label="Department name" />
        </label>
        <Button className="w-full mt-4 !min-h-[48px]" disabled={!name.trim()} onClick={() => void run(async () => { await addDepartment(name.trim()); setName(""); setAddOpen(false); })}>Add department</Button>
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Rename department">
        <label className={fieldLabel}>Name
          <input value={editing?.name ?? ""} onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))} className={fieldInput} aria-label="Department name" />
        </label>
        <Button className="w-full mt-4 !min-h-[48px]" onClick={() => { if (editing) void run(async () => { await renameDepartment(editing.id, editing.name); setEditing(null); }); }}>Save</Button>
      </Modal>
    </div>
  );
}

/* ------------------------------- SPECIALTIES ------------------------------- */

export function SpecialtiesPage() {
  const { specialties, departments, addSpecialty, renameSpecialty, deleteSpecialty, live, loading, syncing, backendError, refreshSection } = useAdmin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void> | void) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Operation failed."));
    }
  }

  const deptNames = useMemo(() => [...new Set(specialties.map((s) => s.department).filter(Boolean))].sort(), [specialties]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return specialties.filter((s) =>
      (deptFilter === "all" || s.department === deptFilter) &&
      (q === "" || s.name.toLowerCase().includes(q)),
    );
  }, [specialties, query, deptFilter]);
  const pager = usePagination(filtered, { initialSize: 10 });
  const isInitial = loading && specialties.length === 0;
  const maxDocs = useMemo(() => filtered.reduce((m, s) => Math.max(m, s.doctors), 0), [filtered]);

  return (
    <div className="space-y-4">
      <CatalogHeader
        eyebrow="Catalog"
        title="Specialties"
        sub={`Care areas across ${departments.length} department${departments.length === 1 ? "" : "s"}. Deletes are blocked while doctors reference a row.`}
        count={specialties.length}
        addLabel="Add specialty"
        onAdd={() => setOpen(true)}
        liveText="Live specialties — deletes are blocked while doctors reference a row."
        live={live} syncing={syncing} loading={loading}
      />
      <FormError message={error ?? backendError} />
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1"><SearchBox value={query} onChange={setQuery} placeholder="Search specialties…" /></div>
        <label className="flex items-center gap-2 bg-white border border-border rounded-xl px-3.5 text-[0.83rem] font-semibold text-ink-secondary">
          Department
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Filter by department" className="bg-transparent outline-none py-2.5 font-bold text-ink">
            <option value="all">All</option>
            {deptNames.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>
      {isInitial ? (
        <TableSkeleton rows={6} cols={4} />
      ) : filtered.length === 0 ? (
        <div className="card-base">
          {specialties.length === 0
            ? <EmptyState title="No specialties found" body="Add your first specialty to get started." action={<Button size="sm" variant="outline" onClick={() => void refreshSection("specialties")}>Refresh</Button>} />
            : <EmptyState title="No matches" body="Try a different search or department filter." />}
        </div>
      ) : (
        <ResponsiveTable
          headers={["Specialty", "Department", "Doctors", "Coverage", "Status", "Actions"]}
          footer={
            <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} start={pager.start} end={pager.end} pageSize={pager.pageSize} onPage={pager.setPage} onSize={pager.setPageSize} />
          }
        >
          {pager.pageItems.map((s) => (
            <tr key={s.id} className="hover:bg-background/60 transition-colors duration-150">
              <td className="td-cell">
                <span className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-teal-soft text-teal-dark flex items-center justify-center shrink-0">
                    <HeartPulse size={15} />
                  </span>
                  <span className="font-bold">{s.name}</span>
                </span>
              </td>
              <td className="td-cell text-ink-secondary text-[0.8rem]">{s.department || "—"}</td>
              <td className="td-cell tabular-nums font-bold">{s.doctors}</td>
              <td className="td-cell min-w-[140px]">
                <div className="h-1.5 bg-background border border-border/60 rounded-full overflow-hidden" role="img" aria-label={`${s.name}: ${s.doctors} doctors`}>
                  <div className="h-full bg-teal rounded-full" style={{ width: `${maxDocs > 0 ? Math.max(4, Math.round((s.doctors / maxDocs) * 100)) : 0}%` }} />
                </div>
              </td>
              <td className="td-cell"><StatusBadge status={s.status} /></td>
              <td className="td-cell">
                <div className="flex gap-1">
                  <button onClick={() => setEditing({ id: s.id, name: s.name })} className="inline-flex items-center gap-1 text-[0.78rem] font-bold text-healthcare hover:underline px-2 py-1.5 rounded-lg"><Pencil size={12} /> Rename</button>
                  <button onClick={() => void run(() => deleteSpecialty(s.id))} className="inline-flex items-center gap-1 text-[0.78rem] font-bold text-ink-faint hover:text-danger px-2 py-1.5 rounded-lg transition-colors duration-150"><Trash2 size={12} /> Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add specialty">
        <label className={fieldLabel}>Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cardiology" className={fieldInput} aria-label="Specialty name" />
        </label>
        <Button className="w-full mt-4 !min-h-[48px]" disabled={!name.trim()} onClick={() => void run(async () => { await addSpecialty(name.trim()); setName(""); setOpen(false); })}>Add specialty</Button>
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Rename specialty">
        <label className={fieldLabel}>Name
          <input value={editing?.name ?? ""} onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))} className={fieldInput} aria-label="Specialty name" />
        </label>
        <Button className="w-full mt-4 !min-h-[48px]" onClick={() => { if (editing) void run(async () => { await renameSpecialty(editing.id, editing.name); setEditing(null); }); }}>Save</Button>
      </Modal>
    </div>
  );
}

/* ---------------------------- APPOINTMENT TYPES ---------------------------- */

const DURATIONS = ["15", "30", "45", "60"];

export function AppointmentTypesPage() {
  const { types, addType, updateType, deleteType, live, loading, syncing, backendError, refreshSection } = useAdmin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [editing, setEditing] = useState<{ id: string; name: string; duration: string } | null>(null);
  const [query, setQuery] = useState("");
  const [durFilter, setDurFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void> | void) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Operation failed."));
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return types.filter((t) =>
      (durFilter === "all" || String(t.duration) === durFilter) &&
      (q === "" || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)),
    );
  }, [types, query, durFilter]);
  const pager = usePagination(filtered, { initialSize: 9 });
  const isInitial = loading && types.length === 0;

  return (
    <div className="space-y-4">
      <CatalogHeader
        eyebrow="Catalog"
        title="Appointment Types"
        sub="Visit kinds and durations — durations drive slot math across scheduling."
        count={types.length}
        addLabel="Add type"
        onAdd={() => setOpen(true)}
        liveText="Live visit types — durations drive slot math."
        live={live} syncing={syncing} loading={loading}
      />
      <FormError message={error ?? backendError} />
      <SearchBox value={query} onChange={setQuery} placeholder="Search visit types…" />
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Filter by duration">
        {["all", ...DURATIONS].map((d) => (
          <button
            key={d}
            onClick={() => setDurFilter(d)}
            aria-pressed={durFilter === d}
            className={`px-3.5 py-1.5 rounded-full text-[0.76rem] font-bold whitespace-nowrap border transition-colors duration-150 ${durFilter === d ? "bg-navy text-white border-navy" : "bg-white text-ink-secondary border-border hover:border-healthcare hover:text-healthcare"}`}
          >
            {d === "all" ? "All durations" : `${d} min`}
          </button>
        ))}
      </div>
      {isInitial ? (
        <TableSkeleton rows={6} cols={3} />
      ) : filtered.length === 0 ? (
        <div className="card-base">
          {types.length === 0
            ? <EmptyState title="No appointment types found" body="Add your first visit type to get started." action={<Button size="sm" variant="outline" onClick={() => void refreshSection("types")}>Refresh</Button>} />
            : <EmptyState title="No matches" body="Try a different search or duration filter." />}
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {pager.pageItems.map((t) => (
              <article key={t.id} className="card-base p-4 hover:shadow-card transition-shadow duration-200">
                <div className="flex items-start gap-2.5">
                  <span className="min-w-[3.4rem] text-center bg-navy text-white rounded-xl px-2 py-2 shrink-0">
                    <span className="block text-[1.05rem] font-extrabold tabular-nums leading-none">{t.duration}</span>
                    <span className="block text-[0.6rem] font-bold uppercase tracking-wide opacity-70 mt-0.5">min</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-bold text-navy text-[0.95rem] truncate">{t.name}</h2>
                    <p className="text-[0.74rem] text-ink-secondary truncate">{t.description} · {t.mode}</p>
                  </div>
                  <StatusBadge status={t.status} />
                </div>
                <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/70">
                  <button onClick={() => setEditing({ id: t.id, name: t.name, duration: String(t.duration) })} className="inline-flex items-center gap-1 text-[0.78rem] font-bold text-healthcare hover:underline px-2 py-1.5 -ml-2 rounded-lg">
                    <Pencil size={12} /> Edit
                  </button>
                  <button onClick={() => void run(() => deleteType(t.id))} className="inline-flex items-center gap-1 text-[0.78rem] font-bold text-ink-faint hover:text-danger px-2 py-1.5 rounded-lg transition-colors duration-150">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          {pager.totalPages > 1 && (
            <div className="card-base overflow-hidden">
              <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} start={pager.start} end={pager.end} pageSize={pager.pageSize} onPage={pager.setPage} onSize={pager.setPageSize} />
            </div>
          )}
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add appointment type">
        <div className="space-y-4">
          <label className={fieldLabel}>Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Follow-up visit" className={fieldInput} aria-label="Appointment type name" />
          </label>
          <div>
            <span className={fieldLabel} id="new-duration-label">Duration</span>
            <div className="flex gap-1.5 mt-2" role="radiogroup" aria-labelledby="new-duration-label">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={duration === d}
                  onClick={() => setDuration(d)}
                  className={`flex-1 py-2.5 rounded-xl text-[0.83rem] font-bold border transition-colors duration-150 ${duration === d ? "bg-navy text-white border-navy" : "bg-white text-ink-secondary border-border hover:border-healthcare"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <Button className="w-full !min-h-[48px]" disabled={!name.trim()} onClick={() => void run(async () => { await addType({ name: name.trim(), description: "Custom visit type", duration: parseInt(duration, 10), mode: "In person" }); setName(""); setOpen(false); })}>Add type</Button>
        </div>
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit appointment type">
        <div className="space-y-4">
          <label className={fieldLabel}>Name
            <input value={editing?.name ?? ""} onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))} className={fieldInput} aria-label="Appointment type name" />
          </label>
          <div>
            <span className={fieldLabel} id="edit-duration-label">Duration (min)</span>
            <div className="flex gap-1.5 mt-2" role="radiogroup" aria-labelledby="edit-duration-label">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={(editing?.duration ?? "30") === d}
                  onClick={() => setEditing((p) => (p ? { ...p, duration: d } : p))}
                  className={`flex-1 py-2.5 rounded-xl text-[0.83rem] font-bold border transition-colors duration-150 ${(editing?.duration ?? "30") === d ? "bg-navy text-white border-navy" : "bg-white text-ink-secondary border-border hover:border-healthcare"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <Button className="w-full !min-h-[48px]" onClick={() => { if (editing) void run(async () => { await updateType(editing.id, { name: editing.name.trim(), duration: parseInt(editing.duration, 10) }); setEditing(null); }); }}>Save</Button>
        </div>
      </Modal>
    </div>
  );
}
