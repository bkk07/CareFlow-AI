import { MotionConfig } from "framer-motion";
import { Navigate, Outlet, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ScheduleProvider } from "./context/ScheduleContext";
import { DoctorShell } from "./components/layout/DoctorShell";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import TodayPage from "./pages/TodayPage";
import UpcomingPage from "./pages/UpcomingPage";
import CalendarPage from "./pages/CalendarPage";
import AvailabilityPage from "./pages/AvailabilityPage";
import AppointmentDetailPage from "./pages/AppointmentDetailPage";
import QuestionnairesPage from "./pages/QuestionnairesPage";
import NotificationsPage from "./pages/NotificationsPage";
import ProfilePage from "./pages/ProfilePage";

function ProtectedLayout() {
  const { isAuthenticated, mode } = useAuth();
  if (mode === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-secondary text-sm">
        Restoring your session…
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return (
    <DoctorShell>
      <Outlet />
    </DoctorShell>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/upcoming" element={<UpcomingPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/availability" element={<AvailabilityPage />} />
        <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
        <Route path="/questionnaires" element={<QuestionnairesPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <ScheduleProvider>
          <Router>
            <AppRoutes />
          </Router>
        </ScheduleProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
