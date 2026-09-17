import { Award, Clock, Globe, MapPin, Star } from "lucide-react";
import type { Doctor } from "../../types";
import { consultationModeLabel } from "../../mock/services";
import { Button, SafeImage } from "../common/ui";
import { Modal } from "../common/Modal";

export function DoctorProfileModal({
  doctor,
  open,
  onClose,
  onBook,
}: {
  doctor: Doctor | null;
  open: boolean;
  onClose: () => void;
  onBook: (d: Doctor) => void;
}) {
  if (!doctor) return null;
  return (
    <Modal open={open} onClose={onClose} title="Doctor profile" wide>
      <div className="flex flex-col sm:flex-row gap-5">
        <SafeImage
          src={doctor.photo}
          alt={doctor.name}
          name={doctor.name}
          className="w-28 h-28 rounded-2xl border border-border shrink-0"
        />
        <div className="min-w-0">
          <h3 className="text-xl font-extrabold text-navy">{doctor.name}</h3>
          <p className="text-healthcare font-semibold text-sm">{doctor.title}</p>
          <p className="text-sm text-ink-secondary mt-1 flex items-center gap-1.5">
            <MapPin size={14} /> {doctor.hospitalName} · {doctor.department}
          </p>
          <p className="text-sm text-ink-secondary mt-1 flex items-center gap-1.5">
            <Star size={14} className="text-warning fill-warning" /> {doctor.rating} · {doctor.reviewsCount} patient reviews
          </p>
          <div className="grid sm:grid-cols-3 gap-2 mt-3 text-[0.82rem]">
            <span className="bg-background border border-border rounded-lg px-2.5 py-2 flex items-center gap-1.5">
              <Award size={14} className="text-teal" /> {doctor.qualifications}
            </span>
            <span className="bg-background border border-border rounded-lg px-2.5 py-2 flex items-center gap-1.5">
              <Clock size={14} className="text-teal" /> {doctor.experienceYears} yrs experience
            </span>
            <span className="bg-background border border-border rounded-lg px-2.5 py-2 flex items-center gap-1.5">
              <Globe size={14} className="text-teal" /> {doctor.languages.join(", ")}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-4 text-sm leading-relaxed">
        <section>
          <h4 className="font-bold text-ink mb-1">About</h4>
          <p className="text-ink-secondary">{doctor.about}</p>
        </section>
        <section>
          <h4 className="font-bold text-ink mb-1">Areas of practice</h4>
          <ul className="list-disc pl-5 text-ink-secondary space-y-0.5">
            {doctor.areasOfPractice.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
        <section>
          <h4 className="font-bold text-ink mb-1">Consultation information</h4>
          <p className="text-ink-secondary">
            Available for {doctor.consultationModes.map(consultationModeLabel).join(", ")} visits.
            Next available: <strong className="text-ink">{doctor.nextAvailable}</strong>. Please arrive
            10 minutes early for in-person visits and keep your ID ready.
          </p>
        </section>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-5">
        <Button variant="outline" onClick={onClose} className="sm:w-auto w-full">
          Close
        </Button>
        <Button
          onClick={() => {
            onClose();
            onBook(doctor);
          }}
          className="sm:flex-1 w-full"
        >
          Check availability · {doctor.nextAvailable}
        </Button>
      </div>
    </Modal>
  );
}
