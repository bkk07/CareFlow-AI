import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  HeartPulse,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { CareFlowLogo } from "../components/brand/CareFlowLogo";

/* ------------------------------------------------------------------ */
/* Subtle reveal only (150–250ms fade). No parallax, no floating.      */
/* ------------------------------------------------------------------ */

function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`${className} transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      {children}
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="max-w-[68ch]">
      {eyebrow && (
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-teal-dark">{eyebrow}</p>
      )}
      <h2 className="text-[1.45rem] sm:text-[1.9rem] font-bold text-navy tracking-tight leading-tight mt-2">
        {title}
      </h2>
      {sub && <p className="text-ink-secondary text-[1rem] leading-relaxed mt-3">{sub}</p>}
    </div>
  );
}

function StatusDot({ tone, label }: { tone: "green" | "amber" | "blue" | "gray" | "red"; label: string }) {
  const tones: Record<string, string> = {
    green: "bg-success-soft text-success",
    amber: "bg-warning-soft text-warning",
    blue: "bg-healthcare-soft text-healthcare",
    gray: "bg-slate-100 text-ink-secondary",
    red: "bg-danger-soft text-danger",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[0.72rem] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${tones[tone]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

/* ------------------------------- NAVBAR ------------------------------- */

const NAV_LINKS = [
  ["Platform", "#platform"],
  ["Solutions", "#showcase"],
  ["Features", "#features"],
  ["Security", "#security"],
  ["Resources", "#onboarding"],
];

function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-border">
      <div className="max-w-shell mx-auto px-4 sm:px-6 h-16 md:h-[68px] flex items-center gap-4">
        <Link to="/" aria-label="CareFlow AI home">
          <CareFlowLogo />
        </Link>
        <nav className="hidden lg:flex items-center gap-1 ml-8" aria-label="Primary">
          {NAV_LINKS.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="px-3 py-2 rounded-lg text-[0.875rem] font-medium text-ink-secondary hover:text-navy hover:bg-background transition-colors duration-200"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex-1" />
        <Link
          to="/login"
          className="hidden sm:inline-block text-[0.875rem] font-semibold text-ink-secondary hover:text-navy px-3 py-2 transition-colors duration-200"
        >
          Sign In
        </Link>
        <Link
          to="/register"
          className="hidden sm:inline-flex items-center gap-1.5 bg-healthcare hover:bg-healthcare-dark text-white text-[0.875rem] font-semibold rounded-control px-4 py-2.5 transition-colors duration-200"
        >
          Get Started
        </Link>
        <button
          className="lg:hidden w-10 h-10 inline-flex items-center justify-center rounded-lg border border-border text-ink"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
      {open && (
        <nav className="lg:hidden border-t border-border bg-white px-4 py-3 space-y-1" aria-label="Mobile">
          {NAV_LINKS.map(([label, href]) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-[0.95rem] font-medium text-ink hover:bg-background"
            >
              {label}
            </a>
          ))}
          <div className="flex gap-2 pt-2">
            <Link to="/login" className="flex-1 text-center border border-border rounded-control py-2.5 font-semibold text-[0.9rem]">
              Sign In
            </Link>
            <Link to="/register" className="flex-1 text-center bg-healthcare text-white rounded-control py-2.5 font-semibold text-[0.9rem]">
              Get Started
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

/* --------------------------- HERO DASHBOARD --------------------------- */

function HeroDashboard() {
  return (
    <div className="bg-white border border-border rounded-2xl shadow-card overflow-hidden" aria-label="Hospital admin dashboard preview">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="w-2.5 h-2.5 rounded-full bg-border" aria-hidden />
        <span className="w-2.5 h-2.5 rounded-full bg-border" aria-hidden />
        <span className="w-2.5 h-2.5 rounded-full bg-border" aria-hidden />
        <p className="ml-2 text-[0.75rem] font-semibold text-ink-secondary">Sample hospital overview</p>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 p-4">
        {[
          ["Today's Appointments", "18", "6 confirmed · 4 pending"],
          ["Active Doctors", "24", "across 6 departments"],
          ["Upcoming", "132", "next 7 days"],
          ["Operational Alerts", "2", "needs review"],
        ].map(([label, value, sub]) => (
          <div key={label} className="border border-border rounded-xl px-3.5 py-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
            <p className="text-[1.4rem] font-bold text-navy tabular-nums leading-tight mt-0.5">{value}</p>
            <p className="text-[0.72rem] text-ink-secondary mt-0.5">{sub}</p>
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-[1.5fr_1fr] gap-2.5 px-4 pb-4">
        <div className="border border-border rounded-xl p-3.5">
          <p className="text-[0.8rem] font-bold text-navy">Today&apos;s appointment activity</p>
          <ul className="mt-2.5 divide-y divide-border/70">
            {[
              ["09:30 · Cardiology", "Confirmed", "green"],
              ["10:15 · Orthopedics", "Pending", "amber"],
              ["11:00 · Follow-up", "Completed", "blue"],
              ["11:45 · General", "Cancelled", "gray"],
            ].map(([row, s, tone]) => (
              <li key={row} className="py-2 flex items-center justify-between gap-2 text-[0.8rem]">
                <span className="font-medium text-ink">{row}</span>
                <StatusDot tone={tone as "green" | "amber" | "blue" | "gray"} label={s} />
              </li>
            ))}
          </ul>
        </div>
        <div className="border border-border rounded-xl p-3.5 bg-background/50">
          <p className="text-[0.8rem] font-bold text-navy">Operational activity</p>
          <ul className="mt-2.5 space-y-2 text-[0.78rem]">
            {[
              ["Doctor added", "Cardiology"],
              ["Appointment confirmed", "09:30 slot"],
              ["Questionnaire submitted", "Pre-visit form"],
              ["AI scheduling activity", "Availability checked"],
              ["Integration status", "Connected"],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-2">
                <CheckCircle2 size={14} className="text-teal-dark shrink-0 mt-0.5" />
                <span><span className="font-semibold text-ink">{t}</span><span className="block text-ink-secondary text-[0.72rem]">{d}</span></span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- PAGE --------------------------------- */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-ink font-sans antialiased">
      <Navbar />

      {/* ------------------------------- HERO ------------------------------- */}
      <section className="bg-background border-b border-border">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-12 lg:py-20 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-teal-dark">
              Healthcare Operations Platform
            </p>
            <h1 className="text-[2rem] sm:text-[2.75rem] font-bold text-navy tracking-tight leading-[1.1] mt-4">
              Run your hospital operations with clarity.
            </h1>
            <p className="text-[1.05rem] font-medium text-ink mt-4 leading-relaxed">
              Connect appointments, doctors, workflows, AI-assisted scheduling, and operational
              visibility in one healthcare platform.
            </p>
            <p className="text-ink-secondary text-[1rem] leading-relaxed mt-3 max-w-[54ch]">
              CareFlow AI gives hospital teams a centralized way to configure services, manage
              doctors and appointments, monitor AI-assisted workflows, and maintain operational
              visibility across the hospital.
            </p>
            <div className="flex flex-col sm:flex-row gap-2.5 mt-7">
              <Link
                to="/register"
                className="inline-flex items-center justify-center gap-2 bg-healthcare hover:bg-healthcare-dark text-white font-semibold rounded-control px-6 py-3 text-[0.95rem] transition-colors duration-200"
              >
                Get Started <ArrowRight size={16} />
              </Link>
              <a
                href="#platform"
                className="inline-flex items-center justify-center gap-2 bg-white border border-border hover:border-healthcare hover:text-healthcare font-semibold rounded-control px-6 py-3 text-[0.95rem] transition-colors duration-200"
              >
                Explore Platform
              </a>
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1.5 mt-6 text-[0.8rem] font-medium text-ink-secondary">
              {["Appointments", "Doctors", "Workflows", "Analytics", "AI Assistance"].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-teal" aria-hidden /> {t}
                </span>
              ))}
            </p>
          </div>
          <Reveal>
            <HeroDashboard />
          </Reveal>
        </div>
      </section>

      {/* ---------------------------- TRUST STRIP ---------------------------- */}
      <section className="border-b border-border">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            [Building2, "Centralized Operations", "Manage core hospital workflows from one platform."],
            [CalendarDays, "Real-Time Availability", "Work with doctor calendars and appointment availability."],
            [HeartPulse, "AI-Assisted Scheduling", "Help patients discover care and schedule appointments."],
            [Activity, "Operational Visibility", "Monitor workflows, integrations, AI activity, and recovery operations."],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof Building2;
            return (
              <div key={title as string} className="flex gap-3">
                <span className="w-10 h-10 rounded-xl bg-healthcare-soft text-healthcare flex items-center justify-center shrink-0">
                  <I size={19} />
                </span>
                <div>
                  <p className="font-bold text-navy text-[0.95rem]">{title as string}</p>
                  <p className="text-ink-secondary text-[0.875rem] mt-1 leading-relaxed">{body as string}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* -------------------------- PLATFORM OVERVIEW -------------------------- */}
      <section id="platform" className="scroll-mt-20">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-14 lg:py-20">
          <Reveal>
            <SectionHead
              eyebrow="Platform"
              title="Everything your hospital needs to coordinate care."
              sub="CareFlow AI brings hospital configuration, scheduling, appointments, doctors, AI assistance, integrations, and operational workflows into one platform."
            />
          </Reveal>
          <div id="features" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-9 scroll-mt-20">
            {[
              [Building2, "Hospital Setup", "Configure your hospital, departments, specialties, and appointment types."],
              [Stethoscope, "Doctor Management", "Invite, activate, manage, and organize doctors across your hospital."],
              [CalendarDays, "Appointment Management", "Monitor and manage appointment lifecycles from booking to completion."],
              [HeartPulse, "AI Activity", "Review AI-assisted scheduling activity and escalations."],
              [Settings, "Integrations", "Connect hospital workflows with external healthcare systems."],
              [BarChart3, "Analytics & Operations", "Monitor workflows, operational activity, recovery queues, and performance."],
            ].map(([Icon, title, body]) => {
              const I = Icon as typeof Building2;
              return (
                <Reveal key={title as string}>
                  <article className="h-full bg-white border border-border rounded-2xl p-6 hover:border-healthcare/50 hover:shadow-subtle transition-all duration-200">
                    <span className="w-11 h-11 rounded-xl bg-healthcare-soft text-healthcare flex items-center justify-center">
                      <I size={20} />
                    </span>
                    <h3 className="font-bold text-navy text-[1.02rem] mt-4">{title as string}</h3>
                    <p className="text-ink-secondary text-[0.925rem] leading-relaxed mt-1.5">{body as string}</p>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------ OPERATIONS SHOWCASE ------------------------ */}
      <section id="showcase" className="bg-background border-y border-border scroll-mt-20">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-14 lg:py-20">
          <Reveal>
            <SectionHead
              eyebrow="Workspace"
              title="One workspace for your hospital team."
              sub="The same navigation and structure your administrators use every day — overview to operations in one console."
            />
          </Reveal>
          <Reveal className="mt-9">
            <div className="bg-white border border-border rounded-2xl shadow-card overflow-hidden">
              <div className="grid md:grid-cols-[230px_1fr]">
                <aside className="hidden md:block border-r border-border p-3 bg-white" aria-label="Application sidebar preview">
                  <div className="px-2 py-2"><CareFlowLogo size={30} /></div>
                  <ul className="mt-2 space-y-0.5 text-[0.82rem] font-medium">
                    {[
                      [LayoutDashboard, "Overview", true],
                      [Building2, "Setup", false],
                      [ClipboardList, "Catalog", false],
                      [Stethoscope, "Doctors", false],
                      [CalendarDays, "Appointments", false],
                      [FileText, "Questionnaires", false],
                      [Activity, "AI Activity", false],
                      [Settings, "Integration", false],
                      [Workflow, "Workflows", false],
                      [BarChart3, "Analytics", false],
                      [Users, "Staff", false],
                      [LifeBuoy, "Operations", false],
                    ].map(([Icon, label, active]) => {
                      const I = Icon as typeof Building2;
                      return (
                        <li
                          key={label as string}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg ${active ? "bg-healthcare-soft text-healthcare font-semibold" : "text-ink-secondary"}`}
                        >
                          <I size={16} /> {label as string}
                        </li>
                      );
                    })}
                  </ul>
                </aside>
                <div className="p-4 sm:p-6 overflow-x-auto">
                  <div className="min-w-[560px]">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="font-bold text-navy text-[1.1rem]">Hospital overview</h3>
                        <p className="text-ink-secondary text-[0.82rem]">Sample view of daily operations</p>
                      </div>
                      <StatusDot tone="green" label="Systems normal" />
                    </div>
                    <div className="grid grid-cols-3 gap-2.5 mt-4">
                      {[
                        ["Appointment volume", "High mid-morning", "blue"],
                        ["Doctor availability", "22 of 26 available", "green"],
                        ["Workflow status", "3 running", "amber"],
                      ].map(([t, d, tone]) => (
                        <div key={t as string} className="border border-border rounded-xl p-3">
                          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-faint">{t as string}</p>
                          <p className="text-[0.85rem] font-bold text-navy mt-1">{d as string}</p>
                          <span className={`inline-block mt-2 w-16 h-1.5 rounded-full ${tone === "green" ? "bg-success" : tone === "amber" ? "bg-warning" : "bg-healthcare"}`} aria-hidden />
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                      <div className="border border-border rounded-xl p-3">
                        <p className="text-[0.78rem] font-bold text-navy">Appointment status</p>
                        {[
                          ["Confirmed", "68%", "bg-success"],
                          ["Pending", "18%", "bg-warning"],
                          ["Completed", "11%", "bg-healthcare"],
                          ["Cancelled", "3%", "bg-border"],
                        ].map(([s, w, c]) => (
                          <div key={s as string} className="flex items-center gap-2 mt-2 text-[0.75rem]">
                            <span className="w-20 text-ink-secondary font-medium">{s as string}</span>
                            <span className="flex-1 h-1.5 bg-background rounded-full overflow-hidden">
                              <span className={`block h-full rounded-full ${c as string}`} style={{ width: w as string }} />
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="border border-border rounded-xl p-3">
                        <p className="text-[0.78rem] font-bold text-navy">Integration health</p>
                        <ul className="mt-2 space-y-1.5 text-[0.78rem]">
                          {[
                            ["Scheduling sync", "Connected", "green"],
                            ["Records verification", "Verifying", "amber"],
                            ["Notifications", "Connected", "green"],
                          ].map(([t, s, tone]) => (
                            <li key={t as string} className="flex items-center justify-between gap-2">
                              <span className="text-ink-secondary">{t as string}</span>
                              <StatusDot tone={tone as "green" | "amber"} label={s as string} />
                            </li>
                          ))}
                        </ul>
                        <p className="text-[0.78rem] font-bold text-navy mt-3">Recent activity</p>
                        <p className="text-[0.75rem] text-ink-secondary mt-1">Morning clinic confirmed · 2 questionnaires submitted · 1 escalation resolved</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="md:hidden border-t border-border px-4 py-2.5 overflow-x-auto no-scrollbar">
                <div className="flex gap-1.5 min-w-max text-[0.72rem] font-semibold text-ink-secondary">
                  {["Overview", "Setup", "Catalog", "Doctors", "Appointments", "AI Activity", "Integration", "Workflows", "Analytics", "Staff", "Operations"].map((s) => (
                    <span key={s} className={`px-2.5 py-1.5 rounded-lg border border-border ${s === "Overview" ? "bg-healthcare-soft text-healthcare" : "bg-white"}`}>{s}</span>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* --------------------------- DOCTOR MANAGEMENT --------------------------- */}
      <section id="solutions" className="scroll-mt-20">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-14 lg:py-20">
          <Reveal>
            <SectionHead
              eyebrow="Care team"
              title="Keep your care team organized."
              sub="Search, filter, and manage doctors by department, specialty, and lifecycle status — from invitation to active practice."
            />
          </Reveal>
          <Reveal className="mt-9">
            <div className="bg-white border border-border rounded-2xl shadow-subtle overflow-hidden">
              <div className="flex flex-col sm:flex-row gap-2.5 p-4 border-b border-border">
                <label className="flex items-center gap-2 flex-1 border border-border rounded-control px-3 py-2 text-[0.875rem] text-ink-faint">
                  <Search size={15} /> Search doctors
                </label>
                {["Department", "Specialty", "Status"].map((f) => (
                  <span key={f} className="border border-border rounded-control px-3 py-2 text-[0.875rem] text-ink-secondary font-medium">
                    {f} · All
                  </span>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-b border-border">
                      {["Doctor", "Specialty", "Department", "Status", "Availability", "Upcoming", "Actions"].map((h) => (
                        <th key={h} className="th-cell">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {[
                      ["Dr. A. Rao", "Cardiology", "Medicine", "Active", "green", "Mon–Fri · 9–5", "12 visits", "Manage"],
                      ["Dr. S. Iyer", "Orthopedics", "Surgery", "Active", "green", "Tue–Sat · 10–6", "9 visits", "Manage"],
                      ["Dr. M. Khan", "Pediatrics", "Medicine", "Invited", "blue", "Pending setup", "—", "Resend"],
                      ["Dr. L. D'Souza", "Dermatology", "Outpatient", "Inactive", "gray", "Paused", "—", "Activate"],
                      ["Dr. R. Nair", "Neurology", "Medicine", "Suspended", "red", "Blocked", "—", "Review"],
                    ].map(([doc, spec, dept, status, tone, avail, up, act]) => (
                      <tr key={doc as string} className="hover:bg-background/60 transition-colors duration-200">
                        <td className="td-cell font-semibold text-navy">{doc as string}</td>
                        <td className="td-cell text-ink-secondary">{spec as string}</td>
                        <td className="td-cell text-ink-secondary">{dept as string}</td>
                        <td className="td-cell"><StatusDot tone={tone as "green" | "blue" | "gray" | "red"} label={status as string} /></td>
                        <td className="td-cell text-ink-secondary">{avail as string}</td>
                        <td className="td-cell tabular-nums text-ink-secondary">{up as string}</td>
                        <td className="td-cell"><span className="font-semibold text-healthcare">{act as string}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* -------------------------- APPOINTMENT OPS -------------------------- */}
      <section className="bg-background border-y border-border">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-14 lg:py-20">
          <Reveal>
            <SectionHead
              eyebrow="Appointments"
              title="Stay ahead of every appointment."
              sub="Each appointment moves through a defined lifecycle with full history — booking, confirmation, completion, and recovery are tracked as operational workflow."
            />
          </Reveal>
          <Reveal className="mt-9">
            <div className="bg-white border border-border rounded-2xl shadow-subtle overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left">
                  <thead>
                    <tr className="border-b border-border">
                      {["Appointment ID", "Patient", "Doctor", "Specialty", "Date", "Time", "Mode", "Status"].map((h) => (
                        <th key={h} className="th-cell">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {[
                      ["APT-1042", "A. Sharma", "Dr. Rao", "Cardiology", "Mon", "09:30", "In person", "Confirmed", "green"],
                      ["APT-1043", "J. D'Souza", "Dr. Iyer", "Orthopedics", "Mon", "10:15", "In person", "Pending", "amber"],
                      ["APT-1044", "R. Khan", "Dr. Rao", "Cardiology", "Mon", "11:00", "Video", "Completed", "blue"],
                      ["APT-1045", "P. Menon", "Dr. Nair", "Neurology", "Tue", "09:00", "Phone", "Sync Pending", "amber"],
                      ["APT-1046", "S. Verma", "Dr. Khan", "Pediatrics", "Tue", "10:30", "In person", "Cancelled", "gray"],
                    ].map((r) => (
                      <tr key={r[0] as string} className="hover:bg-background/60 transition-colors duration-200">
                        <td className="td-cell font-mono text-[0.78rem] font-semibold">{r[0] as string}</td>
                        <td className="td-cell font-medium">{r[1] as string}</td>
                        <td className="td-cell text-ink-secondary">{r[2] as string}</td>
                        <td className="td-cell text-ink-secondary">{r[3] as string}</td>
                        <td className="td-cell text-ink-secondary">{r[4] as string}</td>
                        <td className="td-cell tabular-nums">{r[5] as string}</td>
                        <td className="td-cell text-ink-secondary">{r[6] as string}</td>
                        <td className="td-cell"><StatusDot tone={r[8] as "green" | "amber" | "blue" | "gray"} label={r[7] as string} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------ AI SECTION ------------------------------ */}
      <section className="scroll-mt-20">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-14 lg:py-20">
          <Reveal>
            <SectionHead
              eyebrow="AI assistance"
              title="AI that assists your scheduling workflows."
              sub="CareFlow AI helps patients discover doctors, check availability, and complete scheduling through a controlled scheduling assistant."
            />
          </Reveal>
          <div className="grid md:grid-cols-2 gap-4 mt-9">
            <Reveal>
              <div className="h-full bg-white border border-border rounded-2xl p-6">
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-ink-faint">Patient conversation</p>
                <div className="mt-4 space-y-3">
                  <p className="max-w-[85%] bg-background border border-border rounded-2xl rounded-bl-md px-4 py-3 text-[0.925rem]">
                    I need a cardiologist this week.
                  </p>
                  <p className="max-w-[90%] ml-auto bg-navy text-white rounded-2xl rounded-br-md px-4 py-3 text-[0.925rem]">
                    I found 2 cardiologists with availability on Thursday and Friday. Which day works for you?
                  </p>
                  <p className="max-w-[70%] bg-background border border-border rounded-2xl rounded-bl-md px-4 py-3 text-[0.925rem]">
                    Friday morning, please.
                  </p>
                </div>
              </div>
            </Reveal>
            <Reveal>
              <div className="h-full bg-navy text-white rounded-2xl p-6">
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-white/60">Hospital-side activity · AI Scheduling</p>
                <ul className="mt-4 space-y-2.5">
                  {[
                    ["Doctor search", "2 cardiologists found", true],
                    ["Availability checked", "Real calendar slots", true],
                    ["Appointment type selected", "Follow-up · 20 min", true],
                    ["Booking confirmation requested", "Awaiting patient", false],
                  ].map(([t, d, done]) => (
                    <li key={t as string} className="flex gap-3 bg-white/[0.07] border border-white/10 rounded-xl px-4 py-3">
                      <CheckCircle2 size={17} className={done ? "text-teal-soft shrink-0 mt-0.5" : "text-white/40 shrink-0 mt-0.5"} />
                      <span>
                        <span className="block font-semibold text-[0.9rem]">{t as string}</span>
                        <span className="block text-white/65 text-[0.8rem]">{d as string}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="inline-block mt-4 text-[0.72rem] font-semibold bg-white/10 border border-white/15 rounded-full px-3 py-1.5">
                  Human-controlled healthcare workflows
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* --------------------------- INTEGRATION --------------------------- */}
      <section className="bg-background border-y border-border">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-14 lg:py-20">
          <Reveal>
            <SectionHead
              eyebrow="Reliability"
              title="Built for reliable healthcare workflows."
              sub="CareFlow AI verifies external appointment outcomes and provides operational recovery workflows when an integration encounters an unexpected state."
            />
          </Reveal>
          <Reveal className="mt-9">
            <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                ["01 · Appointment", "Booking is created in the hospital schedule with full history."],
                ["02 · Integration", "The appointment is sent to the connected healthcare system."],
                ["03 · Verification", "The external result is re-checked before it counts."],
                ["04 · Confirmed / Recovery", "Verified bookings confirm; uncertain cases go to the recovery queue."],
              ].map(([t, d]) => (
                <li key={t as string} className="bg-white border border-border rounded-2xl p-6">
                  <p className="font-bold text-healthcare text-[0.95rem]">{t as string}</p>
                  <p className="text-ink-secondary text-[0.9rem] leading-relaxed mt-2">{d as string}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------- ANALYTICS ----------------------------- */}
      <section className="scroll-mt-20">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-14 lg:py-20">
          <Reveal>
            <SectionHead
              eyebrow="Analytics"
              title="See what's happening across your hospital."
              sub="Sample views of the trends, statuses, and alerts your team reviews each day."
            />
          </Reveal>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-9">
            <Reveal>
              <div className="bg-white border border-border rounded-2xl p-5">
                <p className="font-bold text-navy text-[0.92rem]">Appointment trends</p>
                <p className="text-[0.75rem] text-ink-secondary">Sample view · last 7 days</p>
                <svg viewBox="0 0 260 90" className="w-full h-28 mt-3" role="img" aria-label="Sample appointment trend line">
                  <polyline points="5,70 45,62 85,64 125,48 165,52 205,34 255,38" fill="none" stroke="#1769AA" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx="205" cy="34" r="4" fill="#1769AA" />
                </svg>
              </div>
            </Reveal>
            <Reveal>
              <div className="bg-white border border-border rounded-2xl p-5">
                <p className="font-bold text-navy text-[0.92rem]">Appointment status</p>
                <p className="text-[0.75rem] text-ink-secondary">Sample distribution</p>
                <div className="flex items-center gap-4 mt-3">
                  <svg viewBox="0 0 80 80" className="w-24 h-24" role="img" aria-label="Sample status donut">
                    <circle cx="40" cy="40" r="30" fill="none" stroke="#E4EDF4" strokeWidth="12" />
                    <circle cx="40" cy="40" r="30" fill="none" stroke="#2E8B68" strokeWidth="12" strokeDasharray="120 188" strokeLinecap="round" transform="rotate(-90 40 40)" />
                    <circle cx="40" cy="40" r="30" fill="none" stroke="#C58A22" strokeWidth="12" strokeDasharray="34 188" strokeLinecap="round" transform="rotate(140 40 40)" />
                  </svg>
                  <ul className="text-[0.78rem] space-y-1.5">
                    <li className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-success" /> Confirmed</li>
                    <li className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-warning" /> Pending</li>
                    <li className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-border" /> Other</li>
                  </ul>
                </div>
              </div>
            </Reveal>
            <Reveal>
              <div className="bg-white border border-border rounded-2xl p-5">
                <p className="font-bold text-navy text-[0.92rem]">Doctor utilization</p>
                <p className="text-[0.75rem] text-ink-secondary">Sample week</p>
                <div className="mt-3 space-y-2.5">
                  {[["Cardiology", "72%"], ["Orthopedics", "58%"], ["Pediatrics", "44%"]].map(([d, w]) => (
                    <div key={d as string}>
                      <div className="flex justify-between text-[0.75rem] font-medium"><span className="text-ink-secondary">{d as string}</span><span className="text-navy tabular-nums">{w as string}</span></div>
                      <div className="h-2 bg-background rounded-full mt-1 overflow-hidden"><div className="h-full bg-teal rounded-full" style={{ width: w as string }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
            <Reveal>
              <div className="bg-white border border-border rounded-2xl p-5">
                <p className="font-bold text-navy text-[0.92rem]">Workflow health</p>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {[["Running", "3", "blue"], ["Completed", "41", "green"], ["Failed", "1", "red"], ["Retried", "2", "amber"]].map(([t, v, tone]) => (
                    <div key={t as string} className="border border-border rounded-xl p-3">
                      <p className="text-[1.2rem] font-bold text-navy tabular-nums">{v as string}</p>
                      <StatusDot tone={tone as "green" | "amber" | "blue" | "red"} label={t as string} />
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
            <Reveal>
              <div className="bg-white border border-border rounded-2xl p-5">
                <p className="font-bold text-navy text-[0.92rem]">AI activity</p>
                <ul className="mt-3 space-y-0 relative">
                  {["Availability check completed", "Doctor search completed", "Escalation resolved"].map((t, i, arr) => (
                    <li key={t} className="flex gap-2.5 pb-3 last:pb-0 relative">
                      {i < arr.length - 1 && <span className="absolute left-[5px] top-4 bottom-0 w-px bg-border" aria-hidden />}
                      <span className="w-[11px] h-[11px] rounded-full bg-healthcare shrink-0 mt-1" aria-hidden />
                      <span className="text-[0.82rem] font-medium">{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal>
              <div className="bg-white border border-border rounded-2xl p-5">
                <p className="font-bold text-navy text-[0.92rem]">Operational alerts</p>
                <ul className="mt-3 space-y-2 text-[0.82rem]">
                  <li className="flex gap-2 bg-warning-soft border border-warning/25 rounded-xl px-3 py-2.5"><Bell size={15} className="text-warning shrink-0 mt-0.5" /> 1 verification awaiting review</li>
                  <li className="flex gap-2 bg-background border border-border rounded-xl px-3 py-2.5"><CheckCircle2 size={15} className="text-success shrink-0 mt-0.5" /> Nightly sync completed</li>
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ----------------------------- SECURITY ----------------------------- */}
      <section id="security" className="bg-background border-y border-border scroll-mt-20">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-14 lg:py-20 grid lg:grid-cols-2 gap-10">
          <Reveal>
            <SectionHead
              eyebrow="Trust"
              title="Designed around controlled access."
              sub="Hospital data stays hospital-scoped. Every sensitive action is authenticated, authorized, and audited."
            />
            <ul className="mt-7 space-y-3">
              {[
                [Lock, "Secure authentication", "Password-based sign-in with hashed credentials and short-lived sessions."],
                [Users, "Role-based access", "Hospital admins, doctors, and staff each see only what their role allows."],
                [Building2, "Hospital-scoped data", "One hospital can never access another hospital's private data."],
                [ShieldCheck, "Audited AI capabilities", "Every AI-assisted action is validated, permission-checked, and logged."],
                [FileText, "Operational audit trail", "Logins, appointments, configuration changes, and recoveries are recorded."],
              ].map(([Icon, title, body]) => {
                const I = Icon as typeof Building2;
                return (
                  <li key={title as string} className="flex gap-3">
                    <span className="w-9 h-9 rounded-lg bg-white border border-border text-healthcare flex items-center justify-center shrink-0">
                      <I size={17} />
                    </span>
                    <span>
                      <span className="block font-bold text-navy text-[0.92rem]">{title as string}</span>
                      <span className="block text-ink-secondary text-[0.875rem] mt-0.5">{body as string}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Reveal>
          <Reveal>
            <div className="h-full bg-navy text-white rounded-2xl p-6 sm:p-8">
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-white/60">How access is enforced</p>
              <ul className="mt-4 space-y-3 text-[0.9rem] leading-relaxed">
                <li className="bg-white/[0.07] border border-white/10 rounded-xl px-4 py-3">Sign in → identity and hospital scope resolved from the server record.</li>
                <li className="bg-white/[0.07] border border-white/10 rounded-xl px-4 py-3">Every request → role check, then hospital filter applied at the query layer.</li>
                <li className="bg-white/[0.07] border border-white/10 rounded-xl px-4 py-3">Every AI action → permission check, validation, and audit entry.</li>
              </ul>
              <p className="text-white/60 text-[0.8rem] mt-4">No exaggerated claims — controls are implemented in code and verified by tests.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------- ONBOARDING ----------------------------- */}
      <section id="onboarding" className="scroll-mt-20">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-14 lg:py-20">
          <Reveal>
            <SectionHead
              eyebrow="Onboarding"
              title="Get your hospital ready in a few steps."
            />
          </Reveal>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-9">
            {[
              [Building2, "01 · Create Hospital", "Register your hospital and administrator account for review."],
              [ClipboardList, "02 · Configure Departments & Specialties", "Set up clinical units and care categories."],
              [Stethoscope, "03 · Add Doctors & Appointment Types", "Invite doctors, define visit types and availability."],
              [CalendarDays, "04 · Start Managing Care", "Publish availability and manage daily operations."],
            ].map(([Icon, title, body]) => {
              const I = Icon as typeof Building2;
              return (
                <li key={title as string} className="bg-white border border-border rounded-2xl p-6">
                  <span className="w-10 h-10 rounded-xl bg-teal-soft text-teal-dark flex items-center justify-center">
                    <I size={19} />
                  </span>
                  <p className="font-bold text-navy text-[0.95rem] mt-4">{title as string}</p>
                  <p className="text-ink-secondary text-[0.875rem] mt-1.5 leading-relaxed">{body as string}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* ------------------------------ FINAL CTA ------------------------------ */}
      <section className="max-w-shell mx-auto px-4 sm:px-6 pb-14">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl bg-healthcare-faint border border-healthcare/25 px-6 py-12 sm:p-14 text-center">
            <svg className="absolute inset-0 w-full h-full" aria-hidden preserveAspectRatio="none" viewBox="0 0 800 300">
              <path d="M-20 220 C150 200 220 140 380 150 C540 160 600 220 820 190" fill="none" stroke="#1769AA" strokeOpacity="0.18" strokeWidth="2" />
              <path d="M-20 250 C160 235 260 180 420 190 C580 200 640 250 820 225" fill="none" stroke="#168C8C" strokeOpacity="0.16" strokeWidth="2" />
              <circle cx="380" cy="150" r="4" fill="#168C8C" fillOpacity="0.35" />
              <circle cx="540" cy="168" r="4" fill="#1769AA" fillOpacity="0.3" />
            </svg>
            <div className="relative">
              <h2 className="text-[1.6rem] sm:text-[2rem] font-bold text-navy tracking-tight">
                Bring your hospital operations into one place.
              </h2>
              <p className="text-ink-secondary text-[1rem] mt-3 max-w-[58ch] mx-auto">
                Configure your hospital, manage your care team, monitor appointments, and gain
                operational visibility with CareFlow AI.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-2.5 mt-7">
                <Link
                  to="/register"
                  className="inline-flex items-center justify-center gap-2 bg-healthcare hover:bg-healthcare-dark text-white font-semibold rounded-control px-7 py-3 text-[0.95rem] transition-colors duration-200"
                >
                  Get Started <ArrowRight size={16} />
                </Link>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center bg-white border border-border hover:border-healthcare hover:text-healthcare font-semibold rounded-control px-7 py-3 text-[0.95rem] transition-colors duration-200"
                >
                  Sign In
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* -------------------------------- FOOTER -------------------------------- */}
      <footer className="border-t border-border bg-white">
        <div className="max-w-shell mx-auto px-4 sm:px-6 py-12 grid sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr] gap-8">
          <div>
            <CareFlowLogo tagline />
            <p className="text-ink-secondary text-[0.875rem] leading-relaxed mt-4 max-w-[34ch]">
              Healthcare scheduling and hospital operations platform.
            </p>
          </div>
          <nav aria-label="Platform">
            <p className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-ink-faint">Platform</p>
            <ul className="mt-3 space-y-2 text-[0.875rem]">
              {["Hospital Admin", "Doctor", "Patient", "AI Assistant", "Analytics", "Integrations"].map((s) => (
                <li key={s}><span className="text-ink-secondary">{s}</span></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Resources">
            <p className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-ink-faint">Resources</p>
            <ul className="mt-3 space-y-2 text-[0.875rem]">
              {["Documentation", "Security", "Help Center", "Contact"].map((s) => (
                <li key={s}><span className="text-ink-secondary">{s}</span></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Company">
            <p className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-ink-faint">Company</p>
            <ul className="mt-3 space-y-2 text-[0.875rem]">
              {["About", "Privacy", "Terms"].map((s) => (
                <li key={s}><span className="text-ink-secondary">{s}</span></li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="border-t border-border">
          <div className="max-w-shell mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row gap-2 items-center justify-between text-[0.78rem] text-ink-secondary">
            <p>© 2026 CareFlow AI. All rights reserved.</p>
            <p className="flex gap-4">
              <Link to="/login" className="hover:text-healthcare font-medium">Sign In</Link>
              <Link to="/register" className="hover:text-healthcare font-medium">Get Started</Link>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
