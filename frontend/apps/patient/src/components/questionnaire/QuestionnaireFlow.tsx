import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import type { Appointment, QuestionnaireQuestion } from "../../types";
import { Button } from "../common/ui";

export function QuestionnaireFlow({
  questions,
  initialAnswers,
  onComplete,
}: {
  questions: QuestionnaireQuestion[];
  initialAnswers?: Record<string, unknown>;
  onComplete: (answers: Record<string, unknown>) => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers ?? {});
  const [done, setDone] = useState(false);
  const q = questions[index];
  const total = questions.length;

  function setAnswer(id: string, v: unknown) {
    setAnswers((prev) => ({ ...prev, [id]: v }));
  }

  function canContinue(): boolean {
    if (!q.required) return true;
    const v = answers[q.id];
    if (v === undefined || v === null || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.values(v as Record<string, unknown>).some((x) => x);
    return true;
  }

  if (done) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className="w-16 h-16 mx-auto rounded-full bg-success-soft text-success flex items-center justify-center mb-3"
        >
          <CheckCircle2 size={30} />
        </motion.div>
        <h3 className="font-bold text-ink">Responses submitted</h3>
        <p className="text-sm text-ink-secondary mt-1">The care team will have this before your visit.</p>
      </motion.div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between text-[0.8rem] font-semibold text-ink-secondary mb-1.5">
        <span>
          Question {index + 1} of {total}
        </span>
        <span>{Math.round(((index + 1) / total) * 100)}%</span>
      </div>
      <div className="h-2 bg-background border border-border rounded-full overflow-hidden mb-5" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={total}>
        <motion.div
          className="h-full bg-healthcare rounded-full"
          animate={{ width: `${((index + 1) / total) * 100}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={q.id}
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -18 }}
          transition={{ duration: 0.22 }}
        >
          <h3 className="font-bold text-ink leading-snug">{q.prompt}</h3>
          {q.helper && <p className="text-[0.83rem] text-ink-secondary mt-1">{q.helper}</p>}
          {q.required && <p className="text-[0.75rem] text-danger font-semibold mt-1">Required</p>}

          <div className="mt-4 space-y-2">
            {q.type === "yes_no" && (
              <div className="grid grid-cols-2 gap-2">
                {["Yes", "No"].map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setAnswer(q.id, opt)}
                    aria-pressed={answers[q.id] === opt}
                    className={`min-h-[2.75rem] rounded-control border font-semibold text-sm transition ${
                      answers[q.id] === opt
                        ? "bg-navy text-white border-navy"
                        : "bg-white border-border hover:border-healthcare"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            {q.type === "single_choice" &&
              q.options?.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setAnswer(q.id, opt)}
                  aria-pressed={answers[q.id] === opt}
                  className={`w-full text-left px-4 py-3 rounded-control border text-sm font-medium transition ${
                    answers[q.id] === opt
                      ? "bg-healthcare-soft border-healthcare text-navy"
                      : "bg-white border-border hover:border-healthcare"
                  }`}
                >
                  {opt}
                </button>
              ))}
            {q.type === "multi_choice" &&
              q.options?.map((opt) => {
                const arr = (answers[q.id] as string[] | undefined) ?? [];
                const on = arr.includes(opt);
                return (
                  <button
                    key={opt}
                    onClick={() =>
                      setAnswer(q.id, on ? arr.filter((x) => x !== opt) : [...arr, opt])
                    }
                    aria-pressed={on}
                    className={`w-full text-left px-4 py-3 rounded-control border text-sm font-medium transition flex items-center gap-2.5 ${
                      on ? "bg-healthcare-soft border-healthcare" : "bg-white border-border hover:border-healthcare"
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs font-bold ${on ? "bg-healthcare text-white border-healthcare" : "border-border"}`}>
                      {on ? "✓" : ""}
                    </span>
                    {opt}
                  </button>
                );
              })}
            {q.type === "numeric" && (
              <input
                type="number"
                inputMode="numeric"
                className="input-base"
                placeholder="Enter a number"
                value={(answers[q.id] as string | undefined) ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
            {q.type === "date" && (
              <input
                type="date"
                className="input-base"
                value={(answers[q.id] as string | undefined) ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
            {q.type === "short_text" && (
              <input
                type="text"
                className="input-base"
                placeholder="Type your answer"
                value={(answers[q.id] as string | undefined) ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
            {q.type === "long_text" && (
              <textarea
                className="input-base min-h-[110px]"
                placeholder="Type your answer"
                value={(answers[q.id] as string | undefined) ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
            {q.type === "structured" && (
              <div className="space-y-3">
                {q.structuredFields?.map((f) => (
                  <div key={f.key}>
                    <label className="text-[0.82rem] font-semibold text-ink-secondary block mb-1">{f.label}</label>
                    <input
                      className="input-base"
                      placeholder={f.placeholder}
                      value={((answers[q.id] as Record<string, string> | undefined)?.[f.key]) ?? ""}
                      onChange={(e) =>
                        setAnswer(q.id, { ...((answers[q.id] as Record<string, string> | undefined) ?? {}), [f.key]: e.target.value })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex gap-2 mt-6">
        <Button variant="outline" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))} className="flex-1">
          Previous
        </Button>
        {index < total - 1 ? (
          <Button disabled={!canContinue()} onClick={() => setIndex((i) => i + 1)} className="flex-1">
            Next
          </Button>
        ) : (
          <Button
            disabled={!canContinue()}
            onClick={() => {
              setDone(true);
              onComplete(answers);
            }}
            className="flex-1"
          >
            Submit
          </Button>
        )}
      </div>
      <button className="w-full text-center text-[0.82rem] text-ink-secondary hover:text-healthcare font-semibold mt-3">
        Save progress
      </button>
    </div>
  );
}

export function verificationSteps(stage: Appointment["verificationStage"]): string {
  return stage;
}
