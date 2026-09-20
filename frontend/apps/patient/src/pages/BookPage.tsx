import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  apiError as apiErrorText,
  createAppointment as apiCreateAppointment,
  fetchContact as apiFetchContact,
  fetchDaySchedule as apiDaySchedule,
  listAppointmentTypes as apiListTypes,
  listSpecialties as apiListSpecialties,
  searchDoctors as apiSearchDoctors,
  searchHospitals as apiSearchHospitals,
  type AppointmentType as ApiAppointmentType,
  type DayScheduleWindow,
} from "../api";
import {
  mapDoctorResult,
  mapHospitalResult,
} from "../lib/backend";
import { consultationModeLabel, formatDayKeyLong, parseDayKey, sevenDaysFrom, toLocalKey, readPosition, type GeoCoords } from "../lib/helpers";
import { useAppState } from "../context/AppStateContext";
import { useAuth } from "../context/AuthContext";
import { DoctorCard } from "../components/doctor/cards";
import { HospitalCard } from "../components/hospital/HospitalCard";
import { DoctorProfileModal } from "../components/doctor/DoctorProfileModal";
import DaySchedulePicker, {
  endIsoFor,
  fmtRange,
  isRangeAvailable,
} from "../components/appointment/DaySchedulePicker";
import DayStripWithCalendar from "../components/appointment/DayStripWithCalendar";
import { BookingSuccessPanel } from "../components/appointment/AppointmentDetailModal";
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/common/ui";
import type { Appointment, Doctor, Hospital } from "../types";

type Step = "search" | "availability" | "review" | "success";

