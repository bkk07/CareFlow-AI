import { motion } from "framer-motion";
import { Clock, MapPin, Star } from "lucide-react";
import type { Doctor, Hospital } from "../../types";
import { consultationModeLabel } from "../../mock/services";
import { Button, SafeImage, StatusBadge } from "../common/ui";

export function DoctorCard({
  doctor,
  onView,
  onBook,
}: {
  doctor: Doctor;
  onView: () => void;
  onBook: () => void;
}) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="card-base p-5 hover:shadow-card transition-shadow"
    >
      <div className="flex gap-4">
        <SafeImage
          src={doctor.photo}
          alt={`${doctor.name} photo`}
          name={doctor.name}
          className="w-16 h-16 rounded-full shrink-0 border border-border"
        />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-ink leading-tight">{doctor.name}</h3>
          <p className="text-[0.83rem] text-healthcare font-semibold">{doctor.title}</p>
          <p className="text-[0.83rem] text-ink-secondary mt-0.5 flex items-center gap-1">
            <MapPin size={13} className="shrink-0" /> {doctor.hospitalName}
          </p>
          <p className="text-[0.8rem] text-ink-secondary mt-1">
            {doctor.experienceYears} yrs experience · {doctor.languages.join(", ")}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {doctor.consultationModes.map((m) => (
              <span key={m} className="text-[0.72rem] font-semibold bg-background border border-border rounded-full px-2 py-0.5">
                {consultationModeLabel(m)}
              </span>
            ))}
          </div>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[0.82rem] font-semibold text-success bg-success-soft rounded-lg px-2 py-1">
            <Clock size={13} /> Next: {doctor.nextAvailable}
          </p>
          <div className="flex items-center gap-1 text-[0.8rem] text-ink-secondary mt-1.5">
            <Star size={13} className="text-warning fill-warning" /> {doctor.rating} ({doctor.reviewsCount})
          </div>
          <div className="flex gap-2 mt-3">
            <Button variant="outline" size="sm" onClick={onView}>
              View profile
            </Button>
            <Button size="sm" onClick={onBook}>
              View availability
            </Button>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

export function HospitalCard({
  hospital,
  onView,
}: {
  hospital: Hospital;
  onView: () => void;
}) {
  return (
    <article className="card-base overflow-hidden hover:shadow-card transition-shadow">
      <div className="relative h-36">
        <SafeImage src={hospital.image} alt={hospital.name} name={hospital.name} className="w-full h-full" />
        <span className="absolute top-3 left-3 bg-white/95 text-navy text-[0.75rem] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
          <Star size={12} className="text-warning fill-warning" /> {hospital.rating}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-ink">{hospital.name}</h3>
        <p className="text-[0.83rem] text-ink-secondary flex items-center gap-1 mt-0.5">
          <MapPin size={13} /> {hospital.location}
        </p>
        <p className="text-[0.82rem] text-ink-secondary mt-2">
          {hospital.doctorsCount} doctors · {hospital.specialties.slice(0, 3).join(" · ")}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {hospital.consultationTypes.map((c) => (
            <StatusBadge key={c} status={c} />
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onView}>
          View hospital
        </Button>
      </div>
    </article>
  );
}
