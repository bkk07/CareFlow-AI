import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from "react-router-dom";
import { AdminProvider, useAdmin } from "./store/AdminStore";
import { AdminShell } from "./components/layout/AdminShell";
import LoginPage from "./pages/LoginPage";
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

function Protected({ children }: { children: React.ReactNode }) {
  const { authed } = useAdmin();
  if (!authed) return <Navigate to="/login" replace />;
  return <AdminShell>{children}</AdminShell>;
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2 }}
      >
        <Routes location={location}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Protected><HospitalOverviewPage /></Protected>} />
          <Route path="/setup" element={<Protected><HospitalSetupPage /></Protected>} />
          <Route path="/catalog/departments" element={<Protected><DepartmentsPage /></Protected>} />
          <Route path="/catalog/specialties" element={<Protected><SpecialtiesPage /></Protected>} />
          <Route path="/catalog/types" element={<Protected><AppointmentTypesPage /></Protected>} />
          <Route path="/doctors" element={<Protected><DoctorsPage /></Protected>} />
          <Route path="/appointments" element={<Protected><AppointmentsPage /></Protected>} />
          <Route path="/questionnaires" element={<Protected><QuestionnairesPage /></Protected>} />
          <Route path="/ai-activity" element={<Protected><AIActivityPage /></Protected>} />
          <Route path="/integration" element={<Protected><IntegrationPage /></Protected>} />
          <Route path="/workflows" element={<Protected><WorkflowsPage /></Protected>} />
          <Route path="/analytics" element={<Protected><AnalyticsPage /></Protected>} />
          <Route path="/staff" element={<Protected><StaffPage /></Protected>} />
          {/* Operations area for authorized hospital operators */}
          <Route path="/ops" element={<Protected><OpsOverviewPage /></Protected>} />
          <Route path="/ops/failed" element={<Protected><FailedOpsPage /></Protected>} />
          <Route path="/ops/unknown" element={<Protected><UnknownOutcomesPage /></Protected>} />
          <Route path="/ops/reconciliation" element={<Protected><ReconciliationPage /></Protected>} />
          <Route path="/ops/escalations" element={<Protected><EscalationsPage /></Protected>} />
          <Route path="/ops/retry" element={<Protected><RetryQueuePage /></Protected>} />
          <Route path="/ops/recovery" element={<Protected><RecoveryHistoryPage /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AdminProvider>
        <Router>
          <AnimatedRoutes />
        </Router>
      </AdminProvider>
    </MotionConfig>
  );
}
