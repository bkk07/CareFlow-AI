import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Clock,
  Home,
  LogOut,
  Menu,
  Settings,
  User,
  X,
} from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useSchedule } from "../../context/ScheduleContext";
import { Avatar } from "../common/ui";

const GROUPS: { label: string; items: { to: string; label: string; icon: React.ElementType; end?: boolean }[] }[] = [
  {
    label: "Schedule",
    items: [
      { to: "/", label: "Overview", icon: Home, end: true },
      { to: "/today", label: "Today", icon: Clock },
      { to: "/upcoming", label: "Upcoming", icon: CalendarDays },
      { to: "/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Manage",
    items: [
      { to: "/availability", label: "Availability", icon: Settings },
      { to: "/questionnaires", label: "Questionnaires", icon: ClipboardList },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/notifications", label: "Notifications", icon: Bell },
      { to: "/profile", label: "Profile", icon: User },
    ],
  },
];

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/overview": "Overview",
  "/today": "Today",
  "/upcoming": "Upcoming",
  "/calendar": "Calendar",
  "/availability": "Availability",
  "/questionnaires": "Questionnaires",
  "/notifications": "Notifications",
  "/profile": "Profile",
};

const MOBILE_NAV = [
  { to: "/today", label: "Today", icon: Clock, end: false },
  { to: "/upcoming", label: "Upcoming", icon: CalendarDays, end: false },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, end: false },
  { to: "/notifications", label: "Alerts", icon: Bell, end: false },
  { to: "/", label: "Home", icon: Home, end: true },
];

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label="CareFlow AI doctor home">
      <span className="w-9 h-9 rounded-[10px] bg-navy text-white flex items-center justify-center shrink-0" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
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

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { doctor, logout } = useAuth();
  const { unreadCount, accepting } = useSchedule();
  const navigate = useNavigate();

  function doLogout() {
    logout();
    onNavigate?.();
    navigate("/login");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-1"><Logo /></div>
      <div className="mt-4 px-1 pb-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Avatar name={doctor.name || "Doctor"} photo={doctor.photo} />
          <div className="min-w-0">
            <p className="text-[0.87rem] font-bold text-ink truncate">{doctor.name || "Doctor"}</p>
            {doctor.specialty && <p className="text-[0.75rem] text-ink-secondary truncate">{doctor.specialty}</p>}
            {doctor.hospital && <p className="text-[0.72rem] text-ink-faint truncate">{doctor.hospital}</p>}
          </div>
        </div>
        <p className={`mt-2 inline-flex items-center gap-1.5 text-[0.72rem] font-bold rounded-full px-2.5 py-1 ${accepting ? "bg-success-soft text-success" : "bg-slate-100 text-ink-secondary"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
          {accepting ? "Accepting appointments" : "Not accepting appointments"}
        </p>
      </div>
      <nav className="mt-3 space-y-3 flex-1 overflow-y-auto" aria-label="Primary">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <p className="px-3.5 text-[0.68rem] font-bold uppercase tracking-widest text-ink-faint mb-1">{g.label}</p>
            <div className="space-y-0.5">
              {g.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={onNavigate}
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
            </div>
          </div>
        ))}
      </nav>
      <button onClick={doLogout} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-control text-[0.85rem] font-semibold text-ink-secondary hover:text-danger hover:bg-danger-soft transition mt-2">
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}

export function DoctorShell({ children }: { children: React.ReactNode }) {
  const { doctor, logout } = useAuth();
  const { unreadCount, notifications, markAllRead } = useSchedule();
  const [panelOpen, setPanelOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const base = `/${location.pathname.split("/")[1] ?? ""}`;
  const pageTitle = location.pathname.startsWith("/appointments") ? "Appointment" : (TITLES[base] ?? TITLES[location.pathname] ?? "Overview");

  function doLogout() {
    logout();
    setMenuOpen(false);
    navigate("/login");
  }

  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-[248px] flex-col bg-white border-r border-border px-4 py-5 z-30" aria-label="Primary">
        <SidebarBody />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
            <motion.div className="absolute inset-0 bg-navy-deep/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawerOpen(false)} aria-hidden />
            <motion.aside
              className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-white border-r border-border px-4 py-5 overflow-y-auto"
              initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ duration: 0.22 }}
            >
              <div className="flex items-center justify-end mb-2">
                <button onClick={() => setDrawerOpen(false)} aria-label="Close navigation" className="w-9 h-9 rounded-full hover:bg-background flex items-center justify-center text-ink-secondary">
                  <X size={18} />
                </button>
              </div>
              <SidebarBody onNavigate={() => setDrawerOpen(false)} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="md:pl-[248px] sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-border">
        <div className="max-w-shell mx-auto px-4 sm:px-6 h-[62px] flex items-center gap-2.5">
          <button onClick={() => setDrawerOpen(true)} aria-label="Open navigation" className="md:hidden w-10 h-10 rounded-full border border-border bg-white flex items-center justify-center text-ink-secondary shrink-0">
            <Menu size={18} />
          </button>
          <div className="md:hidden min-w-0"><Logo /></div>
          <div className="hidden md:block min-w-0">
            <nav aria-label="Breadcrumb" className="text-[0.74rem] font-semibold text-ink-faint leading-none">
              Doctor Portal <span aria-hidden> / </span> <span className="text-healthcare">{pageTitle}</span>
            </nav>
            <p className="font-bold text-navy leading-tight text-[0.95rem] mt-0.5 truncate">
              {pageTitle}
              {doctor.hospital ? <span className="font-semibold text-ink-secondary"> · {doctor.hospital}</span> : null}
            </p>
          </div>
          <div className="flex-1" />
          <p className="hidden lg:block text-[0.78rem] text-ink-secondary font-semibold">{todayLabel}</p>
          <div className="relative">
            <button
              onClick={() => { setPanelOpen((v) => !v); setMenuOpen(false); }}
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
                      <button onClick={() => void markAllRead()} className="text-[0.78rem] font-bold text-healthcare hover:underline">Mark all read</button>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                      {notifications.length === 0 && (
                        <p className="px-4 py-6 text-center text-[0.83rem] text-ink-secondary">You're all caught up.</p>
                      )}
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
          <div className="relative">
            <button
              onClick={() => { setMenuOpen((v) => !v); setPanelOpen(false); }}
              aria-label="Profile menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-1.5 rounded-full border border-border bg-white pl-1 pr-1.5 py-1 hover:border-healthcare transition"
            >
              <Avatar name={doctor.name || "Doctor"} photo={doctor.photo} size="sm" />
              <ChevronDown size={14} className="text-ink-faint" />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.16 }}
                    className="absolute right-0 mt-2 w-[240px] bg-white border border-border rounded-card shadow-card z-20 overflow-hidden py-1.5"
                    role="menu"
                    aria-label="Profile"
                  >
                    <div className="px-4 py-2.5 border-b border-border/60">
                      <p className="text-[0.85rem] font-bold text-ink truncate">{doctor.name || "Doctor"}</p>
                      {doctor.specialty && <p className="text-[0.75rem] text-ink-secondary truncate">{doctor.specialty}</p>}
                    </div>
                    <Link to="/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-[0.85rem] font-semibold text-ink hover:bg-background" role="menuitem">
                      <User size={15} /> Profile
                    </Link>
                    <button onClick={doLogout} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[0.85rem] font-semibold text-danger hover:bg-danger-soft" role="menuitem">
                      <LogOut size={15} /> Sign out
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <div className="md:pl-[248px]">
        <main className="shell-container pt-5 sm:pt-6">{children}</main>
      </div>

      {/* Mobile bottom nav */}
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
