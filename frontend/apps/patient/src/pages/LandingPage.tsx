import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Baby,
  BadgeCheck,
  Bell,
  Bone,
  Building2,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Globe,
  HeartPulse,
  Inbox,
  Languages,
  Lock,
  MapPin,
  MessageCircle,
  Mic,
  Phone,
  Search,
  ShieldCheck,
  Siren,
  Sparkles,
  Star,
  Stethoscope,
  Sun,
  Video,
} from "lucide-react";
import { Logo } from "../components/layout/PatientShell";
import PublicNav from "../components/layout/PublicNav";

/* ------------------------------------------------------------------ */
/* Reveal on scroll — subtle, once, respects reduced motion via CSS.   */
/* ------------------------------------------------------------------ */

function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -48px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pro primitives: safe images, scrolled state                        */
/* ------------------------------------------------------------------ */

function SafeImg({
  src,
  alt,
  className = "",
  eager = false,
  fallbackLabel = "CF",
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
  fallbackLabel?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={`flex items-center justify-center bg-gradient-to-br from-healthcare-soft to-teal-soft font-extrabold text-healthcare ${className}`}
      >
        {fallbackLabel}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Data (illustrative preview content)                                 */
/* ------------------------------------------------------------------ */

type Doctor = {
  id: string;
  name: string;
  specialty: string;
  hospital: string;
  photo: string;
  rating: string;
  reviews: string;
  experience: string;
  distance: string;
  next: string;
  modes: string[];
  languages: string[];
  specialtyIcon: typeof HeartPulse;
  accent: string;
};

const DOCTORS: Doctor[] = [
  {
    id: "cardio",
    name: "Dr. Ananya Rao",
    specialty: "Cardiology",
    hospital: "City General Hospital",
    photo: "https://randomuser.me/api/portraits/women/44.jpg",
    rating: "4.9",
    reviews: "212",
    experience: "12 yrs",
    distance: "2.1 km",
    next: "Tue · 10:30 AM",
    modes: ["In-person", "Video"],
    languages: ["English", "Hindi"],
    specialtyIcon: HeartPulse,
    accent: "bg-rose-50 text-rose-600",
  },
  {
    id: "derm",
    name: "Dr. Meera Krishnan",
    specialty: "Dermatology",
    hospital: "Lakeside Medical Centre",
    photo: "https://randomuser.me/api/portraits/women/68.jpg",
    rating: "4.8",
    reviews: "168",
    experience: "9 yrs",
    distance: "3.4 km",
    next: "Wed · 11:15 AM",
    modes: ["In-person", "Video"],
    languages: ["English", "Tamil"],
    specialtyIcon: Sun,
    accent: "bg-amber-50 text-amber-600",
  },
  {
    id: "ortho",
    name: "Dr. James Verghese",
    specialty: "Orthopedics",
    hospital: "St. Mary's Hospital",
    photo: "https://randomuser.me/api/portraits/men/32.jpg",
    rating: "4.9",
    reviews: "304",
    experience: "15 yrs",
    distance: "4.0 km",
    next: "Thu · 9:00 AM",
    modes: ["In-person"],
    languages: ["English", "Malayalam"],
    specialtyIcon: Bone,
    accent: "bg-sky-50 text-sky-700",
  },
  {
    id: "peds",
    name: "Dr. Sara Pillai",
    specialty: "Pediatrics",
    hospital: "Sunrise Children's Hospital",
    photo: "https://randomuser.me/api/portraits/women/12.jpg",
    rating: "5.0",
    reviews: "141",
    experience: "8 yrs",
    distance: "1.6 km",
    next: "Today · 4:45 PM",
    modes: ["In-person", "Phone"],
    languages: ["English", "Hindi"],
    specialtyIcon: Baby,
    accent: "bg-teal-50 text-teal-700",
  },
];

const HOSPITALS = [
  {
    name: "City General Hospital",
    area: "Central District · 2.1 km",
    tags: ["Multi-specialty", "Emergency 24/7"],
    img: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=70",
    note: "Open today · New slots",
    departments: "24 departments",
    emergency: true,
  },
  {
    name: "Lakeside Medical Centre",
    area: "Lakeside · 3.4 km",
    tags: ["Outpatient", "Diagnostics"],
    img: "https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=800&q=70",
    note: "High availability",
    departments: "14 departments",
    emergency: false,
  },
  {
    name: "St. Mary's Hospital",
    area: "North Wing · 4.0 km",
    tags: ["Surgical", "Specialty care"],
    img: "https://images.unsplash.com/photo-1538108149393-fbbd81895907?auto=format&fit=crop&w=800&q=70",
    note: "New slots weekly",
    departments: "18 departments",
    emergency: true,
  },
];

const SPECIALTY_CHIPS = [
  { label: "Cardiology", icon: HeartPulse },
  { label: "Dermatology", icon: Sun },
  { label: "Orthopedics", icon: Bone },
  { label: "Pediatrics", icon: Baby },
  { label: "General Care", icon: Stethoscope },
];

const FAQS = [
  {
    q: "Is CareFlow AI a doctor? Will it diagnose me?",
    a: "No. CareFlow AI is a scheduling and care-navigation assistant only. It helps you discover doctors, compare availability, and book — it never provides diagnosis, prescriptions, or emergency care.",
  },
  {
    q: "How do I reschedule or cancel an appointment?",
    a: "Open Visits, choose the appointment, then select Reschedule or Cancel. Your slot is released back to the doctor's schedule immediately and confirmations update in your inbox.",
  },
  {
    q: "Is my health information private and secure?",
    a: "Yes. Sign-in is protected, health information is handled carefully, and scheduling activity stays inside your private account. Only the details needed to hold your booking are shared with the clinic.",
  },
  {
    q: "Do I need insurance to use CareFlow AI?",
    a: "No. Finding care and requesting a booking is free for patients. Bring your insurance details to the visit — the clinic confirms coverage directly.",
  },
  {
    q: "What should I do in a medical emergency?",
    a: "Call your local emergency number immediately (for example, 911 in the US or 108/112 in India). CareFlow AI is for routine scheduling and cannot handle emergencies.",
  },
];

const FILTERS = ["All", "Cardiology", "Dermatology", "Orthopedics", "Pediatrics"];

/* ------------------------------------------------------------------ */
/* Small atoms                                                         */
/* ------------------------------------------------------------------ */

function Stars() {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-400" aria-label="Rated highly by patients">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} size={13} fill="currentColor" strokeWidth={0} />
      ))}
    </span>
  );
}

