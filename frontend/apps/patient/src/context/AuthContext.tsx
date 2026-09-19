import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  fetchContact,
  login as apiLogin,
  me as apiMe,
  registerPatient as apiRegister,
  restoreAccessToken,
  saveContact as apiSaveContact,
  setAccessToken,
  updateEmail as apiUpdateEmail,
  type Contact,
  type CurrentUser,
} from "../api";
import type { PatientProfile } from "../types";

export type BackendMode = "checking" | "live";

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
  logout: () => void;
  refreshProfile: () => Promise<void>;
  updateContactInfo: (patch: { full_name?: string; phone?: string; date_of_birth?: string; city?: string | null; latitude?: number | null; longitude?: number | null }) => Promise<void>;
  updateAccountEmail: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const EMPTY_PATIENT: PatientProfile = {
  id: "",
  name: "",
  email: "",
  phone: "",
  dob: "",
  gender: "",
  address: "",
  avatar: "",
  memberSince: "",
  bloodGroup: "",
  emergencyContact: "",
};

function profileFromBackend(user: CurrentUser, contact: Contact | null): PatientProfile {
  return {
    ...EMPTY_PATIENT,
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

  // On boot: restore the JWT session when one was saved.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = restoreAccessToken();
      if (token) {
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
      }
      if (!cancelled) setMode("live");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setAuthError(null);
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

  const logout = useCallback(() => {
    setAccessToken(null);
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
    async (patch: { full_name?: string; phone?: string; date_of_birth?: string; city?: string | null; latitude?: number | null; longitude?: number | null }) => {
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
    () => (user ? profileFromBackend(user, contact) : EMPTY_PATIENT),
    [user, contact],
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
      logout,
      refreshProfile,
      updateContactInfo,
      updateAccountEmail,
    }),
    [isAuthenticated, mode, user, contact, patient, accessToken, authError, login, register, logout, refreshProfile, updateContactInfo, updateAccountEmail],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
