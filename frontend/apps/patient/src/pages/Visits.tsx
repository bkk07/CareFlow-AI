import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  apiError,
  type Appointment,
  type AppointmentDetail,
  type Questionnaire,
  type QuestionnaireResponse,
} from "../api";

const LIVE = ["confirmed", "rescheduled", "sync_pending", "reconciliation_required"];

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Visits() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [form, setForm] = useState<Questionnaire | null>(null);
  const [formState, setFormState] = useState<"unknown" | "none" | "ready">("unknown");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState<QuestionnaireResponse[]>([]);
  const [rescheduling, setRescheduling] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<Appointment[]>("/appointments");
      setItems(data.sort((a, b) => b.slot_start.localeCompare(a.slot_start)));
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function showDetail(id: string) {
    setError(null);
    setNotice(null);
    setRescheduling(false);
    try {
      const [{ data }, formRes] = await Promise.all([
        api.get<AppointmentDetail>(`/appointments/${id}`),
        api.get<{ questionnaire: Questionnaire | null }>(
          `/appointments/${id}/questionnaire`,
        ),
      ]);
      setDetail(data);
      if (formRes.data.questionnaire) {
        setForm(formRes.data.questionnaire);
        setFormState("ready");
        const initial: Record<string, unknown> = {};
        for (const q of formRes.data.questionnaire.questions) {
          if (q.type === "multi_choice") initial[q.id] = [];
          else if (q.type === "yes_no") initial[q.id] = false;
          else initial[q.id] = "";
        }
        setAnswers(initial);
        const { data: existing } = await api.get<QuestionnaireResponse[]>(
          `/appointments/${id}/questionnaire/responses`,
        );
        setSaved(existing);
      } else {
        setForm(null);
        setFormState("none");
        setSaved([]);
      }
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function cancel(id: string) {
    setError(null);
    try {
      await api.post(`/appointments/${id}/cancel`, {});
      setDetail(null);
      setNotice("Visit cancelled.");
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  async function reschedule(id: string) {
    setError(null);
    try {
      await api.post(`/appointments/${id}/reschedule`, {
        slot_start: new Date(`${newStart}:00Z`).toISOString(),
        slot_end: new Date(`${newEnd}:00Z`).toISOString(),
      });
      setRescheduling(false);
      setNotice("Visit moved.");
      await showDetail(id);
      await refresh();
    } catch (e) {
      setError(apiError(e));
    }
  }

  function setAnswer(id: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  async function submitAnswers() {
    if (!detail) return;
    setError(null);
    try {
      const { data } = await api.post(
        `/appointments/${detail.id}/questionnaire/responses`,
        { answers },
      );
      setNotice(
        data.completed
          ? data.flagged
            ? "Submitted — flagged for the care team to review."
            : "Questionnaire complete. Thank you!"
          : "Progress saved — a few required answers remain.",
      );
      const { data: existing } = await api.get<QuestionnaireResponse[]>(
        `/appointments/${detail.id}/questionnaire/responses`,
      );
      setSaved(existing);
    } catch (e) {
      setError(apiError(e));
    }
  }

  const upcoming = items.filter((a) => LIVE.includes(a.state));
  const past = items.filter((a) => !LIVE.includes(a.state));

  function visitRow(a: Appointment, action: string) {
    return (
      <div className="row-item" key={a.id}>
        <span className={`pill pill-${a.state}`}>{a.state.replace(/_/g, " ")}</span>
        <div className="grow">
          <p className="title">{fmt(a.slot_start)}</p>
        </div>
        <button className="btn btn-sm" onClick={() => void showDetail(a.id)}>
          {action}
        </button>
      </div>
    );
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <div className="card">
        <div className="section-head" style={{ marginTop: 0 }}>
          <h2>Upcoming visits ({loading ? "…" : upcoming.length})</h2>
          <Link className="btn btn-sm btn-primary" to="/">
            + Book a visit
          </Link>
        </div>
        {loading ? (
          <div aria-live="polite">
            {[0, 1].map((i) => (
              <div className="skeleton-row" key={i}>
                <div className="skeleton" style={{ width: 90, height: 24, borderRadius: 999 }} />
                <div className="skeleton" style={{ flex: 1 }} />
              </div>
            ))}
          </div>
        ) : upcoming.length > 0 ? (
          <div className="row-list">{upcoming.map((a) => visitRow(a, "Manage"))}</div>
        ) : (
          <div className="empty">
            <div className="empty-icon" aria-hidden>
              ◷
            </div>
            <h3>Nothing scheduled</h3>
            <p>Book your next visit in under a minute.</p>
            <Link className="btn btn-primary" to="/">
              Find care
            </Link>
          </div>
        )}
      </div>

      {detail && (
        <div className="card">
          <div className="section-head" style={{ marginTop: 0 }}>
            <h3>Visit details</h3>
            <button className="btn btn-sm btn-ghost" onClick={() => setDetail(null)}>
              Close ✕
            </button>
          </div>
          <p>
            <span className={`pill pill-${detail.state}`}>{detail.state.replace(/_/g, " ")}</span>{" "}
            <strong>{fmt(detail.slot_start)}</strong> –{" "}
            {new Date(detail.slot_end).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
          {(detail.state === "confirmed" || detail.state === "rescheduled") && (
            <div className="toolbar">
              <button className="btn btn-danger btn-sm" onClick={() => void cancel(detail.id)}>
                Cancel visit
              </button>
              <button className="btn btn-sm" onClick={() => setRescheduling((v) => !v)}>
                Reschedule
              </button>
            </div>
          )}
          {rescheduling && (
            <div className="form-row" style={{ maxWidth: 640 }}>
              <div className="field">
                <label>New start</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                />
              </div>
              <div className="field">
                <label>New end</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                />
              </div>
              <div className="field">
                <button
                  className="btn btn-primary"
                  onClick={() => void reschedule(detail.id)}
                  disabled={!newStart || !newEnd}
                >
                  Move visit
                </button>
              </div>
            </div>
          )}
          <h4>History</h4>
          {detail.history.length > 0 ? (
            <div className="row-list">
              {detail.history.map((h) => (
                <div className="row-item" key={h.id}>
                  <span className={`pill pill-${h.to_state}`}>{h.to_state.replace(/_/g, " ")}</span>
                  <div className="grow">
                    <p className="sub">
                      {h.from_state.replace(/_/g, " ")} → {h.to_state.replace(/_/g, " ")}
                      {h.reason ? ` · ${h.reason}` : ""}
                    </p>
                  </div>
                  <span className="muted" style={{ fontSize: "0.83rem" }}>
                    {new Date(h.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No transitions recorded.</p>
          )}

          {formState === "ready" && form && (
            <>
              <h4>Pre-visit questions — {form.name}</h4>
              {form.questions.map((q) => (
                <div className="field" key={q.id} style={{ maxWidth: 560 }}>
                  <label>
                    {q.prompt} {q.required ? "" : "(optional)"}
                  </label>
                  {q.type === "yes_no" && (
                    <select
                      className="select"
                      value={String(answers[q.id] ?? false)}
                      onChange={(e) => setAnswer(q.id, e.target.value === "true")}
                    >
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                  )}
                  {q.type === "choice" && (
                    <select
                      className="select"
                      value={String(answers[q.id] ?? "")}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    >
                      <option value="">Select…</option>
                      {(q.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  )}
                  {q.type === "multi_choice" &&
                    (q.options ?? []).map((o) => (
                      <label key={o} style={{ marginRight: "0.75rem", fontWeight: 400 }}>
                        <input
                          type="checkbox"
                          checked={((answers[q.id] as string[]) ?? []).includes(o)}
                          onChange={(e) => {
                            const cur = ((answers[q.id] as string[]) ?? []).slice();
                            setAnswer(
                              q.id,
                              e.target.checked ? [...cur, o] : cur.filter((x) => x !== o),
                            );
                          }}
                        />{" "}
                        {o}
                      </label>
                    ))}
                  {q.type === "numeric" && (
                    <input
                      className="input"
                      type="number"
                      value={String(answers[q.id] ?? "")}
                      onChange={(e) =>
                        setAnswer(q.id, e.target.value === "" ? "" : Number(e.target.value))
                      }
                    />
                  )}
                  {q.type === "date" && (
                    <input
                      className="input"
                      type="date"
                      value={String(answers[q.id] ?? "")}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    />
                  )}
                  {(q.type === "short_text" || q.type === "long_text") &&
                    (q.type === "short_text" ? (
                      <input
                        className="input"
                        style={{ width: "100%" }}
                        value={String(answers[q.id] ?? "")}
                        onChange={(e) => setAnswer(q.id, e.target.value)}
                      />
                    ) : (
                      <textarea
                        className="input"
                        rows={3}
                        value={String(answers[q.id] ?? "")}
                        onChange={(e) => setAnswer(q.id, e.target.value)}
                      />
                    ))}
                  {q.type === "structured" && (
                    <p className="muted">Structured answers are collected via the assistant.</p>
                  )}
                </div>
              ))}
              <button className="btn btn-primary" onClick={() => void submitAnswers()}>
                Save answers
              </button>
              {saved.length > 0 && (
                <p className="muted">
                  Last saved: {saved[0].completed ? "complete" : "draft"} ·{" "}
                  {saved[0].completed_at
                    ? new Date(saved[0].completed_at).toLocaleString()
                    : "in progress"}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>Past visits ({past.length})</h2>
        {past.length > 0 ? (
          <div className="row-list">{past.map((a) => visitRow(a, "View"))}</div>
        ) : (
          <p className="muted">No past visits yet.</p>
        )}
      </div>
    </>
  );
}
