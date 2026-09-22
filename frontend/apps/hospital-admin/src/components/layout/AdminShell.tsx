import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Bell,
  Building2,
  CalendarDays,
  ClipboardList,
  Globe,
  HeartPulse,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Settings,
  Stethoscope,
  Users,
  Workflow,
} from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAdmin } from "../../store/AdminStore";
import { Avatar } from "../common/ui";

const HOSPITAL_NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true, group: "" },
  { to: "/setup", label: "Hospital Setup", icon: Building2, end: false, group: "" },
  { to: "/catalog/departments", label: "Departments", icon: Globe, end: false, group: "Catalog" },
  { to: "/catalog/specialties", label: "Specialties", icon: HeartPulse, end: false, group: "Catalog" },
  { to: "/catalog/types", label: "Appointment Types", icon: ClipboardList, end: false, group: "Catalog" },
  { to: "/doctors", label: "Doctors", icon: Stethoscope, end: false, group: "" },
  { to: "/appointments", label: "Appointments", icon: CalendarDays, end: false, group: "" },
  { to: "/questionnaires", label: "Questionnaires", icon: ClipboardList, end: false, group: "" },
  { to: "/ai-activity", label: "AI Activity", icon: Activity, end: false, group: "Insights" },
  { to: "/integration", label: "Integration", icon: Settings, end: false, group: "Insights" },
  { to: "/workflows", label: "Workflows", icon: Workflow, end: false, group: "Insights" },
  { to: "/analytics", label: "Analytics", icon: Activity, end: false, group: "Insights" },
  { to: "/ops", label: "Operations", icon: LifeBuoy, end: false, group: "" },
  { to: "/staff", label: "Staff & Access", icon: Users, end: false, group: "" },
];

function NavList({ items }: { items: typeof HOSPITAL_NAV }) {
  let lastGroup = "__first";
  return (
    <nav className="space-y-0.5">
      {items.map((n) => {
        const showLabel = n.group !== lastGroup && n.group !== "";
        lastGroup = n.group;
        return (
          <div key={n.to + n.label}>
            {showLabel && <p className="text-[0.65rem] font-bold uppercase tracking-widest text-ink-faint px-3.5 pt-3 pb-1">{n.group}</p>}
            <NavLink to={n.to} end={n.end} className={({ isActive }) => `flex items-center gap-3 px-3.5 py-2 rounded-control text-[0.84rem] font-semibold transition ${isActive ? "text-healthcare bg-healthcare-soft" : "text-ink-secondary hover:text-ink hover:bg-background"}`}>
              <n.icon size={17} />{n.label}
            </NavLink>
          </div>
        );
      })}
    </nav>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { logout, unread, notifications, markAllRead, hospital, user, live, loading, syncing } = useAdmin();
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();
  const busy = loading || syncing;

  return (
    <div className="min-h-screen bg-background">
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-[264px] flex-col bg-white border-r border-border px-3.5 py-4 z-30" aria-label="Primary">
        <Link to="/" className="flex items-center gap-2.5 px-1.5 py-1 rounded-xl hover:bg-background transition" aria-label="CareFlow AI home">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-healthcare to-navy text-white flex items-center justify-center font-extrabold shadow-subtle">+</span>
          <span className="leading-none">
            <span className="block font-extrabold text-navy tracking-tight">CareFlow <span className="text-healthcare">AI</span></span>
            <span className="block text-[0.64rem] font-bold uppercase tracking-widest text-ink-faint mt-0.5">Hospital Console</span>
          </span>
          <span className={`ml-auto w-2 h-2 rounded-full ${live ? (busy ? "bg-warning animate-pulse" : "bg-success") : "bg-border"}`} title={live ? (busy ? "Syncing" : "Live") : "Offline"} />
        </Link>
        <div className="flex-1 overflow-y-auto mt-3 pb-2"><NavList items={HOSPITAL_NAV} /></div>
        <div className="border-t border-border pt-2.5 mt-1">
          <div className="px-3.5 py-2 mb-1.5 rounded-xl bg-background border border-border/70">
            <p className="text-[0.72rem] font-bold text-navy truncate">{hospital?.name ?? "Hospital"}</p>
            <p className="text-[0.68rem] text-ink-faint truncate">{hospital?.status?.replace("_", " ") ?? "—"}</p>
          </div>
          <button onClick={() => { logout(); navigate("/login"); }} className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-[0.83rem] font-semibold text-ink-secondary hover:text-danger hover:bg-danger-soft transition">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      <header className="md:pl-[264px] sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-border">
        <div className="max-w-shell mx-auto px-4 sm:px-6 h-[62px] flex items-center gap-3">
          <div className="min-w-0">
            <p className="font-bold text-navy text-[0.92rem] truncate flex items-center gap-2">
              {hospital?.name ?? (live ? "Hospital" : loading ? "Connecting…" : "Hospital")}
              {busy && <span className="inline-flex items-center gap-1 text-[0.68rem] font-bold text-warning bg-warning-soft border border-warning/25 rounded-full px-2 py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />Syncing</span>}
            </p>
            <p className="text-[0.72rem] text-ink-secondary leading-none truncate">{user?.email ?? "Hospital Administrator"}</p>
          </div>
          <div className="flex-1" />
          <Link to="/appointments" className="hidden sm:inline-flex items-center gap-1.5 text-[0.78rem] font-bold text-ink-secondary hover:text-healthcare border border-border rounded-full px-3 py-1.5 hover:border-healthcare transition">
            View bookings
          </Link>
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
                      <p className="px-4 py-5 text-sm text-ink-secondary text-center">No notifications yet.</p>
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
          <Avatar name={user?.email ?? "Hospital Administrator"} size="sm" />
        </div>
      </header>

      <div className="md:pl-[264px]">
        <main className="shell-container pt-5 pb-24 md:pb-10">{children}</main>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-border px-2 pt-1.5 pb-[calc(0.4rem+env(safe-area-inset-bottom))] overflow-x-auto no-scrollbar" aria-label="Mobile">
        <div className="flex gap-1 min-w-max">
          {HOSPITAL_NAV.map((n) => (
            <NavLink key={n.to + n.label} to={n.to} end={n.end} className={({ isActive }) => `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[0.64rem] font-semibold whitespace-nowrap ${isActive ? "text-healthcare bg-healthcare-soft" : "text-ink-faint"}`}>
              <n.icon size={19} />{n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function DoctorAvatar({ name, photo }: { name: string; photo: string }) {
  return <Avatar name={name} photo={photo} size="sm" />;
}
