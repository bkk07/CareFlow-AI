import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { APPOINTMENT_TYPES, DOCTORS, HOSPITALS, SPECIALTIES } from "../mock/data";
import {
  checkAvailability as apiCheckAvailability,
  createAppointment as apiCreateAppointment,
  listAppointmentTypes as apiListTypes,
  listSpecialties as apiListSpecialties,
  searchDoctors as apiSearchDoctors,
  searchHospitals as apiSearchHospitals,
  type AppointmentType as ApiAppointmentType,
  type Slot,
} from "../api";
import {
  mapDoctorResult,
  mapHospitalResult,
  mapSlot,
} from "../lib/backend";
import { consultationModeLabel, mockBookAppointment, mockCheckAvailability, mockDelay, mockFindDoctors, nextSevenDays } from "../mock/services";
import { useAppState } from "../context/AppStateContext";
import { useAuth } from "../context/AuthContext";
import { DoctorCard } from "../components/doctor/cards";
import { HospitalCard } from "../components/hospital/HospitalCard";
import { DoctorProfileModal } from "../components/doctor/DoctorProfileModal";
import { SlotPicker } from "../components/appointment/SlotPicker";
import { BookingSuccessPanel } from "../components/appointment/AppointmentDetailModal";
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/common/ui";
import type { Appointment, Doctor, Hospital, TimeSlot } from "../types";

type Step = "search" | "availability" | "review" | "success";

