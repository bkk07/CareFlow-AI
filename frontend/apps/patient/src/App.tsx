import { Link, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import Appointments from "./pages/Appointments";
import ChatDebug from "./pages/ChatDebug";
import Home from "./pages/Home";
import VoiceChat from "./pages/VoiceChat";
import Preferences from "./pages/Preferences";
import Profile from "./pages/Profile";

const linkStyle: React.CSSProperties = { marginRight: "1rem" };

export default function App() {
  return (
    <Router>
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1>CareFlow AI — Patient</h1>
        <nav style={{ marginBottom: "1rem" }}>
          <Link style={linkStyle} to="/">
            Home
          </Link>
          <Link style={linkStyle} to="/profile">
            Profile
          </Link>
          <Link style={linkStyle} to="/appointments">
            Appointments
          </Link>
          <Link style={linkStyle} to="/preferences">
            Preferences
          </Link>
          <Link style={linkStyle} to="/chat-debug">
            Chat (debug)
          </Link>
          <Link to="/voice">Voice (dev)</Link>
        </nav>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/preferences" element={<Preferences />} />
          <Route path="/chat-debug" element={<ChatDebug />} />
          <Route path="/voice" element={<VoiceChat />} />
        </Routes>
      </main>
    </Router>
  );
}
