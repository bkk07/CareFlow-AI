import { useEffect, useState } from "react";
import {
  fetchAppointmentQuestionnaire,
  fetchQuestionnaireResponses,
  type Questionnaire as ApiQuestionnaire,
} from "../api";
import type { QuestionnaireQuestion } from "../types";

export interface QuestionnaireStatus {
  hasForm: boolean;
  completed: boolean;
  answered: number;
  total: number;
  loading: boolean;
}

export function mapApiQuestions(q: ApiQuestionnaire): QuestionnaireQuestion[] {
  return q.questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      id: item.id,
      order: item.order,
      type: (item.type === "choice" ? "single_choice" : item.type) as QuestionnaireQuestion["type"],
      prompt: item.prompt,
      options: item.options ?? undefined,
      required: item.required,
    }));
}

export function hasValue(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object")
    return Object.values(v as Record<string, unknown>).some(
      (x) => x !== undefined && x !== null && x !== "",
    );
  return true;
}

export function countAnswered(
  questions: QuestionnaireQuestion[],
  answers: Record<string, unknown>,
): number {
  return questions.filter((q) => hasValue(answers[q.id])).length;
}

export function resumeIndexFor(
  questions: QuestionnaireQuestion[],
  answers: Record<string, unknown>,
): number {
  const i = questions.findIndex((q) => q.required && !hasValue(answers[q.id]));
  return i === -1 ? 0 : i;
}

/** Session-wide cache: one appointment's form status is fetched once,
 *  then shared by Home, Visits and the detail modal. */
const statusCache = new Map<string, QuestionnaireStatus>();

async function loadStatus(appointmentId: string): Promise<QuestionnaireStatus> {
  const form = await fetchAppointmentQuestionnaire(appointmentId);
  if (!form) return { hasForm: false, completed: false, answered: 0, total: 0, loading: false };
  const mapped = mapApiQuestions(form);
  const empty = { hasForm: true, completed: false, answered: 0, total: mapped.length, loading: false };
  try {
    const responses = await fetchQuestionnaireResponses(appointmentId);
    const latest = responses[responses.length - 1];
    if (!latest) return empty;
    const saved = (latest.answers ?? {}) as Record<string, unknown>;
    return {
      hasForm: true,
      completed: !!latest.completed,
      answered: countAnswered(mapped, saved),
      total: mapped.length,
      loading: false,
    };
  } catch {
    // No saved draft yet — the form is still startable.
    return empty;
  }
}

/** Form status for a set of appointments. Failed loads resolve to
 *  "no form" so cards stay quiet instead of flashing errors. */
export function useQuestionnaireStatuses(ids: string[], enabled: boolean): Record<string, QuestionnaireStatus> {
  const key = ids.join(",");
  const [map, setMap] = useState<Record<string, QuestionnaireStatus>>({});

  useEffect(() => {
    if (!enabled || ids.length === 0) return;
    let cancelled = false;
    const list = key.split(",").filter(Boolean);
    setMap((prev) => {
      const next = { ...prev };
      for (const id of list) {
        next[id] = statusCache.get(id) ?? { hasForm: false, completed: false, answered: 0, total: 0, loading: !statusCache.has(id) };
      }
      return next;
    });
    const missing = list.filter((id) => !statusCache.has(id));
    if (missing.length === 0) return;
    void Promise.all(
      missing.map(async (id) => {
        try {
          statusCache.set(id, await loadStatus(id));
        } catch {
          statusCache.set(id, { hasForm: false, completed: false, answered: 0, total: 0, loading: false });
        }
      }),
    ).then(() => {
      if (cancelled) return;
      setMap((prev) => {
        const next = { ...prev };
        for (const id of list) {
          const cached = statusCache.get(id);
          if (cached) next[id] = cached;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return map;
}
