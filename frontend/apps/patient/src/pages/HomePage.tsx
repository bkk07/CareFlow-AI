import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock,
  History,
  Inbox,
  MapPin,
  Mic,
  Navigation,
  Search,
  Sparkles,
  Stethoscope,
  Video,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { searchDoctors as apiSearchDoctors, searchHospitals as apiSearchHospitals, fetchContact as apiFetchContact } from "../api";
import { mapDoctorResult, mapHospitalResult } from "../lib/backend";
import { consultationModeLabel, readPosition, type GeoCoords } from "../lib/helpers";
import { doctorImage, hospitalImage } from "../lib/images";
import { useAppState } from "../context/AppStateContext";
import { useAuth } from "../context/AuthContext";
import { greetingFor } from "../components/layout/PatientShell";
import { DoctorProfileModal } from "../components/doctor/DoctorProfileModal";
import { AppointmentDetailModal, } from "../components/appointment/AppointmentDetailModal";
import { AppointmentTimeline } from "../components/appointment/AppointmentCard";
import { QuestionnaireStrip } from "../components/appointment/AppointmentCard";
import { useQuestionnaireStatuses } from "../lib/questionnaires";
import { Button, CardSkeleton, EmptyState, ErrorState, SafeImage, StatusBadge } from "../components/common/ui";
import type { Appointment, Doctor, Hospital } from "../types";

const AI_EXAMPLE_PROMPTS = [
  "I need a cardiologist this week",
  "Find a dermatologist near me",
  "What appointments do I have?",
];

const UPCOMING_STATES = ["confirmed", "pending", "rescheduled", "sync_pending"];
const RECENT_KEY = "careflow_recent_searches";

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
}

