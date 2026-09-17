import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from "react-router-dom";
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
          <Route path="/" element={<Navigate to="/platform" replace />} />
          <Route path="/platform" element={<Protected><PlatformOverviewPage /></Protected>} />
          <Route path="/platform/applications" element={<Protected><HospitalApplicationsPage /></Protected>} />
          <Route path="/platform/hospitals" element={<Protected><PlatformHospitalsPage /></Protected>} />
          <Route path="/platform/doctors" element={<Protected><PlatformDoctorsPage /></Protected>} />
          <Route path="/platform/patients" element={<Protected><PlatformPatientsPage /></Protected>} />
          <Route path="/platform/appointments" element={<Protected><PlatformAppointmentsPage /></Protected>} />
          <Route path="/platform/ai" element={<Protected><PlatformAIPage /></Protected>} />
          <Route path="/platform/integrations" element={<Protected><PlatformIntegrationsPage /></Protected>} />
          <Route path="/platform/workflows" element={<Protected><PlatformWorkflowsPage /></Protected>} />
          <Route path="/platform/analytics" element={<Protected><PlatformAnalyticsPage /></Protected>} />
          <Route path="/platform/audit" element={<Protected><AuditPage /></Protected>} />
          <Route path="/platform/health" element={<Protected><OperationalHealthPage /></Protected>} />
          <Route path="*" element={<Navigate to="/platform" replace />} />
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
