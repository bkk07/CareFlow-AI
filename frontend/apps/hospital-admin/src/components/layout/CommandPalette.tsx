import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useAdmin } from "../../store/AdminStore";
import { StatusBadge } from "../common/ui";
import { HOSPITAL_NAV } from "./nav";

type Item = {
  key: string;
  group: string;
  label: string;
  sub?: string;
  to: string;
  status?: string;
};

const ACTIONS: Item[] = [
  { key: "act-doctor", group: "Actions", label: "Add doctor", sub: "Invite and activate a doctor", to: "/doctors" },
  { key: "act-today", group: "Actions", label: "View today's appointments", sub: "Schedules and statuses", to: "/appointments" },
  { key: "act-ops", group: "Actions", label: "Review operations", sub: "Failed, unknown, and reconciliation queues", to: "/ops" },
  { key: "act-ai", group: "Actions", label: "Check AI activity", sub: "Capability executions and escalations", to: "/ai-activity" },
];

/**
 * Global command palette (Ctrl/⌘+K). Searches live store data only:
 * doctors, today's appointments, open operational items, and routes.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { doctors, appointments, operations, reconciliations } = useAdmin();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open ]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => s.toLowerCase().includes(q);
    const out: Item[] = [];
    out.push(...ACTIONS.filter((a) => q === "" || match(a.label) || match(a.sub ?? "")));
    if (q !== "") {
      for (const d of doctors) {
        if (out.length >= 24) break;
        if (match(d.name) || match(d.specialty) || match(d.department)) {
          out.push({
            key: `doc-${d.id}`,
            group: "Doctors",
            label: d.name,
            sub: `${d.specialty} · ${d.department}`,
            to: "/doctors",
            status: d.status,
          });
        }
      }
      for (const a of appointments.filter((x) => x.date === "Today")) {
        if (out.length >= 32) break;
        if (match(a.patient) || match(a.doctor) || match(a.time) || match(a.type)) {
          out.push({
            key: `appt-${a.id}`,
            group: "Today",
            label: `${a.time} · ${a.patient}`,
            sub: `${a.doctor} · ${a.type}`,
            to: "/appointments",
            status: a.status,
          });
        }
      }
      for (const o of operations.filter((x) => ["failed", "unknown"].includes(x.status))) {
        if (out.length >= 36) break;
        if (match(o.type) || match(o.error)) {
          out.push({
            key: `op-${o.id}`,
            group: "Attention",
            label: `${o.type} · ${o.status}`,
            sub: o.error || "EHR operation",
            to: "/ops",
            status: o.status,
          });
        }
      }
      for (const r of reconciliations.filter((x) => x.resolution === "open")) {
        if (out.length >= 40) break;
        if (match(r.error) || match(r.appointmentId)) {
          out.push({
            key: `rec-${r.id}`,
            group: "Attention",
            label: "Reconciliation required",
            sub: r.error || `Appointment ${r.appointmentId.slice(0, 8)}`,
            to: "/ops/reconciliation",
            status: "open",
          });
        }
      }
    }
    out.push(
      ...HOSPITAL_NAV.filter((n) => q === "" || match(n.label)).map((n) => ({
        key: `nav-${n.to}`,
        group: "Navigate",
        label: n.label,
        sub: n.group ? `${n.group} section` : "Hospital console",
        to: n.to,
      })),
    );
    // De-duplicate by key while preserving order.
    const seen = new Set<string>();
    return out.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
  }, [query, doctors, appointments, operations, reconciliations]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function go(to: string) {
    onClose();
    navigate(to);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      const item = items[active];
      if (item) go(item.to);
    }
  }

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-navy-deep/55" onClick={onClose} aria-hidden />
      <div className="relative bg-white w-full max-w-lg rounded-xl shadow-card border border-border overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 border-b border-border">
          <Search size={16} className="text-ink-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search doctors, appointments, pages…"
            aria-label="Search hospital console"
            role="combobox"
            aria-expanded
            aria-controls="cmd-list"
            aria-activedescendant={items[active] ? `cmd-${items[active].key}` : undefined}
            className="w-full py-3 text-[0.88rem] outline-none placeholder:text-ink-faint"
          />
        </div>
        <div ref={listRef} id="cmd-list" role="listbox" className="max-h-[46vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-[0.85rem] text-ink-secondary">
              No matches for “{query}”. Try a doctor name, patient ID, or page.
            </p>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup;
            lastGroup = item.group;
            const isActive = i === active;
            return (
              <div key={item.key}>
                {header && (
                  <p className="px-3 pt-2.5 pb-1 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-ink-faint">
                    {item.group}
                  </p>
                )}
                <button
                  id={`cmd-${item.key}`}
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item.to)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-100 ${isActive ? "bg-background" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[0.85rem] text-ink truncate">{item.label}</span>
                    {item.sub && <span className="block text-[0.74rem] text-ink-secondary truncate">{item.sub}</span>}
                  </span>
                  {item.status && <StatusBadge status={item.status} />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="px-4 py-2 border-t border-border text-[0.7rem] text-ink-faint">
          ↑↓ to navigate · ↵ to open · esc to close
        </div>
      </div>
    </div>
  );
}
