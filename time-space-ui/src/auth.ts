// Lightweight authentication helper for the frontend.
//
// Stores the bearer token in sessionStorage (cleared when the tab closes),
// attaches it to API requests, and triggers a return-to-login on 401.

const TOKEN_KEY = "tsui_auth_token";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Authorization header for API calls, or empty object when not logged in. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Authenticate with the backend and store the returned token on success. */
export async function login(
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.status === 429) {
      return { ok: false, error: "Too many attempts. Please wait 15 minutes and try again." };
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return { ok: false, error: e.error || "Invalid credentials" };
    }
    const data = await res.json();
    setToken(data.token);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

/**
 * fetch wrapper that attaches the bearer token and, on a 401, clears the
 * token and notifies the app to return to the login screen.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    headers: { ...(init.headers || {}), ...authHeaders() },
  });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("auth:unauthorized"));
  }
  return res;
}
