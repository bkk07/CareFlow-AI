import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  login as apiLogin,
  me as apiMe,
  myProfile as apiMyProfile,
  restoreAccessToken,
  setAccessToken,
  updateMyProfile as apiUpdateProfile,
  type CurrentUser,
  type DoctorProfile as BackendProfile,
} from "../api";
import { mapDoctorProfile } from "../lib/backend";
import type { ConsultationMode, Doctor } from "../types";

export type BackendMode = "checking" | "live";

const EMPTY_DOCTOR: Doctor = {
  id: "",
  name: "",
  specialty: "",
  department: "",
  qualifications: "",
  experienceYears: 0,
  languages: [],
  hospital: "",
  photo: "",
  consultationTypes: [],
  appointmentDuration: 0,
  appointmentDurations: [],
  status: "active",
  acceptingAppointments: false,
};

interface AuthState {
  isAuthenticated: boolean;
  /** live = backend JWT session. No offline fallback. */
  mode: BackendMode;
  user: CurrentUser | null;
  profile: BackendProfile | null;
  doctor: Doctor;
  accessToken: string | null;
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateDoctor: (patch: Partial<Doctor>) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

function profilePatchFromUI(
  patch: Partial<Doctor>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.experienceYears !== undefined) out.experience_years = patch.experienceYears;
  if (patch.languages !== undefined) out.languages = patch.languages;
  if (patch.consultationTypes !== undefined)
    out.consultation_types = patch.consultationTypes;
  if (patch.appointmentDurations !== undefined)
    out.available_durations = patch.appointmentDurations;
  else if (patch.appointmentDuration !== undefined)
    out.available_durations = [patch.appointmentDuration];
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
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // On boot: restore the JWT session from storage via the backend.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = restoreAccessToken();
      if (!token) {
        if (!cancelled) setMode("live");
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
        if (!cancelled) {
          setUser(null);
          setProfile(null);
          setAccessTokenState(null);
          setIsAuthenticated(false);
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

  const logout = useCallback(() => {
    setAccessToken(null);
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
      const body = profilePatchFromUI(patch);
      // acceptingAppointments has no backend field (Schedule owns
      // calendars.is_active) — nothing to persist for it here.
      if (!body) return;
      if (!profile) throw new Error("profile-not-loaded");
      const next = await apiUpdateProfile(body);
      setProfile(next);
    },
    [profile],
  );

  const doctor = useMemo<Doctor>(
    () => (profile ? mapDoctorProfile(profile) : EMPTY_DOCTOR),
    [profile],
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
