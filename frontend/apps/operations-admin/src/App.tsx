import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from "react-router-dom";
import { AdminProvider, useAdmin } from "./store/AdminStore";
import { AdminShell } from "./components/layout/AdminShell";
import LoginPage from "./pages/LoginPage";
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
          <Route path="/" element={<Navigate to="/ops" replace />} />
          <Route path="/ops" element={<Protected><OpsOverviewPage /></Protected>} />
          <Route path="/ops/failed" element={<Protected><FailedOpsPage /></Protected>} />
          <Route path="/ops/unknown" element={<Protected><UnknownOutcomesPage /></Protected>} />
          <Route path="/ops/reconciliation" element={<Protected><ReconciliationPage /></Protected>} />
          <Route path="/ops/escalations" element={<Protected><EscalationsPage /></Protected>} />
          <Route path="/ops/retry" element={<Protected><RetryQueuePage /></Protected>} />
          <Route path="/ops/recovery" element={<Protected><RecoveryHistoryPage /></Protected>} />
          <Route path="*" element={<Navigate to="/ops" replace />} />
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
