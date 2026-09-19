import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, ChevronRight, FlaskConical, Play } from "lucide-react";
import {
  checkAvailability as apiCheckAvailability,
  listAppointmentTypes as apiListTypes,
  searchDoctors as apiSearchDoctors,
} from "../api";
import { Button } from "../components/common/ui";

interface Step {
  id: string;
  label: string;
  detail: string;
  latency: string;
}

const INITIAL: Step[] = [
  { id: "intent", label: "Intent detected", detail: "press Run live to resolve intent", latency: "—" },
  { id: "context", label: "Context loaded", detail: "press Run live to load session context", latency: "—" },
  { id: "search", label: "Doctor search", detail: "not run yet", latency: "—" },
  { id: "avail", label: "Availability check", detail: "not run yet", latency: "—" },
  { id: "create", label: "Appointment create skipped", detail: "debug page never books — use Book to create a real visit", latency: "—" },
  { id: "verify", label: "External verification (simulated)", detail: "verify_external_appointment → not executed from debug", latency: "—" },
  { id: "sync", label: "State synchronized (simulated)", detail: "no writes were made", latency: "—" },
];

function ms(t0: number): string {
  return `${Math.max(1, Math.round(performance.now() - t0))} ms`;
}

export default function ChatDebugPage() {
  const [steps, setSteps] = useState<Step[]>(INITIAL);
  const [played, setPlayed] = useState<boolean[]>(INITIAL.map(() => false));
  const [running, setRunning] = useState(false);

  function reveal(i: number, patch?: Partial<Step>) {
    if (patch) setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    setPlayed((prev) => {
      const next = [...prev];
      next[i] = true;
      return next;
    });
  }

  async function run() {
    setRunning(true);
    setSteps(INITIAL);
    setPlayed(INITIAL.map(() => false));
    // Live: execute the read-only capabilities for real; booking + verify +
    // sync stay simulated so the debug page never writes data.
    try {
      reveal(0, { detail: "“cardiology this week” → specialty=Cardiology, range=7d · live", latency: "local" });
      reveal(1, { detail: "live session · patient JWT · preferences applied server-side", latency: "local" });
      let t0 = performance.now();
      const doctors = await apiSearchDoctors({ specialty: "Cardiology" });
      const first = doctors[0];
      reveal(2, {
        label: "Doctor search completed (live)",
        detail: `${doctors.length} cardiology result(s)${first ? ` · ${first.name} · ${first.hospital_name}` : ""}`,
        latency: ms(t0),
      });
      if (first) {
        const types = await apiListTypes(first.hospital_id);
        const type = types[0];
        if (type) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const day = tomorrow.toISOString().slice(0, 10);
          t0 = performance.now();
          const slots = await apiCheckAvailability({
            doctor_id: first.id,
            appointment_type_id: type.id,
            date_from: day,
            date_to: day,
          });
          reveal(3, {
            label: "Availability checked (live)",
            detail: `${first.name} · ${slots.length} open slot(s) · ${day}`,
            latency: ms(t0),
          });
        } else {
          reveal(3, { label: "Availability checked (live)", detail: "hospital has no visit types configured", latency: ms(t0) });
        }
      } else {
        reveal(3, { label: "Availability checked (live)", detail: "no cardiology results to check", latency: "—" });
      }
      reveal(4);
      reveal(5);
      reveal(6);
    } catch {
      reveal(2, { label: "Doctor search failed", detail: "backend error — check the connection and try again", latency: "—" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[0.76rem] font-bold uppercase tracking-widest text-teal-dark flex items-center gap-1.5">
            <FlaskConical size={14} /> Developer tool
          </p>
          <h1 className="page-title mt-1">Chat debug</h1>
          <p className="page-sub mt-1">
            Live run: search + availability execute for real; writes stay simulated.
          </p>
        </div>
        <Button onClick={() => void run()} disabled={running}>
          <Play size={15} /> {running ? "Running…" : "Run live"}
        </Button>
      </div>

      <div className="grid md:grid-cols-[1fr_300px] gap-4 items-start">
        <div className="card-base p-5">
          <h2 className="section-title">Conversation events</h2>
          <ol className="mt-4 space-y-0">
            {steps.map((t, i) => (
              <li key={t.id} className="flex gap-3 pb-4 last:pb-0 relative">
                {i < steps.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-border" aria-hidden />}
                <motion.span
                  initial={false}
                  animate={{ scale: played[i] ? 1 : 0.9, opacity: played[i] ? 1 : 0.45 }}
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${played[i] ? "bg-success text-white border-success" : "bg-white text-ink-faint border-border"}`}
                >
                  {played[i] ? <CheckCircle2 size={15} /> : <span className="text-[0.7rem] font-bold">{i + 1}</span>}
                </motion.span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[0.88rem] text-ink flex items-center gap-2 flex-wrap">
                    {t.label}
                    <span className="text-[0.7rem] font-semibold text-ink-faint bg-background border border-border rounded-full px-1.5 py-0.5">{t.latency}</span>
                  </p>
                  <p className="text-[0.8rem] text-ink-secondary font-mono break-all">{t.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-3">
          <div className="card-base p-4">
            <h3 className="font-bold text-ink text-sm">Live context</h3>
            <dl className="mt-2 space-y-1.5 text-[0.8rem]">
              {[
                ["Intent", "find_cardiology (example query)"],
                ["Selected doctor", "resolved on run"],
                ["Selected slot", "resolved on run"],
                ["Action state", "read-only (no writes)"],
                ["Verification", "live reads only"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-ink-secondary">{k}</dt>
                  <dd className="font-semibold text-ink text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="card-base p-4">
            <h3 className="font-bold text-ink text-sm">Live capability execution</h3>
            <ul className="mt-2 space-y-1.5 text-[0.78rem] font-mono text-ink-secondary">
              <li>search_doctors → live</li>
              <li>check_availability → live</li>
              <li>create_appointment → skipped (no writes)</li>
              <li>verify_external_appointment → simulated</li>
              <li>synchronize_state → not executed</li>
            </ul>
            <button className="mt-2 text-[0.8rem] font-bold text-healthcare flex items-center gap-1 hover:underline">
              View full trace <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
