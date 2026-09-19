import { useState } from "react";
import { Copy, Eye, Plus } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { Button, EmptyState, StatusBadge } from "../../components/common/ui";
import { Drawer, Modal, ResponsiveTable } from "../../components/common/Modal";
import type { Questionnaire } from "../../types";
import type { QuestionnaireDetail } from "../../api";

export default function QuestionnairesPage() {
  const { questionnaires, duplicateQuestionnaire, toggleQuestionnaire, createQuestionnaire, fetchQuestionnaireDetail, live, loading, backendError, refreshAll } = useAdmin();
  const [preview, setPreview] = useState<Questionnaire | null>(null);
  const [previewDetail, setPreviewDetail] = useState<QuestionnaireDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
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

  const previewFields = (previewDetail?.questions ?? []).map((f) => ({
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
              <p className="text-sm text-ink-secondary mt-2">No questions in this form yet.</p>
            ) : (
              <div className="mt-2 space-y-3">
                {previewFields.map((f, i) => (
                  <div key={i} className="bg-white border border-border rounded-control p-3.5">
                    <p className="font-bold text-[0.88rem]">{i + 1}. {f.question} {f.required && <span className="text-danger text-[0.72rem]">Required</span>}</p>
                    <p className="text-[0.75rem] text-ink-secondary mt-0.5">{f.type}</p>
                    {f.type === "Yes/No" && <div className="grid grid-cols-2 gap-1.5 mt-2">{["Yes", "No"].map((o) => <span key={o} className="border border-border rounded-lg py-2 text-center text-sm font-semibold">{o}</span>)}</div>}
                    {(f.type === "Single choice" || f.type === "Multiple choice") && <div className="space-y-1.5 mt-2">{(f.options ?? ["Option A", "Option B"]).map((o) => <span key={o} className="block border border-border rounded-lg px-3 py-2 text-sm">{o}</span>)}</div>}
                    {(f.type === "Short text" || f.type === "Long text" || f.type === "Numeric" || f.type === "Date") && <div className="border border-border rounded-lg px-3 py-2.5 text-sm text-ink-faint mt-2">Patient answer field</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create questionnaire">
        <label className="block text-[0.83rem] font-bold">Name<input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Orthopedics Pre-visit" className="input-base mt-1" /></label>
        <Button className="w-full mt-4" disabled={!newName.trim()} onClick={() => void run(async () => { await createQuestionnaire(newName.trim()); setNewName(""); setCreateOpen(false); })}>Create draft</Button>
      </Modal>
    </div>
  );
}