function ModePill({ mode }: { mode: string }) {
  const Icon = mode === "Video" ? Video : mode === "Phone" ? Phone : Building2;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[0.7rem] font-bold text-slate-600">
      <Icon size={11} /> {mode}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function LandingPage() {
  const navigate = useNavigate();
  const [specialty, setSpecialty] = useState("");
  const [location, setLocation] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [heroSlot, setHeroSlot] = useState("10:30 AM");
  const [heroMode, setHeroMode] = useState("In-person");
  const [voiceLine, setVoiceLine] = useState("Reschedule my cardiology visit to Thursday morning…");

  function submitSearch(e?: React.FormEvent) {
    e?.preventDefault();
    navigate("/book", { state: { query: specialty || "Cardiology", location: location || "Near me" } });
  }

  const visibleDoctors = activeFilter === "All" ? DOCTORS : DOCTORS.filter((d) => d.specialty === activeFilter);

  return (
    <div className="min-h-screen bg-[#F6F9FC] font-sans text-ink antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:border focus:border-healthcare focus:bg-white focus:px-4 focus:py-2 focus:text-navy"
      >
        Skip to content
      </a>

      <PublicNav />

      <main id="main">
        {/* ================= HERO ================= */}
        <section aria-labelledby="hero-heading" className="relative overflow-hidden">
          {/* backdrop: soft clinical gradient + plus pattern */}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#EFF6FB_0%,#F6F9FC_55%,#F6F9FC_100%)]" aria-hidden />
          <div
            className="absolute inset-0 opacity-[0.5]"
            aria-hidden
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(18,59,93,0.10) 1px, transparent 0)",
              backgroundSize: "26px 26px",
              maskImage: "linear-gradient(180deg, black 0%, transparent 75%)",
              WebkitMaskImage: "linear-gradient(180deg, black 0%, transparent 75%)",
            }}
          />
          <div className="absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full bg-teal-soft/70 blur-3xl" aria-hidden />
          <div className="absolute -left-40 top-40 h-[380px] w-[380px] rounded-full bg-healthcare-soft/80 blur-3xl" aria-hidden />

          <div className="relative mx-auto grid max-w-[1280px] items-center gap-12 px-4 pb-14 pt-10 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:pb-20 lg:pt-16">
            {/* Left copy */}
            <Reveal>
              <div>
                <p className="inline-flex items-center gap-2 rounded-full border border-healthcare/20 bg-white/80 py-1.5 pl-2 pr-4 text-[0.76rem] font-bold text-navy shadow-sm backdrop-blur">
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal px-2.5 py-1 text-[0.68rem] font-extrabold uppercase tracking-wider text-white">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
                  </span>
                  Hospital-connected · Real availability
                </p>
                <h1 id="hero-heading" className="mt-5 text-[2.5rem] font-extrabold leading-[1.06] tracking-[-0.03em] text-navy-deep sm:text-[3.4rem] lg:text-[3.9rem]">
                  Find the right care,
                  <br />
                  <span className="relative whitespace-nowrap">
                    without the waiting.
                    <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none" aria-hidden>
                      <path d="M4 8C60 3 180 2 296 7" stroke="#168C8C" strokeWidth="5" strokeLinecap="round" opacity="0.35" />
                    </svg>
                  </span>
                </h1>
                <p className="mt-5 max-w-xl text-[1.05rem] leading-relaxed text-slate-600">
                  Discover doctors and hospitals, check real-time availability, and book your appointment in just a few
                  simple steps — all in one calm, secure place.
                </p>

                {/* Integrated search bar */}
                <form
                  onSubmit={submitSearch}
                  role="search"
                  aria-label="Find care"
                  className="mt-7 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_20px_50px_-20px_rgba(14,46,74,0.35)] sm:rounded-full sm:flex-row sm:items-center"
                >
                  <label className="flex flex-1 items-center gap-2.5 rounded-xl px-4 py-2.5 sm:rounded-full">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-healthcare-soft text-healthcare">
                      <Stethoscope size={17} />
                    </span>
                    <span className="flex-1 text-left">
                      <span className="block text-[0.68rem] font-extrabold uppercase tracking-wider text-slate-400">Specialty</span>
                      <input
                        value={specialty}
                        onChange={(e) => setSpecialty(e.target.value)}
                        placeholder="Cardiology, skin, knee…"
                        aria-label="What care do you need?"
                        className="w-full bg-transparent text-[0.95rem] font-semibold text-navy outline-none placeholder:font-medium placeholder:text-slate-400"
                      />
                    </span>
                  </label>
                  <span className="hidden h-10 w-px bg-slate-200 sm:block" aria-hidden />
                  <label className="flex flex-1 items-center gap-2.5 rounded-xl px-4 py-2.5 sm:rounded-full">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-soft text-teal-dark">
                      <MapPin size={17} />
                    </span>
                    <span className="flex-1 text-left">
                      <span className="block text-[0.68rem] font-extrabold uppercase tracking-wider text-slate-400">Location</span>
                      <input
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Near me"
                        aria-label="Where?"
                        className="w-full bg-transparent text-[0.95rem] font-semibold text-navy outline-none placeholder:font-medium placeholder:text-slate-400"
                      />
                    </span>
                  </label>
                  <button
                    type="submit"
                    className="inline-flex min-h-[3.2rem] items-center justify-center gap-2 rounded-xl bg-healthcare px-7 text-[0.95rem] font-bold text-white transition hover:bg-healthcare-dark sm:rounded-full"
                  >
                    <Search size={17} /> Search
                  </button>
                </form>

                {/* Social proof */}
                <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <span className="flex -space-x-2.5">
                    {DOCTORS.map((d) => (
                      <SafeImg
                        key={d.id}
                        src={d.photo}
                        alt=""
                        fallbackLabel={d.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                        className="h-9 w-9 rounded-full border-2 border-white shadow-sm"
                      />
                    ))}
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-navy text-[0.65rem] font-extrabold text-white">
                      24/7
                    </span>
                  </span>
                  <span>
                    <Stars />
                    <span className="mt-0.5 block text-[0.8rem] font-medium text-slate-500">
                      Real availability · Simple booking · Care when you need it
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[0.74rem] font-bold text-slate-500">
                    <Lock size={12} className="text-emerald-600" /> Private by design
                  </span>
                </div>

                {/* Specialty shortcuts — set the search field */}
                <div className="mt-5 flex flex-wrap items-center gap-2" aria-label="Popular specialties">
                  <span className="text-[0.76rem] font-extrabold uppercase tracking-wider text-slate-400">Popular:</span>
                  {SPECIALTY_CHIPS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => setSpecialty(c.label === "General Care" ? "General Physician" : c.label)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[0.8rem] font-bold transition ${
                        specialty === c.label || specialty === "General Physician" && c.label === "General Care"
                          ? "border-navy bg-navy text-white"
                          : "border-slate-200 bg-white/70 text-healthcare backdrop-blur hover:border-healthcare hover:bg-healthcare-faint"
                      }`}
                    >
                      <c.icon size={13} /> {c.label}
                    </button>
                  ))}
                </div>

                <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200/60 bg-amber-50/70 px-3.5 py-2.5 text-[0.78rem] font-medium leading-relaxed text-slate-600">
                  <Siren size={15} className="mt-0.5 shrink-0 text-amber-600" />
                  <span>
                    Medical emergency? Call <a href="tel:911" className="font-extrabold text-navy underline">911</a> now —
                    CareFlow AI is for routine scheduling only.
                  </span>
                </p>

                <div className="mt-4 flex flex-wrap gap-2" aria-label="Quick links">
                  {["Find a Doctor", "Find a Hospital", "Check Availability", "Book Appointment"].map((q) => (
                    <Link
                      key={q}
                      to="/book"
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/70 px-3.5 py-1.5 text-[0.8rem] font-bold text-healthcare backdrop-blur transition hover:border-healthcare hover:bg-healthcare-faint"
                    >
                      {q} <ChevronRight size={13} />
                    </Link>
                  ))}
                </div>
              </div>
            </Reveal>

            {/* Right composition — interactive preview */}
            <Reveal delay={140}>
              <div className="relative mx-auto w-full max-w-[520px]">
                {/* Main booking card */}
                <div className="relative z-10 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_32px_80px_-24px_rgba(14,46,74,0.4)]">
                  <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden />
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden />
                    <span className="h-2.5 w-2.5 rounded-full bg-teal/60" aria-hidden />
                    <p className="ml-2 text-[0.76rem] font-bold text-navy">Book an appointment</p>
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.68rem] font-bold text-emerald-700">
                      <ShieldCheck size={11} /> Secure
                    </span>
                  </div>
                  <div className="space-y-4 p-5">
                    <div className="flex items-center gap-3.5 rounded-2xl border bg-slate-50/60 p-3.5" style={{ borderColor: "#E6EEF3" }}>
                      <SafeImg src={DOCTORS[0].photo} alt="Dr. Ananya Rao" fallbackLabel="AR" className="h-14 w-14 rounded-2xl" eager />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[0.95rem] font-extrabold text-navy">
                          Dr. Ananya Rao
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-navy px-1.5 py-0.5 text-[0.64rem] font-extrabold text-white">
                            <BadgeCheck size={10} /> Verified
                          </span>
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[0.68rem] font-extrabold text-amber-600">
                            <Star size={10} fill="currentColor" strokeWidth={0} /> 4.9
                          </span>
                        </p>
                        <p className="truncate text-[0.78rem] font-medium text-slate-500">Cardiologist · City General Hospital · 12 yrs</p>
                        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[0.72rem] font-bold text-emerald-700">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> {DOCTORS[0].modes.length} modes · Next {heroSlot}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 flex items-center justify-between text-[0.74rem] font-extrabold uppercase tracking-wider text-slate-400">
                        <span>Available times · Tue, 24 Sep</span>
                        <span className="font-bold normal-case tracking-normal text-emerald-600">4 open</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Try selecting a time slot">
                        {["09:30 AM", "10:30 AM", "11:15 AM", "02:00 PM"].map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setHeroSlot(t)}
                            aria-pressed={heroSlot === t}
                            className={`rounded-xl px-3.5 py-2 text-[0.8rem] font-bold transition ${
                              heroSlot === t
                                ? "bg-navy text-white shadow-[0_8px_16px_-6px_rgba(14,46,74,0.5)]"
                                : "border border-slate-200 bg-white text-navy hover:border-navy"
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-[0.74rem] font-extrabold uppercase tracking-wider text-slate-400">Consultation mode</p>
                      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Try selecting a consultation mode">
                        {[
                          { m: "In-person", icon: Building2 },
                          { m: "Video", icon: Video },
                          { m: "Phone", icon: Phone },
                        ].map(({ m, icon: Icon }) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setHeroMode(m)}
                            aria-pressed={heroMode === m}
                            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[0.76rem] font-bold transition ${
                              heroMode === m
                                ? "bg-navy text-white shadow-[0_8px_16px_-6px_rgba(14,46,74,0.5)]"
                                : "border border-slate-200 bg-white text-slate-500 hover:border-navy hover:text-navy"
                            }`}
                          >
                            <Icon size={13} /> {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate("/book")}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-3.5 text-[0.9rem] font-bold text-white transition hover:bg-healthcare-dark"
                    >
                      Continue to book <ArrowRight size={16} />
                    </button>
                    <p className="text-center text-[0.72rem] font-medium text-slate-400">
                      Tue, 24 Sep · {heroSlot} · {heroMode} · Free to reschedule
                    </p>
                  </div>
                </div>

                {/* Floating AI card */}
                <div className="absolute -right-3 z-20 w-[210px] rounded-2xl border border-slate-200/80 bg-white/95 p-3.5 shadow-[0_20px_50px_-16px_rgba(14,46,74,0.45)] backdrop-blur sm:-right-8" aria-hidden>
                  <p className="flex items-center gap-1.5 text-[0.72rem] font-extrabold text-navy">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal text-white">
                      <Sparkles size={12} />
                    </span>
                    CareFlow AI
                  </p>
                  <p className="mt-2 rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2 text-[0.74rem] font-medium leading-snug text-slate-600">
                    Found 3 cardiologists open this week near you.
                  </p>
                </div>

                {/* Floating confirmation */}
                <div className="absolute -bottom-6 -left-3 z-20 flex items-center gap-2.5 rounded-2xl border border-emerald-100 bg-white/95 p-3.5 pr-5 shadow-[0_20px_50px_-16px_rgba(46,139,104,0.5)] backdrop-blur sm:-left-8" aria-hidden>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check size={17} strokeWidth={3} />
                  </span>
                  <span>
                    <span className="block text-[0.82rem] font-extrabold text-navy">Appointment confirmed</span>
                    <span className="block text-[0.72rem] font-medium text-slate-500">Tue {heroSlot} · {heroMode} · Room 204</span>
                  </span>
                </div>
              </div>
            </Reveal>
          </div>

          {/* Hospital strip */}
          <div className="relative border-t border-slate-200/70 bg-white/60 backdrop-blur">
            <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-4 sm:px-6">
              <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-slate-400">Connected hospitals & clinics</p>
              {["City General", "Lakeside Medical", "St. Mary's", "Sunrise Children's", "MetroCare", "Northside Clinic"].map((h) => (
                <span key={h} className="inline-flex items-center gap-1.5 text-[0.86rem] font-extrabold text-slate-400">
                  <Building2 size={14} /> {h}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ================= VALUE PROPS (minimal, no boxes) ================= */}
        <section aria-label="Why CareFlow AI" className="bg-white">
          <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:py-16">
            {[
              { icon: CalendarCheck, tint: "bg-sky-50 text-healthcare", title: "Real Availability", body: "Appointment times drawn from actual doctor schedules — not guesswork." },
              { icon: ClipboardList, tint: "bg-teal-soft text-teal-dark", title: "Simple Booking", body: "Doctor, visit type, mode, date and time — confirmed in minutes." },
              { icon: ShieldCheck, tint: "bg-emerald-50 text-emerald-700", title: "Secure & Private", body: "Protected sign-in and careful handling of your health information." },
              { icon: Sparkles, tint: "bg-indigo-50 text-indigo-600", title: "AI-Assisted", body: "Guidance finding and scheduling care — never diagnosis." },
            ].map((t, i) => (
              <Reveal key={t.title} delay={i * 70}>
                <div className="flex gap-4">
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${t.tint}`} aria-hidden>
                    <t.icon size={22} />
                  </span>
                  <span>
                    <span className="block text-[1rem] font-extrabold text-navy">{t.title}</span>
                    <span className="mt-1 block text-[0.88rem] leading-relaxed text-slate-500">{t.body}</span>
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ================= HOW IT WORKS ================= */}
        <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-24 bg-[#F6F9FC]">
          <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:py-24">
            <Reveal>
              <div className="mx-auto max-w-2xl text-center">
                <p className="text-[0.74rem] font-extrabold uppercase tracking-[0.16em] text-teal-dark">How it works</p>
                <h2 id="how-heading" className="mt-3 text-[1.9rem] font-extrabold tracking-[-0.02em] text-navy-deep sm:text-[2.5rem]">
                  Healthcare, made simpler.
                </h2>
                <p className="mt-3 text-[1rem] leading-relaxed text-slate-500">
                  From finding the right doctor to managing your visit — one connected scheduling experience.
                </p>
              </div>
            </Reveal>
            <ol className="relative mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <span className="absolute left-0 right-0 top-10 hidden border-t-2 border-dashed border-slate-200 lg:block" aria-hidden />
              {[
                { n: "01", icon: Search, title: "Find Care", body: "Search by specialty, location, and consultation mode." },
                { n: "02", icon: Clock, title: "Check Availability", body: "See open slots based on real doctor schedules." },
                { n: "03", icon: CalendarCheck, title: "Book Your Visit", body: "Pick type, mode, date and time — done." },
                { n: "04", icon: Bell, title: "Stay Connected", body: "Visits, reminders, forms and messages in one place." },
              ].map((s, i) => (
                <Reveal key={s.n} delay={i * 80}>
                  <li className="group relative h-full rounded-[20px] border border-slate-200/80 bg-white p-6 transition-all hover:-translate-y-1 hover:shadow-[0_24px_50px_-20px_rgba(14,46,74,0.35)]">
                    <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-navy text-white shadow-[0_10px_20px_-8px_rgba(14,46,74,0.6)]">
                      <s.icon size={21} />
                      <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-teal text-[0.62rem] font-extrabold text-white">
                        {i + 1}
                      </span>
                    </span>
                    <p className="mt-5 text-[0.72rem] font-extrabold tracking-[0.18em] text-slate-300">{s.n}</p>
                    <h3 className="mt-1 text-[1.05rem] font-extrabold text-navy">{s.title}</h3>
                    <p className="mt-1.5 text-[0.88rem] leading-relaxed text-slate-500">{s.body}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ================= AI ASSISTANT ================= */}
        <section id="ai-assistant" aria-labelledby="ai-heading" className="scroll-mt-24 bg-white">
          <div className="mx-auto grid max-w-[1280px] items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
            <Reveal>
              <div>
                <p className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3.5 py-1.5 text-[0.74rem] font-extrabold text-indigo-700">
                  <Sparkles size={13} /> SCHEDULING ASSISTANT
                </p>
                <h2 id="ai-heading" className="mt-4 text-[1.9rem] font-extrabold leading-[1.12] tracking-[-0.02em] text-navy-deep sm:text-[2.5rem]">
                  Not sure where to start?
                  <br />
                  Just ask.
                </h2>
                <p className="mt-4 max-w-lg text-[1.02rem] leading-relaxed text-slate-500">
                  CareFlow AI helps you discover doctors, compare availability, and guides you into booking — in plain
                  language.
                </p>
                <ul className="mt-6 space-y-3">
                  {["Describe the care you need naturally", "Compare specialists by time, place and mode", "Jump straight into booking — no phone tag"].map((li) => (
                    <li key={li} className="flex items-center gap-3 text-[0.93rem] font-medium text-navy">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" aria-hidden>
                        <Check size={13} strokeWidth={3} />
                      </span>
                      {li}
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigate("/chat")}
                    className="inline-flex min-h-[3rem] items-center gap-2 rounded-xl bg-navy px-6 text-[0.95rem] font-bold text-white transition hover:bg-navy-deep"
                  >
                    <MessageCircle size={17} /> Try the assistant
                  </button>
                  <p className="inline-flex items-center gap-1.5 text-[0.78rem] font-medium text-slate-500">
                    <ShieldCheck size={14} className="text-teal-dark" /> Scheduling help only — never diagnosis.
                  </p>
                </div>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-[#F6F9FC] shadow-[0_32px_80px_-28px_rgba(14,46,74,0.45)]">
                <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-5 py-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-white" aria-hidden>
                    <Sparkles size={17} />
                  </span>
                  <span>
                    <span className="block text-[0.9rem] font-extrabold text-navy">CareFlow AI</span>
                    <span className="flex items-center gap-1.5 text-[0.72rem] font-bold text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online · replies instantly
                    </span>
                  </span>
                </div>
                <div className="space-y-3 p-5" role="img" aria-label="Example: patient asks for a cardiologist, assistant shows two available doctors">
                  <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-navy px-4 py-2.5 text-[0.87rem] font-medium text-white">
                    I need a cardiologist this week.
                  </p>
                  <p className="w-fit max-w-[88%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-2.5 text-[0.87rem] text-slate-600 shadow-sm">
                    I found cardiology specialists available this week near you:
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {DOCTORS.slice(0, 2).map((d) => (
                      <div key={d.id} className="rounded-2xl border border-slate-200 bg-white p-3.5">
                        <span className="flex items-center gap-2.5">
                          <SafeImg src={d.photo} alt="" fallbackLabel={d.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} className="h-10 w-10 rounded-full" />
                          <span className="min-w-0">
                            <span className="block truncate text-[0.84rem] font-extrabold text-navy">{d.name}</span>
                            <span className="block truncate text-[0.72rem] font-medium text-slate-500">{d.specialty}</span>
                          </span>
                        </span>
                        <span className="mt-2.5 flex items-center gap-1 text-[0.76rem] font-bold text-emerald-700">
                          <Clock size={12} /> Next: {d.next}
                        </span>
                        <span className="mt-2 block rounded-xl bg-healthcare-faint py-2 text-center text-[0.78rem] font-extrabold text-healthcare">
                          View Availability
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-4 pr-1.5">
                    <span className="flex-1 text-[0.83rem] font-medium text-slate-400">Ask about availability…</span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-healthcare text-white" aria-hidden>
                      <Mic size={15} />
                    </span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ================= DOCTORS ================= */}
        <section id="doctors" aria-labelledby="doctors-heading" className="scroll-mt-24 bg-[#F6F9FC]">
          <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:py-24">
            <Reveal>
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="max-w-2xl">
                  <p className="text-[0.74rem] font-extrabold uppercase tracking-[0.16em] text-teal-dark">Doctor discovery</p>
                  <h2 id="doctors-heading" className="mt-3 text-[1.9rem] font-extrabold tracking-[-0.02em] text-navy-deep sm:text-[2.5rem]">
                    Find care that fits your needs.
                  </h2>
                  <p className="mt-3 text-slate-500">Verified profiles with clear availability, modes and hospital information.</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/book")}
                  className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-5 py-3 text-[0.88rem] font-bold text-navy transition hover:border-navy"
                >
                  Browse all doctors <ArrowRight size={16} />
                </button>
              </div>
            </Reveal>
            <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Filter by specialty">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={activeFilter === f}
                  onClick={() => setActiveFilter(f)}
                  className={`rounded-full px-4 py-2 text-[0.83rem] font-bold transition ${
                    activeFilter === f ? "bg-navy text-white shadow" : "border border-slate-200 bg-white text-slate-500 hover:border-navy hover:text-navy"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {visibleDoctors.map((d, i) => (
                <Reveal key={d.id} delay={i * 70}>
                  <article className="group flex h-full flex-col overflow-hidden rounded-[20px] border border-slate-200/80 bg-white transition-all hover:-translate-y-1.5 hover:shadow-[0_28px_60px_-20px_rgba(14,46,74,0.4)]">
                    <div className="relative h-52 overflow-hidden bg-slate-100">
                      <SafeImg
                        src={d.photo}
                        alt={`Portrait of ${d.name}`}
                        fallbackLabel={d.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                        className="h-full w-full object-top transition-transform duration-500 group-hover:scale-105"
                      />
                      <span className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.7rem] font-extrabold ${d.accent}`}>
                        <d.specialtyIcon size={12} /> {d.specialty}
                      </span>
                      <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[0.72rem] font-extrabold text-navy backdrop-blur">
                        <Star size={11} className="text-amber-400" fill="currentColor" strokeWidth={0} /> {d.rating} <span className="font-medium text-slate-400">({d.reviews})</span>
                      </span>
                      <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-navy-deep/85 px-2.5 py-1 text-[0.68rem] font-extrabold text-white backdrop-blur">
                        <BadgeCheck size={11} /> Verified profile
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <h3 className="text-[1.02rem] font-extrabold text-navy">{d.name}</h3>
                      <p className="mt-1 flex items-center gap-1.5 text-[0.8rem] font-medium text-slate-500">
                        <Building2 size={13} /> {d.hospital}
                      </p>
                      <p className="mt-1 text-[0.76rem] font-medium text-slate-400">{d.experience} experience · {d.distance} away</p>
                      <p className="mt-2 flex items-center gap-1.5 text-[0.74rem] font-medium text-slate-500">
                        <Languages size={13} className="text-slate-400" /> {d.languages.join(" · ")}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {d.modes.map((m) => (
                          <ModePill key={m} mode={m} />
                        ))}
                      </div>
                      <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[0.76rem] font-bold text-emerald-700">
                        <Clock size={13} /> Next: {d.next}
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => navigate("/book", { state: { query: d.specialty } })}
                          className="rounded-xl border border-slate-200 py-2.5 text-[0.84rem] font-bold text-navy transition hover:border-navy"
                        >
                          Profile
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate("/book", { state: { query: d.specialty } })}
                          className="rounded-xl bg-navy py-2.5 text-[0.84rem] font-bold text-white transition group-hover:bg-healthcare"
                        >
                          Book visit
                        </button>
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
            <p className="mt-5 text-center text-[0.76rem] text-slate-400">Illustrative preview — real availability appears after sign-in.</p>

            {/* Hospitals */}
            <div id="hospitals" className="mt-14 scroll-mt-28">
              <Reveal>
                <div className="flex items-end justify-between gap-4">
                  <h3 className="text-[1.35rem] font-extrabold tracking-tight text-navy-deep">Nearby hospitals</h3>
                  <button type="button" onClick={() => navigate("/book")} className="inline-flex items-center gap-1 text-[0.86rem] font-bold text-healthcare hover:underline">
                    View all <ArrowRight size={15} />
                  </button>
                </div>
              </Reveal>
              <div className="mt-5 grid gap-5 md:grid-cols-3">
                {HOSPITALS.map((h, i) => (
                  <Reveal key={h.name} delay={i * 80}>
                    <article className="group overflow-hidden rounded-[20px] border border-slate-200/80 bg-white transition-all hover:-translate-y-1 hover:shadow-[0_28px_60px_-20px_rgba(14,46,74,0.4)]">
                      <div className="relative h-44 overflow-hidden bg-slate-200">
                        <SafeImg src={h.img} alt={h.name} fallbackLabel={h.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} className="h-full w-full transition-transform duration-500 group-hover:scale-105" />
                        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[0.7rem] font-extrabold text-emerald-700 backdrop-blur">
                          {h.note}
                        </span>
                        {h.emergency && (
                          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-red-600/95 px-2.5 py-1 text-[0.68rem] font-extrabold text-white backdrop-blur">
                            <Siren size={11} /> Emergency 24/7
                          </span>
                        )}
                      </div>
                      <div className="p-5">
                        <h4 className="flex items-center gap-1.5 font-extrabold text-navy">
                          {h.name} <BadgeCheck size={15} className="text-healthcare" aria-label="Verified hospital" />
                        </h4>
                        <p className="mt-1 flex items-center gap-1.5 text-[0.8rem] font-medium text-slate-500">
                          <MapPin size={13} /> {h.area} · {h.departments}
                        </p>
                        <p className="mt-3 flex flex-wrap gap-1.5">
                          {h.tags.map((t) => (
                            <span key={t} className="rounded-full bg-slate-100 px-2.5 py-1 text-[0.7rem] font-bold text-slate-600">{t}</span>
                          ))}
                        </p>
                        <button
                          type="button"
                          onClick={() => navigate("/book")}
                          className="mt-4 w-full rounded-xl border border-slate-200 py-2.5 text-[0.83rem] font-bold text-navy transition hover:border-navy"
                        >
                          Check availability
                        </button>
                      </div>
                    </article>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ================= APP DASHBOARD ================= */}
        <section aria-labelledby="appt-heading" className="bg-white">
          <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:py-24">
            <Reveal>
              <div className="mx-auto max-w-2xl text-center">
                <p className="text-[0.74rem] font-extrabold uppercase tracking-[0.16em] text-teal-dark">Appointment management</p>
                <h2 id="appt-heading" className="mt-3 text-[1.9rem] font-extrabold tracking-[-0.02em] text-navy-deep sm:text-[2.5rem]">
                  Your appointments, all in one place.
                </h2>
                <p className="mt-3 text-slate-500">Visits, video links, questionnaires and reminders — no phone calls, no paperwork.</p>
              </div>
            </Reveal>
            <Reveal delay={110}>
              <div className="mx-auto mt-10 max-w-5xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_40px_90px_-30px_rgba(14,46,74,0.45)]" role="img" aria-label="Preview of the patient dashboard with upcoming visit, inbox and reminders">
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden />
                  <span className="h-2.5 w-2.5 rounded-full bg-teal/60" aria-hidden />
                  <span className="ml-3 rounded-md bg-slate-200/70 px-24 py-2 text-[0.7rem] font-semibold text-slate-400 max-sm:hidden">careflow.ai/visits</span>
                </div>
                <div className="grid md:grid-cols-[220px_1fr_260px]">
                  {/* mini sidebar */}
                  <div className="hidden border-r border-slate-100 bg-slate-50/50 p-4 md:block" aria-hidden>
                    {[
                      { icon: Search, label: "Find Care", active: false },
                      { icon: CalendarDays, label: "Visits", active: true },
                      { icon: Inbox, label: "Inbox", active: false },
                      { icon: MessageCircle, label: "AI Assistant", active: false },
                      { icon: Mic, label: "Voice", active: false },
                    ].map((n) => (
                      <p key={n.label} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[0.8rem] font-bold ${n.active ? "bg-navy text-white" : "text-slate-500"}`}>
                        <n.icon size={15} /> {n.label}
                      </p>
                    ))}
                  </div>
                  {/* upcoming */}
                  <div className="p-5 sm:p-6">
                    <p className="flex items-center justify-between text-[0.7rem] font-extrabold uppercase tracking-[0.14em] text-slate-400">
                      <span>Upcoming appointment</span>
                      <span className="inline-flex items-center gap-1 normal-case tracking-normal text-emerald-600">
                        <Globe size={11} /> Synced with clinic
                      </span>
                    </p>
                    <div className="mt-3 rounded-2xl border border-healthcare/20 bg-healthcare-faint/60 p-4">
                      <div className="flex items-center gap-3">
                        <SafeImg src={DOCTORS[0].photo} alt="" fallbackLabel="AR" className="h-12 w-12 rounded-xl" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[0.92rem] font-extrabold text-navy">Dr. Ananya Rao · Cardiology</p>
                          <p className="text-[0.76rem] font-medium text-slate-500">City General · Room 204 · In-person</p>
                        </div>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[0.68rem] font-extrabold text-emerald-700">Confirmed</span>
                      </div>
                      <p className="mt-3 flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[0.75rem] font-bold text-navy shadow-sm">
                          <CalendarDays size={13} className="text-healthcare" /> Tue, 24 Sep · 10:30 AM
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 text-[0.75rem] font-bold text-white">
                          <Video size={13} /> Join video
                        </span>
                      </p>
                      <div className="mt-3 flex gap-2">
                        <span className="flex-1 rounded-xl bg-white py-2.5 text-center text-[0.8rem] font-bold text-navy shadow-sm">Reschedule</span>
                        <span className="flex-1 rounded-xl border border-slate-200 py-2.5 text-center text-[0.8rem] font-bold text-slate-500">Cancel</span>
                      </div>
                    </div>
                    <div className="mt-3 rounded-2xl border border-amber-200/70 bg-amber-50/70 p-3.5">
                      <p className="flex items-center justify-between text-[0.78rem] font-bold text-navy">
                        <span className="inline-flex items-center gap-1.5"><ClipboardList size={15} className="text-amber-600" /> Pre-visit questionnaire</span>
                        <span className="text-[0.72rem] font-extrabold text-amber-700">3 of 5 done</span>
                      </p>
                      <span className="mt-2 block h-2 overflow-hidden rounded-full bg-amber-100" aria-hidden>
                        <span className="block h-full w-[60%] rounded-full bg-amber-500" />
                      </span>
                      <p className="mt-1.5 text-[0.74rem] font-medium text-slate-500">Takes ~5 min · the clinic reviews it before your visit.</p>
                    </div>
                  </div>
                  {/* side column */}
                  <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-5 md:border-l md:border-t-0" aria-hidden>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="flex items-center gap-1.5 text-[0.78rem] font-extrabold text-navy">
                        <Bell size={14} className="text-healthcare" /> Reminders
                      </p>
                      <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[0.74rem] font-medium text-slate-600">Check-in opens 2 hrs before your visit</p>
                      <p className="mt-1.5 rounded-xl bg-slate-50 p-2.5 text-[0.74rem] font-medium text-slate-600">Lab results are ready to review</p>
                    </div>
                    <div className="rounded-2xl bg-navy p-4 text-white">
                      <p className="flex items-center gap-1.5 text-[0.78rem] font-extrabold"><Mic size={14} /> Voice help</p>
                      <p className="mt-1 text-[0.74rem] text-white/70">"Reschedule my Tuesday visit…"</p>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ================= VOICE + MANAGE ================= */}
        <section aria-labelledby="voice-heading" className="bg-[#F6F9FC]">
          <div className="mx-auto grid max-w-[1280px] gap-5 px-4 py-16 sm:px-6 lg:grid-cols-5 lg:py-24">
            <Reveal className="lg:col-span-3">
              <div className="flex h-full flex-col justify-center rounded-[24px] bg-navy-deep p-8 text-white sm:p-10">
                <p className="text-[0.74rem] font-extrabold uppercase tracking-[0.16em] text-teal-soft">Voice assistance</p>
                <h2 id="voice-heading" className="mt-3 text-[1.8rem] font-extrabold tracking-tight sm:text-[2.2rem]">Prefer to talk?</h2>
                <p className="mt-3 max-w-md leading-relaxed text-white/70">
                  Hands-free help with scheduling and appointment tasks — speak naturally, at your own pace.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => navigate("/voice")}
                    className="inline-flex min-h-[3rem] items-center gap-2 rounded-xl bg-white px-6 text-[0.93rem] font-bold text-navy transition hover:bg-teal-soft"
                  >
                    <Mic size={17} /> Try Voice Assistant
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2" aria-label="Try a voice command">
                  {[
                    "Reschedule my cardiology visit…",
                    "What appointments do I have?",
                    "Find a dermatologist near me",
                  ].map((cmd) => (
                    <button
                      key={cmd}
                      type="button"
                      onClick={() => setVoiceLine(cmd)}
                      aria-pressed={voiceLine === cmd}
                      className={`rounded-full px-3.5 py-1.5 text-[0.76rem] font-bold transition ${
                        voiceLine === cmd ? "bg-teal text-white" : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                      }`}
                    >
                      "{cmd}"
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-4 rounded-2xl bg-white/[0.07] p-4" role="img" aria-label="Voice assistant listening with transcript">
                  <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-teal text-white" aria-hidden>
                    <span className="absolute inset-0 animate-ping rounded-full bg-teal/30" />
                    <Mic size={22} className="relative" />
                  </span>
                  <span>
                    <span className="block text-[0.85rem] font-semibold text-white/90">"{voiceLine}"</span>
                    <span className="mt-1 flex items-end gap-1" aria-hidden>
                      {[14, 22, 10, 26, 18, 30, 16, 24, 12, 20].map((h, i) => (
                        <span key={i} className="w-1 rounded-full bg-teal-soft/80" style={{ height: `${h}px` }} />
                      ))}
                    </span>
                  </span>
                </div>
              </div>
            </Reveal>
            <Reveal delay={100} className="lg:col-span-2">
              <div className="grid h-full gap-5">
                {[
                  { icon: Search, title: "Discover", body: "Doctors and hospitals matched to your needs, location and mode." },
                  { icon: CalendarCheck, title: "Schedule", body: "Live slots and instant confirmation — no back-and-forth." },
                  { icon: ClipboardList, title: "Manage", body: "Visits, forms, notifications and preferences together." },
                ].map((c, i) => (
                  <div key={c.title} className="flex gap-4 rounded-[20px] border border-slate-200/80 bg-white p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_20px_44px_-20px_rgba(14,46,74,0.35)]">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-healthcare-soft text-healthcare" aria-hidden>
                      <c.icon size={20} />
                    </span>
                    <span>
                      <span className="block text-[0.7rem] font-extrabold tracking-[0.16em] text-slate-300">STEP {i + 1}</span>
                      <span className="block text-[1rem] font-extrabold text-navy">{c.title}</span>
                      <span className="mt-0.5 block text-[0.86rem] text-slate-500">{c.body}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ================= TRUST (dark) ================= */}
        <section id="about" aria-labelledby="about-heading" className="scroll-mt-16 bg-navy-deep text-white">
          <div className="mx-auto grid max-w-[1280px] gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:py-24">
            <Reveal>
              <div>
                <p className="text-[0.74rem] font-extrabold uppercase tracking-[0.16em] text-teal-soft">Built for healthcare</p>
                <h2 id="about-heading" className="mt-3 text-[1.9rem] font-extrabold leading-tight tracking-tight sm:text-[2.4rem]">
                  Designed around the healthcare experience.
                </h2>
                <p className="mt-4 leading-relaxed text-white/70">
                  One shared scheduling workflow for patients, doctors and hospital teams — clear, private and reliable.
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/register")}
                  className="mt-7 inline-flex min-h-[3rem] items-center gap-2 rounded-xl bg-white px-6 text-[0.93rem] font-bold text-navy transition hover:bg-teal-soft"
                >
                  Get Started <ArrowRight size={16} />
                </button>
              </div>
            </Reveal>
            <ul className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: Check, title: "Patient-first experience", body: "Plain language, simple steps, accessible design." },
                { icon: Building2, title: "Hospital-connected workflows", body: "Scheduling aligned with real clinic operations." },
                { icon: Clock, title: "Doctor availability", body: "Slots reflecting actual doctor schedules." },
                { icon: CalendarDays, title: "Appointment management", body: "Visits, reminders and follow-ups in one place." },
                { icon: ShieldCheck, title: "Secure authentication", body: "Protected sign-in and careful data handling." },
                { icon: Sparkles, title: "AI-assisted scheduling", body: "Help with discovery and booking — not diagnosis." },
              ].map((f, i) => (
                <Reveal key={f.title} delay={i * 50}>
                  <li className="h-full rounded-2xl border border-white/10 bg-white/[0.06] p-5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/20 text-teal-soft" aria-hidden>
                      <f.icon size={18} />
                    </span>
                    <h3 className="mt-3 text-[0.94rem] font-extrabold">{f.title}</h3>
                    <p className="mt-1 text-[0.83rem] leading-relaxed text-white/65">{f.body}</p>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ================= FAQ ================= */}
        <section aria-labelledby="faq-heading" className="bg-white">
          <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:py-24">
            <Reveal>
              <div>
                <p className="text-[0.74rem] font-extrabold uppercase tracking-[0.16em] text-teal-dark">Questions, answered</p>
                <h2 id="faq-heading" className="mt-3 text-[1.9rem] font-extrabold tracking-[-0.02em] text-navy-deep sm:text-[2.4rem]">
                  Everything patients ask us.
                </h2>
                <p className="mt-3 max-w-md leading-relaxed text-slate-500">
                  Straight answers about privacy, rescheduling, and what CareFlow AI does — and doesn't — do.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => navigate("/chat")}
                    className="inline-flex min-h-[2.9rem] items-center gap-2 rounded-xl bg-navy px-5 text-[0.9rem] font-bold text-white transition hover:bg-navy-deep"
                  >
                    <MessageCircle size={16} /> Ask CareFlow AI
                  </button>
                  <a
                    href="tel:911"
                    className="inline-flex min-h-[2.9rem] items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 text-[0.9rem] font-bold text-red-700 transition hover:bg-red-100"
                  >
                    <Siren size={16} /> Emergency: 911
                  </a>
                </div>
              </div>
            </Reveal>
            <div className="space-y-3">
              {FAQS.map((f, i) => {
                const open = openFaq === i;
                return (
                  <Reveal key={f.q} delay={i * 50}>
                    <div className={`overflow-hidden rounded-2xl border transition ${open ? "border-navy/30 bg-healthcare-faint/40 shadow-sm" : "border-slate-200 bg-white"}`}>
                      <button
                        type="button"
                        onClick={() => setOpenFaq(open ? null : i)}
                        aria-expanded={open}
                        aria-controls={`faq-panel-${i}`}
                        className="flex w-full items-center gap-3 px-5 py-4 text-left"
                      >
                        <span className="flex-1 text-[0.94rem] font-extrabold text-navy">{f.q}</span>
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${open ? "bg-navy text-white" : "bg-slate-100 text-slate-500"}`}>
                          <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                        </span>
                      </button>
                      {open && (
                        <p id={`faq-panel-${i}`} className="px-5 pb-5 text-[0.88rem] leading-relaxed text-slate-600">
                          {f.a}
                        </p>
                      )}
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ================= FINAL CTA ================= */}
        <section aria-labelledby="cta-heading" className="bg-[#F6F9FC]">
          <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:py-20">
            <Reveal>
              <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(120deg,#0E2E4A_0%,#1769AA_55%,#168C8C_100%)] px-6 py-12 text-center text-white sm:p-14">
                <div
                  className="absolute inset-0 opacity-20"
                  aria-hidden
                  style={{
                    backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.7) 1px, transparent 0)",
                    backgroundSize: "24px 24px",
                  }}
                />
                <div className="relative">
                  <p className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-4 py-1.5 text-[0.74rem] font-extrabold uppercase tracking-[0.14em] backdrop-blur">
                    <CalendarCheck size={13} /> Free for patients
                  </p>
                  <h2 id="cta-heading" className="mx-auto mt-4 max-w-2xl text-[1.7rem] font-extrabold tracking-tight sm:text-[2.4rem]">
                    Ready to make your next appointment easier?
                  </h2>
                  <p className="mx-auto mt-3 max-w-xl text-white/75">
                    Find the right care, check availability, and schedule your visit with CareFlow AI.
                  </p>
                  <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => navigate("/book")}
                      className="inline-flex min-h-[3.2rem] items-center justify-center gap-2 rounded-xl bg-white px-8 text-[1rem] font-bold text-navy transition hover:bg-teal-soft"
                    >
                      <Search size={18} /> Find Care
                    </button>
                    <Link
                      to="/login"
                      className="inline-flex min-h-[3.2rem] items-center justify-center rounded-xl border border-white/30 px-8 text-[1rem] font-bold text-white transition hover:bg-white/10"
                    >
                      Sign In
                    </Link>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ================= FOOTER ================= */}
      <footer className="bg-navy-deep text-white">
        {/* Emergency strip */}
        <div className="border-b border-white/10 bg-red-950/40">
          <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-6">
            <p className="flex items-center gap-2.5 text-[0.88rem] font-bold">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white">
                <Siren size={17} />
              </span>
              Medical emergency? Don't wait — call now.
            </p>
            <span className="flex-1" />
            <span className="flex flex-wrap gap-2">
              <a href="tel:911" className="rounded-xl bg-red-600 px-5 py-2.5 text-[0.86rem] font-extrabold text-white transition hover:bg-red-500">
                Call 911
              </a>
              <Link to="/book" className="rounded-xl border border-white/20 px-5 py-2.5 text-[0.86rem] font-bold text-white transition hover:bg-white/10">
                Book routine care
              </Link>
            </span>
          </div>
        </div>
        <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <Logo light />
            <p className="mt-4 max-w-xs text-[0.87rem] leading-relaxed text-white/60">
              AI-assisted scheduling and care discovery — find care, check availability, book and manage your visit.
            </p>
            <p className="mt-4 space-y-1.5 text-[0.82rem] font-medium text-white/60">
              <span className="flex items-center gap-2"><Phone size={13} /> Support: Mon–Sat, 8am–8pm</span>
              <span className="flex items-center gap-2"><Globe size={13} /> English · Hindi · Tamil · Malayalam</span>
            </p>
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[0.74rem] font-bold text-white/80">
              <ShieldCheck size={13} /> Private by design · No diagnosis
            </p>
          </div>
          <nav aria-label="CareFlow AI">
            <h3 className="text-[0.74rem] font-extrabold uppercase tracking-[0.14em] text-white/50">CareFlow AI</h3>
            <ul className="mt-4 space-y-2.5 text-[0.9rem] font-medium">
              <li><a href="#find-care" className="text-white/75 hover:text-white">Find Care</a></li>
              <li><a href="#doctors" className="text-white/75 hover:text-white">Doctors</a></li>
              <li><a href="#hospitals" className="text-white/75 hover:text-white">Hospitals</a></li>
              <li><a href="#how-it-works" className="text-white/75 hover:text-white">How It Works</a></li>
            </ul>
          </nav>
          <nav aria-label="Patients">
            <h3 className="text-[0.74rem] font-extrabold uppercase tracking-[0.14em] text-white/50">Patients</h3>
            <ul className="mt-4 space-y-2.5 text-[0.9rem] font-medium">
              <li><Link to="/visits" className="text-white/75 hover:text-white">Appointments</Link></li>
              <li><Link to="/visits" className="text-white/75 hover:text-white">Visits</Link></li>
              <li><Link to="/chat" className="text-white/75 hover:text-white">AI Assistant</Link></li>
              <li><Link to="/voice" className="text-white/75 hover:text-white">Voice Assistant</Link></li>
              <li><Link to="/preferences" className="text-white/75 hover:text-white">Preferences</Link></li>
            </ul>
          </nav>
          <nav aria-label="Company">
            <h3 className="text-[0.74rem] font-extrabold uppercase tracking-[0.14em] text-white/50">Company</h3>
            <ul className="mt-4 space-y-2.5 text-[0.9rem] font-medium">
              <li><a href="#about" className="text-white/75 hover:text-white">About</a></li>
              <li><Link to="/login" className="text-white/75 hover:text-white">Contact</Link></li>
              <li><Link to="/login" className="text-white/75 hover:text-white">Privacy</Link></li>
              <li><Link to="/login" className="text-white/75 hover:text-white">Terms</Link></li>
            </ul>
          </nav>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-[0.8rem] font-medium text-white/60">© 2026 CareFlow AI. All rights reserved.</p>
            <p className="max-w-xl text-[0.74rem] leading-relaxed text-white/45">
              CareFlow AI helps with care discovery and appointment scheduling. It does not provide medical diagnosis or emergency medical services.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