export default function BookPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { pushNotification, refresh, live } = useAppState();
  const { user } = useAuth();
  const preset = (location.state as { doctorId?: string; hospitalId?: string; query?: string } | null) ?? {};

  const [step, setStep] = useState<Step>(preset.doctorId ? "availability" : "search");
  const [query, setQuery] = useState(preset.query ?? "");
  const [specialty, setSpecialty] = useState("All");
  const [hospitalId, setHospitalId] = useState<string>(preset.hospitalId ?? "all");
  const [mode, setMode] = useState("any");
  const [allDoctors, setAllDoctors] = useState<Doctor[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [specialtyOptions, setSpecialtyOptions] = useState<string[]>([]);
  const [liveTypes, setLiveTypes] = useState<ApiAppointmentType[]>([]);
  const [myCity, setMyCity] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoCoords | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [activeDoctor, setActiveDoctor] = useState<Doctor | null>(null);
  const [profileDoctor, setProfileDoctor] = useState<Doctor | null>(null);
  // Anchor for the day strip: picking any calendar day re-anchors the strip
  // to start from that day, and the schedule below fetches that day.
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [dayKey, setDayKey] = useState(() => toLocalKey(new Date()));
  const [workingHours, setWorkingHours] = useState<DayScheduleWindow[]>([]);
  const [busy, setBusy] = useState<DayScheduleWindow[]>([]);
  const [schedLoading, setSchedLoading] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);
  // Chosen range: start picked by the patient, end = start + event duration.
  const [sel, setSel] = useState<{ start: string; end: string } | null>(null);
  // Bumped to force a fresh schedule fetch (e.g. after a booking conflict,
  // so a just-taken time shows as unavailable instead of staying bookable).
  const [schedRefreshKey, setSchedRefreshKey] = useState(0);
  const [typeId, setTypeId] = useState("");
  // Required explicit pick — no pre-selected default, so the patient always
  // confirms how they want to meet the doctor (backend re-validates it
  // against the doctor's offered consultation types).
  const [consultMode, setConsultMode] = useState<Appointment["consultationMode"] | "">("");
  const [consultError, setConsultError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const days = useMemo(() => sevenDaysFrom(anchorDate), [anchorDate]);
  const dayLabel = useMemo(() => {
    const d = days.find((x) => x.key === dayKey);
    return d ? `${d.label}, ${d.sub}` : formatDayKeyLong(dayKey);
  }, [days, dayKey]);

  // Consultation-type is filtered server-side; the client memo re-applies
  // it as a safety net (e.g. legacy doctors with unconfigured types).
  const doctors = useMemo(
    () =>
      mode === "any"
        ? allDoctors
        : allDoctors.filter((d) =>
            d.consultationModes.includes(mode as Appointment["consultationMode"]),
          ),
    [allDoctors, mode],
  );

  interface SearchOverrides {
    city?: string | null;
    query?: string;
    specialty?: string;
    hospitalId?: string;
    mode?: string;
    geo?: GeoCoords | null;
    doctorId?: string | null;
  }

  async function loadDoctors(overrides?: SearchOverrides | string | null) {
    // Back-compat: loadDoctors(cityOverride) from older call sites.
    const opts: SearchOverrides =
      typeof overrides === "string" || overrides === null || overrides === undefined
        ? overrides === undefined
          ? {}
          : { city: overrides }
        : overrides;
    const effCity = opts.city !== undefined ? opts.city : myCity;
    const effQuery = (opts.query !== undefined ? opts.query : query).trim();
    const effSpecialty = opts.specialty !== undefined ? opts.specialty : specialty;
    const effHospitalId = opts.hospitalId !== undefined ? opts.hospitalId : hospitalId;
    const effMode = opts.mode !== undefined ? opts.mode : mode;
    const effGeo = opts.geo !== undefined ? opts.geo : geo;
    const effDoctorId = opts.doctorId !== undefined ? opts.doctorId : preset.doctorId;
    setLoading(true);
    setError(false);
    try {
      const [foundHospitals, foundDoctors] = await Promise.all([
        apiSearchHospitals(effQuery || "", effCity ?? undefined, effGeo ?? undefined),
        apiSearchDoctors({
          // Free text matches doctor name, specialty, or hospital name.
          query: effQuery || undefined,
          // Structured filters narrow the free-text result set.
          specialty: effSpecialty !== "All" ? effSpecialty : undefined,
          hospital_id: effHospitalId !== "all" ? effHospitalId : undefined,
          consultation_mode: effMode !== "any" ? effMode : undefined,
          city: effCity ?? undefined,
          latitude: effGeo?.latitude,
          longitude: effGeo?.longitude,
          limit: 20,
        }),
      ]);
      const mappedHospitals = foundHospitals.map(mapHospitalResult);
      setHospitals(mappedHospitals);
      const mapped = foundDoctors.map(mapDoctorResult);
      setAllDoctors(mapped);
      const derived = Array.from(new Set(foundDoctors.map((d) => d.specialty).filter((s): s is string => !!s))).sort();
      if (effHospitalId !== "all") {
        try {
          const dir = await apiListSpecialties(effHospitalId);
          setSpecialtyOptions(dir.map((s) => s.name));
        } catch {
          setSpecialtyOptions(derived);
        }
      } else if (effSpecialty !== "All") {
        // A specialty filter narrows the results to that specialty, so the
        // derived list would collapse to one chip and trap the user.
        // Merge instead of replacing so other specialties stay selectable.
        setSpecialtyOptions((prev) =>
          Array.from(new Set([...prev, ...derived, effSpecialty])).sort(),
        );
      } else {
        setSpecialtyOptions(derived);
      }
      if (effDoctorId) {
        const hit = mapped.find((d) => d.id === effDoctorId) ?? null;
        if (hit) {
          setActiveDoctor(hit);
          setConsultMode("");
          setConsultError(null);
          setTypeId("");
          setSel(null);
          setStep("availability");
        } else {
          setStep("search");
        }
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function useMyLocation() {
    setLocating(true);
    setGeoError(null);
    readPosition()
      .then((g) => {
        setGeo(g);
        setLocating(false);
      })
      .catch((e: unknown) => {
        setGeoError(e instanceof Error ? e.message : "Could not read your location.");
        setLocating(false);
      });
  }

  useEffect(() => {
    if (!live) return;
    // Saved city first (taken once), then search so nearby ranks correctly.
    // Preset values from navigation (Home hero query, hospital/doctor cards)
    // are passed explicitly so the first search uses them even though
    // setState below is async.
    apiFetchContact()
      .then((c) => {
        setMyCity(c.city ?? null);
        void loadDoctors({
          city: c.city ?? null,
          query: preset.query ?? "",
          specialty: "All",
          hospitalId: preset.hospitalId ?? "all",
          doctorId: preset.doctorId ?? null,
        });
      })
      .catch(() => {
        setMyCity(null);
        void loadDoctors({
          city: null,
          query: preset.query ?? "",
          specialty: "All",
          hospitalId: preset.hospitalId ?? "all",
          doctorId: preset.doctorId ?? null,
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // Incoming navigation state (Home hero search, Recommended/Hospital cards)
  // while this page is already mounted: sync the form and re-search with the
  // new values explicitly (setState alone would leave a stale search).
  // The first mount is skipped — the live effect above already searched.
  const navKey = JSON.stringify(location.state ?? null);
  const firstNav = useRef(false);
  useEffect(() => {
    if (!live) return;
    if (!firstNav.current) {
      firstNav.current = true;
      return;
    }
    const incoming = (location.state as { doctorId?: string; hospitalId?: string; query?: string } | null) ?? {};
    if (incoming.query === undefined && incoming.hospitalId === undefined && incoming.doctorId === undefined) return;
    if (incoming.query !== undefined) setQuery(incoming.query);
    if (incoming.hospitalId !== undefined) setHospitalId(incoming.hospitalId);
    if (incoming.doctorId !== undefined) {
      setStep("availability");
    } else {
      setStep("search");
    }
    void loadDoctors({
      query: incoming.query ?? query,
      hospitalId: incoming.hospitalId ?? hospitalId,
      doctorId: incoming.doctorId ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navKey, live]);

  // Re-rank by distance as soon as the patient shares a position.
  useEffect(() => {
    if (live && geo && step === "search") void loadDoctors({ geo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

  // Live availability from the doctor's ORIGINAL working hours:
  // 1) load the hospital's visit types, preferring durations the doctor
  //    actually offers (doctor.availableDurations), then
  // 2) ask the backend for real open slots (rules minus blocks minus
  //    bookings) for the chosen day + visit type.
  // Step 1 — resolve visit types whenever the doctor changes.
  useEffect(() => {
    if (step !== "availability" || !activeDoctor || !live) return;
    let cancelled = false;
    (async () => {
      try {
        const types = await apiListTypes(activeDoctor.hospitalId);
        if (cancelled) return;
        setLiveTypes(types);
        const offered = activeDoctor.availableDurations ?? [];
        const compatible =
          offered.length > 0
            ? types.filter((t) => offered.includes(t.duration_minutes))
            : types;
        const pool = compatible.length > 0 ? compatible : types;
        const chosen = pool.find((t) => t.id === typeId) ?? pool[0];
        if (!chosen) {
          setTypeId("");
          return;
        }
        if (chosen.id !== typeId) setTypeId(chosen.id);
      } catch (e) {
        if (!cancelled) setSchedError(apiErrorText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeDoctor, live]);

  // Step 2 — load the doctor's working day (hours + anonymous busy blocks).
  // Type-independent: the timeline is the same whatever the event; only
  // the duration math changes. Picking a start time only SELECTS it;
  // booking happens solely via Confirm appointment on the review step.
  useEffect(() => {
    if (step !== "availability" || !activeDoctor || !live) return;
    let cancelled = false;
    setSchedLoading(true);
    setSchedError(null);
    setSel(null);
    (async () => {
      try {
        const sched = await apiDaySchedule(activeDoctor.id, dayKey);
        if (cancelled) return;
        setWorkingHours(sched.working_hours);
        setBusy(sched.busy);
      } catch (e) {
        if (!cancelled) setSchedError(apiErrorText(e));
      } finally {
        if (!cancelled) setSchedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, activeDoctor, dayKey, live, schedRefreshKey]);

  function openAvailability(d: Doctor) {
    setActiveDoctor(d);
    setConsultMode("");
    setConsultError(null);
    setTypeId("");
    setSel(null);
    setSchedError(null);
    setBookingError(null);
    setStep("availability");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleStartSelect(startIso: string | null) {
    if (!startIso || !activeType) {
      setSel(null);
      return;
    }
    setSel({ start: startIso, end: endIsoFor(startIso, activeType.durationMinutes) });
  }

  async function confirmBooking() {
    if (!activeDoctor || !sel) return;
    if (!consultMode) {
      setConsultError("Choose how you want to meet — in person, video, or phone.");
      setStep("availability");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setBooking(true);
    setBookingError(null);
    try {
      if (!user) throw new Error("slot-missing");
      await apiCreateAppointment({
        patient_id: user.id,
        doctor_id: activeDoctor.id,
        appointment_type_id: typeId,
        slot_start: sel.start,
        slot_end: sel.end,
        consultation_mode: consultMode,
      });
      await refresh();
      pushNotification({
        category: "appointments",
        title: "Appointment requested",
        body: `${activeDoctor.specialty} with ${activeDoctor.name} · ${dayLabel} at ${fmtRange(sel.start, sel.end)}.`,
        unread: true,
      });
      setBooking(false);
      // Fresh schedule for the next booking — the taken time is now busy.
      setSchedRefreshKey((k) => k + 1);
      setStep("success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setBooking(false);
      const raw = apiErrorText(e);
      const taken = /409|not available|taken|conflict/i.test(raw);
      if (taken) {
        // Someone just took this time: refetch so the timeline shows it
        // as busy instead of staying bookable.
        setSel(null);
        setSchedRefreshKey((k) => k + 1);
        setStep("availability");
        setBookingError("That time was just taken. The schedule has been refreshed — please pick another time.");
      } else {
        setBookingError(raw);
      }
    }
  }

  const offeredDurations = activeDoctor?.availableDurations ?? [];
  const compatibleTypes = liveTypes.filter((t) =>
    offeredDurations.length === 0 ? true : offeredDurations.includes(t.duration_minutes),
  );
  const visibleTypes = compatibleTypes.length > 0 ? compatibleTypes : liveTypes;
  const typeOptions = visibleTypes.map((t) => ({ id: t.id, name: t.name, durationMinutes: t.duration_minutes }));
  const activeType = typeOptions.find((t) => t.id === typeId) ?? typeOptions[0];

  return (
    <div className="space-y-5">
      {/* Stepper */}
      <div className="flex items-center gap-1.5 flex-wrap" aria-label="Booking progress">
        {(["Find care", "Time", "Review", "Done"] as const).map((label, i) => {
          const order: Step[] = ["search", "availability", "review", "success"];
          const idx = order.indexOf(step);
          const cls = idx > i ? "bg-success-soft text-success border-success/25" : idx === i ? "bg-navy text-white border-navy" : "bg-white text-ink-faint border-border";
          return (
            <span key={label} className={`text-[0.76rem] font-bold border rounded-full px-3 py-1 ${cls}`}>
              {i + 1} · {label}
            </span>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
          Live availability from connected hospitals
        </p>
          {myCity ? (
            <p className="text-[0.78rem] font-semibold text-navy bg-background border border-border rounded-control px-3 py-2 w-fit">
              Showing care near {myCity}
            </p>
          ) : (
            <button
              onClick={() => navigate("/profile")}
              className="text-[0.78rem] font-semibold text-healthcare bg-healthcare-faint border border-healthcare/25 rounded-control px-3 py-2 w-fit hover:underline"
            >
              Set your city for nearby suggestions
            </button>
          )}
      </div>

          {step === "search" && (
        <>
          <div>
            <h1 className="page-title">Find the care you need</h1>
            <p className="page-sub mt-1">Search doctors and hospitals, then check live availability.</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {geo ? (
                <>
                  <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-1.5 w-fit">
                    Ranked by distance from you
                  </p>
                  <button onClick={() => { setGeo(null); void loadDoctors({ geo: null }); }} className="text-[0.78rem] font-semibold text-ink-secondary hover:text-healthcare hover:underline">
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
          </div>

          <div className="card-base p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex items-center gap-2 flex-1 bg-background border border-border rounded-control px-3">
                <Search size={17} className="text-ink-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void loadDoctors()}
                  placeholder="Search by doctor name, specialty, or hospital…"
                  aria-label="Search by doctor name, specialty, or hospital"
                  className="w-full bg-transparent outline-none py-2.5 text-[0.92rem]"
                />
              </div>
              <Button onClick={() => void loadDoctors()}>Search</Button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-3 pb-0.5" aria-label="Specialties">
              {["All", ...specialtyOptions].map((s) => (
                <button
                  key={s}
                  onClick={() => { setSpecialty(s); void loadDoctors({ specialty: s }); }}
                  className={`chip ${specialty === s ? "bg-navy text-white border-navy" : "bg-white text-ink-secondary border-border hover:border-healthcare"}`}
                  aria-pressed={specialty === s}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="grid sm:grid-cols-3 gap-2 mt-3">
              <label className="text-[0.8rem] font-semibold text-ink-secondary">
                Hospital
                <select value={hospitalId} onChange={(e) => { setHospitalId(e.target.value); void loadDoctors({ hospitalId: e.target.value }); }} className="input-base mt-1">
                  <option value="all">All hospitals</option>
                  {hospitals.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-[0.8rem] font-semibold text-ink-secondary">
                Consultation type
                <select value={mode} onChange={(e) => { setMode(e.target.value); void loadDoctors({ mode: e.target.value }); }} className="input-base mt-1">
                  <option value="any">Any type</option>
                  <option value="in_person">In person</option>
                  <option value="video">Video</option>
                  <option value="phone">Phone</option>
                </select>
              </label>
              <div className="flex items-end">
                <Button variant="outline" className="w-full" onClick={() => { setQuery(""); setSpecialty("All"); setHospitalId("all"); setMode("any"); void loadDoctors({ query: "", specialty: "All", hospitalId: "all", mode: "any" }); }}>
                  Clear filters
                </Button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="grid md:grid-cols-2 gap-3">
              <CardSkeleton /> <CardSkeleton />
            </div>
          ) : error ? (
            <ErrorState title="Unable to load doctors" body="Something went wrong while loading results." onRetry={() => void loadDoctors()} />
          ) : doctors.length === 0 ? (
            <div className="card-base">
              <EmptyState
                title="No doctors found"
                body="Try a different specialty, hospital, or consultation type — or ask CareFlow AI for help."
                action={<Button onClick={() => navigate("/chat")}>Ask CareFlow AI</Button>}
              />
            </div>
          ) : (
            <>
              <p className="text-sm text-ink-secondary font-medium">
                {doctors.length} doctor{doctors.length === 1 ? "" : "s"} available
                {(query.trim() || specialty !== "All" || hospitalId !== "all" || mode !== "any") && (
                  <span className="text-ink-faint">
                    {" "}· filtered
                    {query.trim() ? ` by “${query.trim()}”` : ""}
                    {specialty !== "All" ? ` · ${specialty}` : ""}
                    {hospitalId !== "all" ? ` · ${hospitals.find((h) => h.id === hospitalId)?.name ?? "hospital"}` : ""}
                    {mode !== "any" ? ` · ${mode.replace("_", " ")}` : ""}
                  </span>
                )}
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                {doctors.map((d) => (
                  <DoctorCard key={d.id} doctor={d} onView={() => setProfileDoctor(d)} onBook={() => openAvailability(d)} />
                ))}
              </div>
              <div>
                <h2 className="section-title mb-3 mt-2">Hospitals</h2>
                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {hospitals.map((h) => (
                    <HospitalCard key={h.id} hospital={h} onView={() => { setHospitalId(h.id); void loadDoctors({ hospitalId: h.id }); }} />
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {step === "availability" && activeDoctor && (
        <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
          <div className="card-base p-5 sm:p-6">
            <button onClick={() => setStep("search")} className="text-[0.83rem] font-bold text-ink-secondary hover:text-healthcare mb-2">← Back to results</button>
            <h1 className="text-[1.3rem] font-extrabold text-navy">Book with {activeDoctor.name}</h1>
            <p className="text-sm text-ink-secondary">{activeDoctor.specialty} · {activeDoctor.hospitalName}</p>
            <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit mt-2">
              Live schedule from {activeDoctor.name}&rsquo;s working hours
              {offeredDurations.length > 0 ? ` · ${offeredDurations.join(", ")} min visits` : ""}
            </p>

            <div className="grid sm:grid-cols-2 gap-2 mt-4">
              <label className="text-[0.8rem] font-semibold text-ink-secondary">
                Visit type
                <select
                  value={typeId}
                  onChange={(e) => {
                    setTypeId(e.target.value);
                    setSel(null);
                    setBookingError(null);
                  }}
                  className="input-base mt-1"
                >
                  {typeOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} · {t.durationMinutes} min</option>
                  ))}
                </select>
              </label>
              <div className="text-[0.8rem] font-semibold text-ink-secondary">
                Consultation <span className="text-danger">*</span>
                <div className="flex gap-1.5 mt-1" role="radiogroup" aria-label="Consultation type (required)">
                  {activeDoctor.consultationModes.map((m) => (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={consultMode === m}
                      onClick={() => { setConsultMode(m); setConsultError(null); }}
                      className={`flex-1 text-[0.8rem] font-bold border rounded-control py-2.5 transition ${consultMode === m ? "bg-navy text-white border-navy" : "bg-white border-border hover:border-healthcare"}`}
                    >
                      {consultationModeLabel(m)}
                    </button>
                  ))}
                </div>
                {consultError ? (
                  <p role="alert" className="text-[0.78rem] font-semibold text-danger mt-1">{consultError}</p>
                ) : (
                  !consultMode && (
                    <p className="text-[0.76rem] text-ink-faint mt-1">Required — pick how you want to meet.</p>
                  )
                )}
              </div>
            </div>

            <h3 className="font-bold text-ink mt-5 mb-2 text-[0.95rem]">Choose a day</h3>
            <DayStripWithCalendar
              days={days}
              dayKey={dayKey}
              anchorDate={anchorDate}
              onSelect={(k) => { setDayKey(k); setBookingError(null); }}
              onPickDate={(d) => { setAnchorDate(d); setDayKey(toLocalKey(d)); setBookingError(null); }}
            />
            {parseDayKey(dayKey).getTime() !== new Date(new Date().setHours(0, 0, 0, 0)).getTime() && (
              <button
                onClick={() => { const t = new Date(); setAnchorDate(t); setDayKey(toLocalKey(t)); }}
                className="text-[0.78rem] font-bold text-healthcare hover:underline mt-1.5"
              >
                Back to today
              </button>
            )}

            <h3 className="font-bold text-ink mt-5 mb-2 text-[0.95rem]">Day schedule</h3>
            <p className="text-[0.78rem] text-ink-secondary mb-2">Colored blocks are already taken — choose your preferred start time below. Nothing is booked until you confirm on the next step.</p>
            {bookingError && (
              <p role="alert" className="mb-3 text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">
                {bookingError}
              </p>
            )}
            {schedError ? (
              <ErrorState title="Unable to load availability" body={schedError} onRetry={() => setSchedRefreshKey((k) => k + 1)} />
            ) : !activeType ? (
              <p className="text-[0.86rem] text-ink-secondary border border-dashed border-border rounded-control px-4 py-6 text-center">
                No visit types available for this doctor.
              </p>
            ) : (
              <DaySchedulePicker
                workingHours={workingHours}
                busy={busy}
                durationMinutes={activeType.durationMinutes}
                dayKey={dayKey}
                selectedStart={sel?.start ?? null}
                onSelect={handleStartSelect}
                loading={schedLoading}
              />
            )}
          </div>

          <aside className="card-base p-5 lg:sticky lg:top-20">
            <h3 className="font-bold text-ink">Booking summary</h3>
            <dl className="mt-3 space-y-2 text-[0.86rem]">
              {[
                ["Doctor", activeDoctor.name],
                ["Hospital", activeDoctor.hospitalName],
                ["Date", dayLabel],
                ["Time", sel ? fmtRange(sel.start, sel.end) : "—"],
                ["Type", activeType ? `${activeType.name} · ${activeType.durationMinutes} min` : "—"],
                ["Visit", consultMode ? consultationModeLabel(consultMode) : "— (required)"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-ink-secondary">{k}</dt>
                  <dd className="font-bold text-ink text-right">{v}</dd>
                </div>
              ))}
            </dl>
            <Button
              disabled={!sel || !consultMode || !isRangeAvailable(workingHours, busy, sel.start, sel.end)}
              onClick={() => {
                if (!consultMode) {
                  setConsultError("Choose how you want to meet — in person, video, or phone.");
                  return;
                }
                setStep("review");
              }}
              className="w-full mt-4"
            >
              Review booking <ArrowRight size={16} />
            </Button>
            {!sel && <p className="text-[0.78rem] text-ink-faint text-center mt-2">Choose a start time to continue — choosing does not book anything yet</p>}
            {sel && !consultMode && <p className="text-[0.78rem] font-semibold text-danger text-center mt-2">Pick a consultation type to continue.</p>}
          </aside>
        </div>
      )}

      {step === "review" && activeDoctor && sel && (
        <div className="max-w-2xl mx-auto card-base p-6">
          <button onClick={() => setStep("availability")} className="text-[0.83rem] font-bold text-ink-secondary hover:text-healthcare mb-2">← Change time</button>
          <h1 className="text-[1.3rem] font-extrabold text-navy">Review your appointment</h1>
          <div className="mt-4 divide-y divide-border border border-border rounded-control overflow-hidden">
            {[
              ["Doctor", `${activeDoctor.name} · ${activeDoctor.specialty}`],
              ["Hospital", activeDoctor.hospitalName],
              ["Date", dayLabel],
              ["Time", `${fmtRange(sel.start, sel.end)} · ${activeType?.durationMinutes ?? ""} min`],
              ["Type", `${activeType?.name ?? ""} · ${consultMode ? consultationModeLabel(consultMode) : "—"}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-3 text-sm bg-white">
                <span className="text-ink-secondary">{k}</span>
                <span className="font-bold text-ink text-right">{v}</span>
              </div>
            ))}
          </div>
          {bookingError && (
            <p role="alert" className="mt-3 text-[0.83rem] font-semibold text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2.5">
              {bookingError}
            </p>
          )}
          <Button onClick={() => void confirmBooking()} disabled={booking} size="lg" className="w-full mt-4">
            {booking ? "Confirming…" : "Confirm appointment"}
          </Button>
          <p className="text-[0.78rem] text-ink-secondary text-center mt-2">You can reschedule or cancel later from Visits.</p>
        </div>
      )}

      {step === "success" && (
        <div className="max-w-2xl mx-auto card-base p-6">
          <BookingSuccessPanel onDone={() => navigate("/visits")} />
          <button onClick={() => navigate("/")} className="w-full text-center text-sm font-bold text-healthcare hover:underline mt-2">
            Back to home
          </button>
        </div>
      )}

      <DoctorProfileModal doctor={profileDoctor} open={!!profileDoctor} onClose={() => setProfileDoctor(null)} onBook={openAvailability} />

      <AnimatePresence>
        {booking && (
          <motion.div className="fixed inset-0 z-40 bg-navy-deep/40 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-white rounded-card px-6 py-5 flex items-center gap-3 shadow-card">
              <CheckCircle2 className="text-healthcare animate-pulse" size={22} />
              <p className="font-bold text-navy text-sm">Confirming your appointment…</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
