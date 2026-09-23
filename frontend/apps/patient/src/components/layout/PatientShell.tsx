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
      {/* Care + Flow + Connection: two care nodes linked by a flowing path,
          crossed by a subtle care tick — one mark, no clip-art. */}
      <span className="w-9 h-9 rounded-[11px] bg-gradient-to-br from-healthcare via-[#14608F] to-navy-deep text-white flex items-center justify-center shadow-subtle">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 15.5C6.5 15.5 7.5 12 10 12H13.5L15 14.5L16.8 9.5L18.2 12H20"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.95"
          />
          <circle cx="4" cy="15.5" r="1.7" fill="currentColor" />
          <circle cx="20" cy="12" r="1.7" fill="currentColor" />
          <path d="M12 6.2v5M9.5 8.7h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <span className={`font-extrabold tracking-tight leading-none text-[1.06rem] ${light ? "text-white" : "text-navy"}`}>
        CareFlow <span className="text-teal-dark">AI</span>
      </span>
    </Link>
  );
}

/** Time-aware greeting using the authenticated patient's first name. */
export function greetingFor(name: string, now = new Date()): { hello: string; firstName: string } {
  const h = now.getHours();
  const hello = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const firstName = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return { hello, firstName };
}

export function PatientShell({ children }: { children: React.ReactNode }) {
  const { patient, logout } = useAuth();
  const { unreadCount, notifications, markAllRead } = useAppState();
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Full-bleed ChatGPT-style chat manages its own height — no footer below it.
  const isChat = pathname === "/chat";
  const { hello, firstName } = greetingFor(patient.name);

  function doLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-[256px] flex-col bg-white border-r border-border px-4 py-6 z-30" aria-label="Primary">
        <div className="px-1">
          <Logo to="/home" />
          <p className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-ink-faint mt-2.5">
            Patient portal
          </p>
        </div>
        <nav className="mt-6 space-y-1 flex-1" aria-label="Patient">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[0.9rem] font-semibold transition-colors ${
                  isActive ? "text-navy bg-healthcare-soft" : "text-ink-secondary hover:text-ink hover:bg-background"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-healthcare" aria-hidden />
                  )}
                  <n.icon size={18} aria-hidden />
                  {n.label}
                  {n.to === "/inbox" && unreadCount > 0 && (
                    <span className="ml-auto text-[0.7rem] font-bold bg-navy text-white rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border pt-4 mt-2">
          <div className="flex items-center gap-2.5 px-2 py-1">
            <SafeImage src={patient.avatar} alt={patient.name} name={patient.name} className="w-9 h-9 rounded-full border border-border" />
            <div className="min-w-0">
              <p className="text-[0.85rem] font-bold text-ink truncate">{patient.name}</p>
              <p className="text-[0.75rem] text-ink-secondary truncate">{patient.email}</p>
            </div>
          </div>
          <button onClick={doLogout} className="mt-1.5 w-full flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-[0.85rem] font-semibold text-ink-secondary hover:text-danger hover:bg-danger-soft transition-colors">
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      {/* Top header */}
      <header className="md:pl-[256px] sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-border">
        <div className="max-w-shell mx-auto px-4 sm:px-6 min-h-[68px] flex items-center gap-3 py-2">
          <div className="md:hidden shrink-0">
            <Logo to="/home" />
          </div>
          {/* Orientation block — visible on every size so the bar never feels empty */}
          <div className="min-w-0 flex-1 md:flex-none md:ml-0 ml-1">
            <p className="text-[0.78rem] sm:text-[0.8rem] text-ink-secondary leading-tight truncate">
              {hello}, <span className="font-bold text-navy">{firstName || patient.name}</span>
            </p>
            <p className="text-[0.7rem] text-ink-faint leading-tight mt-0.5 truncate">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
          <div className="hidden md:block flex-1" />
          <a
            href="tel:911"
            aria-label="Emergency: call emergency services. CareFlow AI does not handle emergencies."
            title="For medical emergencies, call emergency services — CareFlow AI does not handle emergencies."
            className="hidden sm:inline-flex items-center gap-1.5 text-[0.8rem] font-bold text-danger bg-transparent border border-danger/30 rounded-full px-3 py-1.5 hover:bg-danger-soft transition-colors"
          >
            <Siren size={14} aria-hidden /> Emergency
          </a>
          <a
            href="tel:911"
            aria-label="Emergency: call emergency services"
            className="sm:hidden w-10 h-10 rounded-full border border-danger/30 text-danger flex items-center justify-center shrink-0"
          >
            <Siren size={17} aria-hidden />
          </a>
          <div className="relative">
            <button
              onClick={() => setPanelOpen((v) => !v)}
              aria-label={`Notifications, ${unreadCount} unread`}
              aria-expanded={panelOpen}
              className="relative w-10 h-10 rounded-full border border-border bg-white flex items-center justify-center text-ink-secondary hover:text-healthcare hover:border-healthcare transition-colors"
            >
              <Bell size={18} aria-hidden />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 bg-navy text-white text-[0.65rem] font-bold rounded-full flex items-center justify-center">
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
          <Link to="/profile" aria-label="Profile" className="shrink-0">
            <SafeImage src={patient.avatar} alt={patient.name} name={patient.name} className="w-10 h-10 rounded-full border border-border" />
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="md:pl-[256px]">
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
                `relative flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[0.68rem] font-semibold transition-colors ${
                  isActive ? "text-healthcare" : "text-ink-faint"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`p-1 rounded-lg ${isActive ? "bg-healthcare-soft" : ""}`}>
                    <n.icon size={20} aria-hidden />
                  </span>
                  {n.label}
                  {n.to === "/inbox" && unreadCount > 0 && (
                    <span className="absolute top-0.5 right-1/2 translate-x-4 min-w-[1rem] h-4 px-1 bg-navy text-white text-[0.6rem] font-bold rounded-full flex items-center justify-center">
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
