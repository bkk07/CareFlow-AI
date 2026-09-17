import { motion } from "framer-motion";
import type { TimeSlot } from "../../types";

const PERIODS = [
  { id: "morning", label: "Morning" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening", label: "Evening" },
] as const;

export function SlotPicker({
  slots,
  selectedId,
  onSelect,
  loading,
}: {
  slots: TimeSlot[];
  selectedId: string | null;
  onSelect: (s: TimeSlot) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-4" aria-live="polite" aria-label="Loading availability">
        {PERIODS.map((p) => (
          <div key={p.id}>
            <div className="skeleton h-4 w-24 rounded mb-2" />
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-10 rounded-control" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const available = slots.filter((s) => s.available);
  if (available.length === 0) {
    return (
      <div className="card-base p-6 text-center">
        <p className="font-bold text-ink">No open slots this day</p>
        <p className="text-sm text-ink-secondary mt-1">Try another day — new availability opens regularly.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {PERIODS.map((p) => {
        const group = slots.filter((s) => s.period === p.id);
        if (group.length === 0) return null;
        return (
          <div key={p.id}>
            <h4 className="text-[0.83rem] font-bold text-ink-secondary uppercase tracking-wide mb-2">{p.label}</h4>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {group.map((s) => {
                const selected = selectedId === s.id;
                return (
                  <motion.button
                    key={s.id}
                    type="button"
                    disabled={!s.available}
                    onClick={() => onSelect(s)}
                    aria-pressed={selected}
                    whileTap={s.available ? { scale: 0.95 } : undefined}
                    className={`min-h-[2.75rem] px-2 rounded-control border text-[0.85rem] font-semibold transition ${
                      selected
                        ? "bg-healthcare text-white border-healthcare-dark shadow-subtle"
                        : s.available
                          ? "bg-white text-navy border-healthcare/30 hover:border-healthcare hover:bg-healthcare-soft"
                          : "bg-background text-ink-faint border-border line-through cursor-not-allowed"
                    }`}
                  >
                    {s.start}
                  </motion.button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[0.78rem] text-ink-secondary" aria-live="polite">
        Times shown in your local time. Your current appointment stays unchanged until a new slot is confirmed.
      </p>
    </div>
  );
}
