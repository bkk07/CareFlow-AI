import { MotionConfig } from "framer-motion";
import { Navigate, Outlet, Route, BrowserRouter as Router, Routes } from "react-router-dom";
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
    <PatientShell>
      <Outlet />
    </PatientShell>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/book" element={<BookPage />} />
        <Route path="/visits" element={<VisitsPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat-debug" element={<ChatDebugPage />} />
        <Route path="/voice" element={<VoicePage />} />
        <Route path="/preferences" element={<PreferencesPage />} />
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
        <AppStateProvider>
          <Router>
            <AppRoutes />
          </Router>
        </AppStateProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
