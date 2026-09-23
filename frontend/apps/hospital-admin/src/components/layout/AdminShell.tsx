import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Search,
} from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAdmin } from "../../store/AdminStore";
import { Avatar } from "../common/ui";
import { CareFlowLogo } from "../brand/CareFlowLogo";
import { CommandPalette } from "./CommandPalette";
import { HOSPITAL_NAV, routeTitle } from "./nav";

function NavList({ items, collapsed }: { items: typeof HOSPITAL_NAV; collapsed: boolean }) {
  let lastGroup = "__first";
  return (
    <nav className="space-y-0.5" aria-label="Hospital sections">
      {items.map((n) => {
        const groupChanged = n.group !== lastGroup;
        const showLabel = !collapsed && groupChanged && n.group !== "";
        lastGroup = n.group;
        return (
          <div key={n.to + n.label}>
            {showLabel && (
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.12em] text-ink-faint px-3 pt-3.5 pb-1">
                {n.group}
              </p>
            )}
            {collapsed && groupChanged && n.group !== "" && <div className="mx-3 my-1.5 border-t border-border/70" aria-hidden />}
            <NavLink
              to={n.to}
              end={n.end}
              title={collapsed ? n.label : undefined}
              aria-label={n.label}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-control text-[0.83rem] font-semibold transition-colors duration-150 ${
                  collapsed ? "justify-center" : ""
                } ${isActive ? "text-healthcare bg-healthcare-soft" : "text-ink-secondary hover:text-ink hover:bg-background"}`
              }
            >
              <n.icon size={17} className="shrink-0" />
              {!collapsed && n.label}
            </NavLink>
          </div>
        );
      })}
    </nav>
  );
}

const COLLAPSE_KEY = "careflow_shell_collapsed";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { logout, unread, notifications, markAllRead, hospital, user, live, loading, syncing, operations, reconciliations, escalations } = useAdmin();
  const [panelOpen, setPanelOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const navigate = useNavigate();
  const location = useLocation();
  const busy = loading || syncing;

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  const openOps = operations.filter((o) => ["failed", "unknown"].includes(o.status)).length;
  const openRecs = reconciliations.filter((r) => r.resolution === "open").length;
  const openEsc = escalations.filter((e) => e.status !== "resolved").length;
  const openIssues = openOps + openRecs + openEsc;
  const rail = collapsed ? "md:pl-[76px]" : "md:pl-[248px]";
  const approved = (hospital?.status ?? "") === "approved";

  function toggleCollapsed() {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !v;
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={`hidden md:flex fixed inset-y-0 left-0 flex-col bg-white border-r border-border px-3 py-4 z-30 transition-[width] duration-200 ${collapsed ? "w-[76px]" : "w-[248px]"}`}
        aria-label="Primary"
      >
        <Link
          to="/overview"
          className={`flex items-center gap-2 rounded-xl hover:bg-background transition-colors duration-150 px-1.5 py-1 ${collapsed ? "justify-center" : ""}`}
          aria-label="CareFlow AI home"
          title={collapsed ? "CareFlow AI home" : undefined}
        >
          {collapsed ? <CareFlowLogo compact size={34} /> : <CareFlowLogo size={32} />}
          {!collapsed && (
            <span className={`ml-auto w-2 h-2 rounded-full shrink-0 ${live ? (busy ? "bg-warning animate-pulse" : "bg-success") : "bg-border"}`} title={live ? (busy ? "Syncing" : "Live") : "Offline"} />
          )}
        </Link>

        {!collapsed ? (
          <div className="mt-3 px-1">
            <div className="rounded-xl bg-background border border-border/70 px-3 py-2.5">
              <p className="text-[0.78rem] font-bold text-navy truncate leading-tight">{hospital?.name ?? "Hospital"}</p>
              <p className="flex items-center gap-1.5 mt-1 text-[0.68rem] font-semibold text-ink-secondary">
                <span className={`w-1.5 h-1.5 rounded-full ${approved ? "bg-success" : "bg-warning"}`} aria-hidden />
                {approved ? "Operational" : (hospital?.status?.replace("_", " ") ?? "—")}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex justify-center" title={hospital?.name ?? "Hospital"}>
            <span className={`w-2.5 h-2.5 rounded-full ${approved ? "bg-success" : "bg-warning"}`} aria-hidden />
          </div>
        )}

        <div className="flex-1 overflow-y-auto mt-2 pb-2"><NavList items={HOSPITAL_NAV} collapsed={collapsed} /></div>

        <div className="border-t border-border pt-2 mt-1 space-y-1">
          <button
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[0.8rem] font-semibold text-ink-faint hover:text-ink hover:bg-background transition-colors duration-150 ${collapsed ? "justify-center" : ""}`}
          >
            {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /> Collapse</>}
          </button>
          <button
            onClick={() => { logout(); navigate("/login"); }}
            title={collapsed ? "Sign out" : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[0.82rem] font-semibold text-ink-secondary hover:text-danger hover:bg-danger-soft transition-colors duration-150 ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut size={15} className="shrink-0" /> {!collapsed && "Sign out"}
          </button>
          {!collapsed && (
            <p className="px-3 pt-1 text-[0.68rem] text-ink-faint truncate" title={user?.email ?? undefined}>
              {user?.email ?? "Hospital Administrator"}
            </p>
          )}
        </div>
      </aside>

      <header className={`${rail} sticky top-0 z-20 bg-white border-b border-border transition-[padding] duration-200`}>
        <div className="max-w-shell mx-auto px-4 sm:px-6 h-[60px] flex items-center gap-3">
          <nav className="min-w-0 flex items-center gap-1.5 text-[0.82rem]" aria-label="Breadcrumb">
            <span className="text-ink-faint font-medium hidden sm:inline">Hospital</span>
            <span className="text-ink-faint hidden sm:inline" aria-hidden>/</span>
            <span className="font-bold text-navy truncate">{routeTitle(location.pathname)}</span>
            {busy && (
              <span className="inline-flex items-center gap-1 text-[0.66rem] font-bold text-warning bg-warning-soft border border-warning/25 rounded-full px-2 py-0.5 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />Syncing
              </span>
            )}
          </nav>
          <div className="flex-1" />
          <Link
            to="/ops"
            className={`hidden md:inline-flex items-center gap-1.5 text-[0.74rem] font-bold rounded-full px-3 py-1.5 border transition-colors duration-150 shrink-0 ${openIssues > 0 ? "text-warning bg-warning-soft border-warning/30 hover:border-warning" : "text-success bg-success-soft border-success/25 hover:border-success"}`}
            title={openIssues > 0 ? "Open operations" : "All operations normal"}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${openIssues > 0 ? "bg-warning" : "bg-success"}`} aria-hidden />
            {openIssues > 0 ? `${openIssues} open issue${openIssues === 1 ? "" : "s"}` : "Operational"}
          </Link>
          <Link to="/appointments" className="hidden sm:inline-flex items-center gap-1.5 text-[0.78rem] font-bold text-ink-secondary hover:text-healthcare border border-border rounded-full px-3 py-1.5 hover:border-healthcare transition-colors duration-150 shrink-0">
            View bookings
          </Link>
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Search hospital console"
            title="Search (Ctrl+K)"
            className="w-10 h-10 rounded-full border border-border bg-white flex items-center justify-center text-ink-secondary hover:text-healthcare hover:border-healthcare transition-colors duration-150 shrink-0"
          >
            <Search size={16} />
          </button>
          <div className="relative">
            <button onClick={() => setPanelOpen((v) => !v)} aria-label={`Notifications, ${unread} unread`} aria-expanded={panelOpen} className="relative w-10 h-10 rounded-full border border-border bg-white flex items-center justify-center text-ink-secondary hover:text-healthcare hover:border-healthcare transition-colors duration-150">
              <Bell size={17} />
              {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 bg-danger text-white text-[0.63rem] font-bold rounded-full flex items-center justify-center">{unread}</span>}
            </button>
            <AnimatePresence>
              {panelOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPanelOpen(false)} aria-hidden />
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.15 }} className="absolute right-0 mt-2 w-[330px] max-w-[86vw] bg-white border border-border rounded-card shadow-card z-20 overflow-hidden" role="dialog" aria-label="Notifications">
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

      <div className={rail}>
        <main className="shell-container pt-5 pb-24 md:pb-10">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

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
