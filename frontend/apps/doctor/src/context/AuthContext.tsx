import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  login as apiLogin,
  me as apiMe,
  myProfile as apiMyProfile,
  probeBackend,
  restoreAccessToken,
  setAccessToken,
  updateMyProfile as apiUpdateProfile,
  type CurrentUser,
  type DoctorProfile as BackendProfile,
} from "../api";
import { mapDoctorProfile } from "../lib/backend";
import { CURRENT_DOCTOR } from "../mock/doctors";
import type { ConsultationMode, Doctor } from "../types";

export type BackendMode = "checking" | "live" | "mock";

interface AuthState {
  isAuthenticated: boolean;
  /** live = backend reachable + JWT session; mock = offline demo data. */
  mode: BackendMode;
  user: CurrentUser | null;
  profile: BackendProfile | null;
  doctor: Doctor;
  accessToken: string | null;
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginMock: () => void;
  logout: () => void;
  updateDoctor: (patch: Partial<Doctor>) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);
const MOCK_KEY = "careflow_doctor_mock_auth";

function profilePatchFromUI(
  patch: Partial<Doctor>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.experienceYears !== undefined) out.experience_years = patch.experienceYears;
  if (patch.languages !== undefined) out.languages = patch.languages;
  if (patch.consultationTypes !== undefined)
    out.consultation_types = patch.consultationTypes;
  if (patch.appointmentDuration !== undefined)
    out.default_duration_minutes = patch.appointmentDuration;
  if (patch.photo !== undefined) out.photo_url = patch.photo || null;
  if (patch.qualifications !== undefined)
    out.qualifications = { text: patch.qualifications };
  return Object.keys(out).length > 0 ? out : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<BackendMode>("checking");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [profile, setProfile] = useState<BackendProfile | null>(null);
  const [mockDoctor, setMockDoctor] = useState<Doctor>(CURRENT_DOCTOR);
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
        const [me, prof] = await Promise.all([apiMe(), apiMyProfile()]);
        if (cancelled) return;
        setUser(me);
        setProfile(prof);
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
      const [me, prof] = await Promise.all([apiMe(), apiMyProfile()]);
      setUser(me);
      setProfile(prof);
      setAccessTokenState(restoreAccessToken());
      setIsAuthenticated(true);
      setMode("live");
    } catch {
      setAuthError("Sign-in failed. Check your email and password.");
      throw new Error("login-failed");
    }
  }, []);

  const loginMock = useCallback(() => {
    try {
      localStorage.setItem(MOCK_KEY, "1");
    } catch {
      /* noop */
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
    setProfile(null);
    setAccessTokenState(null);
    setAuthError(null);
    setIsAuthenticated(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    const prof = await apiMyProfile();
    setProfile(prof);
    setAccessTokenState(restoreAccessToken());
  }, []);

  const updateDoctor = useCallback(
    async (patch: Partial<Doctor>) => {
      if (mode === "live" && profile) {
        const body = profilePatchFromUI(patch);
        if (body) {
          const next = await apiUpdateProfile(body);
          setProfile(next);
          return;
        }
        return;
      }
      // Mock mode (and acceptingAppointments, which has no backend field):
      // keep everything local.
      setMockDoctor((d) => ({ ...d, ...patch }));
    },
    [mode, profile],
  );

  const doctor = useMemo<Doctor>(
    () => (mode === "live" && profile ? mapDoctorProfile(profile) : mockDoctor),
    [mode, profile, mockDoctor],
  );

  const value = useMemo(
    () => ({
      isAuthenticated,
      mode,
      user,
      profile,
      doctor,
      accessToken,
      authError,
      login,
      loginMock,
      logout,
      updateDoctor,
      refreshProfile,
    }),
    [
      isAuthenticated,
      mode,
      user,
      profile,
      doctor,
      accessToken,
      authError,
      login,
      loginMock,
      logout,
      updateDoctor,
      refreshProfile,
    ],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export type { ConsultationMode };
