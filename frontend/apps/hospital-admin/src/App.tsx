import { MotionConfig } from "framer-motion";
import { Navigate, Outlet, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { AdminProvider, useAdmin } from "./store/AdminStore";
import { AdminShell } from "./components/layout/AdminShell";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import HospitalOverviewPage from "./pages/hospital/OverviewPage";
import HospitalSetupPage from "./pages/hospital/SetupPage";
import { AppointmentTypesPage, DepartmentsPage, SpecialtiesPage } from "./pages/hospital/CatalogPages";
import DoctorsPage from "./pages/hospital/DoctorsPage";
import AppointmentsPage from "./pages/hospital/AppointmentsPage";
import QuestionnairesPage from "./pages/hospital/QuestionnairesPage";
import { AIActivityPage, IntegrationPage, WorkflowsPage } from "./pages/hospital/InsightPages";
import AnalyticsPage from "./pages/hospital/AnalyticsPage";
import StaffPage from "./pages/hospital/StaffPage";
import {
  EscalationsPage,
  FailedOpsPage,
  OpsOverviewPage,
  ReconciliationPage,
  RecoveryHistoryPage,
  RetryQueuePage,
  UnknownOutcomesPage,
} from "./pages/ops/OpsPages";

function ProtectedLayout() {
  const { authed, mode } = useAdmin();
  if (mode === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-secondary text-sm">
        Restoring your session…
      </div>
    );
  }
  if (!authed) return <Navigate to="/login" replace />;
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}

function LandingRoute() {
  const { authed, mode } = useAdmin();
  if (mode === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-secondary text-sm">
        Restoring your session…
      </div>
    );
  }
  if (authed) return <Navigate to="/overview" replace />;
  return <LandingPage />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/overview" element={<HospitalOverviewPage />} />
        <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
        <Route path="/setup" element={<HospitalSetupPage />} />
        <Route path="/catalog/departments" element={<DepartmentsPage />} />
        <Route path="/catalog/specialties" element={<SpecialtiesPage />} />
        <Route path="/catalog/types" element={<AppointmentTypesPage />} />
        <Route path="/doctors" element={<DoctorsPage />} />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/questionnaires" element={<QuestionnairesPage />} />
        <Route path="/ai-activity" element={<AIActivityPage />} />
        <Route path="/integration" element={<IntegrationPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/staff" element={<StaffPage />} />
        {/* Operations area for authorized hospital operators */}
        <Route path="/ops" element={<OpsOverviewPage />} />
        <Route path="/ops/failed" element={<FailedOpsPage />} />
        <Route path="/ops/unknown" element={<UnknownOutcomesPage />} />
        <Route path="/ops/reconciliation" element={<ReconciliationPage />} />
        <Route path="/ops/escalations" element={<EscalationsPage />} />
        <Route path="/ops/retry" element={<RetryQueuePage />} />
        <Route path="/ops/recovery" element={<RecoveryHistoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
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
