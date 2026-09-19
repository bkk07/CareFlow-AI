import { MotionConfig } from "framer-motion";
import { Navigate, Outlet, Route, BrowserRouter as Router, Routes } from "react-router-dom";
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
      <Route path="/" element={<Navigate to="/ops" replace />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/ops" element={<OpsOverviewPage />} />
        <Route path="/ops/failed" element={<FailedOpsPage />} />
        <Route path="/ops/unknown" element={<UnknownOutcomesPage />} />
        <Route path="/ops/reconciliation" element={<ReconciliationPage />} />
        <Route path="/ops/escalations" element={<EscalationsPage />} />
        <Route path="/ops/retry" element={<RetryQueuePage />} />
        <Route path="/ops/recovery" element={<RecoveryHistoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/ops" replace />} />
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
