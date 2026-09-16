import { useCallback, useEffect, useState } from "react";
import {
  api,
  apiError,
  type Appointment,
  type AppointmentDetail,
  type Questionnaire,
  type QuestionnaireResponse,
} from "../api";

const LIVE = ["confirmed", "rescheduled", "sync_pending", "reconciliation_required"];

function statePill(state: string): string {
  return `pill pill-${state}`;
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

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<Appointment[]>("/appointments");
      setItems(data.sort((a, b) => b.slot_start.localeCompare(a.slot_start)));
    } catch (e) {
      setError(apiError(e));
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

  return (
    <>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <div className="card">
        <h2>Upcoming visits ({upcoming.length})</h2>
        {upcoming.map((a) => (
          <p key={a.id}>
            <span className={statePill(a.state)}>{a.state.replace(/_/g, " ")}</span>{" "}
            {new Date(a.slot_start).toLocaleString()}{" "}
            <button className="btn" onClick={() => void showDetail(a.id)}>
              Manage
            </button>
          </p>
        ))}
        {upcoming.length === 0 && <p className="muted">Nothing scheduled.</p>}
      </div>

      {detail && (
        <div className="card">
          <h3>Visit details</h3>
          <p>
            <span className={statePill(detail.state)}>{detail.state.replace(/_/g, " ")}</span>{" "}
            {new Date(detail.slot_start).toLocaleString()} –{" "}
            {new Date(detail.slot_end).toLocaleTimeString()}
          </p>
          {(detail.state === "confirmed" || detail.state === "rescheduled") && (
            <p>
              <button className="btn btn-danger" onClick={() => void cancel(detail.id)}>
                Cancel visit
              </button>{" "}
              <button className="btn" onClick={() => setRescheduling((v) => !v)}>
                Reschedule
              </button>
            </p>
          )}
          {rescheduling && (
            <div>
              <input
                className="input"
                type="datetime-local"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
              />
              <input
                className="input"
                type="datetime-local"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
              />
              <button
                className="btn btn-primary"
                onClick={() => void reschedule(detail.id)}
                disabled={!newStart || !newEnd}
              >
                Move visit
              </button>
            </div>
          )}
          <h4>History</h4>
          <ul>
            {detail.history.map((h) => (
              <li key={h.id}>
                {h.from_state} → {h.to_state}
                {h.reason ? ` (${h.reason})` : ""} · {new Date(h.created_at).toLocaleString()}
              </li>
            ))}
            {detail.history.length === 0 && <li>No transitions recorded.</li>}
          </ul>

          {formState === "ready" && form && (
            <>
              <h4>Pre-visit questions — {form.name}</h4>
              {form.questions.map((q) => (
                <div className="field" key={q.id}>
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
                      <label key={o} style={{ marginRight: "0.75rem" }}>
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
                        value={String(answers[q.id] ?? "")}
                        onChange={(e) => setAnswer(q.id, e.target.value)}
                      />
                    ) : (
                      <textarea
                        className="input"
                        rows={3}
                        style={{ width: "100%" }}
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
          <p>
            <button className="btn" onClick={() => setDetail(null)}>
              Close
            </button>
          </p>
        </div>
      )}

      <div className="card">
        <h2>Past visits ({past.length})</h2>
        {past.map((a) => (
          <p key={a.id}>
            <span className={statePill(a.state)}>{a.state.replace(/_/g, " ")}</span>{" "}
            {new Date(a.slot_start).toLocaleString()}{" "}
            <button className="btn" onClick={() => void showDetail(a.id)}>
              View
            </button>
          </p>
        ))}
        {past.length === 0 && <p className="muted">No past visits.</p>}
      </div>
    </>
  );
}
