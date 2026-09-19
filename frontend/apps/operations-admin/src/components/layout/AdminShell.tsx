import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Bell,
  ClipboardList,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Settings,
  Users,
  Workflow,
} from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAdmin } from "../../store/AdminStore";
import { Avatar } from "../common/ui";

const OPS_NAV = [
  { to: "/ops", label: "Operations Overview", icon: LayoutDashboard, end: true },
  { to: "/ops/failed", label: "Failed Operations", icon: Activity, end: false },
  { to: "/ops/unknown", label: "Unknown Outcomes", icon: LifeBuoy, end: false },
  { to: "/ops/reconciliation", label: "Reconciliation", icon: Workflow, end: false },
  { to: "/ops/escalations", label: "Human Escalations", icon: Users, end: false },
  { to: "/ops/retry", label: "Retry Queue", icon: Settings, end: false },
  { to: "/ops/recovery", label: "Recovery History", icon: ClipboardList, end: false },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { logout, unread, notifications, markAllRead, user, live } = useAdmin();
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-[252px] flex-col bg-white border-r border-border px-3.5 py-4 z-30" aria-label="Primary">
        <Link to="/ops" className="flex items-center gap-2.5 px-1" aria-label="CareFlow AI home">
          <span className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-healthcare to-navy text-white flex items-center justify-center font-extrabold">+</span>
          <span className="leading-none">
            <span className="block font-extrabold text-navy">CareFlow <span className="text-healthcare">AI</span></span>
            <span className="block text-[0.64rem] font-bold uppercase tracking-widest text-ink-faint mt-0.5">Operations Console</span>
          </span>
        </Link>
        <div className="mt-3 px-1">
          <p className="text-[0.68rem] font-bold uppercase tracking-widest text-ink-faint">Viewing as</p>
          <p className="text-[0.85rem] font-bold text-navy mt-0.5">Operations</p>
        </div>
        <nav className="space-y-0.5 flex-1 overflow-y-auto mt-2 pb-2">
          {OPS_NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex items-center gap-3 px-3.5 py-2 rounded-control text-[0.84rem] font-semibold transition ${isActive ? "text-healthcare bg-healthcare-soft" : "text-ink-secondary hover:text-ink hover:bg-background"}`}>
              <n.icon size={17} />{n.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => { logout(); navigate("/login"); }} className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-control text-[0.83rem] font-semibold text-ink-secondary hover:text-danger hover:bg-danger-soft transition">
          <LogOut size={15} /> Sign out
        </button>
      </aside>

      <header className="md:pl-[252px] sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-border">
        <div className="max-w-shell mx-auto px-4 sm:px-6 h-[60px] flex items-center gap-3">
          <div className="min-w-0">
            <p className="font-bold text-navy text-[0.9rem] truncate">CareFlow Operations</p>
            <p className="text-[0.72rem] text-ink-secondary leading-none">{live && user ? user.email : "Operations"}</p>
          </div>
          <div className="flex-1" />
          <div className="hidden sm:flex items-center gap-2 bg-background border border-border rounded-control px-3 py-2 w-64">
            <input placeholder="Search operations…" aria-label="Search" className="w-full bg-transparent outline-none text-[0.83rem]" />
          </div>
          <div className="relative">
            <button onClick={() => setPanelOpen((v) => !v)} aria-label={`Notifications, ${unread} unread`} className="relative w-10 h-10 rounded-full border border-border bg-white flex items-center justify-center text-ink-secondary hover:text-healthcare hover:border-healthcare transition">
              <Bell size={17} />
              {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 bg-danger text-white text-[0.63rem] font-bold rounded-full flex items-center justify-center">{unread}</span>}
            </button>
            <AnimatePresence>
              {panelOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPanelOpen(false)} aria-hidden />
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute right-0 mt-2 w-[330px] max-w-[86vw] bg-white border border-border rounded-card shadow-card z-20 overflow-hidden" role="dialog" aria-label="Notifications">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <p className="font-bold text-navy text-sm">Notifications</p>
                      <button onClick={markAllRead} className="text-[0.76rem] font-bold text-healthcare hover:underline">Mark all read</button>
                    </div>
                    {notifications.length === 0 ? (
                      <p className="px-4 py-6 text-center text-[0.82rem] text-ink-secondary">No notifications yet.</p>
                    ) : (
                      notifications.slice(0, 5).map((n) => (
                        <div key={n.id} className={`px-4 py-3 border-b border-border/60 text-sm ${n.unread ? "bg-healthcare-faint" : ""}`}>
                          <p className="font-semibold text-[0.84rem]">{n.title}</p>
                          <p className="text-ink-secondary text-[0.79rem] line-clamp-2">{n.body}</p>
                        </div>
                      ))
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <Avatar name="Operations" size="sm" />
        </div>
      </header>

      <div className="md:pl-[252px]">
        <main className="shell-container pt-5">{children}</main>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-border px-2 pt-1.5 pb-[calc(0.4rem+env(safe-area-inset-bottom))] overflow-x-auto no-scrollbar" aria-label="Mobile">
        <div className="flex gap-1 min-w-max">
          {OPS_NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[0.64rem] font-semibold whitespace-nowrap ${isActive ? "text-healthcare bg-healthcare-soft" : "text-ink-faint"}`}>
              <n.icon size={19} />{n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
