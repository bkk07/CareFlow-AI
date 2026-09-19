import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Clock, FileText } from "lucide-react";
import { useSchedule } from "../context/ScheduleContext";
import { CardSkeleton, EmptyState, ErrorState, StatusBadge } from "../components/common/ui";
import { Tabs } from "../components/common/Modal";

type Filter = "all" | "completed" | "pending";

export default function QuestionnairesPage() {
  const { questionnaires, loading, error, refresh } = useSchedule();
  const [params] = useSearchParams();
  const focusId = params.get("appointment");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(
    focusId ? (questionnaires.find((q) => q.appointmentId === focusId)?.id ?? null) : null,
  );

  const visible = useMemo(
    () => questionnaires.filter((q) => (filter === "all" ? true : filter === "completed" ? q.status === "completed" : q.status !== "completed")),
    [questionnaires, filter],
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="page-title">Pre-visit questionnaires</h1>
        <p className="page-sub mt-1">Patient-provided administrative information — no diagnosis or clinical scoring.</p>
      </div>

      <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
        {loading ? "Syncing responses…" : "Live responses from your appointments"}
      </p>

      {error && <ErrorState title="Could not load questionnaires" body={error} onRetry={() => void refresh()} />}

      <div className="card-base px-2">
        <Tabs<Filter>
          tabs={[{ id: "all", label: "All", count: questionnaires.length }, { id: "completed", label: "Completed" }, { id: "pending", label: "Pending" }]}
          active={filter}
          onChange={setFilter}
        />
      </div>

      {loading && visible.length === 0 && !error ? (
        <div className="space-y-3">
          <CardSkeleton lines={3} />
        </div>
      ) : visible.length === 0 ? (
        <div className="card-base"><EmptyState title="No questionnaires pending" body="New patient responses will appear here before each visit." /></div>
      ) : (
        <div className="space-y-3">
          {visible.map((q) => {
            const open = openId === q.id;
            return (
              <article key={q.id} className="card-base p-5">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${q.status === "completed" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
                      {q.status === "completed" ? <CheckCircle2 size={18} /> : q.status === "assigned" ? <FileText size={18} /> : <Clock size={18} />}
                    </span>
                    <div>
                      <p className="font-bold text-ink">{q.patientName}</p>
                      <p className="text-[0.8rem] text-ink-secondary">{q.name}{q.completedAt ? ` · Completed ${q.completedAt}` : ""}</p>
                    </div>
                  </div>
                  <StatusBadge status={q.status} />
                </div>
                {q.status === "completed" ? (
                  <>
                    <button onClick={() => setOpenId(open ? null : q.id)} aria-expanded={open} className="mt-3 text-[0.83rem] font-bold text-healthcare hover:underline">
                      {open ? "Hide responses" : "View responses"}
                    </button>
                    {open && (
                      <dl className="mt-3 border border-border rounded-control overflow-hidden">
                        {q.answers.map((a, i) => (
                          <div key={i} className={`px-4 py-3 text-sm ${i % 2 === 0 ? "bg-white" : "bg-background/60"}`}>
                            <dt className="text-ink-secondary text-[0.8rem] font-semibold">{a.question}</dt>
                            <dd className="font-semibold text-ink mt-0.5">Patient response: {a.response}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </>
                ) : (
                  <p className="mt-3 text-[0.83rem] text-ink-secondary bg-background border border-border rounded-control px-3.5 py-2.5">
                    {q.status === "assigned" ? "Questionnaire pending — patient has not started it yet." : "In progress — partial responses received."}
                  </p>
                )}
                <Link to={`/appointments/${q.appointmentId}`} className="inline-flex items-center gap-1 text-[0.83rem] font-bold text-healthcare hover:underline mt-3">
                  Open appointment <ArrowRight size={14} />
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
