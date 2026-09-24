import axios, { type AxiosInstance } from "axios";

/**
 * Shared Axios client (Phase 0 — Scaffolding).
 *
 * - `baseURL` comes from `VITE_API_URL` so local/dev/deployed backends
 *   can be swapped without code changes.
 * - Request interceptor is a stub: Phase 1 (Auth) will attach the JWT
 *   access token here.
 */
const _viteEnv = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;
const _viteApiUrl = _viteEnv?.VITE_API_URL;
if (!_viteApiUrl && !_viteEnv?.DEV) {
  throw new Error(
    "VITE_API_URL is not configured. Set it to the backend base URL (e.g. https://<backend-host>).",
  );
}
// Local development default (matches .env.example). Production builds
// must provide VITE_API_URL — see the check above.
export const apiBaseURL = _viteApiUrl ?? "http://localhost:8000";

export const apiClient: AxiosInstance = axios.create({
  baseURL: apiBaseURL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  // Phase 1: attach `Authorization: Bearer <access_token>` from storage.
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(error),
);

export default apiClient;
