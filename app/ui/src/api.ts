// v3 API client — connects to v2 webhook
// Configurable via VITE_API_URL env or localStorage override

const DEFAULT_API_URL = "https://trade.mozasolution.com";

function apiBase(): string {
  const stored = localStorage.getItem("v3_api_url");
  if (stored) return stored.replace(/\/+$/, "");
  return (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

export function setApiUrl(url: string) {
  localStorage.setItem("v3_api_url", url.replace(/\/+$/, ""));
}

export function getApiUrl(): string {
  return apiBase();
}

async function get(path: string) {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("v3_token");
  if (token) headers["x-session-token"] = token;
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function post(path: string, payload?: unknown) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = localStorage.getItem("v3_token");
  if (token) headers["x-session-token"] = token;
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers,
    credentials: "include",
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  health: () => get("/health"),
  authMe: () => get("/auth/me"),
  login: async (email: string, password: string) => {
    const data = await post("/auth/login", { email, password });
    if (data.token) localStorage.setItem("v3_token", data.token);
    return data;
  },
  logout: async () => {
    await post("/auth/logout");
    localStorage.removeItem("v3_token");
  },
  trades: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get(`/v2/trades${qs}`);
  },
  signals: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get(`/v2/signals${qs}`);
  },
  post,
  get,
  // SSE — same as v2
  notificationStream: (): EventSource => {
    return new EventSource(`${apiBase()}/v2/notifications/stream`, {
      withCredentials: true,
    });
  },
};
