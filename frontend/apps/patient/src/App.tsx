import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  Link,
  NavLink,
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
} from "react-router-dom";
import { api, me, restoreAccessToken, setAccessToken, type CurrentUser } from "./api";
import { ActivePill, EASE } from "./motion";
import { LogoutIcon, PlusIcon } from "./icons";
import Book from "./pages/Book";
import ChatDebug from "./pages/ChatDebug";
import Home from "./pages/Home";
import Inbox from "./pages/Inbox";
import Login from "./pages/Login";
import Preferences from "./pages/Preferences";
import Profile from "./pages/Profile";
import Visits from "./pages/Visits";
import VoiceChat from "./pages/VoiceChat";

const LINKS = [
  { to: "/", label: "Find care", end: true },
  { to: "/visits", label: "My visits", end: false },
  { to: "/inbox", label: "Inbox", end: false },
  { to: "/chat", label: "Assistant", end: false },
  { to: "/voice", label: "Voice", end: false },
  { to: "/preferences", label: "Preferences", end: false },
  { to: "/profile", label: "Profile", end: false },
];

function AnimatedRoutes({ user }: { user: CurrentUser }) {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Home />} />
        <Route path="/book" element={<Book patientId={user.id} />} />
        <Route path="/visits" element={<Visits />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/chat" element={<ChatDebug />} />
        <Route path="/chat-debug" element={<ChatDebug />} />
        <Route path="/voice" element={<VoiceChat />} />
        <Route path="/preferences" element={<Preferences />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>
    </AnimatePresence>
  );
}

function Shell({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const [unread, setUnread] = useState(0);

  const refreshInbox = useCallback(async () => {
    try {
      const { data } = await api.get<unknown[]>("/notifications");
      setUnread(data.length);
    } catch {
      /* inbox page reports */
    }
  }, []);

  useEffect(() => {
    void refreshInbox();
    const timer = setInterval(() => void refreshInbox(), 30000);
    return () => clearInterval(timer);
  }, [refreshInbox]);

  return (
    <>
      <motion.header
        className="topbar"
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE }}
      >
        <div className="topbar-inner">
          <Link className="brand" to="/">
            <motion.span
              className="brand-badge"
              aria-hidden
              whileHover={{ rotate: 90 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
            >
              <PlusIcon size={16} />
            </motion.span>
            CareFlow <span>AI</span>
          </Link>
          <nav className="nav">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <ActivePill id="patient-nav" className="nav-pill" />}
                    {l.label}
                    {l.to === "/inbox" && unread > 0 ? ` (${unread})` : ""}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-spacer" />
          <span className="user-chip">
            {user.email}{" "}
            <motion.button
              className="btn btn-sm"
              onClick={onLogout}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
            >
              <LogoutIcon size={14} /> Log out
            </motion.button>
          </span>
        </div>
      </motion.header>
      <main className="container">
        <AnimatedRoutes user={user} />
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <span>
            <strong>CareFlow AI</strong> · live hospital scheduling
          </span>
          <span>Need help? Ask the assistant any time.</span>
        </div>
      </footer>
    </>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => restoreAccessToken());
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    me()
      .then((u) => {
        if (u.role !== "patient") {
          setAccessToken(null);
          setToken(null);
          return;
        }
        setUser(u);
      })
      .catch(() => {
        setAccessToken(null);
        setToken(null);
      });
  }, [token]);

  function logout() {
    setAccessToken(null);
    setToken(null);
  }

  return (
    <MotionConfig reducedMotion="user">
      <Router>
        {!token || !user ? (
          <AnimatePresence mode="wait">
            <Login key="login" onDone={() => setToken(restoreAccessToken())} />
          </AnimatePresence>
        ) : (
          <Shell user={user} onLogout={logout} />
        )}
      </Router>
    </MotionConfig>
  );
}
