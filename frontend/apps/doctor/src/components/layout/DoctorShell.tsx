import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  CalendarDays,
  ClipboardList,
  Clock,
  Home,
  LogOut,
  Settings,
  User,
} from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useSchedule } from "../../context/ScheduleContext";
import { Avatar } from "../common/ui";

const NAV = [
  { to: "/", label: "Overview", icon: Home, end: true },
  { to: "/today", label: "Today", icon: Clock, end: false },
  { to: "/upcoming", label: "Upcoming", icon: CalendarDays, end: false },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, end: false },
  { to: "/availability", label: "Availability", icon: Settings, end: false },
  { to: "/questionnaires", label: "Questionnaires", icon: ClipboardList, end: false },
  { to: "/notifications", label: "Notifications", icon: Bell, end: false },
  { to: "/profile", label: "Profile", icon: User, end: false },
];

const MOBILE_NAV = [
  { to: "/today", label: "Today", icon: Clock, end: false },
  { to: "/upcoming", label: "Upcoming", icon: CalendarDays, end: false },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, end: false },
  { to: "/notifications", label: "Alerts", icon: Bell, end: false },
  { to: "/", label: "More", icon: Home, end: true },
];

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label="CareFlow AI doctor home">
      <span className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-healthcare to-navy text-white flex items-center justify-center shadow-subtle">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span className="leading-none">
        <span className="block font-extrabold tracking-tight text-navy">CareFlow <span className="text-healthcare">AI</span></span>
        <span className="block text-[0.68rem] font-bold uppercase tracking-widest text-ink-faint mt-0.5">Doctor Portal</span>
      </span>
    </Link>
  );
}

export function DoctorShell({ children }: { children: React.ReactNode }) {
  const { doctor, logout } = useAuth();
  const { unreadCount, notifications, markAllRead, accepting } = useSchedule();
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();
  const acceptingShown = accepting;

  function doLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-[248px] flex-col bg-white border-r border-border px-4 py-5 z-30" aria-label="Primary">
        <Logo />
        <div className="mt-4 px-1 pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Avatar name={doctor.name} photo={doctor.photo} />
            <div className="min-w-0">
              <p className="text-[0.87rem] font-bold text-ink truncate">{doctor.name}</p>
              <p className="text-[0.75rem] text-ink-secondary">{doctor.specialty}</p>
            </div>
          </div>
          <p className={`mt-2 inline-flex items-center gap-1.5 text-[0.72rem] font-bold rounded-full px-2.5 py-1 ${acceptingShown ? "bg-success-soft text-success" : "bg-slate-100 text-ink-secondary"}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
            {acceptingShown ? "Accepting appointments" : "Not accepting appointments"}
          </p>
        </div>
        <nav className="mt-3 space-y-0.5 flex-1 overflow-y-auto">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-2.5 rounded-control text-[0.88rem] font-semibold transition ${isActive ? "text-healthcare bg-healthcare-soft" : "text-ink-secondary hover:text-ink hover:bg-background"}`
              }
            >
              <n.icon size={18} />
              {n.label}
              {n.to === "/notifications" && unreadCount > 0 && (
                <span className="ml-auto text-[0.7rem] font-bold bg-danger text-white rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center">{unreadCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <button onClick={doLogout} className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-control text-[0.85rem] font-semibold text-ink-secondary hover:text-danger hover:bg-danger-soft transition">
          <LogOut size={16} /> Sign out
        </button>
      </aside>

      <header className="md:pl-[248px] sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-border">
        <div className="max-w-shell mx-auto px-4 sm:px-6 h-[62px] flex items-center gap-3">
          <div className="md:hidden"><Logo /></div>
          <div className="hidden md:block min-w-0">
            <p className="text-[0.78rem] text-ink-secondary leading-none">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
            <p className="font-bold text-navy leading-tight text-[0.92rem]">{doctor.hospital} · {doctor.department}</p>
          </div>
          <div className="flex-1" />
          <span className={`hidden sm:inline-flex items-center gap-1.5 text-[0.76rem] font-bold rounded-full px-3 py-1.5 border ${doctor.status === "active" ? "bg-success-soft text-success border-success/20" : "bg-danger-soft text-danger border-danger/20"}`}>
            {doctor.status === "active" ? "Active" : doctor.status}
          </span>
          <div className="relative">
            <button
              onClick={() => setPanelOpen((v) => !v)}
              aria-label={`Notifications, ${unreadCount} unread`}
              aria-expanded={panelOpen}
              className="relative w-10 h-10 rounded-full border border-border bg-white flex items-center justify-center text-ink-secondary hover:text-healthcare hover:border-healthcare transition"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 bg-danger text-white text-[0.65rem] font-bold rounded-full flex items-center justify-center">{unreadCount}</span>
              )}
            </button>
            <AnimatePresence>
              {panelOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPanelOpen(false)} aria-hidden />
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 mt-2 w-[340px] max-w-[86vw] bg-white border border-border rounded-card shadow-card z-20 overflow-hidden"
                    role="dialog"
                    aria-label="Notifications"
                  >
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <p className="font-bold text-navy text-sm">Notifications</p>
                      <button onClick={markAllRead} className="text-[0.78rem] font-bold text-healthcare hover:underline">Mark all read</button>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                      {notifications.slice(0, 5).map((n) => (
                        <div key={n.id} className={`px-4 py-3 border-b border-border/60 text-sm ${n.unread ? "bg-healthcare-faint" : ""}`}>
                          <p className="font-semibold text-ink text-[0.85rem]">{n.title}</p>
                          <p className="text-ink-secondary text-[0.8rem] line-clamp-2 mt-0.5">{n.body}</p>
                        </div>
                      ))}
                    </div>
                    <Link to="/notifications" onClick={() => setPanelOpen(false)} className="block text-center text-[0.83rem] font-bold text-healthcare py-2.5 hover:bg-background">View all</Link>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <Link to="/profile" aria-label="Profile"><Avatar name={doctor.name} photo={doctor.photo} /></Link>
        </div>
      </header>

      <div className="md:pl-[248px]">
        <main className="shell-container pt-5 sm:pt-6">{children}</main>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-border px-1 pt-1.5 pb-[calc(0.4rem+env(safe-area-inset-bottom))]" aria-label="Mobile">
        <div className="grid grid-cols-5 gap-0.5">
          {MOBILE_NAV.map((n) => (
            <NavLink
              key={n.to + n.label}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[0.66rem] font-semibold transition ${isActive ? "text-healthcare" : "text-ink-faint"}`}
            >
              {({ isActive }) => (
                <>
                  <span className={`p-1 rounded-lg relative ${isActive ? "bg-healthcare-soft" : ""}`}>
                    <n.icon size={20} />
                    {n.to === "/notifications" && unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 bg-danger text-white text-[0.6rem] font-bold rounded-full flex items-center justify-center">{unreadCount}</span>
                    )}
                  </span>
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
