const ENV_API_BASE = String(import.meta.env.VITE_API_BASE || "").trim();
const DEFAULT_REMOTE_BASE = ENV_API_BASE || "http://localhost";
const DEFAULT_API_KEY = import.meta.env.VITE_API_KEY || "";
const DEFAULT_API_TIMEOUT_MS = 180000;

function normalizeApiBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    return u.origin;
  } catch {
    return "";
  }
}

function runtimeApiBase() {
  const u = new URL(window.location.href);
  const apiBaseQuery = normalizeApiBase(u.searchParams.get("apiBase"));
  if (apiBaseQuery) {
    localStorage.setItem("tvbridge_api_base", apiBaseQuery);
    return apiBaseQuery;
  }
  const { hostname, origin, port, protocol } = window.location;

  // On deployed server UI, always use same-origin API to avoid stale/bad saved API URLs.
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return origin;
  }

  const apiBaseStored = ENV_API_BASE
    ? ""
    : normalizeApiBase(localStorage.getItem("tvbridge_api_base"));
  if (apiBaseStored) return apiBaseStored;

  const apiBaseDefault = ENV_API_BASE
    ? ENV_API_BASE.replace(/\/+$/, "")
    : normalizeApiBase(DEFAULT_REMOTE_BASE);
  // For localhost/127.0.0.1, only auto-force env-configured API base.
  // Do not clobber an intended runtime target (e.g. VPS via query/storage)
  // with the generic fallback "http://localhost".
  if (
    (hostname === "localhost" || hostname === "127.0.0.1") &&
    ENV_API_BASE &&
    apiBaseDefault
  ) {
    localStorage.setItem("tvbridge_api_base", apiBaseDefault);
    return apiBaseDefault;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    // If running on a non-standard port (e.g. backend serves UI on :3001),
    // use same-origin so API calls hit the correct port.
    if (port && port !== "80" && port !== "443") {
      return origin;
    }
    // In Vite dev mode, proxy handles forwarding to backend.
    if (import.meta.env.DEV) {
      return origin;
    }
    return DEFAULT_REMOTE_BASE;
  }
  return origin;
}

function runtimeApiKey() {
  const u = new URL(window.location.href);
  const keyFromQuery = (u.searchParams.get("apiKey") || "").trim();
  if (keyFromQuery) {
    localStorage.setItem("tvbridge_api_key", keyFromQuery);
    return keyFromQuery;
  }
  const { hostname } = window.location;
  if (
    (hostname === "localhost" || hostname === "127.0.0.1") &&
    DEFAULT_API_KEY
  ) {
    localStorage.setItem("tvbridge_api_key", DEFAULT_API_KEY);
    return DEFAULT_API_KEY.trim();
  }
  return (localStorage.getItem("tvbridge_api_key") || DEFAULT_API_KEY).trim();
}

export function getRuntimeApiKey() {
  return runtimeApiKey();
}

export function setRuntimeApiKey(value) {
  const v = String(value || "").trim();
  if (!v) {
    localStorage.removeItem("tvbridge_api_key");
    return;
  }
  localStorage.setItem("tvbridge_api_key", v);
}

export function getRuntimeActiveUserId() {
  return (localStorage.getItem("tvbridge_active_user_id") || "").trim();
}

export function setRuntimeActiveUserId(value) {
  const v = String(value || "").trim();
  if (!v) {
    localStorage.removeItem("tvbridge_active_user_id");
    return;
  }
  localStorage.setItem("tvbridge_active_user_id", v);
}

export function getRuntimeApiBase() {
  return runtimeApiBase();
}

export function setRuntimeApiBase(value) {
  const v = normalizeApiBase(value);
  if (!v) {
    localStorage.removeItem("tvbridge_api_base");
    return;
  }
  localStorage.setItem("tvbridge_api_base", v);
}

function buildUrl(base, path) {
  return new URL(path, `${base.replace(/\/+$/, "")}/`).toString();
}

function isAuthFailure(status, data) {
  if (status === 401 || status === 403) return true;
  const err = String(data?.error || "").toLowerCase();
  return (
    err.includes("unauthorized") ||
    err.includes("forbidden") ||
    err.includes("session") ||
    err.includes("login required")
  );
}

