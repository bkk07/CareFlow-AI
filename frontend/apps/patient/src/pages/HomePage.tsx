import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck,
  ClipboardList,
  Mic,
  Search,
  Sparkles,
  Stethoscope,
  Video,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { searchDoctors as apiSearchDoctors, searchHospitals as apiSearchHospitals, fetchContact as apiFetchContact } from "../api";
import { mapDoctorResult, mapHospitalResult } from "../lib/backend";
import { readPosition, type GeoCoords } from "../lib/helpers";
import { useAppState } from "../context/AppStateContext";
import { useAuth } from "../context/AuthContext";
import { AppointmentCard } from "../components/appointment/AppointmentCard";
import { DoctorCard } from "../components/doctor/cards";
import { HospitalCard } from "../components/hospital/HospitalCard";
import { DoctorProfileModal } from "../components/doctor/DoctorProfileModal";
import { AppointmentDetailModal } from "../components/appointment/AppointmentDetailModal";
import { Button, CardSkeleton, EmptyState } from "../components/common/ui";
import type { Doctor, Hospital } from "../types";

const AI_EXAMPLE_PROMPTS = [
  "I need a cardiologist this week",
  "Find a dermatologist near me",
  "What appointments do I have?",
];

const QUICK_ACTIONS = [
  { id: "find", label: "Find a Doctor", desc: "Browse by specialty", icon: Stethoscope, tint: "bg-healthcare-soft text-healthcare" },
  { id: "book", label: "Book an Appointment", desc: "Real availability", icon: CalendarCheck, tint: "bg-teal-soft text-teal-dark" },
  { id: "visits", label: "Upcoming Visits", desc: "Manage your care", icon: Video, tint: "bg-success-soft text-success" },
  { id: "forms", label: "Questionnaires", desc: "1 needs attention", icon: ClipboardList, tint: "bg-warning-soft text-warning" },
  { id: "ai", label: "Talk to CareFlow AI", desc: "Scheduling help", icon: Sparkles, tint: "bg-navy-soft text-navy" },
];

