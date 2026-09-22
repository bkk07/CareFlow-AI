import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  LifeBuoy,
  Lock,
  Mic,
  Phone,
  Play,
  RotateCcw,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
  Workflow,
} from "lucide-react";
import { Link } from "react-router-dom";

/* ------------------------------------------------------------------ */
/* Grounded data — mirrors README / PRD / Architecture, no invented APIs */
/* ------------------------------------------------------------------ */

const CHAIN = [
  {
    title: "Patient request",
    detail: "“I need to see a doctor for my shoulder pain sometime this week.” — voice, telephone, or chat. No department codes needed.",
    tag: "web_voice · telephone · text",
  },
  {
    title: "AI understanding + context",
    detail: "Orchestrator detects admin intent, resolves AIContext (Redis, TTL 2h): intent, hospital, doctor, slot, appointment. Clarifies instead of guessing.",
    tag: "POST /chat",
  },
  {
    title: "Hospital / doctor discovery",
    detail: "Grounded candidates via search_hospitals + search_doctors — specialty, mode (in-person/video/phone), geo distance.",
    tag: "2 MCP tools",
  },
  {
    title: "Real availability",
    detail: "check_availability + GET …/slots. Calendar + weekly rules − blocked slots − bookings. 62-day window. Never invented.",
    tag: "Scheduling Engine",
  },
  {
    title: "Authorized action",
    detail: "Explicit “yes” confirmation gate, then POST /appointments with idempotency_key. FOR UPDATE lock + unique backstop → 409 on race.",
    tag: "no double-book",
  },
  {
    title: "EHR integration",
    detail: "IntegrationService → EHRConnector → Mock EHR (swappable). Mappings: patient ↔ external, doctor ↔ provider, appointment ↔ external.",
    tag: "connector protocol",
  },
  {
    title: "External verification",
    detail: "Every vendor “success” is re-read before it counts. verify_external_appointment gates the Confirmed state.",
    tag: "trust-but-verify",
  },
  {
    title: "State synchronization",
    detail: "synchronize_state moves pending / sync_pending → confirmed. Full appointment_history with correlation_id + actor.",
    tag: "10-state machine",
  },
  {
    title: "Workflow + questionnaire",
    detail: "Celery on_appointment_booked → EHR verify + reminders + pre-visit questionnaire. AI collects answers, never diagnoses.",
    tag: "event bus",
  },
  {
    title: "Doctor + admin visibility",
    detail: "Doctor agenda + hospital Ops/Analytics see the same correlation_id trace: capability, latency, verification, notification.",
    tag: "observable",
  },
] as const;

const RECOVERY_TABS = [
  {
    id: "retry",
    label: "Option A · EHR failure → recover",
    steps: ["Booking", "EHR timeout", "Failure classification", "Bounded retry", "External verification", "Synchronize", "Confirm"],
    body: "Timeouts and 5xx are retried with bounds; 4xx validation fails fast. Confirm to patient only after verified match — never optimistically.",
  },
  {
    id: "unknown",
    label: "Option B · Unknown outcome → no duplicate",
    steps: ["Booking sent", "Network timeout", "Unknown result", "Query EHR by idempotency_key", "Appointment found", "Synchronize", "Do NOT duplicate"],
    body: "The highest-value demo: query first, then sync. If the external record exists we confirm without creating a second appointment.",
  },
  {
    id: "escalate",
    label: "Option C · Unrecoverable → human",
    steps: ["EHR failure", "Retries exhausted", "External state check", "Reconciliation record", "Human escalation", "Ops dashboard resolve"],
    body: "Still unknown after bounded retries → reconciliation_required + operator Retry / Resolve / Escalate in /ops with full audit trail.",
  },
] as const;

