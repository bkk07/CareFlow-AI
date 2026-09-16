import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { api, me, restoreAccessToken, setAccessToken, type CurrentUser } from "./api";
import Book from "./pages/Book";
import ChatDebug from "./pages/ChatDebug";
import Home from "./pages/Home";
import Inbox from "./pages/Inbox";
import Login from "./pages/Login";
import Preferences from "./pages/Preferences";
import Profile from "./pages/Profile";
import Visits from "./pages/Visits";
import VoiceChat from "./pages/VoiceChat";

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
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/">
            <span className="brand-badge" aria-hidden>
              +
            </span>
            CareFlow <span>AI</span>
          </Link>
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Find care
            </NavLink>
            <NavLink to="/visits" className={({ isActive }) => (isActive ? "active" : "")}>
              My visits
            </NavLink>
            <NavLink to="/inbox" className={({ isActive }) => (isActive ? "active" : "")}>
              Inbox{unread > 0 ? ` (${unread})` : ""}
            </NavLink>
            <NavLink to="/chat" className={({ isActive }) => (isActive ? "active" : "")}>
              Assistant
            </NavLink>
            <NavLink to="/voice" className={({ isActive }) => (isActive ? "active" : "")}>
              Voice
            </NavLink>
            <NavLink to="/preferences" className={({ isActive }) => (isActive ? "active" : "")}>
              Preferences
            </NavLink>
            <NavLink to="/profile" className={({ isActive }) => (isActive ? "active" : "")}>
              Profile
            </NavLink>
          </nav>
          <div className="topbar-spacer" />
          <span className="user-chip">
            {user.email} <button className="btn" onClick={onLogout}>Log out</button>
          </span>
        </div>
      </header>
      <main className="container">
        <Routes>
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

  if (!token || !user) {
    return (
      <Router>
        <Login onDone={() => setToken(restoreAccessToken())} />
      </Router>
    );
  }

  return (
    <Router>
      <Shell user={user} onLogout={logout} />
    </Router>
  );
}
