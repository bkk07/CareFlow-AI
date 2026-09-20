import { useState } from "react";
import { Copy, Eye, Plus } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, EmptyState, StatusBadge } from "../../components/common/ui";
import { Drawer, Modal, ResponsiveTable } from "../../components/common/Modal";
import type { Questionnaire } from "../../types";
import type { QuestionnaireDetail } from "../../api";

export default function QuestionnairesPage() {
  const { questionnaires, duplicateQuestionnaire, toggleQuestionnaire, deleteQuestionnaire, updateQuestionnaireQuestion, deleteQuestionnaireQuestion, createQuestionnaire, fetchQuestionnaireDetail, addQuestionnaireQuestion, specialties, doctors, types, live, loading, backendError, refreshAll } = useAdmin();
  const [preview, setPreview] = useState<Questionnaire | null>(null);
  const [previewDetail, setPreviewDetail] = useState<QuestionnaireDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScope, setNewScope] = useState("hospital");
  const [newScopeRef, setNewScopeRef] = useState("");
  const [qType, setQType] = useState("short_text");
  const [qPrompt, setQPrompt] = useState("");
  const [qOptions, setQOptions] = useState("");
  const [qRequired, setQRequired] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Questionnaire | null>(null);
  const [editingQ, setEditingQ] = useState<{ id: string; prompt: string; required: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    }
  }

  async function openPreview(q: Questionnaire) {
    setPreview(q);
    setPreviewDetail(null);
    setPreviewLoading(true);
    try {
      const detail = await fetchQuestionnaireDetail(q.id);
      setPreviewDetail(detail);
    } catch {
      setPreviewDetail(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  const scopeRefOptions =
    newScope === "specialty" ? specialties.map((s) => ({ id: s.id, name: s.name }))
    : newScope === "appointment_type" ? types.map((t) => ({ id: t.id, name: t.name }))
    : newScope === "doctor" ? doctors.map((d) => ({ id: d.id, name: d.name }))
    : [];

  async function create() {
    if (newScope !== "hospital" && !newScopeRef) {
      setError("Pick what this form applies to (specialty, visit type, or doctor).");
      return;
    }
    await run(async () => {
      await createQuestionnaire(newName.trim(), newScope, newScope === "hospital" ? null : newScopeRef);
      setNewName("");
      setNewScope("hospital");
      setNewScopeRef("");
      setCreateOpen(false);
    });
  }

  async function addQuestion() {
    if (!preview || !previewDetail) return;
    const options = qOptions.split(",").map((o) => o.trim()).filter(Boolean);
    const order = previewDetail.questions.length + 1;
    await run(async () => {
      await addQuestionnaireQuestion(preview.id, {
        order,
        type: qType,
        prompt: qPrompt.trim(),
        options: options.length > 0 ? options : null,
        required: qRequired,
      });
      setQPrompt("");
      setQOptions("");
      const detail = await fetchQuestionnaireDetail(preview.id);
      setPreviewDetail(detail);
    });
  }

  const needsOptions = qType === "choice" || qType === "multi_choice";

  const previewFields = (previewDetail?.questions ?? []).map((f) => ({
    id: f.id,
    question: f.prompt,
    type: f.type,
    required: f.required,
    options: f.options ?? undefined,
  }));

  if (loading && questionnaires.length === 0) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Questionnaires</h1><p className="page-sub mt-1">Administrative pre-visit forms. No diagnostic content.</p></div>
        <div className="card-base p-5 text-sm text-ink-secondary">Loading questionnaires…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="page-title">Questionnaires</h1><p className="page-sub mt-1">Administrative pre-visit forms. No diagnostic content.</p></div>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={15} /> Create</Button>
      </div>

      {live && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
          {loading ? "Syncing…" : "Live forms — only active forms resolve for new appointments."}
        </p>
      )}
      {(error ?? backendError) && (
        <p role="alert" className="text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">{error ?? backendError}</p>
      )}

      {questionnaires.length === 0 ? (
        <div className="card-base"><EmptyState title="No questionnaires" body="Create your first pre-visit form." action={<Button size="sm" variant="outline" onClick={() => void refreshAll()}>Refresh</Button>} /></div>
      ) : (
        <ResponsiveTable headers={["Form", "Specialty", "Doctor", "Type", "Questions", "Status", "Updated", "Actions"]}>
          {questionnaires.map((q) => (
            <tr key={q.id} className="hover:bg-background/60 transition">
              <td className="td-cell font-bold">{q.name}</td>
              <td className="td-cell">{q.specialty}</td>
              <td className="td-cell">{q.doctor}</td>
              <td className="td-cell">{q.type}</td>
              <td className="td-cell">{q.questions}</td>
              <td className="td-cell"><StatusBadge status={q.status} /></td>
              <td className="td-cell text-ink-secondary">{q.updated}</td>
              <td className="td-cell">
                <div className="flex gap-2">
                  <button onClick={() => void openPreview(q)} className="text-[0.78rem] font-bold text-healthcare hover:underline inline-flex items-center gap-1"><Eye size={12} /> Preview</button>
                  <button onClick={() => void run(() => duplicateQuestionnaire(q.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-healthcare inline-flex items-center gap-1"><Copy size={12} /> Duplicate</button>
                  <button onClick={() => void run(() => toggleQuestionnaire(q.id))} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">{q.status === "active" ? "Deactivate" : "Activate"}</button>
                  <button onClick={() => setConfirmDelete(q)} className="text-[0.78rem] font-bold text-ink-secondary hover:text-danger">Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
      )}

      <Drawer open={!!preview} onClose={() => { setPreview(null); setPreviewDetail(null); }} title={preview ? `Preview · ${preview.name}` : "Preview"}>
        {preview && (
          <div className="bg-background/60 rounded-control p-4">
            <p className="text-[0.78rem] font-bold text-ink-secondary uppercase tracking-wide">How the patient sees it</p>
            {previewLoading ? (
              <p className="text-sm text-ink-secondary mt-2">Loading questions…</p>
            ) : previewFields.length === 0 ? (
              <p className="text-sm text-ink-secondary mt-2">No questions in this form yet — add the first one below.</p>
            ) : (
              <div className="mt-2 space-y-3">
                {previewFields.map((f, i) => (
                  <div key={f.id ?? i} className="bg-white border border-border rounded-control p-3.5">
                    <p className="font-bold text-[0.88rem]">{i + 1}. {f.question} {f.required && <span className="text-danger text-[0.72rem]">Required</span>}</p>
                    <p className="text-[0.75rem] text-ink-secondary mt-0.5">{f.type}</p>
                    {f.type === "Yes/No" && <div className="grid grid-cols-2 gap-1.5 mt-2">{["Yes", "No"].map((o) => <span key={o} className="border border-border rounded-lg py-2 text-center text-sm font-semibold">{o}</span>)}</div>}
                    {(f.type === "Single choice" || f.type === "Multiple choice") && <div className="space-y-1.5 mt-2">{(f.options ?? ["Option A", "Option B"]).map((o) => <span key={o} className="block border border-border rounded-lg px-3 py-2 text-sm">{o}</span>)}</div>}
                    {(f.type === "Short text" || f.type === "Long text" || f.type === "Numeric" || f.type === "Date") && <div className="border border-border rounded-lg px-3 py-2.5 text-sm text-ink-faint mt-2">Patient answer field</div>}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => f.id && setEditingQ({ id: f.id, prompt: f.question, required: f.required })} className="text-[0.75rem] font-bold text-healthcare hover:underline">Edit</button>
                      <button onClick={() => preview && f.id && void run(async () => { await deleteQuestionnaireQuestion(preview.id, f.id); const detail = await fetchQuestionnaireDetail(preview.id); setPreviewDetail(detail); })} className="text-[0.75rem] font-bold text-ink-secondary hover:text-danger">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 bg-white border border-border rounded-control p-3.5">
              <p className="font-bold text-[0.88rem]">Add question</p>
              <label className="block text-[0.8rem] font-bold mt-2">Type
                <select value={qType} onChange={(e) => setQType(e.target.value)} className="input-base mt-1">
                  <option value="yes_no">Yes / No</option>
                  <option value="choice">Single choice</option>
                  <option value="multi_choice">Multiple choice</option>
                  <option value="numeric">Numeric</option>
                  <option value="date">Date</option>
                  <option value="short_text">Short text</option>
                  <option value="long_text">Long text</option>
                </select>
              </label>
              <label className="block text-[0.8rem] font-bold mt-2">Question<input value={qPrompt} onChange={(e) => setQPrompt(e.target.value)} placeholder="e.g. Do you have any known allergies?" className="input-base mt-1" /></label>
              {needsOptions && (
                <label className="block text-[0.8rem] font-bold mt-2">Options (comma separated)<input value={qOptions} onChange={(e) => setQOptions(e.target.value)} placeholder="e.g. New symptom, Follow-up, Refill" className="input-base mt-1" /></label>
              )}
              <label className="flex items-center gap-2 text-[0.8rem] font-bold mt-2 cursor-pointer">
                <input type="checkbox" checked={qRequired} onChange={(e) => setQRequired(e.target.checked)} className="w-4 h-4 accent-[#1769AA]" />
                Required
              </label>
              <Button size="sm" className="mt-3 w-full" disabled={!qPrompt.trim() || (needsOptions && !qOptions.trim())} onClick={() => void addQuestion()}>Add question</Button>
            </div>
          </div>
        )}
      </Drawer>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create questionnaire">
        <label className="block text-[0.83rem] font-bold">Name<input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Orthopedics Pre-visit" className="input-base mt-1" /></label>
        <label className="block text-[0.83rem] font-bold mt-3">Applies to
          <select value={newScope} onChange={(e) => { setNewScope(e.target.value); setNewScopeRef(""); }} className="input-base mt-1">
            <option value="hospital">Whole hospital (fallback for every booking)</option>
            <option value="specialty">One specialty</option>
            <option value="appointment_type">One visit type</option>
            <option value="doctor">One doctor</option>
          </select>
        </label>
        {newScope !== "hospital" && (
          <label className="block text-[0.83rem] font-bold mt-3">Which one?
            <select value={newScopeRef} onChange={(e) => setNewScopeRef(e.target.value)} className="input-base mt-1">
              <option value="">— Select —</option>
              {scopeRefOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
        <Button className="w-full mt-4" disabled={!newName.trim()} onClick={() => void create()}>Create form</Button>
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete questionnaire">
        <p className="text-[0.85rem] text-ink-secondary">Delete “{confirmDelete?.name}” and all its questions? Past responses are kept.</p>
        <Button variant="outline" className="w-full mt-4 !text-danger !border-danger/30" onClick={() => confirmDelete && void run(async () => { await deleteQuestionnaire(confirmDelete.id); setConfirmDelete(null); })}>Delete form</Button>
      </Modal>

      <Modal open={!!editingQ} onClose={() => setEditingQ(null)} title="Edit question">
        <label className="block text-[0.83rem] font-bold">Question<input value={editingQ?.prompt ?? ""} onChange={(e) => setEditingQ((p) => (p ? { ...p, prompt: e.target.value } : p))} className="input-base mt-1" /></label>
        <label className="flex items-center gap-2 text-[0.8rem] font-bold mt-3 cursor-pointer">
          <input type="checkbox" checked={editingQ?.required ?? true} onChange={(e) => setEditingQ((p) => (p ? { ...p, required: e.target.checked } : p))} className="w-4 h-4 accent-[#1769AA]" />
          Required
        </label>
        <Button className="w-full mt-4" onClick={() => preview && editingQ && void run(async () => { await updateQuestionnaireQuestion(preview.id, editingQ.id, { prompt: editingQ.prompt.trim(), required: editingQ.required }); setEditingQ(null); const detail = await fetchQuestionnaireDetail(preview.id); setPreviewDetail(detail); })}>Save</Button>
      </Modal>
    </div>
  );
}