const CAPABILITIES = [
  {
    icon: CalendarDays,
    title: "Real-availability scheduling",
    body: "Doctor active · calendar active · working hours · blocked slots · leave · existing bookings · type compatibility. Revalidated before booking.",
    meta: "MAX_RANGE_DAYS 62 · HTTP 409",
  },
  {
    icon: Bot,
    title: "AI agent, capability-bound",
    body: "20 audited MCP tools only — never direct DB/EHR. Deterministic guards: clinical decline, greeting-only, completeness + confirmation gates.",
    meta: "MAX_ITERATIONS 8 · not RAG",
  },
  {
    icon: Settings,
    title: "EHR connector + verification",
    body: "IntegrationService hides vendor details. Patient/provider/facility mapping, create/update/cancel/reschedule/retrieve/verify behind one interface.",
    meta: "Mock EHR swappable",
  },
  {
    icon: LifeBuoy,
    title: "Failure recovery queues",
    body: "Failed ops, unknown outcomes, reconciliation, escalations, retry queue, recovery history — all in /ops with correlation traces.",
    meta: "trust-but-verify",
  },
  {
    icon: Workflow,
    title: "Event workflows + reminders",
    body: "Celery worker + beat. Booking, cancellation, questionnaire, verification, escalation events trigger notifications, retries, analytics.",
    meta: "publish_event → Celery",
  },
  {
    icon: ClipboardList,
    title: "Safe pre-visit questionnaires",
    body: "Hospital/specialty/doctor/type-scoped forms. AI collects structured answers; concern-flag escalation, zero diagnostic interpretation.",
    meta: "7 question types",
  },
];

const LIFECYCLE = ["draft", "submitted", "under_review", "approved"] as const;

function TopNav() {
  return (
    <header className="sticky top-0 z-40 bg-white/92 backdrop-blur border-b border-border">
      <div className="max-w-shell mx-auto px-4 sm:px-6 h-[64px] flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2.5" aria-label="CareFlow AI home">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-healthcare to-navy text-white flex items-center justify-center font-extrabold shadow-subtle">+</span>
          <span className="leading-none">
            <span className="block font-extrabold text-navy tracking-tight">CareFlow <span className="text-healthcare">AI</span></span>
            <span className="block text-[0.62rem] font-bold uppercase tracking-widest text-ink-faint mt-0.5">Hospital Console</span>
          </span>
        </Link>
        <nav className="hidden lg:flex items-center gap-1 ml-6 text-[0.83rem] font-semibold text-ink-secondary" aria-label="Landing sections">
          {[
            ["Live chain", "#chain"],
            ["Capabilities", "#capabilities"],
            ["Recovery", "#recovery"],
            ["Onboarding", "#onboarding"],
            ["Security", "#security"],
          ].map(([label, href]) => (
            <a key={href} href={href} className="px-3 py-2 rounded-lg hover:text-healthcare hover:bg-healthcare-soft transition">{label}</a>
          ))}
        </nav>
        <div className="flex-1" />
        <span className="hidden md:inline-flex items-center gap-1.5 text-[0.72rem] font-bold text-success bg-success-soft border border-success/25 rounded-full px-2.5 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden /> API live
        </span>
        <Link to="/login" className="text-[0.84rem] font-bold text-ink-secondary hover:text-healthcare px-3 py-2">Sign in</Link>
        <Link to="/register" className="inline-flex items-center gap-1.5 bg-healthcare text-white hover:bg-healthcare-dark border border-healthcare-dark shadow-subtle rounded-control px-4 py-2 text-[0.85rem] font-bold transition">
          Register hospital <ArrowRight size={15} />
        </Link>
      </div>
    </header>
  );
}

