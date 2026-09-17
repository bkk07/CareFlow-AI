import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from "react-router-dom";
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

function Protected({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <DoctorShell>{children}</DoctorShell>;
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
          <Route path="/" element={<Protected><DashboardPage /></Protected>} />
          <Route path="/today" element={<Protected><TodayPage /></Protected>} />
          <Route path="/upcoming" element={<Protected><UpcomingPage /></Protected>} />
          <Route path="/calendar" element={<Protected><CalendarPage /></Protected>} />
          <Route path="/availability" element={<Protected><AvailabilityPage /></Protected>} />
          <Route path="/appointments/:id" element={<Protected><AppointmentDetailPage /></Protected>} />
          <Route path="/questionnaires" element={<Protected><QuestionnairesPage /></Protected>} />
          <Route path="/notifications" element={<Protected><NotificationsPage /></Protected>} />
          <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <ScheduleProvider>
          <Router>
            <AnimatedRoutes />
          </Router>
        </ScheduleProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