/** "In 3 days" / "Tomorrow" / "Today" from a real ISO start — null when unparseable. */
function countdownLabel(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - Date.now()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.16em] text-teal-dark">{children}</p>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { patient } = useAuth();
  const { appointments, notifications, live, loading: appLoading } = useAppState();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [profileDoctor, setProfileDoctor] = useState<Doctor | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [recommended, setRecommended] = useState<Doctor[]>([]);
  const [nearby, setNearby] = useState<Hospital[]>([]);
  const [geo, setGeo] = useState<GeoCoords | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const { hello, firstName } = greetingFor(patient.name);
  const todayLine = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  function useMyLocation() {
    setLocating(true);
    setGeoError(null);
    readPosition()
      .then((g) => setGeo(g))
      .catch((e: unknown) => setGeoError(e instanceof Error ? e.message : "Could not read your location."))
      .finally(() => setLocating(false));
  }

  // Real directory only: precise coordinates rank by true distance,
  // otherwise the saved city is the fallback. Nothing is fabricated.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    setLoading(true);
    setDirError(null);
    const run = async () => {
      if (geo) {
        return Promise.all([
          apiSearchDoctors({ latitude: geo.latitude, longitude: geo.longitude }),
          apiSearchHospitals("", undefined, geo),
        ]);
      }
      const contact = await apiFetchContact().catch(() => null);
      const city = contact?.city ?? undefined;
      return Promise.all([
        apiSearchDoctors({ city }),
        apiSearchHospitals("", city),
      ]);
    };
    run()
      .then(([docs, hosps]) => {
        if (cancelled) return;
        setRecommended(docs.slice(0, 3).map(mapDoctorResult));
        setNearby(hosps.slice(0, 2).map(mapHospitalResult));
      })
      .catch(() => {
        if (!cancelled) setDirError("We couldn't load nearby care right now.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live, geo]);

  const upcoming = useMemo(
    () => appointments
      .filter((a) => UPCOMING_STATES.includes(a.status))
      .slice()
      .sort((a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime()),
    [appointments],
  );
  const next: Appointment | null = upcoming[0] ?? null;
  const detailAppt = detailId ? (appointments.find((a) => a.id === detailId) ?? null) : null;

  // Per-visit form status, fetched once per appointment per session and
  // shared with the strips below — the Visits page owns the full flow.
  const upcomingIds = useMemo(() => upcoming.map((a) => a.id), [upcoming]);
  const quMap = useQuestionnaireStatuses(upcomingIds, live);

  const actionableBookings = useMemo(
    () => appointments.filter((a) => ["pending", "sync_pending"].includes(a.status)),
    [appointments],
  );
  const questionnaireUpdates = useMemo(
    () => notifications.filter((n) => n.category === "questionnaires" && n.unread),
    [notifications],
  );
  const unreadCount = useMemo(() => notifications.filter((n) => n.unread).length, [notifications]);

  // Priority engine: exactly one hero — the most important true thing.
  const priority: "appointment" | "booking" | "questionnaire" | "clear" =
    next ? "appointment"
    : actionableBookings.length > 0 ? "booking"
    : questionnaireUpdates.length > 0 ? "questionnaire"
    : "clear";

  // Agenda: upcoming visits grouped by day, chronological.
  const agenda = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const a of upcoming) {
      const list = groups.get(a.date) ?? [];
      list.push(a);
      groups.set(a.date, list);
    }
    return [...groups.entries()];
  }, [upcoming]);

  // Care team: doctors from the patient's own history — continuity of care.
  const careTeam = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; photo: string; specialty: string; hospital: string }>();
    for (const a of appointments) {
      const key = a.doctorId || a.doctorName;
      if (!seen.has(key)) {
        seen.set(key, { id: a.doctorId, name: a.doctorName, photo: a.doctorPhoto, specialty: a.specialty, hospital: a.hospitalName });
      }
    }
    return [...seen.values()].slice(0, 4);
  }, [appointments]);

  const recentUpdates = useMemo(() => notifications.slice(0, 4), [notifications]);

  function rememberSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setRecent((prev) => {
      const nextList = [trimmed, ...prev.filter((s) => s.toLowerCase() !== trimmed.toLowerCase())].slice(0, 4);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(nextList));
      } catch {
        // Private mode: recents simply don't persist.
      }
      return nextList;
    });
  }

  function submitSearch(e?: React.FormEvent) {
    e?.preventDefault();
    rememberSearch(query);
    navigate("/book", { state: { query } });
  }

  function searchFor(q: string) {
    rememberSearch(q);
    navigate("/book", { state: { query: q } });
  }

  const QUICK_ACTIONS = [
    { id: "find", label: "Find a doctor", desc: "Browse by specialty", icon: Stethoscope },
    { id: "book", label: "Book a visit", desc: upcoming.length > 0 ? `${upcoming.length} upcoming` : "Real availability", icon: CalendarCheck },
    { id: "visits", label: "Manage visits", desc: "Reschedule or cancel", icon: Video },
    {
      id: "forms",
      label: "Questionnaires",
      desc: questionnaireUpdates.length > 0 ? `${questionnaireUpdates.length} update${questionnaireUpdates.length > 1 ? "s" : ""}` : "All clear",
      icon: ClipboardList,
    },
  ];

  function quickAction(id: string) {
    if (id === "find" || id === "book") navigate("/book");
    else navigate("/visits");
  }

  return (
    <div className="max-w-[880px] mx-auto">
      {/* ---------- Briefing header (not a card) ---------- */}
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Eyebrow>{todayLine}</Eyebrow>
        <h1 className="text-[2rem] sm:text-[2.6rem] font-extrabold text-navy tracking-[-0.02em] leading-[1.08] mt-2">
          {hello}, {firstName || patient.name}.
        </h1>
        <p className="text-ink-secondary text-[1rem] sm:text-[1.05rem] mt-2 max-w-xl leading-relaxed">
          {next
            ? `Your next visit is ${countdownLabel(next.slotStart)?.toLowerCase() ?? "coming up"} — everything else can wait.`
            : actionableBookings.length > 0
              ? "A booking needs a moment of your time."
              : questionnaireUpdates.length > 0
                ? "A questionnaire needs your attention."
                : "Nothing needs you right now. Here's your care at a glance."}
        </p>

        {/* Command bar */}
        <form onSubmit={submitSearch} role="search" aria-label="Find care" className="mt-5">
          <div className="flex items-center gap-2 bg-white border border-border rounded-2xl pl-4 pr-2 py-2.5 shadow-card focus-within:border-healthcare focus-within:ring-2 focus-within:ring-healthcare/20 transition">
            <Search size={20} className="text-ink-faint shrink-0" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search doctors, specialties, hospitals…"
              aria-label="Describe the care you need"
              className="w-full bg-transparent outline-none text-[1rem] py-2 placeholder:text-ink-faint min-w-0"
            />
            {geo ? (
              <button
                type="button"
                onClick={() => setGeo(null)}
                title="Location on — ranked by distance. Select to clear."
                className="hidden sm:inline-flex items-center gap-1 text-[0.74rem] font-bold text-teal-dark bg-teal-soft rounded-full px-2.5 py-1.5 hover:underline shrink-0"
              >
                <MapPin size={12} aria-hidden /> Near you
              </button>
            ) : (
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                title="Use my location for nearby care"
                aria-label="Use my location for nearby care"
                className="hidden sm:inline-flex items-center gap-1 text-[0.74rem] font-bold text-healthcare hover:underline shrink-0 disabled:opacity-60 px-1 py-1.5"
              >
                <Navigation size={13} aria-hidden /> {locating ? "Locating…" : "Near me"}
              </button>
            )}
            <button
              type="button"
              aria-label="Voice input"
              onClick={() => navigate("/voice")}
              className="w-10 h-10 rounded-xl hover:bg-background flex items-center justify-center text-healthcare shrink-0 transition-colors"
            >
              <Mic size={18} aria-hidden />
            </button>
            <Button type="submit" className="shrink-0">Search</Button>
          </div>
        </form>
        {geoError && <p role="alert" className="text-[0.78rem] font-semibold text-danger mt-2">{geoError}</p>}
        {recent.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap" aria-label="Recent searches">
            <History size={13} className="text-ink-faint shrink-0" aria-hidden />
            {recent.map((r) => (
              <button
                key={r}
                onClick={() => searchFor(r)}
                className="text-[0.78rem] font-medium text-ink-secondary hover:text-healthcare hover:underline truncate max-w-[220px]"
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </motion.header>

      {/* ---------- Priority: exactly one hero ---------- */}
      <motion.section
        aria-label="Up next"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, delay: 0.06 }}
        className="mt-6"
      >
        {appLoading || loading ? (
          <CardSkeleton />
        ) : priority === "appointment" && next ? (
          <div className="relative">
            <div
              className="absolute -inset-x-4 -top-6 -bottom-4 opacity-70 pointer-events-none"
              aria-hidden
              style={{
                background:
                  "radial-gradient(420px 180px at 85% 0%, rgba(22,140,140,0.12), transparent 65%), radial-gradient(380px 200px at 8% 100%, rgba(23,105,170,0.12), transparent 60%)",
              }}
            />
            {countdownLabel(next.slotStart) && (
              <span className="absolute -top-4 left-5 z-10 inline-flex items-center gap-1.5 text-[0.78rem] font-extrabold bg-navy text-white rounded-full pl-2.5 pr-3.5 py-2 shadow-card">
                <Clock size={13} aria-hidden /> {countdownLabel(next.slotStart)}
              </span>
            )}
          <article className="relative overflow-hidden rounded-2xl border border-border bg-white shadow-card" aria-label={`Up next: appointment with ${next.doctorName}`}>
            <div className="flex items-center gap-2.5 flex-wrap bg-healthcare-faint/70 border-b border-border/70 px-5 sm:px-6 py-3.5 pt-5">
              <Eyebrow><span>Up next</span></Eyebrow>
              <span className="flex-1" />
              <StatusBadge status={next.status} />
            </div>
            <div className="p-5 sm:p-6">
              <div className="flex items-center gap-4 sm:gap-5">
                <SafeImage
                  src={next.doctorPhoto}
                  fallbackSrc={doctorImage(next.doctorId || next.doctorName)}
                  alt=""
                  name={next.doctorName}
                  className="w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-2xl border border-border shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-[1.35rem] sm:text-[1.6rem] font-extrabold text-navy leading-tight truncate tracking-tight">{next.doctorName}</p>
                  <p className="text-[0.92rem] text-ink-secondary mt-0.5">{next.specialty} · {next.hospitalName}</p>
                  <p className="text-[0.95rem] font-bold text-navy mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} className="text-healthcare" aria-hidden /> {next.date}</span>
                    <span aria-hidden className="text-border">·</span>
                    <span>{next.time} · {next.durationMinutes} min</span>
                  </p>
                  <p className="text-[0.82rem] text-ink-secondary mt-0.5">{consultationModeLabel(next.consultationMode)} · {next.appointmentType}</p>
                </div>
              </div>
              {quMap[next.id]?.hasForm && (
                <QuestionnaireStrip
                  status={quMap[next.id]}
                  onOpen={() => navigate("/visits", { state: { questionnaireFor: next.id } })}
                />
              )}
              <div className="mt-5 flex flex-col sm:flex-row gap-2">
                <Button size="sm" onClick={() => setDetailId(next.id)}>
                  View details
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("/visits", { state: { rescheduleId: next.id } })}>
                  Reschedule
                </Button>
                <button
                  onClick={() => navigate("/visits", { state: { cancelId: next.id } })}
                  className="inline-flex items-center justify-center min-h-[2rem] px-3 py-1.5 text-[0.82rem] font-semibold rounded-lg text-ink-secondary hover:text-danger hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          </article>
          </div>
        ) : priority === "booking" ? (
          <div className="card-base p-5 sm:p-6 flex gap-4 items-start">
            <span className="w-11 h-11 rounded-2xl bg-healthcare-soft text-healthcare flex items-center justify-center shrink-0" aria-hidden>
              <Clock size={21} />
            </span>
            <div className="min-w-0 flex-1">
              <Eyebrow>Booking update</Eyebrow>
              <p className="font-bold text-[1rem] text-ink mt-0.5">
                {actionableBookings.length} booking{actionableBookings.length > 1 ? "s" : ""} being confirmed
              </p>
              <p className="text-[0.85rem] text-ink-secondary mt-0.5">
                {actionableBookings[0].doctorName} · {actionableBookings[0].date} — we&apos;ll confirm it with the clinic shortly.
              </p>
              <Button size="sm" className="mt-3" onClick={() => navigate("/visits")}>Review in visits</Button>
            </div>
          </div>
        ) : priority === "questionnaire" ? (
          <div className="card-base p-5 sm:p-6 flex gap-4 items-start">
            <span className="w-11 h-11 rounded-2xl bg-teal-soft text-teal-dark flex items-center justify-center shrink-0" aria-hidden>
              <ClipboardList size={21} />
            </span>
            <div className="min-w-0 flex-1">
              <Eyebrow>Before your visit</Eyebrow>
              <p className="font-bold text-[1rem] text-ink mt-0.5">
                {questionnaireUpdates.length} questionnaire update{questionnaireUpdates.length > 1 ? "s" : ""}
              </p>
              <p className="text-[0.85rem] text-ink-secondary mt-0.5">
                {questionnaireUpdates[0].title} — forms live with your visits and take a few minutes.
              </p>
              <Button size="sm" className="mt-3" onClick={() => navigate("/visits")}>Complete questionnaire</Button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-white/60 px-5 py-6 text-center">
            <p className="font-bold text-ink">You&apos;re all caught up.</p>
            <p className="text-[0.85rem] text-ink-secondary mt-1">No upcoming visits, no pending forms.</p>
            <Button size="sm" className="mt-3" onClick={() => navigate("/book")}>Find care</Button>
          </div>
        )}
      </motion.section>

      {/* ---------- Main + rail ---------- */}
      <div className="mt-10 grid lg:grid-cols-[1fr_300px] gap-10 items-start">
        <div className="space-y-12 min-w-0">
          {/* Schedule agenda */}
          <section aria-labelledby="schedule-heading">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="schedule-heading" className="text-[1.3rem] font-extrabold text-navy tracking-[-0.01em]">Your schedule</h2>
              <button onClick={() => navigate("/visits")} className="text-[0.83rem] font-bold text-healthcare hover:underline shrink-0">
                All visits
              </button>
            </div>
            {appLoading || loading ? (
              <CardSkeleton lines={4} />
            ) : agenda.length === 0 ? (
              <p className="text-[0.95rem] text-ink-secondary mt-2">Nothing scheduled yet — your upcoming visits will line up here by day.</p>
            ) : (
              <div className="mt-2 relative pl-6">
                <span className="absolute left-[7px] top-3 bottom-3 w-px bg-border" aria-hidden />
                {agenda.map(([day, items]) => (
                  <div key={day} className="relative mt-6 first:mt-3">
                    <span className="absolute -left-6 top-1 w-[15px] h-[15px] rounded-full bg-white border-[3px] border-healthcare" aria-hidden />
                    <p className="text-[0.78rem] font-extrabold uppercase tracking-[0.12em] text-ink">{day}</p>
                    <ul className="mt-1 divide-y divide-border/70 border-b border-border/70">
                      {items.map((a) => (
                        <li key={a.id}>
                          <button
                            onClick={() => setDetailId(a.id)}
                            className="w-full flex items-center gap-3.5 py-4 text-left group"
                          >
                            <span className="text-[0.95rem] font-bold text-navy w-[80px] shrink-0 tabular-nums">{a.time}</span>
                            <SafeImage
                              src={a.doctorPhoto}
                              fallbackSrc={doctorImage(a.doctorId || a.doctorName)}
                              alt=""
                              name={a.doctorName}
                              className="w-10 h-10 rounded-full border border-border shrink-0"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[0.95rem] font-bold text-ink truncate group-hover:text-healthcare group-hover:underline">
                                {a.doctorName}
                              </span>
                              <span className="block text-[0.8rem] text-ink-secondary truncate mt-0.5">
                                {a.specialty} · {consultationModeLabel(a.consultationMode)}
                                {quMap[a.id]?.hasForm && !quMap[a.id]?.completed && (
                                  <> · <span className="font-bold text-healthcare">Form {quMap[a.id].answered}/{quMap[a.id].total}</span></>
                                )}
                              </span>
                            </span>
                            <span className={`hidden sm:inline-flex items-center gap-1.5 text-[0.76rem] font-bold shrink-0 ${a.status === "cancelled" ? "text-ink-faint" : "text-ink-secondary"}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${a.status === "confirmed" || a.status === "rescheduled" ? "bg-success" : a.status === "cancelled" ? "bg-border" : "bg-healthcare"}`} aria-hidden />
                              {a.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                            </span>
                            <ChevronRight size={16} className="text-ink-faint shrink-0" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Care team — doctors from the patient's own history */}
          {careTeam.length > 0 && (
            <section aria-labelledby="team-heading">
              <h2 id="team-heading" className="text-[1.3rem] font-extrabold text-navy tracking-[-0.01em]">Your care team</h2>
              <p className="text-[0.88rem] text-ink-secondary mt-1">Doctors you&apos;ve seen on CareFlow — book with them again anytime.</p>
              <ul className="mt-4 grid sm:grid-cols-2 gap-3">
                {careTeam.map((d) => (
                  <li key={d.id || d.name} className="card-base p-4 flex items-center gap-3 hover:shadow-card transition-shadow">
                    <SafeImage
                      src={d.photo}
                      fallbackSrc={doctorImage(d.id || d.name)}
                      alt=""
                      name={d.name}
                      className="w-11 h-11 rounded-full border border-border shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.88rem] font-bold text-ink truncate">{d.name}</span>
                      <span className="block text-[0.76rem] text-ink-secondary truncate">{d.specialty}</span>
                    </span>
                    <button
                      onClick={() => navigate("/book", { state: { doctorId: d.id } })}
                      className="text-[0.8rem] font-bold text-healthcare hover:underline shrink-0 px-1 py-2"
                    >
                      Book again
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Explore care — real directory only */}
          <section aria-labelledby="explore-heading">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="explore-heading" className="text-[1.3rem] font-extrabold text-navy tracking-[-0.01em]">Explore care near you</h2>
              <button onClick={() => navigate("/book")} className="text-[0.83rem] font-bold text-healthcare hover:underline shrink-0">
                See all
              </button>
            </div>
            <p className="text-[0.88rem] text-ink-secondary mt-1">
              {geo ? "Ranked by distance from your location." : "Based on availability in your area — not medical advice."}
            </p>
            <div className="mt-3">
              {loading || appLoading ? (
                <CardSkeleton />
              ) : dirError ? (
                <ErrorState title="We couldn't load nearby care" body="Something went wrong while retrieving doctors and hospitals near you." onRetry={() => setGeo((g) => (g ? { ...g } : g))} />
              ) : recommended.length === 0 && nearby.length === 0 ? (
                <div className="card-base">
                  <EmptyState
                    title="We couldn't find a match"
                    body="Try another search, or use your location to find care closest to you."
                    action={<Button onClick={() => navigate("/book")}>Try another search</Button>}
                  />
                </div>
              ) : (
                <>
                  <ul className="divide-y divide-border/70 border-y border-border/70">
                    {recommended.map((d) => (
                      <li key={d.id}>
                        <div className="flex items-center gap-3 py-3">
                          <SafeImage
                            src={d.photo}
                            fallbackSrc={doctorImage(d.id || d.name)}
                            alt=""
                            name={d.name}
                            className="w-11 h-11 rounded-full border border-border shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[0.9rem] font-bold text-ink leading-tight truncate">{d.name}</p>
                            <p className="text-[0.78rem] text-ink-secondary truncate">
                              {d.specialty} · {d.hospitalName}
                            </p>
                            <p className="text-[0.76rem] text-ink-secondary flex items-center gap-1.5 mt-0.5">
                              <Clock size={12} aria-hidden /> {d.nextAvailable}
                              {d.consultationModes.length > 0 && (
                                <span aria-hidden> · {d.consultationModes.map(consultationModeLabel).join(" · ")}</span>
                              )}
                            </p>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <button
                              onClick={() => navigate("/book", { state: { doctorId: d.id } })}
                              className="text-[0.8rem] font-bold text-white bg-healthcare hover:bg-healthcare-dark rounded-lg px-3.5 py-2 transition-colors"
                            >
                              Book
                            </button>
                            <button
                              onClick={() => setProfileDoctor(d)}
                              className="text-[0.78rem] font-bold text-ink-secondary hover:text-healthcare hover:underline px-1 py-1"
                            >
                              View doctor
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {nearby.length > 0 && (
                    <ul className="mt-2 space-y-2">
                      {nearby.map((h) => (
                        <li key={h.id} className="flex items-center gap-3 py-1">
                          <SafeImage
                            src={h.image}
                            fallbackSrc={hospitalImage(h.id || h.name)}
                            alt=""
                            name={h.name}
                            className="w-10 h-10 rounded-xl border border-border shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[0.86rem] font-bold text-ink truncate leading-tight">{h.name}</p>
                            <p className="text-[0.75rem] text-ink-secondary flex items-center gap-1 truncate">
                              <MapPin size={11} className="shrink-0" aria-hidden /> {h.location || "Nearby"}
                            </p>
                          </div>
                          <button
                            onClick={() => navigate("/book", { state: { hospitalId: h.id } })}
                            className="text-[0.8rem] font-bold text-healthcare hover:underline shrink-0 inline-flex items-center gap-0.5 px-1 py-2"
                          >
                            <Building2 size={13} aria-hidden /> Doctors here
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        {/* ---------- Quiet rail ---------- */}
        <aside className="space-y-7 lg:sticky lg:top-[92px]" aria-label="Shortcuts and updates">
          {/* Attention — only when something needs the patient */}
          {(actionableBookings.length > 0 || questionnaireUpdates.length > 0) && (
            <section aria-label="Needs your attention">
              <h2 className="text-[1.05rem] font-extrabold text-navy tracking-tight">Needs attention</h2>
              <ul className="mt-2 space-y-2">
                {actionableBookings.length > 0 && (
                  <li>
                    <button onClick={() => navigate("/visits")} className="w-full text-left card-base p-3.5 hover:shadow-card transition-shadow">
                      <p className="text-[0.84rem] font-bold text-ink flex items-center gap-1.5">
                        <Clock size={14} className="text-healthcare" aria-hidden />
                        {actionableBookings.length} booking{actionableBookings.length > 1 ? "s" : ""} confirming
                      </p>
                      <p className="text-[0.76rem] text-ink-secondary mt-0.5 truncate">{actionableBookings[0].doctorName} · {actionableBookings[0].date}</p>
                    </button>
                  </li>
                )}
                {questionnaireUpdates.length > 0 && (
                  <li>
                    <button onClick={() => navigate("/visits")} className="w-full text-left card-base p-3.5 hover:shadow-card transition-shadow">
                      <p className="text-[0.84rem] font-bold text-ink flex items-center gap-1.5">
                        <ClipboardList size={14} className="text-teal-dark" aria-hidden />
                        {questionnaireUpdates.length} questionnaire update{questionnaireUpdates.length > 1 ? "s" : ""}
                      </p>
                      <p className="text-[0.76rem] text-ink-secondary mt-0.5 truncate">{questionnaireUpdates[0].title}</p>
                    </button>
                  </li>
                )}
              </ul>
            </section>
          )}

          {/* AI — light clinical card, like the landing page */}
          <section aria-label="CareFlow AI assistant" className="rounded-2xl border border-border bg-white shadow-subtle overflow-hidden">
            <div className="bg-healthcare-faint/70 border-b border-border/70 px-5 py-3.5 flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-teal-soft text-teal-dark flex items-center justify-center" aria-hidden>
                <Sparkles size={15} />
              </span>
              <p className="text-[0.95rem] font-extrabold text-navy">Ask CareFlow AI</p>
            </div>
            <div className="p-5">
              <p className="text-[0.84rem] leading-relaxed text-ink-secondary">
                Scheduling and care-navigation help — finding doctors, checking availability, managing bookings. Never diagnosis.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {AI_EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => navigate("/chat", { state: { prompt: p } })}
                    className="text-[0.76rem] font-semibold bg-background border border-border rounded-full px-3 py-1.5 hover:border-healthcare hover:text-healthcare transition-colors text-ink-secondary"
                  >
                    “{p}”
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={() => navigate("/chat")} className="mt-4 w-full">
                Start a conversation <ArrowRight size={14} aria-hidden />
              </Button>
            </div>
          </section>

          {/* Quick actions — slim rows, not cards */}
          <section aria-label="Quick actions">
              <h2 className="text-[1.05rem] font-extrabold text-navy tracking-tight">Do more</h2>
            <ul className="mt-1 divide-y divide-border/70 border-b border-border/70">
              {QUICK_ACTIONS.map((a) => (
                <li key={a.id}>
                  <button onClick={() => quickAction(a.id)} className="w-full flex items-center gap-3 py-3 text-left group">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.92rem] font-bold text-ink group-hover:text-healthcare group-hover:underline">
                        {a.label}
                      </span>
                      <span className="block text-[0.79rem] text-ink-secondary mt-0.5">{a.desc}</span>
                    </span>
                    <a.icon size={17} className="text-ink-faint shrink-0" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Recent updates */}
          <section aria-label="Recent updates">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[1.05rem] font-extrabold text-navy tracking-tight">
                Recent updates {unreadCount > 0 && <span className="text-healthcare">· {unreadCount} unread</span>}
              </h2>
              <button onClick={() => navigate("/inbox")} className="text-[0.8rem] font-bold text-healthcare hover:underline shrink-0">
                Inbox
              </button>
            </div>
            {recentUpdates.length === 0 ? (
              <p className="text-[0.88rem] text-ink-secondary mt-2">You&apos;re up to date — confirmations and reminders will appear here.</p>
            ) : (
              <ul className="mt-1 divide-y divide-border/70 border-b border-border/70">
                {recentUpdates.map((n) => (
                  <li key={n.id}>
                    <button onClick={() => navigate("/inbox")} className="w-full flex gap-2.5 py-2.5 text-left group">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.unread ? "bg-healthcare" : "bg-border"}`} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-[0.83rem] font-bold text-ink leading-snug group-hover:text-healthcare group-hover:underline">
                          {n.title}
                        </span>
                        <span className="block text-[0.75rem] text-ink-secondary truncate mt-0.5">{n.body}</span>
                        {n.time && <span className="block text-[0.68rem] text-ink-faint mt-0.5">{n.time}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => navigate("/inbox")}
              className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 text-[0.83rem] font-bold text-navy border border-border rounded-xl py-2.5 hover:border-healthcare hover:text-healthcare transition-colors"
            >
              <Inbox size={15} aria-hidden /> Open inbox
            </button>
          </section>

          {/* Journey progress for the next visit */}
          {next && (
            <section aria-label="Visit progress">
              <h2 className="text-[1.05rem] font-extrabold text-navy tracking-tight">Visit progress</h2>
              <div className="card-base p-4 mt-2">
                <AppointmentTimeline stage={next.verificationStage} />
                <p className="text-[0.76rem] text-ink-secondary mt-1">
                  {next.verificationStage === "confirmed"
                    ? "Your visit is confirmed — see you soon."
                    : next.verificationStage === "verified"
                      ? "Your booking is verified and awaiting confirmation."
                      : "Your booking was received and is being verified."}
                </p>
              </div>
            </section>
          )}
        </aside>
      </div>

      <DoctorProfileModal
        doctor={profileDoctor}
        open={!!profileDoctor}
        onClose={() => setProfileDoctor(null)}
        onBook={(d) => navigate("/book", { state: { doctorId: d.id } })}
      />
      <AppointmentDetailModal
        appointment={detailAppt}
        open={!!detailAppt}
        onClose={() => setDetailId(null)}
        questionnaire={detailAppt ? (quMap[detailAppt.id] ?? null) : null}
        onQuestionnaire={(a) => navigate("/visits", { state: { questionnaireFor: a.id } })}
      />
    </div>
  );
}
