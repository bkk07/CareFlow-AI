import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AppStateProvider } from "./context/AppStateContext";
import { PatientShell } from "./components/layout/PatientShell";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import BookPage from "./pages/BookPage";
import VisitsPage from "./pages/VisitsPage";
import InboxPage from "./pages/InboxPage";
import ChatPage from "./pages/ChatPage";
import VoicePage from "./pages/VoicePage";
import ChatDebugPage from "./pages/ChatDebugPage";
import PreferencesPage from "./pages/PreferencesPage";
import ProfilePage from "./pages/ProfilePage";

function Protected({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <PatientShell>{children}</PatientShell>;
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
        transition={{ duration: 0.22 }}
      >
        <Routes location={location}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Protected><HomePage /></Protected>} />
          <Route path="/book" element={<Protected><BookPage /></Protected>} />
          <Route path="/visits" element={<Protected><VisitsPage /></Protected>} />
          <Route path="/inbox" element={<Protected><InboxPage /></Protected>} />
          <Route path="/chat" element={<Protected><ChatPage /></Protected>} />
          <Route path="/chat-debug" element={<Protected><ChatDebugPage /></Protected>} />
          <Route path="/voice" element={<Protected><VoicePage /></Protected>} />
          <Route path="/preferences" element={<Protected><PreferencesPage /></Protected>} />
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
        <AppStateProvider>
          <Router>
            <AnimatedRoutes />
          </Router>
        </AppStateProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