function redirectToLogin() {
  try {
    localStorage.removeItem("tvbridge_api_key");
  } catch {
    // ignore
  }
  if (window.location.pathname.endsWith("/login")) return;
  const base = window.location.pathname.startsWith("/ui") ? "/ui" : "";
  const returnUrl = encodeURIComponent(
    window.location.pathname + window.location.search,
  );
  const loginPath = `${base}/login?return_url=${returnUrl}`;
  window.location.assign(loginPath);
}

async function get(path) {
  const API_KEY = runtimeApiKey();
  const base = runtimeApiBase();
  const primaryUrl = buildUrl(base, path);
  const fallbackUrl = buildUrl(window.location.origin, path);

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), DEFAULT_API_TIMEOUT_MS);
    const activeUserId = getRuntimeActiveUserId();
    const headers = { "Cache-Control": "no-cache", Pragma: "no-cache" };
    if (API_KEY) headers["x-api-key"] = API_KEY;
    if (activeUserId) headers["x-active-user-id"] = activeUserId;
    try {
      return await fetch(url, {
        signal: ctrl.signal,
        cache: "no-store",
        credentials: "include",
        headers,
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(
          `Request timeout (${Math.round(DEFAULT_API_TIMEOUT_MS / 1000)}s). Check API URL and server status.`,
        );
      }
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  let res;
  try {
    res = await doFetch(primaryUrl);
  } catch (primaryError) {
    // If user configured a remote API URL, fallback to same-origin /mt5 endpoints.
    if (primaryUrl !== fallbackUrl) {
      try {
        res = await doFetch(fallbackUrl);
      } catch {
        throw primaryError;
      }
    } else {
      throw primaryError;
    }
  }

  let data;
  try {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}...`,
      );
    }
  } catch (err) {
    if (err.message.includes("Server returned non-JSON")) throw err;
    throw new Error(`Failed to read response body (${res.status})`);
  }

  if (!res.ok || !data.ok) {
    if (
      path !== "/auth/login" &&
      path !== "/auth/me" &&
      isAuthFailure(res.status, data)
    ) {
      redirectToLogin();
      throw new Error("Session expired. Redirecting to login.");
    }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function getBlob(path) {
  const API_KEY = runtimeApiKey();
  const base = runtimeApiBase();
  const primaryUrl = buildUrl(base, path);
  const fallbackUrl = buildUrl(window.location.origin, path);

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), DEFAULT_API_TIMEOUT_MS);
    const activeUserId = getRuntimeActiveUserId();
    const headers = { "Cache-Control": "no-cache", Pragma: "no-cache" };
    if (API_KEY) headers["x-api-key"] = API_KEY;
    if (activeUserId) headers["x-active-user-id"] = activeUserId;
    try {
      return await fetch(url, {
        signal: ctrl.signal,
        cache: "no-store",
        credentials: "include",
        headers,
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(
          `Request timeout (${Math.round(DEFAULT_API_TIMEOUT_MS / 1000)}s). Check API URL and server status.`,
        );
      }
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  let res;
  try {
    res = await doFetch(primaryUrl);
  } catch (primaryError) {
    if (primaryUrl !== fallbackUrl) {
      try {
        res = await doFetch(fallbackUrl);
      } catch {
        throw primaryError;
      }
    } else {
      throw primaryError;
    }
  }

  if (!res.ok) {
    let data = {};
    let text = "";
    try {
      text = await res.text();
      data = JSON.parse(text);
    } catch {
      data = {};
    }
    if (isAuthFailure(res.status, data)) {
      redirectToLogin();
      throw new Error("Session expired. Redirecting to login.");
    }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  const blob = await res.blob();
  const contentType =
    res.headers.get("content-type") || blob.type || "application/octet-stream";
  const disposition = res.headers.get("content-disposition") || "";
  const fileName = (/filename="([^"]+)"/i.exec(disposition)?.[1] || "").trim();
  return { blob, contentType, disposition, fileName };
}

async function post(path, body = {}) {
  const API_KEY = runtimeApiKey();
  const base = runtimeApiBase();
  const primaryUrl = buildUrl(base, path);
  const fallbackUrl = buildUrl(window.location.origin, path);

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), DEFAULT_API_TIMEOUT_MS);
    try {
      const activeUserId = getRuntimeActiveUserId();
      const headers = {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      };
      if (API_KEY) headers["x-api-key"] = API_KEY;
      if (activeUserId) headers["x-active-user-id"] = activeUserId;
      return await fetch(url, {
        method: "POST",
        signal: ctrl.signal,
        cache: "no-store",
        credentials: "include",
        headers,
        body: JSON.stringify(body || {}),
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(
          `Request timeout (${Math.round(DEFAULT_API_TIMEOUT_MS / 1000)}s). Check API URL and server status.`,
        );
      }
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  let res;
  try {
    res = await doFetch(primaryUrl);
  } catch (primaryError) {
    if (primaryUrl !== fallbackUrl) {
      try {
        res = await doFetch(fallbackUrl);
      } catch {
        throw primaryError;
      }
    } else {
      throw primaryError;
    }
  }

  let data;
  try {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}...`,
      );
    }
  } catch (err) {
    if (err.message.includes("Server returned non-JSON")) throw err;
    throw new Error(`Failed to read response body (${res.status})`);
  }

  if (!res.ok || !data.ok) {
    if (
      path !== "/auth/login" &&
      path !== "/auth/me" &&
      isAuthFailure(res.status, data)
    ) {
      redirectToLogin();
      throw new Error("Session expired. Redirecting to login.");
    }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function postWithTimeout(
  path,
  body = {},
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
) {
  const API_KEY = runtimeApiKey();
  const base = runtimeApiBase();
  const primaryUrl = buildUrl(base, path);
  const fallbackUrl = buildUrl(window.location.origin, path);

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const activeUserId = getRuntimeActiveUserId();
      const headers = {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      };
      if (API_KEY) headers["x-api-key"] = API_KEY;
      if (activeUserId) headers["x-active-user-id"] = activeUserId;
      return await fetch(url, {
        method: "POST",
        signal: ctrl.signal,
        cache: "no-store",
        credentials: "include",
        headers,
        body: JSON.stringify(body || {}),
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(
          `Request timeout (${Math.round(timeoutMs / 1000)}s). Check API URL and server status.`,
        );
      }
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  let res;
  try {
    res = await doFetch(primaryUrl);
  } catch (primaryError) {
    if (primaryUrl !== fallbackUrl) {
      try {
        res = await doFetch(fallbackUrl);
      } catch {
        throw primaryError;
      }
    } else {
      throw primaryError;
    }
  }

  let data;
  try {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}...`,
      );
    }
  } catch (err) {
    if (err.message.includes("Server returned non-JSON")) throw err;
    throw new Error(`Failed to read response body (${res.status})`);
  }

  if (!res.ok || !data.ok) {
    if (
      path !== "/auth/login" &&
      path !== "/auth/me" &&
      isAuthFailure(res.status, data)
    ) {
      redirectToLogin();
      throw new Error("Session expired. Redirecting to login.");
    }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function put(path, body = {}) {
  const API_KEY = runtimeApiKey();
  const base = runtimeApiBase();
  const primaryUrl = buildUrl(base, path);
  const fallbackUrl = buildUrl(window.location.origin, path);

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), DEFAULT_API_TIMEOUT_MS);
    try {
      const activeUserId = getRuntimeActiveUserId();
      const headers = {
        "Content-Type": "application/json",
      };
      if (API_KEY) headers["x-api-key"] = API_KEY;
      if (activeUserId) headers["x-active-user-id"] = activeUserId;
      return await fetch(url, {
        method: "PUT",
        signal: ctrl.signal,
        credentials: "include",
        headers,
        body: JSON.stringify(body || {}),
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(
          `Request timeout (${Math.round(DEFAULT_API_TIMEOUT_MS / 1000)}s). Check API URL and server status.`,
        );
      }
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  let res;
  try {
    res = await doFetch(primaryUrl);
  } catch (primaryError) {
    if (primaryUrl !== fallbackUrl) {
      try {
        res = await doFetch(fallbackUrl);
      } catch {
        throw primaryError;
      }
    } else {
      throw primaryError;
    }
  }

  let data;
  try {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}...`,
      );
    }
  } catch (err) {
    if (err.message.includes("Server returned non-JSON")) throw err;
    throw new Error(`Failed to read response body (${res.status})`);
  }

  if (!res.ok || !data.ok) {
    if (
      path !== "/auth/login" &&
      path !== "/auth/me" &&
      isAuthFailure(res.status, data)
    ) {
      redirectToLogin();
      throw new Error("Session expired. Redirecting to login.");
    }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function del(path) {
  const API_KEY = runtimeApiKey();
  const base = runtimeApiBase();
  const primaryUrl = buildUrl(base, path);
  const fallbackUrl = buildUrl(window.location.origin, path);

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), DEFAULT_API_TIMEOUT_MS);
    try {
      const activeUserId = getRuntimeActiveUserId();
      const headers = {};
      if (API_KEY) headers["x-api-key"] = API_KEY;
      if (activeUserId) headers["x-active-user-id"] = activeUserId;
      return await fetch(url, {
        method: "DELETE",
        signal: ctrl.signal,
        credentials: "include",
        headers,
      });
    } catch (err) {
      if (err?.name === "AbortError")
        throw new Error(
          `Request timeout (${Math.round(DEFAULT_API_TIMEOUT_MS / 1000)}s). Check API URL and server status.`,
        );
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  let res;
  try {
    res = await doFetch(primaryUrl);
  } catch (primaryError) {
    if (primaryUrl !== fallbackUrl) {
      try {
        res = await doFetch(fallbackUrl);
      } catch {
        throw primaryError;
      }
    } else {
      throw primaryError;
    }
  }
  let data;
  try {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}...`,
      );
    }
  } catch (err) {
    if (err.message.includes("Server returned non-JSON")) throw err;
    throw new Error(`Failed to read response body (${res.status})`);
  }

  if (!res.ok || !data.ok) {
    if (
      path !== "/auth/login" &&
      path !== "/auth/me" &&
      isAuthFailure(res.status, data)
    ) {
      redirectToLogin();
      throw new Error("Session expired. Redirecting to login.");
    }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function downloadCsv(path, params = {}) {
  const API_KEY = runtimeApiKey();
  const base = runtimeApiBase();
  const q = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
  });
  const primaryUrl = buildUrl(base, `${path}?${q.toString()}`);
  const fallbackUrl = buildUrl(
    window.location.origin,
    `${path}?${q.toString()}`,
  );

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 20000);
    try {
      const activeUserId = getRuntimeActiveUserId();
      const headers = {};
      if (API_KEY) headers["x-api-key"] = API_KEY;
      if (activeUserId) headers["x-active-user-id"] = activeUserId;
      return await fetch(url, {
        signal: ctrl.signal,
        credentials: "include",
        headers,
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(
          "Download timeout (20s). Check API URL and server status.",
        );
      }
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  let res;
  try {
    res = await doFetch(primaryUrl);
  } catch (primaryError) {
    if (primaryUrl !== fallbackUrl) {
      res = await doFetch(fallbackUrl);
    } else {
      throw primaryError;
    }
  }
  if (!res.ok) {
    if (path !== "/auth/login" && isAuthFailure(res.status, {})) {
      redirectToLogin();
      throw new Error("Session expired. Redirecting to login.");
    }
    const text = await res.text();
    throw new Error(text || `Download failed: ${res.status}`);
  }
  const blob = await res.blob();
  const contentDisposition = res.headers.get("content-disposition") || "";
  const m = contentDisposition.match(/filename="([^"]+)"/i);
  const filename = m && m[1] ? m[1] : "mt5-backtest.csv";
  return { blob, filename };
}

export const api = {
  authMe: () => get("/auth/me"),
  authProfile: () => get("/auth/profile"),
  updateAuthProfile: (name, email) => put("/auth/profile", { name, email }),
  updateMetadata: (payload = {}) => put("/auth/metadata", payload),
  listUsers: () => get("/auth/users"),
  createUser: (payload = {}) => post("/auth/users", payload),
  updateUser: (userId, payload = {}) =>
    put(`/auth/users/${encodeURIComponent(userId)}`, payload),
  deactivateUser: (userId) =>
    post(`/auth/users/${encodeURIComponent(userId)}/deactivate`, {}),
  deleteUser: (userId) => del(`/auth/users/${encodeURIComponent(userId)}`),
  userDetail: (userId) =>
    get(`/auth/users/${encodeURIComponent(userId)}/detail`),
  createUserAccount: (userId, payload = {}) =>
    post(`/auth/users/${encodeURIComponent(userId)}/accounts`, payload),
  updateUserAccount: (userId, accountId, payload = {}) =>
    put(
      `/auth/users/${encodeURIComponent(userId)}/accounts/${encodeURIComponent(accountId)}`,
      payload,
    ),
  deleteUserAccount: (userId, accountId) =>
    del(
      `/auth/users/${encodeURIComponent(userId)}/accounts/${encodeURIComponent(accountId)}`,
    ),
  v2Accounts: () => get("/v2/accounts"),
  v2CreateAccount: (payload = {}) => post("/v2/accounts", payload),
  v2UpdateAccount: (accountId, payload = {}) =>
    put(`/v2/accounts/${encodeURIComponent(accountId)}`, payload),
  v2ArchiveAccount: (accountId) =>
    del(`/v2/accounts/${encodeURIComponent(accountId)}`),
  v2Sources: () => get("/v2/sources"),
  v2Trades: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "")
        q.set(k, String(v));
    });
    return get(`/v2/trades?${q.toString()}`);
  },
  v2UpdateTrade: (tradeId, payload = {}) =>
    post(`/v2/trades/${encodeURIComponent(tradeId)}/update`, payload),
  v2TradesBulkAction: (action, filters = {}) =>
    post("/v2/trades/bulk-action", { action, ...filters }),
  v2TradeEvents: (tradeId, limit = 200) =>
    get(
      `/v2/trades/${encodeURIComponent(tradeId)}/events?limit=${encodeURIComponent(limit)}`,
    ),
  v2CreateSource: (payload = {}) => post("/v2/sources", payload),
  v2UpdateSource: (sourceId, payload = {}) =>
    put(`/v2/sources/${encodeURIComponent(sourceId)}`, payload),
  v2SourceEvents: (sourceId, limit = 100) =>
    get(
      `/v2/sources/${encodeURIComponent(sourceId)}/events?limit=${encodeURIComponent(limit)}`,
    ),
  v2RotateSourceSecret: (sourceId) =>
    post(`/v2/sources/${encodeURIComponent(sourceId)}/auth-secret/rotate`, {}),
  v2RevokeSourceSecret: (sourceId) =>
    post(`/v2/sources/${encodeURIComponent(sourceId)}/auth-secret/revoke`, {}),
  v2GetSubscriptions: (accountId) =>
    get(`/v2/accounts/${encodeURIComponent(accountId)}/subscriptions`),
  v2PutSubscriptions: (accountId, items = []) =>
    put(`/v2/accounts/${encodeURIComponent(accountId)}/subscriptions`, {
      items,
    }),
  v2RotateAccountApiKey: (accountId) =>
    post(`/v2/accounts/${encodeURIComponent(accountId)}/api-key/rotate`, {}),
  v2RevokeAccountApiKey: (accountId) =>
    post(`/v2/accounts/${encodeURIComponent(accountId)}/api-key/revoke`, {}),
  v2UpdateAccountApiKey: (accountId, plainApiKey) =>
    post(`/v2/broker/accounts/${encodeURIComponent(accountId)}/apiKey`, {
      api_key_plaintext: plainApiKey,
    }),
  v2ExecutionProfiles: () => get("/v2/settings/execution-profiles"),
  v2SaveExecutionProfile: (payload = {}) =>
    post("/v2/settings/execution-profile", payload),
  v2ApplyExecutionProfile: (payload = {}) =>
    post("/v2/settings/execution-profile/apply", payload),
  login: (email, password) => post("/auth/login", { email, password }),
  logout: () => post("/auth/logout", {}),
  changePassword: (currentPassword, newPassword) =>
    post("/auth/password", { currentPassword, newPassword }),
  health: () => get("/health"),
  dashboardAdvanced: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "")
        q.set(k, String(v));
    });
    return get(`/mt5/dashboard/advanced?${q.toString()}`);
  },
  dashboardSummary: (userId = "") =>
    get(
      `/mt5/dashboard/summary${userId ? `?user_id=${encodeURIComponent(userId)}` : ""}`,
    ),
  dashboardSeries: (period = "month", userId = "") =>
    get(
      `/mt5/dashboard/pnl-series?period=${encodeURIComponent(period)}${userId ? `&user_id=${encodeURIComponent(userId)}` : ""}`,
    ),
  symbols: (userId = "") =>
    get(
      `/mt5/filters/symbols${userId ? `?user_id=${encodeURIComponent(userId)}` : ""}`,
    ),
  filtersAdvanced: (userId = "") =>
    get(
      `/mt5/filters/advanced${userId ? `?user_id=${encodeURIComponent(userId)}` : ""}`,
    ),
  trades: (params) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "")
        q.set(k, String(v));
    });
    return get(`/v2/trades?${q.toString()}`);
  },
  trade: (signalId) => get(`/mt5/trades/${encodeURIComponent(signalId)}`),
  createTrade: (payload = {}) => post("/v2/trades/create", payload),
  createDraftTrade: (payload = {}) =>
    post("/v2/trades/create", { ...payload, execution_status: "Draft" }),
  promoteDraftTrade: (tradeId) =>
    post(`/v2/trades/${encodeURIComponent(tradeId)}/promote`),
  createTradeDirect: (payload = {}) => post("/v2/trades/create", payload),
  saveTradePlan: (tradeId, payload = {}) =>
    post(`/v2/trades/${encodeURIComponent(tradeId)}/trade-plan/save`, payload),
  uploadTradeFile: async (tradeId, file) => {
    const API_KEY = runtimeApiKey();
    const base = runtimeApiBase();
    const form = new FormData();
    form.append("file", file);
    const headers = {};
    const activeUserId = getRuntimeActiveUserId();
    if (API_KEY) headers["x-api-key"] = API_KEY;
    if (activeUserId) headers["x-active-user-id"] = activeUserId;
    const res = await fetch(
      `${base}/v2/trades/${encodeURIComponent(tradeId)}/files/upload`,
      { method: "POST", headers, body: form, credentials: "include" },
    );
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Upload failed - server returned non-JSON (${res.status}): ${text.slice(0, 100)}`,
      );
    }
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Upload failed (${res.status})`);
    }
    return data;
  },
  listTradeFiles: (tradeId) =>
    get(`/v2/trades/${encodeURIComponent(tradeId)}/files`),
  deleteTradeFile: (tradeId, fileName) =>
    del(
      `/v2/trades/${encodeURIComponent(tradeId)}/files/${encodeURIComponent(fileName)}`,
    ),
  saveChartObjects: (tradeId, objects = []) =>
    post(`/v2/trades/${encodeURIComponent(tradeId)}/chart-objects`, {
      objects,
    }),
  loadChartObjects: (tradeId) =>
    get(`/v2/trades/${encodeURIComponent(tradeId)}/chart-objects`),
  deleteTrades: (params) => post("/mt5/trades/delete", params),
  cancelTrades: (params) => post("/mt5/trades/cancel", params),
  renewTrades: (params) => post("/mt5/trades/renew", params),
  downloadBacktestCsv: (params) => downloadCsv("/csv", params),
  events: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "")
        q.set(k, String(v));
    });
    return get(`/mt5/api/events?${q.toString()}`);
  },
  createEvent: (payload = {}) => post("/mt5/api/events/create", payload),
  deleteEvents: () => post("/mt5/api/events/delete", {}),
  dbTables: () => get("/mt5/db/tables"),
  dbRows: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "")
        q.set(k, String(v));
    });
    return get(`/mt5/db/rows?${q.toString()}`);
  },
  dbCreateRow: (payload = {}) => post("/mt5/db/rows/create", payload),
  dbUpdateRow: (payload = {}) => post("/mt5/db/rows/update", payload),
  dbSchema: (table) => get(`/mt5/db/schema?table=${encodeURIComponent(table)}`),
  storageStats: () => get("/v2/system/storage/stats"),
  storageCleanup: (target, userId = "") =>
    post("/v2/system/storage/cleanup", { target, userId }),
  listCache: () => get("/v2/system/cache"),
  getCacheDetail: (key, source = "memory") =>
    get(
      `/v2/system/cache?key=${encodeURIComponent(key)}&source=${encodeURIComponent(source)}`,
    ),
  deleteCache: (key = "", source = "") =>
    del(
      `/v2/system/cache?key=${encodeURIComponent(key)}&source=${encodeURIComponent(source)}`,
    ),
  aiListTemplates: () => get("/v2/ai/templates"),
  aiUpsertTemplate: (payload = {}) => post("/v2/ai/templates", payload),
  aiDeleteTemplate: (templateId) =>
    del(`/v2/ai/templates/${encodeURIComponent(templateId)}`),
  aiGetConfig: () => get("/v2/ai/config"),
  aiUpsertConfig: (key, value) => post("/v2/ai/config", { key, value }),
  aiGenerate: (payload = {}) =>
    postWithTimeout("/v2/ai/generate", payload, 65000),
  chartSnapshotCreate: (payload = {}) =>
    postWithTimeout("/v2/chart/snapshot", payload, 90000),
  chartSnapshotCreateBatch: (payload = {}) =>
    postWithTimeout("/v2/chart/snapshot/batch", payload, 180000),
  chartRefresh: (payload = {}) =>
    postWithTimeout("/v2/chart/refresh", payload, 180000),
  chartSnapshotsAnalyze: (payload = {}) =>
    postWithTimeout("/v2/chart/snapshots/analyze", payload, 180000),
  claudeFiles: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "")
        q.set(k, String(v));
    });
    return get(`/v2/ai/claude/files${q.toString() ? `?${q.toString()}` : ""}`);
  },
  claudeFile: (fileId) =>
    get(`/v2/ai/claude/files/${encodeURIComponent(fileId)}`),
  claudeFileContent: (fileId, download = false) =>
    getBlob(
      `/v2/ai/claude/files/${encodeURIComponent(fileId)}/content${download ? "?download=1" : ""}`,
    ),
  claudeUploadSnapshots: (payload = {}) =>
    postWithTimeout("/v2/ai/claude/files/upload-snapshots", payload, 90000),
  claudeDeleteFiles: (payload = {}) =>
    post("/v2/ai/claude/files/delete", payload),
  chartTwelveCandles: (
    symbol = "",
    timeframe = "15m",
    bars = 300,
    refresh = false,
  ) =>
    get(
      `/v2/chart/twelve/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&bars=${encodeURIComponent(bars)}${refresh ? "&refresh=1" : ""}`,
    ),
  chartSymbols: (q = "", provider = "ICMARKETS", limit = 20) =>
    get(
      `/v2/chart/symbols?q=${encodeURIComponent(q)}&provider=${encodeURIComponent(provider)}&limit=${encodeURIComponent(limit)}`,
    ),
  chartSnapshots: (limit = 30) =>
    get(`/v2/chart/snapshots?limit=${encodeURIComponent(limit)}`),
  tradeSnapshots: (tradeSid) =>
    get(`/v2/trades/${encodeURIComponent(tradeSid)}/snapshots`),
  chartSnapshotsDelete: (payload = {}) =>
    post("/v2/chart/snapshots/delete", payload),
  getSettings: () => get("/v2/settings"),
  getSettingSecret: (type, name, field = "value") =>
    get(
      `/v2/settings/secret?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}&field=${encodeURIComponent(field)}`,
    ),
  upsertSetting: (payload = {}) => post("/v2/settings", payload),
  notificationPulse: () => get("/v2/notifications/pulse"),
  notificationStream: () => {
    // Returns an EventSource — caller manages lifecycle
    const base = runtimeApiBase();
    return new EventSource(`${base}/v2/notifications/stream`, {
      withCredentials: true,
    });
  },
  notificationEvents: () => get("/v2/notifications/events"),
  notificationSettings: () => get("/v2/notifications/settings"),
  notificationSaveSettings: (settings) =>
    post("/v2/notifications/settings", { settings }),
  notificationTest: (payload = {}) => post("/v2/notifications/test", payload),
  deleteSetting: (type, name) =>
    del(`/v2/settings/${encodeURIComponent(type)}/${encodeURIComponent(name)}`),
};
