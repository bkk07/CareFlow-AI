import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Clock,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";

function BrandMark() {
  return (
    <span className="w-9 h-9 rounded-[10px] bg-navy text-white flex items-center justify-center shrink-0" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </span>
  );
}

const PREVIEW_DAY = [
  { time: "09:00", label: "Consultation", state: "Confirmed", tone: "bg-success-soft text-success" },
  { time: "09:30", label: "Follow-up", state: "Confirmed", tone: "bg-success-soft text-success" },
  { time: "10:00", label: "Check-up", state: "Pending", tone: "bg-warning-soft text-warning" },
  { time: "11:00", label: "Follow-up", state: "Completed", tone: "bg-slate-100 text-ink-secondary" },
];

const FEATURES = [
  { icon: Clock, title: "Today's schedule", body: "See your appointments at a glance." },
  { icon: CalendarCheck, title: "Availability", body: "Control when patients can book." },
  { icon: ClipboardList, title: "Questionnaires", body: "Review authorized pre-visit information." },
  { icon: CalendarDays, title: "Calendar", body: "Manage your schedule in one place." },
];

const STEPS = ["Today's schedule", "Appointments", "Questionnaires", "Availability"];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-ink">
      {/* Navbar */}
      <header className="bg-white border-b border-border sticky top-0 z-20">
        <div className="max-w-shell mx-auto px-4 sm:px-6 h-[62px] flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5" aria-label="CareFlow AI Doctor Portal home">
            <BrandMark />
            <span className="leading-none">
              <span className="block font-extrabold tracking-tight text-navy">
                CareFlow <span className="text-healthcare">AI</span>
              </span>
              <span className="block text-[0.68rem] font-bold uppercase tracking-widest text-ink-faint mt-0.5">
                Doctor Portal
              </span>
            </span>
          </Link>
          <div className="flex-1" />
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[0.76rem] font-semibold text-ink-secondary">
            <ShieldCheck size={14} className="text-teal-dark" /> Hospital-managed access
          </span>
          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-1.5 min-h-[2.5rem] px-5 text-[0.88rem] font-bold bg-healthcare text-white rounded-control hover:bg-healthcare-dark transition"
          >
            Sign in <ArrowRight size={15} />
          </Link>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="max-w-shell mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-8">
          <div className="grid lg:grid-cols-[1fr_380px] gap-8 items-start">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32 }}>
              <p className="inline-flex items-center gap-1.5 text-[0.74rem] font-bold text-teal-dark bg-teal-soft rounded-full px-3 py-1.5">
                <Stethoscope size={13} /> CareFlow AI · Doctor Portal
              </p>
              <h1 className="text-[2rem] sm:text-[2.5rem] font-extrabold text-navy tracking-tight leading-tight mt-3">
                Your schedule, organized.
              </h1>
              <p className="text-ink-secondary text-[1rem] leading-relaxed mt-3 max-w-xl">
                Manage appointments, availability, questionnaires, and your day from one place.
              </p>
              <div className="flex flex-wrap gap-2.5 mt-6">
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-1.5 min-h-[3rem] px-7 text-[0.95rem] font-bold bg-navy text-white rounded-control hover:bg-navy-deep transition"
                >
                  Sign in <ArrowRight size={16} />
                </Link>
                <span
                  title="Contact your hospital administrator"
                  className="inline-flex items-center justify-center min-h-[3rem] px-7 text-[0.95rem] font-bold bg-white text-navy border border-border rounded-control"
                >
                  Contact hospital administrator
                </span>
              </div>
              <p className="text-[0.8rem] text-ink-secondary mt-3">
                Doctor accounts are created by your hospital administrator — there is no public registration.
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-5 text-[0.82rem] font-semibold text-ink-secondary">
                <span className="inline-flex items-center gap-1.5"><Clock size={14} className="text-healthcare" /> Today's appointments</span>
                <span className="inline-flex items-center gap-1.5"><CalendarCheck size={14} className="text-healthcare" /> Availability management</span>
                <span className="inline-flex items-center gap-1.5"><ClipboardList size={14} className="text-healthcare" /> Questionnaire review</span>
              </div>
            </motion.div>

            {/* Compact product preview (illustrative layout, no patient data) */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: 0.08 }}
              className="card-base p-5"
              aria-label="Product preview"
            >
              <div className="flex items-center justify-between">
                <p className="text-[0.72rem] font-bold uppercase tracking-widest text-healthcare">Today's appointments</p>
                <span className="text-[0.72rem] font-bold text-ink-faint">Preview</span>
              </div>
              <ul className="mt-3 space-y-2">
                {PREVIEW_DAY.map((s) => (
                  <li key={s.time} className="flex items-center gap-3 border border-border rounded-control px-3 py-2">
                    <span className="text-[0.8rem] font-extrabold text-navy tabular-nums w-11 shrink-0">{s.time}</span>
                    <span className="text-[0.83rem] font-semibold text-ink flex-1">{s.label}</span>
                    <span className={`text-[0.7rem] font-bold rounded-full px-2 py-0.5 ${s.tone}`}>{s.state}</span>
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                {[
                  { k: "Availability", v: "Open" },
                  { k: "Upcoming", v: "This week" },
                  { k: "Forms", v: "Ready" },
                ].map((c) => (
                  <div key={c.k} className="bg-background border border-border rounded-control px-2 py-2">
                    <p className="text-[0.72rem] font-extrabold text-navy">{c.v}</p>
                    <p className="text-[0.68rem] font-semibold text-ink-secondary">{c.k}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Features */}
        <section className="max-w-shell mx-auto px-4 sm:px-6 pb-8" aria-label="Features">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.28, delay: i * 0.04 }}
                className="card-base p-5"
              >
                <span className="w-9 h-9 rounded-xl bg-healthcare-soft text-healthcare flex items-center justify-center">
                  <f.icon size={17} />
                </span>
                <p className="font-bold text-navy mt-2.5">{f.title}</p>
                <p className="text-[0.83rem] text-ink-secondary mt-1">{f.body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Workflow */}
        <section className="max-w-shell mx-auto px-4 sm:px-6 pb-8" aria-label="Workflow">
          <div className="card-base p-5 sm:p-6">
            <h2 className="section-title">A calm daily workflow</h2>
            <ol className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-center gap-2 flex-1">
                  <span className="flex items-center gap-2 bg-background border border-border rounded-control px-3.5 py-2.5 flex-1">
                    <span className="w-6 h-6 rounded-full bg-navy text-white text-[0.72rem] font-extrabold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-[0.85rem] font-bold text-ink">{s}</span>
                  </span>
                  {i < STEPS.length - 1 && (
                    <span className="hidden sm:block text-ink-faint font-bold" aria-hidden>→</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Final CTA */}
        <section className="max-w-shell mx-auto px-4 sm:px-6 pb-10" aria-label="Get started">
          <div className="card-base p-6 sm:p-8 bg-navy text-white border-navy text-center" style={{ background: "#123B5D" }}>
            <h2 className="text-[1.35rem] font-extrabold tracking-tight" style={{ color: "#fff" }}>Ready for your day?</h2>
            <p className="text-white/80 text-[0.9rem] mt-1">Sign in to open today's schedule.</p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-1.5 min-h-[3rem] px-8 mt-5 text-[0.95rem] font-bold bg-white rounded-control transition hover:bg-healthcare-soft"
              style={{ color: "#123B5D" }}
            >
              Sign in to Doctor Portal <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-white">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center gap-2 justify-between text-[0.8rem] text-ink-secondary">
          <span className="font-bold text-navy">CareFlow AI · Doctor Portal</span>
          <span>Hospital-managed access · Secure sign-in</span>
        </div>
      </footer>
    </div>
  );
}
