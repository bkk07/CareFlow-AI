import { MotionConfig } from "framer-motion";
import { Navigate, Outlet, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { AdminProvider, useAdmin } from "./store/AdminStore";
import { AdminShell } from "./components/layout/AdminShell";
import LoginPage from "./pages/LoginPage";
import {
  HospitalApplicationsPage,
  PlatformAIPage,
  PlatformAppointmentsPage,
  PlatformDoctorsPage,
  PlatformHospitalsPage,
  PlatformOverviewPage,
  PlatformPatientsPage,
} from "./pages/platform/PlatformPages";
import {
  AuditPage,
  OperationalHealthPage,
  PlatformAnalyticsPage,
  PlatformIntegrationsPage,
  PlatformWorkflowsPage,
} from "./pages/platform/PlatformInsights";

function ProtectedLayout() {
  const { authed } = useAdmin();
  if (!authed) return <Navigate to="/login" replace />;
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/platform" replace />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/platform" element={<PlatformOverviewPage />} />
        <Route path="/platform/applications" element={<HospitalApplicationsPage />} />
        <Route path="/platform/hospitals" element={<PlatformHospitalsPage />} />
        <Route path="/platform/doctors" element={<PlatformDoctorsPage />} />
        <Route path="/platform/patients" element={<PlatformPatientsPage />} />
        <Route path="/platform/appointments" element={<PlatformAppointmentsPage />} />
        <Route path="/platform/ai" element={<PlatformAIPage />} />
        <Route path="/platform/integrations" element={<PlatformIntegrationsPage />} />
        <Route path="/platform/workflows" element={<PlatformWorkflowsPage />} />
        <Route path="/platform/analytics" element={<PlatformAnalyticsPage />} />
        <Route path="/platform/audit" element={<AuditPage />} />
        <Route path="/platform/health" element={<OperationalHealthPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/platform" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AdminProvider>
          <Router>
            <AppRoutes />
          </Router>
      </AdminProvider>
    </MotionConfig>
  );
}