export default function HomePage() {
  const navigate = useNavigate();
  const { patient } = useAuth();
  const { appointments, notifications, live } = useAppState();
  const [query, setQuery] = useState("");
  const [profileDoctor, setProfileDoctor] = useState<Doctor | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recommended, setRecommended] = useState<Doctor[]>([]);
  const [nearby, setNearby] = useState<Hospital[]>([]);
  const [geo, setGeo] = useState<GeoCoords | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  function useMyLocation() {
    setLocating(true);
    setGeoError(null);
    readPosition()
      .then((g) => setGeo(g))
      .catch((e: unknown) => setGeoError(e instanceof Error ? e.message : "Could not read your location."))
      .finally(() => setLocating(false));
  }

  // Recommendations come from the real directory: precise coordinates
  // rank by true distance, otherwise the saved city is the fallback.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    setLoading(true);
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
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live, geo]);

  const upcoming = useMemo(
    () =>
      appointments
        .filter((a) => ["confirmed", "pending", "rescheduled", "sync_pending"].includes(a.status))
        .slice(0, 2),
    [appointments],
  );
  const detailAppt = detailId ? (appointments.find((a) => a.id === detailId) ?? null) : null;

  const activity = useMemo(() => {
    const rows = notifications.slice(0, 3).map((n) => ({
      t: n.title,
      s: n.body,
      time: n.time,
      dot: n.category === "appointments" ? "bg-success" : n.category === "questionnaires" ? "bg-warning" : "bg-healthcare",
    }));
    if (rows.length === 0 && appointments.length > 0) {
      const a = appointments[0];
      return [{ t: `${a.status.replace("_", " ")} visit`, s: `${a.specialty} · ${a.doctorName}`, time: `${a.date} at ${a.time}`, dot: "bg-success" }];
    }
    return rows;
  }, [notifications, appointments]);

  function submitSearch(e?: React.FormEvent) {
    e?.preventDefault();
    navigate("/book", { state: { query } });
  }

  function quickAction(id: string) {
    if (id === "find" || id === "book") navigate("/book");
    else if (id === "visits") navigate("/visits");
    else if (id === "forms") navigate("/visits", { state: { openQuestionnaire: true } });
    else navigate("/chat");
  }

  return (
    <div className="space-y-7">
      {/* Hero */}
      <section className="card-base overflow-hidden">
        <div className="grid md:grid-cols-[1.15fr_0.85fr]">
          <div className="p-6 sm:p-8">
            <p className="text-[0.78rem] font-bold text-teal-dark uppercase tracking-widest">Patient portal</p>
            <h1 className="page-title mt-1.5">How can we help you today?</h1>
            <p className="page-sub mt-2 max-w-xl">
              Find the right care, check real availability, and manage your appointments with CareFlow AI.
            </p>
            <form onSubmit={submitSearch} className="mt-4" role="search">
              <div className="flex flex-col sm:flex-row gap-2 bg-background border border-border rounded-control p-2 focus-within:border-healthcare focus-within:ring-2 focus-within:ring-healthcare/20 transition">
                <div className="flex items-center gap-2 flex-1 px-2">
                  <Search size={18} className="text-ink-faint shrink-0" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Tell us what kind of care you're looking for…"
                    aria-label="Describe the care you need"
                    className="w-full bg-transparent outline-none text-[0.93rem] py-2.5 placeholder:text-ink-faint"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label="Voice input"
                    onClick={() => navigate("/voice")}
                    className="w-11 h-11 rounded-control border border-border bg-white flex items-center justify-center text-healthcare hover:border-healthcare transition shrink-0"
                  >
                    <Mic size={18} />
                  </button>
                  <Button type="submit" className="flex-1 sm:flex-none">Search</Button>
                </div>
              </div>
            </form>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {geo ? (
                <>
                  <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-1.5 w-fit">
                    Ranked by distance from you
                  </p>
                  <button onClick={() => setGeo(null)} className="text-[0.78rem] font-semibold text-ink-secondary hover:text-healthcare hover:underline">
                    Clear location
                  </button>
                </>
              ) : (
                <button
                  onClick={useMyLocation}
                  disabled={locating}
                  className="text-[0.78rem] font-semibold text-healthcare bg-healthcare-faint border border-healthcare/25 rounded-control px-3 py-1.5 hover:underline disabled:opacity-60"
                >
                  {locating ? "Reading location…" : "Use my location for nearby care"}
                </button>
              )}
            </div>
            {geoError && <p role="alert" className="text-[0.78rem] font-semibold text-danger mt-2">{geoError}</p>}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {AI_EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => navigate("/chat", { state: { prompt: p } })}
                  className="text-[0.78rem] font-medium bg-white border border-border rounded-full px-3 py-1.5 hover:border-healthcare hover:text-healthcare transition text-ink-secondary"
                >
                  “{p}”
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button size="lg" onClick={() => navigate("/chat")} className="flex-1 sm:flex-none">
                <Sparkles size={17} /> Talk to CareFlow AI
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate("/book")} className="flex-1 sm:flex-none">
                Find a doctor <ArrowRight size={16} />
              </Button>
            </div>
          </div>
          <div className="relative min-h-[220px] hidden md:block bg-gradient-to-br from-healthcare via-teal to-navy" aria-hidden />
        </div>
      </section>

      {/* Quick actions */}
      <section aria-label="Quick actions">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {QUICK_ACTIONS.map((a, i) => (
            <motion.button
              key={a.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.28 }}
              onClick={() => quickAction(a.id)}
              className="card-base p-4 text-left hover:shadow-card hover:-translate-y-0.5 transition-all group"
            >
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${a.tint}`}>
                <a.icon size={19} />
              </span>
              <p className="font-bold text-[0.86rem] text-ink mt-2.5 leading-tight">{a.label}</p>
              <p className="text-[0.76rem] text-ink-secondary">{a.desc}</p>
            </motion.button>
          ))}
        </div>
      </section>

      {/* Upcoming */}
      <section aria-label="Upcoming appointment">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title">Upcoming appointment</h2>
          <button onClick={() => navigate("/visits")} className="text-[0.83rem] font-bold text-healthcare hover:underline">
            View all
          </button>
        </div>
        {loading ? (
          <CardSkeleton />
        ) : upcoming.length === 0 ? (
          <div className="card-base">
            <EmptyState
              title="No upcoming appointments"
              body="When you book a visit, it will appear here with reminders and preparation steps."
              action={<Button onClick={() => navigate("/book")}>Find care</Button>}
            />
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map((a) => (
              <AppointmentCard
                key={a.id}
                appointment={a}
                onView={() => setDetailId(a.id)}
                onReschedule={() => navigate("/visits", { state: { rescheduleId: a.id } })}
                onCancel={() => navigate("/visits", { state: { cancelId: a.id } })}
              />
            ))}
          </div>
        )}
      </section>

      {/* Recommended */}
      <section aria-label="Recommended care">
        <div className="flex items-center justify-between mb-1">
          <h2 className="section-title">Recommended care near you</h2>
          <button onClick={() => navigate("/book")} className="text-[0.83rem] font-bold text-healthcare hover:underline">
            See all doctors
          </button>
        </div>
        <p className="text-[0.8rem] text-ink-secondary mb-3">Discovery results based on availability — not medical advice.</p>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {recommended.map((d) => (
            <DoctorCard
              key={d.id}
              doctor={d}
              onView={() => setProfileDoctor(d)}
              onBook={() => navigate("/book", { state: { doctorId: d.id } })}
            />
          ))}
        </div>
      </section>

      {/* Hospitals + activity */}
      <section className="grid lg:grid-cols-[1fr_360px] gap-5" aria-label="Hospitals and activity">
        <div>
          <h2 className="section-title mb-3">Hospitals near you</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {nearby.map((h) => (
              <HospitalCard key={h.id} hospital={h} onView={() => navigate("/book", { state: { hospitalId: h.id } })} />
            ))}
          </div>
        </div>
        <div className="card-base p-5 h-fit">
          <h2 className="section-title">Recent activity</h2>
          <ul className="mt-3 space-y-0 relative">
            {activity.length === 0 ? (
              <li className="text-[0.83rem] text-ink-secondary">No recent activity yet — book a visit to get started.</li>
            ) : (
              activity.map((r, i) => (
              <li key={i} className="flex gap-3 pb-4 last:pb-0 relative">
                {i < 2 && <span className="absolute left-[5px] top-4 bottom-0 w-px bg-border" aria-hidden />}
                <span className={`w-[11px] h-[11px] rounded-full mt-1 shrink-0 ${r.dot}`} aria-hidden />
                <div className="min-w-0">
                  <p className="text-[0.85rem] font-bold text-ink">{r.t}</p>
                  <p className="text-[0.78rem] text-ink-secondary truncate">{r.s}</p>
                  <p className="text-[0.72rem] text-ink-faint">{r.time}</p>
                </div>
              </li>
              ))
            )}
          </ul>
          <p className="text-[0.78rem] text-ink-secondary mt-2">Signed in as {patient.name} · {patient.email}</p>
        </div>
      </section>

      <DoctorProfileModal
        doctor={profileDoctor}
        open={!!profileDoctor}
        onClose={() => setProfileDoctor(null)}
        onBook={(d) => navigate("/book", { state: { doctorId: d.id } })}
      />
      <AppointmentDetailModal appointment={detailAppt} open={!!detailAppt} onClose={() => setDetailId(null)} />
    </div>
  );
}
