import { clearSession, readSession, updateAccessToken, writeSession } from "@/lib/authStore";

const defaultApiBaseUrl = "http://localhost:4002";

export const apiBaseUrl = () => {
  const envValue = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (envValue) return envValue.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const injected = (window as unknown as { MAP_OF_US_API_BASE_URL?: string }).MAP_OF_US_API_BASE_URL;
    if (injected) return injected.replace(/\/$/, "");
  }
  return defaultApiBaseUrl;
};

type ApiOptions = RequestInit & {
  auth?: boolean;
  retry?: boolean;
};

function makeHeaders(headers?: HeadersInit, auth = true, body?: BodyInit | null) {
  const next = new Headers(headers);
  if (!next.has("Content-Type") && !(body instanceof FormData)) {
    next.set("Content-Type", "application/json");
  }
  const token = auth ? readSession()?.accessToken : null;
  if (token) next.set("Authorization", `Bearer ${token}`);
  return next;
}

async function refreshAccessToken() {
  const session = readSession();
  if (!session?.refreshToken) return false;
  const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  }).catch(() => null);
  if (!response?.ok) return false;
  const data = (await response.json().catch(() => null)) as { accessToken?: string } | null;
  if (!data?.accessToken) return false;
  updateAccessToken(data.accessToken);
  return true;
}

export async function apiFetch(path: string, options: ApiOptions = {}) {
  const { auth = true, retry = true, ...init } = options;
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: makeHeaders(init.headers, auth, init.body),
    cache: init.cache ?? "no-store",
  });

  if (response.status === 401 && auth && retry && (await refreshAccessToken())) {
    return apiFetch(path, { ...options, retry: false });
  }

  if (response.status === 401) clearSession();
  return response;
}

export async function apiJson<T>(path: string, options: ApiOptions = {}) {
  const response = await apiFetch(path, options);
  if (!response.ok) throw new Error(`API ${path} failed (${response.status})`);
  return (await response.json()) as T;
}

export async function login(username: string, password: string) {
  const response = await apiFetch("/auth/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) return false;
  const session = (await response.json()) as Parameters<typeof writeSession>[0];
  writeSession(session);
  return true;
}

export async function logout() {
  await apiFetch("/auth/logout", { method: "POST" }).catch(() => null);
  clearSession();
}
