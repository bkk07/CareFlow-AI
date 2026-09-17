import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div className="absolute inset-0 bg-navy-deep/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.div
            className={`relative bg-white w-full rounded-t-2xl sm:rounded-card shadow-card max-h-[92vh] overflow-y-auto ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22 }}
          >
            <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-navy">{title}</h2>
              <button onClick={onClose} aria-label="Close dialog" className="w-9 h-9 rounded-full hover:bg-background flex items-center justify-center text-ink-secondary">
                <X size={18} />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div className="absolute inset-0 bg-navy-deep/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.aside
            className="absolute inset-y-0 right-0 w-full sm:max-w-md bg-white shadow-card overflow-y-auto"
            initial={{ x: 320, opacity: 0.5 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 320, opacity: 0 }}
            transition={{ duration: 0.24 }}
          >
            <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-navy">{title}</h2>
              <button onClick={onClose} aria-label="Close panel" className="w-9 h-9 rounded-full hover:bg-background flex items-center justify-center text-ink-secondary">
                <X size={18} />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-border" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`relative px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition ${active === t.id ? "text-healthcare" : "text-ink-secondary hover:text-ink"}`}
        >
          {t.label}
          {typeof t.count === "number" && (
            <span className="ml-1.5 text-xs bg-background border border-border rounded-full px-1.5 py-0.5">{t.count}</span>
          )}
          {active === t.id && <motion.span layoutId="doctor-tabs" className="absolute inset-x-2 -bottom-px h-0.5 bg-healthcare rounded-full" />}
        </button>
      ))}
    </div>
  );
}
