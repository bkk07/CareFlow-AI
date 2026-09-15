import axios from "axios";

const baseURL =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_URL ?? "http://localhost:8000";

export const api = axios.create({ baseURL });

export function setAccessToken(token: string | null) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    localStorage.setItem("careflow_admin_token", token);
  } else {
    delete api.defaults.headers.common["Authorization"];
    localStorage.removeItem("careflow_admin_token");
  }
}

export function restoreAccessToken(): string | null {
  const token = localStorage.getItem("careflow_admin_token");
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  }
  return token;
}

export interface CurrentUser {
  id: string;
  email: string;
  role: string;
  hospital_id: string | null;
}

export interface NamedEntity {
  id: string;
  hospital_id: string;
  name: string;
}

export interface AppointmentType extends NamedEntity {
  duration_minutes: number;
  compatible_specialty_ids: string[];
}

export interface Doctor {
  id: string;
  hospital_id: string;
  name: string;
  specialty_id: string | null;
  department_id: string | null;
  experience_years: number;
  default_duration_minutes: number;
  external_provider_id: string | null;
  status: string;
}

export async function login(email: string, password: string): Promise<void> {
  const { data } = await api.post("/auth/login", { email, password });
  setAccessToken(data.access_token);
}

export async function me(): Promise<CurrentUser> {
  const { data } = await api.get("/auth/me");
  return data;
}
