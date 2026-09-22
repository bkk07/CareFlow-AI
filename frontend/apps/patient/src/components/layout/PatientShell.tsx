import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  CalendarDays,
  Home,
  Inbox,
  LogOut,
  Search,
  Settings,
  Siren,
  Sparkles,
  User,
} from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useAppState } from "../../context/AppStateContext";
import { SafeImage } from "../common/ui";

const NAV = [
  { to: "/home", label: "Home", icon: Home, end: true },
  { to: "/book", label: "Find Care", icon: Search, end: false },
  { to: "/visits", label: "Appointments", icon: CalendarDays, end: false },
  { to: "/inbox", label: "Inbox", icon: Inbox, end: false },
  { to: "/chat", label: "AI Assistant", icon: Sparkles, end: false },
  { to: "/preferences", label: "Preferences", icon: Settings, end: false },
  { to: "/profile", label: "Profile", icon: User, end: false },
];

const MOBILE_NAV = [
  { to: "/home", label: "Home", icon: Home, end: true },
  { to: "/book", label: "Find Care", icon: Search, end: false },
  { to: "/visits", label: "Visits", icon: CalendarDays, end: false },
  { to: "/inbox", label: "Inbox", icon: Inbox, end: false },
  { to: "/chat", label: "Assistant", icon: Sparkles, end: false },
];

export function Logo({ light, to = "/" }: { light?: boolean; to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 shrink-0" aria-label="CareFlow AI home">
      <span className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-healthcare to-navy text-white flex items-center justify-center shadow-subtle">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span className={`font-extrabold tracking-tight leading-none ${light ? "text-white" : "text-navy"}`}>
        CareFlow <span className="text-healthcare">AI</span>
      </span>
    </Link>
  );
}

export function PatientShell({ children }: { children: React.ReactNode }) {
  const { patient, logout } = useAuth();
  const { unreadCount, notifications, markAllRead } = useAppState();
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Full-bleed ChatGPT-style chat manages its own height — no footer below it.
  const isChat = pathname === "/chat";

  function doLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-[248px] flex-col bg-white border-r border-border px-4 py-5 z-30" aria-label="Primary">
        <Logo to="/home" />
        <p className="text-[0.78rem] text-ink-secondary mt-1 px-1">Patient portal</p>
        <nav className="mt-5 space-y-1 flex-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3.5 py-2.5 rounded-control text-[0.9rem] font-semibold transition ${
                  isActive ? "text-healthcare bg-healthcare-soft" : "text-ink-secondary hover:text-ink hover:bg-background"
                }`
              }
            >
              <n.icon size={18} />
              {n.label}
              {n.to === "/inbox" && unreadCount > 0 && (
                <span className="ml-auto text-[0.7rem] font-bold bg-danger text-white rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border pt-3 space-y-1">
          <div className="flex items-center gap-2.5 px-2 py-1">
            <SafeImage src={patient.avatar} alt={patient.name} name={patient.name} className="w-9 h-9 rounded-full border border-border" />
            <div className="min-w-0">
              <p className="text-[0.85rem] font-bold text-ink truncate">{patient.name}</p>
              <p className="text-[0.75rem] text-ink-secondary truncate">{patient.email}</p>
            </div>
          </div>
          <button onClick={doLogout} className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-control text-[0.85rem] font-semibold text-ink-secondary hover:text-danger hover:bg-danger-soft transition">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* Top header */}
      <header className="md:pl-[248px] sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-border">
        <div className="max-w-shell mx-auto px-4 sm:px-6 h-[64px] flex items-center gap-3">
          <div className="md:hidden">
            <Logo to="/home" />
          </div>
          <div className="hidden md:block min-w-0">
            <p className="text-[0.8rem] text-ink-secondary leading-none">Good day,</p>
            <p className="font-bold text-navy leading-tight truncate">{patient.name}</p>
          </div>
          <div className="flex-1" />
          <a
            href="tel:911"
            className="hidden sm:inline-flex items-center gap-1.5 text-[0.8rem] font-bold text-danger bg-danger-soft border border-danger/20 rounded-full px-3 py-1.5 hover:brightness-95"
          >
            <Siren size={14} /> Emergency
          </a>
          <div className="relative">
            <button
              onClick={() => setPanelOpen((v) => !v)}
              aria-label={`Notifications, ${unreadCount} unread`}
              aria-expanded={panelOpen}
              className="relative w-10 h-10 rounded-full border border-border bg-white flex items-center justify-center text-ink-secondary hover:text-healthcare hover:border-healthcare transition"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 bg-danger text-white text-[0.65rem] font-bold rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            <AnimatePresence>
              {panelOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPanelOpen(false)} aria-hidden />
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 mt-2 w-[340px] max-w-[86vw] bg-white border border-border rounded-card shadow-card z-20 overflow-hidden"
                    role="dialog"
                    aria-label="Notifications"
                  >
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <p className="font-bold text-navy text-sm">Notifications</p>
                      <button onClick={markAllRead} className="text-[0.78rem] font-bold text-healthcare hover:underline">
                        Mark all read
                      </button>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                      {notifications.slice(0, 5).map((n) => (
                        <div key={n.id} className={`px-4 py-3 border-b border-border/60 text-sm ${n.unread ? "bg-healthcare-faint" : ""}`}>
                          <p className="font-semibold text-ink text-[0.85rem]">{n.title}</p>
                          <p className="text-ink-secondary text-[0.8rem] line-clamp-2 mt-0.5">{n.body}</p>
                        </div>
                      ))}
                    </div>
                    <Link to="/inbox" onClick={() => setPanelOpen(false)} className="block text-center text-[0.83rem] font-bold text-healthcare py-2.5 hover:bg-background">
                      View all
                    </Link>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <Link to="/profile" aria-label="Profile" className="hidden sm:block">
            <SafeImage src={patient.avatar} alt={patient.name} name={patient.name} className="w-10 h-10 rounded-full border border-border" />
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="md:pl-[248px]">
        <main className={isChat ? "px-0 pb-0 md:pb-0" : "shell-container pt-5 sm:pt-7"}>
          {children}
        </main>
        {!isChat && (
        <footer className="hidden md:block border-t border-border bg-white">
          <div className="max-w-shell mx-auto px-6 py-4 flex items-center justify-between text-[0.8rem] text-ink-secondary">
            <span><strong className="text-navy">CareFlow AI</strong> · secure patient scheduling</span>
            <span>Your healthcare information stays private and secure.</span>
          </div>
        </footer>
        )}
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-border px-1 pt-1.5 pb-[calc(0.4rem+env(safe-area-inset-bottom))]" aria-label="Mobile">
        <div className="grid grid-cols-5 gap-0.5">
          {MOBILE_NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[0.68rem] font-semibold transition ${
                  isActive ? "text-healthcare" : "text-ink-faint"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`p-1 rounded-lg ${isActive ? "bg-healthcare-soft" : ""}`}>
                    <n.icon size={20} />
                  </span>
                  {n.label}
                  {n.to === "/inbox" && unreadCount > 0 && (
                    <span className="absolute top-0.5 right-1/2 translate-x-4 min-w-[1rem] h-4 px-1 bg-danger text-white text-[0.6rem] font-bold rounded-full flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
