import {
  Activity,
  Building2,
  CalendarDays,
  ClipboardList,
  Globe,
  HeartPulse,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  Stethoscope,
  Users,
  Workflow,
} from "lucide-react";

/** Single source of truth for hospital console navigation (sidebar, command bar, palette). */
export const HOSPITAL_NAV = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard, end: true, group: "" },
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

const ROUTE_TITLES: [string, string][] = [
  ["/catalog/departments", "Departments"],
  ["/catalog/specialties", "Specialties"],
  ["/catalog/types", "Appointment Types"],
  ["/overview", "Overview"],
  ["/setup", "Hospital Setup"],
  ["/doctors", "Doctors"],
  ["/appointments", "Appointments"],
  ["/questionnaires", "Questionnaires"],
  ["/ai-activity", "AI Activity"],
  ["/integration", "Integration"],
  ["/workflows", "Workflows"],
  ["/analytics", "Analytics"],
  ["/staff", "Staff & Access"],
  ["/ops", "Operations"],
];

export function routeTitle(pathname: string): string {
  if (pathname.startsWith("/ops")) {
    if (pathname === "/ops" || pathname === "/ops/") return "Operations";
    const leaf = pathname.split("/").pop() ?? "";
    return `Operations / ${leaf.charAt(0).toUpperCase()}${leaf.slice(1)}`;
  }
  for (const [prefix, title] of ROUTE_TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title;
  }
  return "Overview";
}