export default function BookPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { addAppointment, pushNotification, refresh, live } = useAppState();
  const { user } = useAuth();
  const preset = (location.state as { doctorId?: string; hospitalId?: string; query?: string } | null) ?? {};

  const [step, setStep] = useState<Step>(preset.doctorId ? "availability" : "search");
  const [query, setQuery] = useState(preset.query ?? "");
  const [specialty, setSpecialty] = useState("All");
  const [hospitalId, setHospitalId] = useState<string>(preset.hospitalId ?? "all");
  const [mode, setMode] = useState("any");
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>(HOSPITALS);
  const [specialtyOptions, setSpecialtyOptions] = useState<string[]>(SPECIALTIES);
  const [liveTypes, setLiveTypes] = useState<ApiAppointmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const rawSlots = useRef<Record<string, Slot>>({});

  const [activeDoctor, setActiveDoctor] = useState<Doctor | null>(null);
  const [profileDoctor, setProfileDoctor] = useState<Doctor | null>(null);
  const [dayKey, setDayKey] = useState(nextSevenDays()[1].key);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [selected, setSelected] = useState<TimeSlot | null>(null);
  const [typeId, setTypeId] = useState(APPOINTMENT_TYPES[1].id);
  const [consultMode, setConsultMode] = useState<Appointment["consultationMode"]>("in_person");
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const days = useMemo(() => nextSevenDays(), []);
  const dayLabel = useMemo(() => {
    const d = days.find((x) => x.key === dayKey);
    return d ? `${d.label}, ${d.sub}` : dayKey;
  }, [days, dayKey]);

  async function loadDoctors() {
    setLoading(true);
    setError(false);
    try {
      if (live) {
        const [foundHospitals, foundDoctors] = await Promise.all([
          apiSearchHospitals(""),
          apiSearchDoctors({
            query: query.trim() || undefined,
            specialty: specialty !== "All" ? specialty : undefined,
            hospital_id: hospitalId !== "all" ? hospitalId : undefined,
          }),
        ]);
        const mappedHospitals = foundHospitals.map(mapHospitalResult);
        setHospitals(mappedHospitals);
        const mapped = foundDoctors.map(mapDoctorResult);
        const filtered = mode === "any" ? mapped : mapped.filter((d) => d.consultationModes.includes(mode as Appointment["consultationMode"]));
        setDoctors(filtered);
        const derived = Array.from(new Set(foundDoctors.map((d) => d.specialty).filter((s): s is string => !!s))).sort();
        if (hospitalId !== "all") {
          try {
            const dir = await apiListSpecialties(hospitalId);
            setSpecialtyOptions(dir.map((s) => s.name));
          } catch {
            setSpecialtyOptions(derived);
          }
        } else {
          setSpecialtyOptions(derived);
        }
        if (preset.doctorId && !activeDoctor) {
          const hit = mapped.find((d) => d.id === preset.doctorId) ?? null;
          if (hit) {
            setActiveDoctor(hit);
            setConsultMode(hit.consultationModes[0]);
            setStep("availability");
          } else {
            setStep("search");
          }
        }
      } else {
        const res = await mockFindDoctors({ query, specialty, hospitalId, mode });
        setDoctors(res);
        setHospitals(HOSPITALS);
        setSpecialtyOptions(SPECIALTIES);
        if (preset.doctorId && !activeDoctor) {
          const hit = DOCTORS.find((d) => d.id === preset.doctorId) ?? null;
          if (hit) {
            setActiveDoctor(hit);
            setConsultMode(hit.consultationModes[0]);
            setStep("availability");
          } else {
            setStep("search");
          }
        }
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDoctors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // Live availability: resolve the visit type for the doctor's hospital, then
  // ask the backend for real open slots on the chosen day.
  useEffect(() => {
    if (step !== "availability" || !activeDoctor) return;
    setSlotsLoading(true);
    setSlotsError(false);
    setSelected(null);
    if (!live) {
      mockCheckAvailability(activeDoctor.id, dayKey)
        .then(setSlots)
        .catch(() => setSlotsError(true))
        .finally(() => setSlotsLoading(false));
      return;
    }
    (async () => {
      try {
        const types = await apiListTypes(activeDoctor.hospitalId);
        setLiveTypes(types);
        const chosen = types.find((t) => t.id === typeId) ?? types[0];
        if (!chosen) {
          setSlots([]);
          return;
        }
        if (chosen.id !== typeId) setTypeId(chosen.id);
        const found = await apiCheckAvailability({
          doctor_id: activeDoctor.id,
          appointment_type_id: chosen.id,
          date_from: dayKey,
          date_to: dayKey,
        });
        rawSlots.current = {};
        setSlots(
          found.map((s, i) => {
            const mapped = mapSlot(s, i);
            rawSlots.current[mapped.id] = s;
            return mapped;
          }),
        );
      } catch {
        setSlotsError(true);
      } finally {
        setSlotsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeDoctor, dayKey, live]);

  function openAvailability(d: Doctor) {
    setActiveDoctor(d);
    setConsultMode(d.consultationModes[0]);
    setBookingError(null);
    setStep("availability");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function confirmBooking() {
    if (!activeDoctor || !selected) return;
    setBooking(true);
    setBookingError(null);
    try {
      if (live && user) {
        const raw = rawSlots.current[selected.id];
        if (!raw) throw new Error("slot-missing");
        await apiCreateAppointment({
          patient_id: user.id,
          doctor_id: activeDoctor.id,
          appointment_type_id: typeId,
          slot_start: raw.start,
          slot_end: raw.end,
        });
        await refresh();
        pushNotification({
          category: "appointments",
          title: "Appointment requested",
          body: `${activeDoctor.specialty} with ${activeDoctor.name} · ${dayLabel} at ${selected.start}.`,
          unread: true,
        });
      } else {
        await mockDelay(null, 900);
        const appt = mockBookAppointment({
          doctorId: activeDoctor.id,
          dateLabel: dayLabel,
          time: selected.start,
          mode: consultMode,
          typeId,
        });
        addAppointment({ ...appt, status: "confirmed", verificationStage: "confirmed" });
        pushNotification({
          category: "appointments",
          title: "Appointment confirmed",
          body: `${activeDoctor.specialty} with ${activeDoctor.name} · ${dayLabel} at ${selected.start}.`,
          unread: true,
        });
      }
      setBooking(false);
      setStep("success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setBooking(false);
      setBookingError("Booking failed — the slot may just have been taken. Pick another time.");
    }
  }

  const typeOptions = live && liveTypes.length > 0
    ? liveTypes.map((t) => ({ id: t.id, name: t.name, durationMinutes: t.duration_minutes }))
    : APPOINTMENT_TYPES;
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

      {live && (
        <p className="text-[0.78rem] font-semibold text-teal-dark bg-teal-soft/60 border border-teal/20 rounded-control px-3 py-2 w-fit">
          Live availability from connected hospitals
        </p>
      )}

      {step === "search" && (
        <>
          <div>
            <h1 className="page-title">Find the care you need</h1>
            <p className="page-sub mt-1">Search doctors and hospitals, then check live availability.</p>
          </div>

          <div className="card-base p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex items-center gap-2 flex-1 bg-background border border-border rounded-control px-3">
                <Search size={17} className="text-ink-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void loadDoctors()}
                  placeholder="Doctor, specialty, or hospital"
                  aria-label="Search doctors"
                  className="w-full bg-transparent outline-none py-2.5 text-[0.92rem]"
                />
              </div>
              <Button onClick={() => void loadDoctors()}>Search</Button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-3 pb-0.5" aria-label="Specialties">
              {["All", ...specialtyOptions].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpecialty(s)}
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
                <select value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} className="input-base mt-1">
                  <option value="all">All hospitals</option>
                  {hospitals.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-[0.8rem] font-semibold text-ink-secondary">
                Consultation type
                <select value={mode} onChange={(e) => setMode(e.target.value)} className="input-base mt-1">
                  <option value="any">Any type</option>
                  <option value="in_person">In person</option>
                  <option value="video">Video</option>
                  <option value="phone">Phone</option>
                </select>
              </label>
              <div className="flex items-end">
                <Button variant="outline" className="w-full" onClick={() => { setQuery(""); setSpecialty("All"); setHospitalId("all"); setMode("any"); }}>
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
              <p className="text-sm text-ink-secondary font-medium">{doctors.length} doctor{doctors.length === 1 ? "" : "s"} available</p>
              <div className="grid md:grid-cols-2 gap-3">
                {doctors.map((d) => (
                  <DoctorCard key={d.id} doctor={d} onView={() => setProfileDoctor(d)} onBook={() => openAvailability(d)} />
                ))}
              </div>
              <div>
                <h2 className="section-title mb-3 mt-2">Hospitals</h2>
                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {hospitals.map((h) => (
                    <HospitalCard key={h.id} hospital={h} onView={() => { setHospitalId(h.id); void loadDoctors(); }} />
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

            <div className="grid sm:grid-cols-2 gap-2 mt-4">
              <label className="text-[0.8rem] font-semibold text-ink-secondary">
                Visit type
                <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="input-base mt-1">
                  {typeOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} · {t.durationMinutes} min</option>
                  ))}
                </select>
              </label>
              <div className="text-[0.8rem] font-semibold text-ink-secondary">
                Consultation
                <div className="flex gap-1.5 mt-1">
                  {activeDoctor.consultationModes.map((m) => (
                    <button
                      key={m}
                      onClick={() => setConsultMode(m)}
                      aria-pressed={consultMode === m}
                      className={`flex-1 text-[0.8rem] font-bold border rounded-control py-2.5 transition ${consultMode === m ? "bg-navy text-white border-navy" : "bg-white border-border hover:border-healthcare"}`}
                    >
                      {consultationModeLabel(m)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <h3 className="font-bold text-ink mt-5 mb-2 text-[0.95rem]">Choose a day</h3>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1" role="tablist" aria-label="Days">
              {days.map((d) => (
                <button
                  key={d.key}
                  role="tab"
                  aria-selected={dayKey === d.key}
                  onClick={() => setDayKey(d.key)}
                  className={`min-w-[86px] px-3 py-2.5 rounded-control border text-center transition shrink-0 ${
                    dayKey === d.key ? "bg-healthcare text-white border-healthcare-dark" : "bg-white border-border hover:border-healthcare"
                  }`}
                >
                  <span className="block text-[0.78rem] font-bold">{d.label}</span>
                  <span className={`block text-[0.75rem] ${dayKey === d.key ? "text-white/85" : "text-ink-secondary"}`}>{d.sub}</span>
                </button>
              ))}
            </div>

            <h3 className="font-bold text-ink mt-5 mb-2 text-[0.95rem]">Available times</h3>
            {slotsError ? (
              <ErrorState title="Unable to load availability" body="Please try another day." onRetry={() => setDayKey(days[0].key)} />
            ) : (
              <SlotPicker slots={slots} selectedId={selected?.id ?? null} onSelect={setSelected} loading={slotsLoading} />
            )}
          </div>

          <aside className="card-base p-5 lg:sticky lg:top-20">
            <h3 className="font-bold text-ink">Booking summary</h3>
            <dl className="mt-3 space-y-2 text-[0.86rem]">
              {[
                ["Doctor", activeDoctor.name],
                ["Hospital", activeDoctor.hospitalName],
                ["Date", dayLabel],
                ["Time", selected ? selected.start : "—"],
                ["Type", activeType ? `${activeType.name} · ${activeType.durationMinutes} min` : "—"],
                ["Visit", consultationModeLabel(consultMode)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-ink-secondary">{k}</dt>
                  <dd className="font-bold text-ink text-right">{v}</dd>
                </div>
              ))}
            </dl>
            <Button disabled={!selected} onClick={() => setStep("review")} className="w-full mt-4">
              Continue <ArrowRight size={16} />
            </Button>
            {!selected && <p className="text-[0.78rem] text-ink-faint text-center mt-2">Select a time to continue</p>}
          </aside>
        </div>
      )}

      {step === "review" && activeDoctor && selected && (
        <div className="max-w-2xl mx-auto card-base p-6">
          <button onClick={() => setStep("availability")} className="text-[0.83rem] font-bold text-ink-secondary hover:text-healthcare mb-2">← Change time</button>
          <h1 className="text-[1.3rem] font-extrabold text-navy">Review your appointment</h1>
          <div className="mt-4 divide-y divide-border border border-border rounded-control overflow-hidden">
            {[
              ["Doctor", `${activeDoctor.name} · ${activeDoctor.specialty}`],
              ["Hospital", activeDoctor.hospitalName],
              ["Date", dayLabel],
              ["Time", `${selected.start} · ${activeType?.durationMinutes ?? ""} min`],
              ["Type", `${activeType?.name ?? ""} · ${consultationModeLabel(consultMode)}`],
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
