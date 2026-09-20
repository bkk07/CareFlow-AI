import { useEffect, useState } from "react";
import { useSchedule } from "../../context/ScheduleContext";
import { Button } from "../common/ui";
import { Modal } from "../common/Modal";
import type { BlockedSlot } from "../../types";

const REASONS: BlockedSlot["reason"][] = ["Lunch", "Meeting", "Leave", "Administrative work", "Personal time"];

/** Shared "block time" dialog: used from the week grid and the day view. */
export default function AddEventModal({
  open,
  initialDate,
  initialStart,
  initialEnd,
  onClose,
}: {
  open: boolean;
  initialDate: string;
  initialStart: string;
  initialEnd: string;
  onClose: () => void;
}) {
  const { addLiveBlock } = useSchedule();
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [reason, setReason] = useState<BlockedSlot["reason"]>("Meeting");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(initialDate);
      setStart(initialStart);
      setEnd(initialEnd);
      setReason("Meeting");
      setError(null);
    }
  }, [open, initialDate, initialStart, initialEnd]);

  async function save() {
    if (start >= end) {
      setError("End must be after start.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addLiveBlock(date, start, end, reason);
      onClose();
    } catch {
      setError("Could not save — it may overlap an appointment or blocked time.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Event">
      <div className="space-y-3">
        <label className="block text-[0.83rem] font-bold">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base mt-1" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[0.83rem] font-bold">Start
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="input-base mt-1" />
          </label>
          <label className="block text-[0.83rem] font-bold">End
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="input-base mt-1" />
          </label>
        </div>
        <label className="block text-[0.83rem] font-bold">Reason
          <select value={reason} onChange={(e) => setReason(e.target.value as BlockedSlot["reason"])} className="input-base mt-1">
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-[0.83rem] font-semibold text-danger">{error}</p>}
        <Button onClick={() => void save()} disabled={saving} className="w-full">
          {saving ? "Saving…" : "Save event"}
        </Button>
      </div>
    </Modal>
  );
}
