import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Avatar, Button, EmptyState, StatusBadge } from "../../components/common/ui";
import { ConfirmDialog, Drawer, ResponsiveTable } from "../../components/common/Modal";
import { Modal } from "../../components/common/Modal";
import type { Doctor } from "../../types";

export default function DoctorsPage() {
  const { doctors, specialties, departments, setDoctorStatus, createDoctor, inviteDoctorLogin, removeDoctorLogin, live, loading, backendError, refreshAll } = useAdmin();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Doctor | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; to: Doctor["status"] } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSpecialty, setNewSpecialty] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [newExperience, setNewExperience] = useState("0");
  const [newLanguages, setNewLanguages] = useState("English");
  const [newModes, setNewModes] = useState<string[]>(["in_person", "video"]);
  const [inviteFor, setInviteFor] = useState<Doctor | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [removeLoginFor, setRemoveLoginFor] = useState<Doctor | null>(null);
  const [error, setError] = useState<string | null>(null);

  const MODES = [
    { id: "in_person", label: "In person" },
    { id: "video", label: "Video" },
    { id: "phone", label: "Phone" },
  ];

  function toggleMode(m: string) {
    setNewModes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : (backendError ?? "Operation failed."));
    }
  }

  const visible = doctors.filter((d) => {
    if (status !== "all" && d.status !== status) return false;
    const q = query.toLowerCase().trim();
    if (q && !d.name.toLowerCase().includes(q) && !d.specialty.toLowerCase().includes(q)) return false;
    return true;
  });

  if (loading && doctors.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="page-title">Doctors</h1>
          <p className="page-sub mt-1">Hospital roster.</p>
        </div>
        <div className="card-base p-5 text-sm text-ink-secondary">Loading doctors…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Doctors</h1>
          <p className="page-sub mt-1">{doctors.length} doctors · {doctors.filter((d) => d.status === "active").length} active.</p>
        </div>
        <Button size="sm" onClick={() => { setNewName(""); setNewSpecialty(specialties[0]?.id ?? ""); setNewDepartment(departments[0]?.id ?? ""); setNewExperience("0"); setNewLanguages("English"); setNewModes(["in_person", "video"]); setCreateOpen(true); }}><Plus size={15} /> Add doctor</Button>
      </div>

      {live && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
          {loading ? "Syncing…" : "Live roster — activation needs specialty, department and a compatible visit type."}
        </p>
      )}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}

      <div className="card-base p-3.5 flex flex-col sm:flex-row gap-2">
        <div className="flex items-center gap-2 flex-1 bg-background border border-border rounded-control px-3">
          <Search size={15} className="text-ink-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search doctor or specialty…" aria-label="Search doctors" className="w-full bg-transparent outline-none py-2 text-[0.86rem]" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="input-base sm:!w-44">
          <option value="all">All statuses</option>
          {["active", "invited", "inactive", "suspended"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="card-base"><EmptyState title="No doctors found" body={doctors.length === 0 ? "No doctors registered yet — add your first doctor." : "Try a different search or status filter."} action={doctors.length === 0 ? <Button size="sm" variant="outline" onClick={() => void refreshAll()}>Refresh</Button> : undefined} /></div>
      ) : (
        <ResponsiveTable headers={["Doctor", "Specialty", "Department", "Exp.", "Modes", "Status", "Availability", "Login", "Actions"]}>
          {visible.map((d) => (
            <tr key={d.id} className="hover:bg-background/60 transition">
              <td className="td-cell">
                <button onClick={() => setSelected(d)} className="flex items-center gap-2 text-left">
                  <Avatar name={d.name} photo={d.photo} size="sm" />
                  <span className="font-bold hover:text-healthcare hover:underline">{d.name}</span>
                </button>
              </td>
              <td className="td-cell">{d.specialty}</td>
              <td className="td-cell">{d.department}</td>
              <td className="td-cell">{d.experience} yrs</td>
              <td className="td-cell text-ink-secondary text-[0.8rem]">{d.modes.join(", ")}</td>
              <td className="td-cell"><StatusBadge status={d.status} /></td>
              <td className="td-cell text-ink-secondary text-[0.8rem]">{d.availability}</td>
              <td className="td-cell text-ink-secondary text-[0.8rem]">{d.loginEmail ?? "—"}</td>
              <td className="td-cell">
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setSelected(d)} className="text-[0.78rem] font-bold text-healthcare hover:underline">View</button>
                  {d.status !== "active" ? (
                    <button onClick={() => setConfirm({ id: d.id, to: "active" })} className="text-[0.78rem] font-bold text-success hover:underline">Activate</button>
                  ) : (
                    <>
                      <button onClick={() => setConfirm({ id: d.id, to: "inactive" })} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Deactivate</button>
                      <button onClick={() => setConfirm({ id: d.id, to: "suspended" })} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Suspend</button>
                    </>
                  )}
                  {d.loginEmail ? (
                    <button onClick={() => setRemoveLoginFor(d)} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Remove login</button>
                  ) : (
                    <button onClick={() => { setInviteFor(d); setInviteEmail(""); setInvitePassword(""); }} className="text-[0.78rem] font-bold text-healthcare hover:underline">Create login</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Doctor profile">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={selected.name} photo={selected.photo} />
              <div>
                <h3 className="font-extrabold text-navy">{selected.name}</h3>
                <p className="text-[0.82rem] text-ink-secondary">{selected.specialty} · {selected.department}</p>
                <div className="mt-1"><StatusBadge status={selected.status} /></div>
              </div>
            </div>
            <dl className="text-sm border border-border rounded-control overflow-hidden">
              {[
                ["Qualifications", selected.qualifications],
                ["Experience", `${selected.experience} years`],
                ["Languages", selected.languages.join(", ")],
                ["Consultation", selected.modes.join(", ")],
                ["Visit lengths", `${selected.durations.join(", ")} min`],
                ["Hospital", selected.hospital],
                ["Portal login", selected.loginEmail ?? "No login yet"],
                ["Weekly load", `${selected.appointmentsWeek} appointments`],
              ].map(([k, v], i) => (
                <div key={k} className={`flex justify-between gap-3 px-4 py-2.5 ${i % 2 ? "bg-background/60" : "bg-white"}`}>
                  <dt className="text-ink-secondary">{k}</dt><dd className="font-semibold text-right">{v}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h4 className="font-bold text-sm">Availability summary</h4>
              <p className="text-[0.83rem] text-ink-secondary mt-1">Working days: {selected.availability} · Blocked periods visible on the doctor calendar.</p>
            </div>
            <div className="flex gap-2">
              {selected.status !== "active" ? (
                <Button className="flex-1" onClick={() => void run(async () => { await setDoctorStatus(selected.id, "active"); setSelected(null); })}>Activate doctor</Button>
              ) : (
                <Button variant="outline" className="flex-1" onClick={() => void run(async () => { await setDoctorStatus(selected.id, "inactive"); setSelected(null); })}>Deactivate</Button>
              )}
            </div>
            <div className="flex gap-2">
              {selected.loginEmail ? (
                <Button variant="outline" className="flex-1" onClick={() => { setSelected(null); setRemoveLoginFor(selected); }}>Remove portal login</Button>
              ) : (
                <Button variant="outline" className="flex-1" onClick={() => { setSelected(null); setInviteFor(selected); setInviteEmail(""); setInvitePassword(""); }}>Create portal login</Button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.to === "active" ? "Activate doctor" : confirm?.to === "suspended" ? "Suspend doctor" : "Deactivate doctor"}
        body={confirm?.to === "active" ? "The doctor will start receiving new appointments." : confirm?.to === "suspended" ? "Suspended doctors stop receiving new appointments immediately and can be reactivated later." : "Inactive doctors will not receive new appointments. Existing visits stay unchanged."}
        confirmLabel={confirm?.to === "active" ? "Activate" : confirm?.to === "suspended" ? "Suspend" : "Deactivate"}
        danger={confirm?.to !== "active"}
        onConfirm={() => confirm && void run(async () => { await setDoctorStatus(confirm.id, confirm.to); setConfirm(null); })}
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add doctor">
        <div className="space-y-3">
          <label className="block text-[0.83rem] font-bold">Name<input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Dr. Jane Smith" className="input-base mt-1" /></label>
          <label className="block text-[0.83rem] font-bold">Specialty
            <select value={newSpecialty} onChange={(e) => setNewSpecialty(e.target.value)} className="input-base mt-1">
              <option value="">— None —</option>
              {specialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block text-[0.83rem] font-bold">Department
            <select value={newDepartment} onChange={(e) => setNewDepartment(e.target.value)} className="input-base mt-1">
              <option value="">— None —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[0.83rem] font-bold">Experience (years)<input type="number" min={0} value={newExperience} onChange={(e) => setNewExperience(e.target.value)} className="input-base mt-1" /></label>
            <label className="block text-[0.83rem] font-bold">Languages (comma separated)<input value={newLanguages} onChange={(e) => setNewLanguages(e.target.value)} placeholder="English, Hindi" className="input-base mt-1" /></label>
          </div>
          <div>
            <p className="text-[0.83rem] font-bold">Consultation modes</p>
            <div className="flex gap-2 mt-1.5">
              {MODES.map((m) => (
                <label key={m.id} className={`flex-1 text-[0.8rem] font-bold border rounded-control py-2 text-center cursor-pointer transition ${newModes.includes(m.id) ? "bg-navy text-white border-navy" : "bg-white border-border hover:border-healthcare"}`}>
                  <input type="checkbox" className="sr-only" checked={newModes.includes(m.id)} onChange={() => toggleMode(m.id)} />
                  {m.label}
                </label>
              ))}
            </div>
          </div>
          <Button className="w-full" disabled={!newName.trim()} onClick={() => void run(async () => {
            const exp = Math.max(0, parseInt(newExperience, 10) || 0);
            const langs = newLanguages.split(",").map((l) => l.trim()).filter(Boolean);
            await createDoctor({
              name: newName.trim(),
              specialty_id: newSpecialty || null,
              department_id: newDepartment || null,
              experience_years: exp,
              languages: langs,
              consultation_types: newModes,
            });
            setCreateOpen(false);
          })}>Add doctor</Button>
        </div>
      </Modal>

      <Modal open={!!inviteFor} onClose={() => setInviteFor(null)} title={`Create portal login${inviteFor ? ` · ${inviteFor.name}` : ""}`}>
        <div className="space-y-3">
          <p className="text-[0.83rem] text-ink-secondary">The doctor signs into the doctor portal with this email and password. Location and hospital scope come from your hospital record — nothing to enter.</p>
          <label className="block text-[0.83rem] font-bold">Login email<input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="doctor@hospital.org" className="input-base mt-1" /></label>
          <label className="block text-[0.83rem] font-bold">Password (min 8 characters)<input type="password" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} className="input-base mt-1" minLength={8} /></label>
          <Button className="w-full" disabled={!inviteEmail.trim() || invitePassword.length < 8} onClick={() => inviteFor && void run(async () => {
            await inviteDoctorLogin(inviteFor.id, inviteEmail.trim(), invitePassword);
            setInviteFor(null);
          })}>Create login</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removeLoginFor}
        onClose={() => setRemoveLoginFor(null)}
        title="Remove portal login"
        body={`The login${removeLoginFor?.loginEmail ? ` (${removeLoginFor.loginEmail})` : ""} will be deactivated and unlinked. The doctor profile and history stay.`}
        confirmLabel="Remove login"
        danger
        onConfirm={() => removeLoginFor && void run(async () => { await removeDoctorLogin(removeLoginFor.id); setRemoveLoginFor(null); })}
      />
    </div>
  );
}