function HeroConsole() {
  return (
    <div className="relative" aria-label="Console preview">
      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-white border border-border rounded-card shadow-card overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-background/60">
          <span className="w-2.5 h-2.5 rounded-full bg-danger/70" aria-hidden />
          <span className="w-2.5 h-2.5 rounded-full bg-warning/80" aria-hidden />
          <span className="w-2.5 h-2.5 rounded-full bg-success/80" aria-hidden />
          <p className="ml-2 text-[0.76rem] font-bold text-ink-secondary">Hospital Overview · St. Mary&apos;s General</p>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[0.68rem] font-bold text-success bg-success-soft rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden /> Live
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 p-4">
          {[
            ["24 / 31", "doctors active"],
            ["18", "today"],
            ["132", "upcoming"],
            ["2 open", "reconciliations"],
          ].map(([v, l]) => (
            <div key={l} className="bg-background border border-border/70 rounded-xl px-3 py-2.5">
              <p className="font-extrabold text-navy tabular-nums leading-none">{v}</p>
              <p className="text-[0.66rem] font-semibold text-ink-faint mt-1">{l}</p>
            </div>
          ))}
        </div>
        <ul className="px-4 pb-2 divide-y divide-border/70 text-left">
          {[
            ["09:30 · A. Sharma", "Dr. Rao · Cardiology", "confirmed"],
            ["10:15 · J. D’Souza", "Dr. Iyer · Ortho · pre-visit ✓", "pending"],
            ["11:00 · R. Khan", "Dr. Rao · Follow-up", "sync_pending"],
          ].map(([a, b, s]) => (
            <li key={a} className="py-2 flex items-center justify-between gap-2 text-[0.78rem]">
              <span><span className="font-bold block">{a}</span><span className="text-ink-secondary">{b}</span></span>
              <span className={`font-bold px-2 py-0.5 rounded-full ${s === "confirmed" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>{s.replace("_", " ")}</span>
            </li>
          ))}
        </ul>
        <div className="m-4 mt-2 bg-navy text-white rounded-xl p-3.5 font-mono text-[0.68rem] leading-relaxed">
          <p className="text-white/60">correlation 8f3a…c1 · capability trace</p>
          <p><span className="text-teal-soft">create_appointment</span> → <span className="text-teal-soft">verify_external</span> → <span className="text-teal-soft">synchronize_state</span></p>
          <p className="text-success-soft">✓ verified · 212 ms · no duplicate</p>
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
        className="absolute -left-3 sm:-left-6 top-16 bg-white border border-border rounded-xl shadow-card px-3 py-2 flex items-center gap-2 text-[0.74rem] font-bold"
      >
        <CheckCircle2 size={15} className="text-success" /> EHR verified before confirm
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="absolute -right-3 sm:-right-5 bottom-20 bg-white border border-border rounded-xl shadow-card px-3 py-2 flex items-center gap-2 text-[0.74rem] font-bold"
      >
        <ShieldCheck size={15} className="text-healthcare" /> 409 race-safe · no double-book
      </motion.div>
    </div>
  );
}

export default function LandingPage() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [recovery, setRecovery] = useState<(typeof RECOVERY_TABS)[number]["id"]>("unknown");

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setActive((a) => (a + 1) % CHAIN.length), 2400);
    return () => window.clearInterval(t);
  }, [playing]);

  const recoveryTab = useMemo(() => RECOVERY_TABS.find((t) => t.id === recovery)!, [recovery]);
  const step = CHAIN[active];

  return (
    <div className="min-h-screen bg-background text-ink font-sans antialiased">
      <TopNav />

      {/* ---------------- HERO ---------------- */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-navy via-healthcare-dark to-healthcare" aria-hidden />
        <div className="absolute inset-0 opacity-[0.14]" aria-hidden
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "26px 26px" }} />
        <div className="relative max-w-shell mx-auto px-4 sm:px-6 pt-12 pb-16 lg:pt-16 lg:pb-20 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
          <div>
            <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 text-[0.72rem] font-bold uppercase tracking-widest text-white bg-white/15 border border-white/25 rounded-full px-3 py-1.5">
              <Building2 size={13} /> Multi-tenant · AI-native · Trust-but-verify
            </motion.p>
            <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
              className="text-white font-extrabold tracking-tight leading-[1.05] text-[2.1rem] sm:text-[2.9rem] mt-4">
              Run your hospital&apos;s scheduling truth — not just another dashboard.
            </motion.h1>
            <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
              className="text-white/85 text-[1rem] sm:text-[1.08rem] leading-relaxed mt-4 max-w-[56ch]">
              CareFlow AI gives hospital admins one console for catalog, doctors, real availability,
              AI oversight, EHR verification, workflows, analytics, and recovery — so a patient saying
              “shoulder pain this week” becomes a <strong className="text-white">verified booking</strong>, not a phone queue.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="flex flex-wrap gap-2.5 mt-6">
              <Link to="/register" className="inline-flex items-center gap-2 bg-white text-navy font-extrabold rounded-control px-5 py-3 text-[0.92rem] hover:bg-healthcare-soft transition shadow-card">
                Register hospital <ArrowRight size={16} />
              </Link>
              <Link to="/login" className="inline-flex items-center gap-2 text-white font-bold rounded-control px-5 py-3 text-[0.92rem] border border-white/40 hover:bg-white/10 transition">
                Sign in to console
              </Link>
              <a href="#chain" className="inline-flex items-center gap-2 text-white/85 font-semibold rounded-control px-4 py-3 text-[0.88rem] hover:text-white transition">
                <Play size={15} /> Watch the live chain
              </a>
            </motion.div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-8">
              {[
                ["62-day", "real-availability window"],
                ["10-state", "appointment lifecycle"],
                ["20", "audited AI tools"],
                ["409", "race-safe, no double-book"],
              ].map(([v, l]) => (
                <div key={l} className="bg-white/10 border border-white/20 rounded-xl px-3.5 py-3">
                  <dt className="text-white font-extrabold text-[1.25rem] leading-none tabular-nums">{v}</dt>
                  <dd className="text-white/70 text-[0.72rem] font-semibold mt-1">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <HeroConsole />
        </div>
        <div className="relative max-w-shell mx-auto px-4 sm:px-6 pb-8">
          <div className="bg-white/10 border border-white/20 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-white/80 text-[0.78rem] font-semibold">
            <span className="flex items-center gap-1.5"><Mic size={14} /> Web voice</span>
            <span className="flex items-center gap-1.5"><Phone size={14} /> Twilio telephone</span>
            <span className="flex items-center gap-1.5"><Bot size={14} /> Text chat + widgets</span>
            <span className="flex items-center gap-1.5"><Lock size={14} /> JWT · Argon2 · RBAC</span>
            <span className="flex items-center gap-1.5"><Activity size={14} /> correlation_id everywhere</span>
          </div>
        </div>
      </section>

      {/* ---------------- PLATFORM STRIP ---------------- */}
      <section className="border-b border-border bg-white" aria-label="Platform">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center gap-2.5 text-[0.78rem] font-bold">
          <span className="text-ink-faint uppercase tracking-widest text-[0.66rem] mr-1">One backend · five role apps</span>
          {["Patient :5173", "Doctor :5177", "Hospital :5174", "Ops :5176", "Platform :5178"].map((s) => (
            <span key={s} className="bg-background border border-border rounded-full px-3 py-1.5 text-ink-secondary">{s}</span>
          ))}
          <span className="bg-navy text-white rounded-full px-3 py-1.5">FastAPI · Postgres 16 · Redis · Celery</span>
        </div>
      </section>

      {/* ---------------- LIVE CHAIN ---------------- */}
      <section id="chain" className="max-w-shell mx-auto px-4 sm:px-6 py-12 sm:py-16 scroll-mt-20">
        <p className="text-[0.7rem] font-bold uppercase tracking-widest text-healthcare">Product goal · the chain that matters</p>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-2">
          <div className="max-w-[62ch]">
            <h2 className="page-title">One patient sentence, ten coordinated steps.</h2>
            <p className="page-sub mt-2">The AI coordinates — it never diagnoses. Press play and watch a request flow from voice to verified booking to doctor review. This is the PRD §2 chain, live.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPlaying((v) => !v)} className="inline-flex items-center gap-1.5 bg-white border border-border rounded-control px-4 py-2 text-[0.84rem] font-bold hover:border-healthcare hover:text-healthcare transition" aria-pressed={playing}>
              {playing ? "Pause" : <><Play size={14} /> Play chain</>}
            </button>
            <button onClick={() => setActive(0)} className="inline-flex items-center gap-1.5 bg-white border border-border rounded-control px-4 py-2 text-[0.84rem] font-bold hover:border-healthcare hover:text-healthcare transition">
              <RotateCcw size={14} /> Restart
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4 mt-6">
          <ol className="card-base p-3 sm:p-4" aria-label="Booking chain steps">
            {CHAIN.map((s, i) => {
              const done = i < active;
              const current = i === active;
              return (
                <li key={s.title}>
                  <button onClick={() => { setActive(i); setPlaying(false); }}
                    className={`w-full text-left flex gap-3 px-3 py-2.5 rounded-xl transition ${current ? "bg-healthcare-soft border border-healthcare/30" : "border border-transparent hover:bg-background"}`}
                    aria-current={current ? "step" : undefined}>
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.72rem] font-extrabold shrink-0 border-2 ${done || current ? "bg-success text-white border-success" : "bg-white text-ink-faint border-border"}`}>
                      {done ? "✓" : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={`block font-bold text-[0.88rem] ${current ? "text-navy" : "text-ink"}`}>{s.title}</span>
                      <span className="block text-[0.7rem] font-bold uppercase tracking-wide text-ink-faint mt-0.5">{s.tag}</span>
                    </span>
                    {current && <span className="ml-auto text-[0.7rem] font-bold text-healthcare bg-white border border-healthcare/30 rounded-full px-2 py-1 shrink-0">live</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="space-y-4">
            <motion.div key={active} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-base p-5 sm:p-6 border-t-4 border-t-healthcare">
              <p className="text-[0.7rem] font-bold uppercase tracking-widest text-ink-faint">Step {active + 1} of {CHAIN.length}</p>
              <h3 className="text-[1.25rem] font-extrabold text-navy mt-1">{step.title}</h3>
              <p className="text-[0.92rem] text-ink-secondary leading-relaxed mt-2">{step.detail}</p>
              <div className="h-1.5 bg-background rounded-full mt-4 overflow-hidden" role="progressbar" aria-valuenow={active + 1} aria-valuemin={1} aria-valuemax={CHAIN.length}>
                <div className="h-full bg-gradient-to-r from-healthcare to-teal transition-all" style={{ width: `${((active + 1) / CHAIN.length) * 100}%` }} />
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setActive((a) => (a + CHAIN.length - 1) % CHAIN.length)} className="flex-1 bg-white border border-border rounded-control py-2 text-[0.84rem] font-bold hover:border-healthcare transition">← Prev</button>
                <button onClick={() => setActive((a) => (a + 1) % CHAIN.length)} className="flex-1 bg-healthcare text-white rounded-control py-2 text-[0.84rem] font-bold hover:bg-healthcare-dark transition">Next →</button>
              </div>
            </motion.div>
            <div className="card-base p-5 bg-gradient-to-br from-navy to-healthcare-dark text-white border-0">
              <p className="flex items-center gap-2 text-[0.78rem] font-bold uppercase tracking-widest text-white/70"><HeartPulse size={14} /> Innovation spotlight</p>
              <p className="font-bold mt-2 leading-snug">“Confirm only after verify” — the patient hears <em>confirmed</em> only when the external record matches.</p>
              <p className="text-white/75 text-[0.85rem] mt-1.5">Unknown EHR outcomes are queried by <code className="bg-white/15 rounded px-1.5 py-0.5">idempotency_key</code> first — retried or parked for humans, never duplicated.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- CAPABILITIES ---------------- */}
      <section id="capabilities" className="bg-white border-y border-border scroll-mt-20">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <p className="text-[0.7rem] font-bold uppercase tracking-widest text-healthcare">What the console controls</p>
          <h2 className="page-title mt-2">Everything a hospital admin owns, in one workspace.</h2>
          <p className="page-sub mt-2 max-w-[70ch]">Catalog, doctors, appointments, questionnaires, AI activity, EHR integration, workflows, analytics, staff, and ops/recovery — mapped 1:1 to the sidebar you get after sign-in.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mt-7">
            {CAPABILITIES.map((c) => (
              <motion.article key={c.title} whileHover={{ y: -3 }} className="card-base p-5 hover:shadow-card transition-shadow">
                <span className="w-11 h-11 rounded-xl bg-healthcare-soft text-healthcare flex items-center justify-center"><c.icon size={20} /></span>
                <h3 className="font-extrabold text-navy mt-3 text-[1rem]">{c.title}</h3>
                <p className="text-[0.86rem] text-ink-secondary leading-relaxed mt-1.5">{c.body}</p>
                <p className="inline-block mt-3 text-[0.7rem] font-bold font-mono bg-background border border-border rounded-full px-2.5 py-1 text-teal-dark">{c.meta}</p>
              </motion.article>
            ))}
          </div>
          <div className="grid sm:grid-cols-3 gap-3.5 mt-4">
            {[
              { icon: Stethoscope, t: "Doctor lifecycle", d: "Invited → active → inactive/suspended. Specialty, department, compatible visit type required before activation." },
              { icon: Bell, t: "Notifications that fire", d: "Confirmation, reminders, cancellations, questionnaire nudges — patient, doctor, and hospital channels." },
              { icon: Users, t: "Staff & access", d: "Invite hospital staff, deactivate in one click. Every action audited with actor + correlation ID." },
            ].map((r) => (
              <div key={r.t} className="bg-background border border-border/70 rounded-card p-4 flex gap-3">
                <r.icon size={18} className="text-healthcare shrink-0 mt-0.5" />
                <div><p className="font-bold text-[0.9rem]">{r.t}</p><p className="text-[0.82rem] text-ink-secondary mt-0.5">{r.d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- RECOVERY ---------------- */}
      <section id="recovery" className="max-w-shell mx-auto px-4 sm:px-6 py-12 sm:py-16 scroll-mt-20">
        <p className="text-[0.7rem] font-bold uppercase tracking-widest text-healthcare">Required failure demonstration · PRD §28</p>
        <h2 className="page-title mt-2">Failures are first-class. Recovery is observable.</h2>
        <p className="page-sub mt-2 max-w-[70ch]">A vendor “success” means nothing until re-read. Pick the scenario evaluators must see — the console walks each one to a correct final state.</p>
        <div className="flex flex-wrap gap-2 mt-5" role="tablist" aria-label="Recovery scenarios">
          {RECOVERY_TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={recovery === t.id} onClick={() => setRecovery(t.id)}
              className={`px-4 py-2.5 rounded-control text-[0.83rem] font-bold border transition ${recovery === t.id ? "bg-navy text-white border-navy" : "bg-white text-ink-secondary border-border hover:border-healthcare hover:text-healthcare"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <motion.div key={recovery} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-base p-5 sm:p-6 mt-4">
          <ol className="flex flex-wrap items-center gap-2" aria-label="Recovery flow">
            {recoveryTab.steps.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className={`text-[0.8rem] font-bold rounded-full px-3 py-1.5 border ${i === recoveryTab.steps.length - 1 ? "bg-success-soft text-success border-success/30" : i === 0 ? "bg-navy text-white border-navy" : "bg-background text-ink border-border"}`}>{s}</span>
                {i < recoveryTab.steps.length - 1 && <ArrowRight size={14} className="text-ink-faint" aria-hidden />}
              </li>
            ))}
          </ol>
          <p className="text-[0.9rem] text-ink-secondary leading-relaxed mt-4 max-w-[75ch]">{recoveryTab.body}</p>
          <div className="flex items-start gap-2 mt-4 bg-warning-soft border border-warning/30 rounded-xl px-4 py-3 text-[0.84rem]">
            <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
            <p><strong>Operator view:</strong> open items land in <Link to="/login" className="font-bold text-healthcare hover:underline">/ops</Link> — failed, unknown, reconciliation, escalations, retry queue, recovery history — with Retry / Resolve / Escalate.</p>
          </div>
        </motion.div>
      </section>

      {/* ---------------- ONBOARDING ---------------- */}
      <section id="onboarding" className="bg-white border-y border-border scroll-mt-20">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-12 sm:py-16 grid lg:grid-cols-2 gap-8">
          <div>
            <p className="text-[0.7rem] font-bold uppercase tracking-widest text-healthcare">Hospital onboarding · PRD §5</p>
            <h2 className="page-title mt-2">From registration to bookable in four moves.</h2>
            <ol className="flex items-center mt-6" aria-label="Hospital status lifecycle">
              {LIFECYCLE.map((s, i) => (
                <li key={s} className={`flex items-center ${i < LIFECYCLE.length - 1 ? "flex-1" : ""}`}>
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="w-8 h-8 rounded-full flex items-center justify-center text-[0.75rem] font-bold bg-success text-white border-2 border-success">{i + 1}</span>
                    <span className="text-[0.68rem] font-bold capitalize text-success">{s.replace("_", " ")}</span>
                  </div>
                  {i < LIFECYCLE.length - 1 && <div className="h-0.5 flex-1 mx-1.5 mb-6 rounded-full bg-success" aria-hidden />}
                </li>
              ))}
            </ol>
            <div className="space-y-2.5 mt-6">
              {[
                ["1 · Register", "Submit hospital + admin account. Starts as submitted for platform review."],
                ["2 · Configure catalog", "Departments, specialties, appointment types with durations — in /setup and /catalog."],
                ["3 · Invite doctors", "Add doctors, set calendars + availability rules + blocked slots, then activate."],
                ["4 · Go live", "Platform approves → publish availability → receive AI-driven verified bookings."],
              ].map(([t, d]) => (
                <div key={t} className="flex gap-3 bg-background border border-border/70 rounded-xl p-3.5">
                  <CheckCircle2 size={17} className="text-success shrink-0 mt-0.5" />
                  <div><p className="font-bold text-[0.88rem]">{t}</p><p className="text-[0.82rem] text-ink-secondary">{d}</p></div>
                </div>
              ))}
            </div>
          </div>
          <div className="card-base p-5 sm:p-6 bg-gradient-to-b from-healthcare-faint to-white">
            <p className="section-title">Try the console path</p>
            <p className="text-[0.85rem] text-ink-secondary mt-1">New hospitals land in <code className="font-mono bg-white border border-border rounded px-1.5 py-0.5">/setup</code> right after registration — the same guided flow your reviewers see.</p>
            <div className="grid grid-cols-2 gap-2.5 mt-4 text-[0.82rem] font-bold">
              <Link to="/register" className="bg-healthcare text-white rounded-control py-3 text-center hover:bg-healthcare-dark transition">Start registration</Link>
              <Link to="/login" className="bg-white border border-border rounded-control py-3 text-center hover:border-healthcare hover:text-healthcare transition">Open live console</Link>
            </div>
            <div className="mt-5 border-t border-border pt-4 space-y-2 text-[0.82rem]">
              <p className="flex items-center gap-2"><Mic size={14} className="text-healthcare" /> Patient books by voice: “cardiologist this week”</p>
              <p className="flex items-center gap-2"><CalendarDays size={14} className="text-healthcare" /> Slot grid shows only real availability</p>
              <p className="flex items-center gap-2"><ShieldCheck size={14} className="text-healthcare" /> EHR verify → sync → confirm + notify</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- SECURITY ---------------- */}
      <section id="security" className="max-w-shell mx-auto px-4 sm:px-6 py-12 sm:py-16 scroll-mt-20">
        <div className="card-base overflow-hidden grid lg:grid-cols-[1fr_1fr]">
          <div className="p-6 sm:p-8">
            <p className="text-[0.7rem] font-bold uppercase tracking-widest text-healthcare">Security · privacy · audit</p>
            <h2 className="page-title mt-2">Tenant isolation isn’t a claim. It’s the query layer.</h2>
            <ul className="mt-5 space-y-2.5 text-[0.87rem]">
              {[
                "DB user row is authoritative — token hospital_id is a hint only; only platform_admin bypasses scope.",
                "hospital_scoped_query filters every tenant table; patients book only for their own user_id.",
                "Argon2 hashing, short-lived JWT access + refresh, per-request inactive rejection, no sessions/SSO.",
                "All 20 AI tools carry RBAC allowlists; denied calls are still audited with latency + correlation.",
                "No raw clinical content in logs or AI context — structured AIContext only, privacy-aware by design.",
              ].map((s) => (
                <li key={s} className="flex gap-2.5"><CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" /><span className="text-ink-secondary">{s}</span></li>
              ))}
            </ul>
          </div>
          <div className="bg-navy text-white p-6 sm:p-8 font-mono text-[0.74rem] leading-relaxed">
            <p className="text-white/50 uppercase tracking-widest text-[0.64rem] font-bold">Trace one booking across every hop</p>
            <pre className="mt-3 whitespace-pre-wrap">{`conversation  conv_9f2e
→ ai decision   clarify → search → offer
→ capability    check_availability  84ms ✓
→ scheduling    reserve_slot FOR UPDATE ✓
→ ehr           create + verify_external ✓
→ sync          pending → confirmed
→ workflow      reminder T-24h + questionnaire
→ notify        patient + doctor sent
correlation_id  8f3a…c1 · audit sealed`}</pre>
            <p className="mt-4 inline-flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-full px-3 py-1.5 font-sans text-[0.74rem] font-bold"><Lock size={13} /> Secrets via env only · never committed</p>
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="max-w-shell mx-auto px-4 sm:px-6 pb-14">
        <div className="relative overflow-hidden rounded-card bg-gradient-to-r from-navy to-healthcare-dark text-white px-6 py-10 sm:p-12 text-center">
          <div className="absolute inset-0 opacity-15" aria-hidden style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "22px 22px" }} />
          <div className="relative">
            <h2 className="text-[1.6rem] sm:text-[2rem] font-extrabold tracking-tight">Bring verified scheduling to your hospital.</h2>
            <p className="text-white/80 mt-2 max-w-[60ch] mx-auto text-[0.95rem]">Register for platform review today — configure catalog and doctors tomorrow, receive AI-driven verified bookings this week.</p>
            <div className="flex flex-wrap justify-center gap-2.5 mt-6">
              <Link to="/register" className="inline-flex items-center gap-2 bg-white text-navy font-extrabold rounded-control px-6 py-3 text-[0.92rem] hover:bg-healthcare-soft transition">Register hospital <ArrowRight size={16} /></Link>
              <Link to="/login" className="inline-flex items-center gap-2 border border-white/40 text-white font-bold rounded-control px-6 py-3 text-[0.92rem] hover:bg-white/10 transition">Sign in</Link>
            </div>
            <p className="text-white/60 text-[0.76rem] mt-4">Draft → submitted → under review → approved · suspend/reinstate supported</p>
          </div>
        </div>
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 justify-between pt-6 text-[0.78rem] text-ink-secondary">
          <p className="flex items-center gap-2 font-bold text-navy"><span className="w-6 h-6 rounded-lg bg-gradient-to-br from-healthcare to-navy text-white flex items-center justify-center text-[0.8rem] font-extrabold">+</span> CareFlow AI · Hospital Console</p>
          <p>Patient · Doctor · Platform consoles share one scheduling truth (PostgreSQL) + one production API.</p>
          <p className="flex items-center gap-3">
            <Link to="/login" className="hover:text-healthcare font-semibold">Console</Link>
            <Link to="/register" className="hover:text-healthcare font-semibold">Onboarding</Link>
            <a href="#chain" className="hover:text-healthcare font-semibold">Live chain</a>
          </p>
        </footer>
      </section>
    </div>
  );
}
