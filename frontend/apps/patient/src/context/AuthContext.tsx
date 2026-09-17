import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  fetchContact,
  login as apiLogin,
  me as apiMe,
  probeBackend,
  registerPatient as apiRegister,
  restoreAccessToken,
  saveContact as apiSaveContact,
  setAccessToken,
  updateEmail as apiUpdateEmail,
  type Contact,
  type CurrentUser,
} from "../api";
import { CURRENT_PATIENT } from "../mock/data";
import type { PatientProfile } from "../types";

export type BackendMode = "checking" | "live" | "mock";

interface AuthState {
  isAuthenticated: boolean;
  /** live = backend reachable + JWT session; mock = offline demo data. */
  mode: BackendMode;
  user: CurrentUser | null;
  contact: Contact | null;
  patient: PatientProfile;
  accessToken: string | null;
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  loginMock: () => void;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  updateContactInfo: (patch: { full_name?: string; phone?: string; date_of_birth?: string }) => Promise<void>;
  updateAccountEmail: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const MOCK_KEY = "careflow_mock_auth";

function profileFromBackend(user: CurrentUser, contact: Contact | null): PatientProfile {
  return {
    ...CURRENT_PATIENT,
    id: user.id,
    email: user.email,
    name: contact?.full_name ?? user.email.split("@")[0],
    phone: contact?.phone ?? "",
    dob: contact?.date_of_birth ?? "",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<BackendMode>("checking");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // On boot: if the backend is up and a token is stored, restore the session.
  // Otherwise fall back to the offline mock session when one was saved.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reachable = await probeBackend();
      if (cancelled) return;
      if (!reachable) {
        try {
          if (localStorage.getItem(MOCK_KEY) === "1") setIsAuthenticated(true);
        } catch {
          /* private mode */
        }
        setMode("mock");
        return;
      }
      const token = restoreAccessToken();
      if (!token) {
        setMode("live");
        return;
      }
      try {
        const me = await apiMe();
        const profile = await fetchContact().catch(() => null);
        if (cancelled) return;
        setUser(me);
        setContact(profile);
        setAccessTokenState(token);
        setIsAuthenticated(true);
      } catch {
        setAccessToken(null);
      }
      if (!cancelled) setMode("live");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const reachable = await probeBackend();
    if (!reachable) {
      // Offline: keep the demo usable with mock data.
      try {
        localStorage.setItem(MOCK_KEY, "1");
      } catch {
        /* private mode */
      }
      setMode("mock");
      setIsAuthenticated(true);
      return;
    }
    try {
      await apiLogin(email, password);
      const me = await apiMe();
      const profile = await fetchContact().catch(() => null);
      setUser(me);
      setContact(profile);
      setAccessTokenState(restoreAccessToken());
      setIsAuthenticated(true);
      setMode("live");
    } catch {
      setAuthError("Sign-in failed. Check your email and password, or create an account.");
      throw new Error("login-failed");
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    try {
      await apiRegister(email, password);
      const me = await apiMe();
      setUser(me);
      setContact(null);
      setAccessTokenState(restoreAccessToken());
      setIsAuthenticated(true);
      setMode("live");
    } catch (e) {
      setAuthError("Registration failed. The email may already be in use (try signing in).");
      throw e;
    }
  }, []);

  const loginMock = useCallback(() => {
    try {
      localStorage.setItem(MOCK_KEY, "1");
    } catch {
      /* private mode */
    }
    setMode("mock");
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    setAccessToken(null);
    try {
      localStorage.removeItem(MOCK_KEY);
    } catch {
      /* noop */
    }
    setUser(null);
    setContact(null);
    setAccessTokenState(null);
    setAuthError(null);
    setIsAuthenticated(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    const me = await apiMe();
    const profile = await fetchContact().catch(() => null);
    setUser(me);
    setContact(profile);
    setAccessTokenState(restoreAccessToken());
  }, []);

  const updateContactInfo = useCallback(
    async (patch: { full_name?: string; phone?: string; date_of_birth?: string }) => {
      const next = await apiSaveContact(patch);
      setContact(next);
    },
    [],
  );

  const updateAccountEmail = useCallback(async (email: string) => {
    const next = await apiUpdateEmail(email);
    setUser(next);
  }, []);

  const patient = useMemo<PatientProfile>(
    () => (mode === "live" && user ? profileFromBackend(user, contact) : CURRENT_PATIENT),
    [mode, user, contact],
  );

  const value = useMemo(
    () => ({
      isAuthenticated,
      mode,
      user,
      contact,
      patient,
      accessToken,
      authError,
      login,
      register,
      loginMock,
      logout,
      refreshProfile,
      updateContactInfo,
      updateAccountEmail,
    }),
    [isAuthenticated, mode, user, contact, patient, accessToken, authError, login, register, loginMock, logout, refreshProfile, updateContactInfo, updateAccountEmail],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
