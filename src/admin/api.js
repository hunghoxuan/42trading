import { NotificationFacade } from "./services/NotificationFacade";

const ENV_API_BASE = String(import.meta.env.VITE_API_BASE || "").trim();
const ENV_API_PROXY_TARGET = String(
  import.meta.env.VITE_API_PROXY_TARGET || "",
).trim();
const DEFAULT_REMOTE_BASE = ENV_API_BASE || "http://localhost";
const DEFAULT_API_KEY = import.meta.env.VITE_API_KEY || "";
const DEFAULT_API_TIMEOUT_MS = 180000;
const SLOW_API_DEBUG_STORAGE_KEY = "tvbridge_debug_api_slow";

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

  // On deployed server UI, always use same-origin API
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return origin;
  }

  // Local dev: use env API base if configured
  if (ENV_API_BASE) {
    const base = ENV_API_BASE.replace(/\/+$/, "");
    return base;
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
  const apiBaseStored = normalizeApiBase(
    localStorage.getItem("tvbridge_api_base"),
  );
  if (apiBaseStored) return apiBaseStored;
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

function shouldLogSlowApiRequests() {
  try {
    return localStorage.getItem(SLOW_API_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function applyRuntimeHeaders(headers = {}) {
  const API_KEY = runtimeApiKey();
  const activeUserId = getRuntimeActiveUserId();
  if (API_KEY) headers["x-api-key"] = API_KEY;
  if (activeUserId) headers["x-active-user-id"] = activeUserId;
  return headers;
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
  // Don't redirect on local dev — use API key auth
  if (import.meta.env.DEV && (ENV_API_BASE || ENV_API_PROXY_TARGET)) return;
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

function parseTimingNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildResponseTiming(res, data, clientDurationMs) {
  const payloadTiming =
    data && typeof data === "object" && data._timing && typeof data._timing === "object"
      ? data._timing
      : {};
  return {
    total_ms:
      parseTimingNumber(res.headers.get("x-timing-total")) ??
      parseTimingNumber(payloadTiming.total_ms) ??
      Math.max(0, Math.round(clientDurationMs)),
    db_ms:
      parseTimingNumber(res.headers.get("x-timing-db")) ??
      parseTimingNumber(payloadTiming.db_ms),
    trace_id:
      String(
        res.headers.get("x-trace-id") || payloadTiming.trace_id || "",
      ).trim() || null,
  };
}

function attachResponseMeta(data, meta, timing) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  return {
    ...data,
    _timing: {
      ...(data._timing && typeof data._timing === "object" ? data._timing : {}),
      ...timing,
    },
    _request: {
      method: meta.method,
      path: meta.path,
      status: meta.status,
      url: meta.url,
      duration_ms: meta.durationMs,
    },
  };
}

function emitApiRequestEvent(detail) {
  try {
    window.dispatchEvent(
      new CustomEvent("api-request-finished", {
        detail,
      }),
    );
  } catch {
    // ignore browser event issues
  }
}

function makeApiError(message, meta) {
  const error = new Error(message);
  error.apiRequest = meta;
  error.apiTiming = meta.timing || null;
  return error;
}

function recordApiError(meta, message) {
  try {
    NotificationFacade.record({
      type: "system_event",
      status: "error",
      createdAt: Date.now(),
      completedAt: Date.now(),
      durationMs: meta.durationMs,
      dbDurationMs: meta.timing?.db_ms ?? null,
      extra: `${meta.method} ${meta.path}`,
      error: message,
      data: {
        method: meta.method,
        path: meta.path,
        status: meta.status,
        url: meta.url,
        timing: meta.timing || null,
      },
    });
  } catch {
    // ignore notification persistence issues
  }
}

const API_ERROR_NOTIFICATION_TTL_MS = 60 * 1000;
const API_ERROR_NOTIFICATION_CACHE = new Map();
const API_GET_REQUEST_DEDUPE_WINDOW_MS = 1000;
const API_IN_FLIGHT_GET_REQUESTS = new Map();

function shouldRecordApiError(meta, message, notifyOnError = false) {
  if (notifyOnError !== true) return false;
  const key = `${meta.method}:${meta.path}:${meta.status}:${String(message || "").trim()}`;
  const now = Date.now();
  const lastAt = Number(API_ERROR_NOTIFICATION_CACHE.get(key) || 0);
  if (lastAt && now - lastAt < API_ERROR_NOTIFICATION_TTL_MS) {
    return false;
  }
  API_ERROR_NOTIFICATION_CACHE.set(key, now);
  return true;
}

function makeInFlightGetRequestKey(path, { method = "GET", body, cache } = {}) {
  if (method !== "GET" || body !== undefined) return "";
  return [
    runtimeApiBase(),
    method,
    path,
    cache || "",
    getRuntimeActiveUserId(),
  ].join("::");
}

async function requestJson(
  path,
  {
    method = "GET",
    body,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    headers = {},
    cache = undefined,
    notifyOnError = method !== "GET",
  } = {},
) {
  const dedupeKey = makeInFlightGetRequestKey(path, {
    method,
    body,
    cache,
  });
  if (dedupeKey && API_IN_FLIGHT_GET_REQUESTS.has(dedupeKey)) {
    return await API_IN_FLIGHT_GET_REQUESTS.get(dedupeKey);
  }

  const requestPromise = (async () => {
  const base = runtimeApiBase();
  const primaryUrl = buildUrl(base, path);
  const fallbackUrl = buildUrl(window.location.origin, path);
  const startedAt = Date.now();
  let finalUrl = primaryUrl;

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const reqHeaders = { ...headers };
      applyRuntimeHeaders(reqHeaders);
      const options = {
        method,
        signal: ctrl.signal,
        credentials: "include",
        headers: reqHeaders,
      };
      if (cache) options.cache = cache;
      if (body !== undefined) options.body = JSON.stringify(body || {});
      return await fetch(url, options);
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
    finalUrl = primaryUrl;
  } catch (primaryError) {
    if (primaryUrl !== fallbackUrl) {
      try {
        res = await doFetch(fallbackUrl);
        finalUrl = fallbackUrl;
      } catch {
        const meta = {
          method,
          path,
          status: 0,
          url: primaryUrl,
          durationMs: Math.max(0, Date.now() - startedAt),
          timing: null,
        };
        const wrapped = makeApiError(primaryError.message || String(primaryError), meta);
        if (shouldRecordApiError(meta, wrapped.message, notifyOnError)) {
          recordApiError(meta, wrapped.message);
        }
        emitApiRequestEvent({ ok: false, ...meta, error: wrapped.message });
        throw wrapped;
      }
    } else {
      const meta = {
        method,
        path,
        status: 0,
        url: primaryUrl,
        durationMs: Math.max(0, Date.now() - startedAt),
        timing: null,
      };
      const wrapped = makeApiError(primaryError.message || String(primaryError), meta);
      if (shouldRecordApiError(meta, wrapped.message, notifyOnError)) {
        recordApiError(meta, wrapped.message);
      }
      emitApiRequestEvent({ ok: false, ...meta, error: wrapped.message });
      throw wrapped;
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
    const meta = {
      method,
      path,
      status: res.status,
      url: finalUrl,
      durationMs: Math.max(0, Date.now() - startedAt),
      timing: null,
    };
    const wrapped = makeApiError(
      err.message.includes("Server returned non-JSON")
        ? err.message
        : `Failed to read response body (${res.status})`,
      meta,
    );
    if (shouldRecordApiError(meta, wrapped.message, notifyOnError)) {
      recordApiError(meta, wrapped.message);
    }
    emitApiRequestEvent({ ok: false, ...meta, error: wrapped.message });
    throw wrapped;
  }

  const durationMs = Math.max(0, Date.now() - startedAt);
  const timing = buildResponseTiming(res, data, durationMs);
  const meta = {
    method,
    path,
    status: res.status,
    url: finalUrl,
    durationMs: timing.total_ms ?? durationMs,
    timing,
  };
  const decorated = attachResponseMeta(data, meta, timing);

  emitApiRequestEvent({ ok: res.ok && decorated?.ok !== false, ...meta });
  if (
    (timing.total_ms ?? durationMs) >= 2000 &&
    shouldLogSlowApiRequests()
  ) {
    console.warn(
      `[API] slow ${method} ${path} total=${timing.total_ms}ms db=${timing.db_ms ?? "-"}`,
    );
  }

  if (!res.ok || !decorated.ok) {
    if (
      path !== "/auth/login" &&
      path !== "/auth/me" &&
      isAuthFailure(res.status, decorated)
    ) {
      redirectToLogin();
      const wrapped = makeApiError(
        "Session expired. Redirecting to login.",
        meta,
      );
      if (shouldRecordApiError(meta, wrapped.message, notifyOnError)) {
        recordApiError(meta, wrapped.message);
      }
      throw wrapped;
    }
    const wrapped = makeApiError(
      decorated.error || `Request failed: ${res.status}`,
      meta,
    );
    if (shouldRecordApiError(meta, wrapped.message, notifyOnError)) {
      recordApiError(meta, wrapped.message);
    }
    throw wrapped;
  }

  return decorated;
  })();

  if (!dedupeKey) {
    return await requestPromise;
  }

  API_IN_FLIGHT_GET_REQUESTS.set(dedupeKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    window.setTimeout(() => {
      if (API_IN_FLIGHT_GET_REQUESTS.get(dedupeKey) === requestPromise) {
        API_IN_FLIGHT_GET_REQUESTS.delete(dedupeKey);
      }
    }, API_GET_REQUEST_DEDUPE_WINDOW_MS);
  }
}

async function requestFormJson(
  path,
  formData,
  {
    method = "POST",
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    notifyOnError = true,
  } = {},
) {
  const base = runtimeApiBase();
  const primaryUrl = buildUrl(base, path);
  const fallbackUrl = buildUrl(window.location.origin, path);
  const startedAt = Date.now();
  let finalUrl = primaryUrl;

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = {};
      applyRuntimeHeaders(headers);
      return await fetch(url, {
        method,
        signal: ctrl.signal,
        headers,
        body: formData,
        credentials: "include",
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
      res = await doFetch(fallbackUrl);
      finalUrl = fallbackUrl;
    } else {
      const meta = {
        method,
        path,
        status: 0,
        url: primaryUrl,
        durationMs: Math.max(0, Date.now() - startedAt),
        timing: null,
      };
      const wrapped = makeApiError(primaryError.message || String(primaryError), meta);
      if (shouldRecordApiError(meta, wrapped.message, notifyOnError)) {
        recordApiError(meta, wrapped.message);
      }
      throw wrapped;
    }
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const meta = {
      method,
      path,
      status: res.status,
      url: finalUrl,
      durationMs: Math.max(0, Date.now() - startedAt),
      timing: null,
    };
    const wrapped = makeApiError(
      `Upload failed - server returned non-JSON (${res.status}): ${text.slice(0, 100)}`,
      meta,
    );
    if (shouldRecordApiError(meta, wrapped.message, notifyOnError)) {
      recordApiError(meta, wrapped.message);
    }
    throw wrapped;
  }

  const durationMs = Math.max(0, Date.now() - startedAt);
  const timing = buildResponseTiming(res, data, durationMs);
  const meta = {
    method,
    path,
    status: res.status,
    url: finalUrl,
    durationMs: timing.total_ms ?? durationMs,
    timing,
  };
  const decorated = attachResponseMeta(data, meta, timing);

  emitApiRequestEvent({ ok: res.ok && decorated?.ok !== false, ...meta });

  if (!res.ok || !decorated.ok) {
    const wrapped = makeApiError(
      decorated.error || `Upload failed (${res.status})`,
      meta,
    );
    if (shouldRecordApiError(meta, wrapped.message, notifyOnError)) {
      recordApiError(meta, wrapped.message);
    }
    throw wrapped;
  }
  return decorated;
}

async function get(path, options = {}) {
  return requestJson(path, {
    method: "GET",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    cache: "no-store",
    ...options,
  });
}

async function getBlob(path) {
  const base = runtimeApiBase();
  const primaryUrl = buildUrl(base, path);
  const fallbackUrl = buildUrl(window.location.origin, path);

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), DEFAULT_API_TIMEOUT_MS);
    const headers = { "Cache-Control": "no-cache", Pragma: "no-cache" };
    applyRuntimeHeaders(headers);
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
  return requestJson(path, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    cache: "no-store",
  });
}

async function postWithTimeout(
  path,
  body = {},
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
) {
  return requestJson(path, {
    method: "POST",
    body,
    timeoutMs,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    cache: "no-store",
  });
}

async function put(path, body = {}) {
  return requestJson(path, {
    method: "PUT",
    body,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function del(path) {
  return requestJson(path, {
    method: "DELETE",
  });
}

async function downloadCsv(path, params = {}) {
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
      const headers = {};
      applyRuntimeHeaders(headers);
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
  v2Accounts: (options = {}) => get("/api/accounts", options),
  v2CreateAccount: (payload = {}) => post("/api/accounts", payload),
  v2UpdateAccount: (accountId, payload = {}) =>
    put(`/api/accounts/${encodeURIComponent(accountId)}`, payload),
  v2ArchiveAccount: (accountId) =>
    del(`/api/accounts/${encodeURIComponent(accountId)}`),
  v2AccountBridgeReadiness: (accountId) =>
    post(`/api/accounts/${encodeURIComponent(accountId)}/bridge-readiness`, {}),
  v2Sources: (options = {}) => get("/api/sources", options),
  v2Trades: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "")
        q.set(k, String(v));
    });
    return get(`/api/trades?${q.toString()}`);
  },
  v2UpdateTrade: (tradeId, payload = {}) =>
    post(`/api/trades/${encodeURIComponent(tradeId)}/update`, payload),
  v2TradesBulkAction: (action, filters = {}) =>
    post("/api/trades/bulk-action", { action, ...filters }),
  v2TradeCounts: () => get("/api/trades/counts"),
  v2TradeEvents: (tradeId, limit = 200) =>
    get(
      `/api/trades/${encodeURIComponent(tradeId)}/events?limit=${encodeURIComponent(limit)}`,
    ),
  listTempTrades: () => get("/api/trades/temp"),
  listBacktests: () => get("/api/backtests"),
  runBacktest: (payload = {}) => post("/api/backtests/run", payload),
  getBacktest: (runId) => get(`/api/backtests/${encodeURIComponent(runId)}`),
  listStrategies: () => get("/api/strategies"),
  getStrategy: (strategyId) => get(`/api/strategies/${encodeURIComponent(strategyId)}`),
  saveStrategy: (payload = {}) => post("/api/strategies", payload),
  updateStrategy: (strategyId, payload = {}) =>
    put(`/api/strategies/${encodeURIComponent(strategyId)}`, payload),
  archiveStrategy: (strategyId) =>
    post(`/api/strategies/${encodeURIComponent(strategyId)}/archive`, {}),
  deleteStrategy: (strategyId) =>
    del(`/api/strategies/${encodeURIComponent(strategyId)}`),
  v2CreateSource: (payload = {}) => post("/api/sources", payload),
  v2UpdateSource: (sourceId, payload = {}) =>
    put(`/api/sources/${encodeURIComponent(sourceId)}`, payload),
  v2SourceEvents: (sourceId, limit = 100) =>
    get(
      `/api/sources/${encodeURIComponent(sourceId)}/events?limit=${encodeURIComponent(limit)}`,
    ),
  v2RotateSourceSecret: (sourceId) =>
    post(`/api/sources/${encodeURIComponent(sourceId)}/auth-secret/rotate`, {}),
  v2RevokeSourceSecret: (sourceId) =>
    post(`/api/sources/${encodeURIComponent(sourceId)}/auth-secret/revoke`, {}),
  v2GetSubscriptions: (accountId) =>
    get(`/api/accounts/${encodeURIComponent(accountId)}/subscriptions`),
  v2PutSubscriptions: (accountId, items = []) =>
    put(`/api/accounts/${encodeURIComponent(accountId)}/subscriptions`, {
      items,
    }),
  v2RotateAccountApiKey: (accountId) =>
    post(`/api/accounts/${encodeURIComponent(accountId)}/api-key/rotate`, {}),
  v2RevokeAccountApiKey: (accountId) =>
    post(`/api/accounts/${encodeURIComponent(accountId)}/api-key/revoke`, {}),
  v2UpdateAccountApiKey: (accountId, plainApiKey) =>
    post(`/api/broker/accounts/${encodeURIComponent(accountId)}/apiKey`, {
      api_key_plaintext: plainApiKey,
    }),
  v2ExecutionProfiles: () => get("/api/settings/execution-profiles"),
  v2SaveExecutionProfile: (payload = {}) =>
    post("/api/settings/execution-profile", payload),
  v2ApplyExecutionProfile: (payload = {}) =>
    post("/api/settings/execution-profile/apply", payload),
  login: (login, password) =>
    post("/auth/login", { email: login, username: login, login, password }),
  logout: () => post("/auth/logout", {}),
  changePassword: (currentPassword, newPassword) =>
    post("/auth/password", { currentPassword, newPassword }),
  health: () => get("/health"),
  healthActivity: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") {
        q.set(k, String(v));
      }
    });
    return get(`/api/health/activity?${q.toString()}`);
  },
  healthSymbolActivity: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") {
        q.set(k, String(v));
      }
    });
    return get(`/api/health/symbol-activity?${q.toString()}`);
  },
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
    return get(`/api/trades?${q.toString()}`);
  },
  trade: (signalId) => get(`/mt5/trades/${encodeURIComponent(signalId)}`),
  createTrade: (payload = {}) => post("/api/trades/create", payload),
  createDraftTrade: (payload = {}) =>
    post("/api/trades/create", { ...payload, execution_status: "Draft" }),
  promoteDraftTrade: (tradeId) =>
    post(`/api/trades/${encodeURIComponent(tradeId)}/promote`),
  createTradeDirect: (payload = {}) => post("/api/trades/create", payload),
  saveTradePlan: (tradeId, payload = {}) =>
    post(`/api/trades/${encodeURIComponent(tradeId)}/trade-plan/save`, payload),
  uploadTradeDraftFile: async (tradeId, file) => {
    const form = new FormData();
    form.append("file", file);
    return requestFormJson(
      `/api/trades/${encodeURIComponent(tradeId)}/files/upload`,
      form,
      {
        method: "POST",
      },
    );
  },
  uploadTradeFile: async (tradeId, file) => {
    const form = new FormData();
    form.append("file", file);
    return requestFormJson(
      `/api/trades/${encodeURIComponent(tradeId)}/files/upload`,
      form,
      {
        method: "POST",
      },
    );
  },
  listTradeDraftFiles: (tradeId) =>
    get(`/api/trades/${encodeURIComponent(tradeId)}/files`),
  deleteTradeDraftFile: (tradeId, fileName) =>
    del(
      `/api/trades/${encodeURIComponent(tradeId)}/files/${encodeURIComponent(fileName)}`,
    ),
  listTradeFiles: (tradeId) =>
    get(`/api/trades/${encodeURIComponent(tradeId)}/files`),
  deleteTradeFile: (tradeId, fileName) =>
    del(
      `/api/trades/${encodeURIComponent(tradeId)}/files/${encodeURIComponent(fileName)}`,
    ),
  saveChartObjects: (tradeId, objects = []) =>
    post(`/api/trades/${encodeURIComponent(tradeId)}/chart-objects`, {
      objects,
    }),
  loadChartObjects: (tradeId) =>
    get(`/api/trades/${encodeURIComponent(tradeId)}/chart-objects`),
  saveChartArtifacts: (tradeId, payload = {}) =>
    post(`/api/trades/${encodeURIComponent(tradeId)}/chart-artifacts`, payload),
  loadChartArtifacts: (tradeId, tf = "") =>
    get(
      `/api/trades/${encodeURIComponent(tradeId)}/chart-artifacts${String(tf || "").trim() ? `?tf=${encodeURIComponent(tf)}` : ""}`,
    ),
  loadMarketChartArtifacts: (
    symbol,
    tf = "",
    startTime = null,
    endTime = null,
  ) =>
    get(
      `/api/chart/artifacts?symbol=${encodeURIComponent(symbol)}${String(tf || "").trim() ? `&tf=${encodeURIComponent(tf)}` : ""}${Number.isFinite(Number(startTime)) ? `&start_time=${encodeURIComponent(Number(startTime))}` : ""}${Number.isFinite(Number(endTime)) ? `&end_time=${encodeURIComponent(Number(endTime))}` : ""}`,
    ),
  refreshMarketChartArtifacts: (payload = {}) =>
    post("/api/chart/artifacts/refresh", payload),
  loadMarketDataUiConfig: (symbol) =>
    get(`/api/market-data/ui-config?symbol=${encodeURIComponent(symbol)}`),
  saveMarketDataUiConfig: (symbol, config = {}) =>
    post("/api/market-data/ui-config", { symbol, config }),
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
  systemSources: () => get("/api/system/sources"),
  systemLogFile: (source, id, file, limit = 200) =>
    get(
      `/api/system/logs/file?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}&limit=${limit}`,
    ),
  storageStats: () => get("/api/system/storage/stats"),
  storageCleanup: (target, userId = "") =>
    post("/api/system/storage/cleanup", { target, userId }),
  listCache: () => get("/api/system/cache"),
  getCacheDetail: (key, source = "memory") =>
    get(
      `/api/system/cache?key=${encodeURIComponent(key)}&source=${encodeURIComponent(source)}`,
    ),
  deleteCache: (key = "", source = "") =>
    del(
      `/api/system/cache?key=${encodeURIComponent(key)}&source=${encodeURIComponent(source)}`,
    ),
  aiListTemplates: () => get("/api/ai/templates"),
  aiUpsertTemplate: (payload = {}) => post("/api/ai/templates", payload),
  aiDeleteTemplate: (templateId) =>
    del(`/api/ai/templates/${encodeURIComponent(templateId)}`),
  aiGetConfig: () => get("/api/ai/config"),
  aiUpsertConfig: (key, value) => post("/api/ai/config", { key, value }),
  aiGenerate: (payload = {}) =>
    postWithTimeout("/api/ai/generate", payload, 65000),
  aiChat: (payload = {}) => postWithTimeout("/api/ai/chat", payload, 300000),
  aiChatConversations: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "")
        q.set(k, String(v));
    });
    return get(
      `/api/ai/chat/conversations${q.toString() ? `?${q.toString()}` : ""}`,
    );
  },
  aiChatConversation: (conversationId) =>
    get(`/api/ai/chat/conversations/${encodeURIComponent(conversationId)}`),
  aiChatCodexControl: (payload = {}) =>
    post("/api/ai/chat/codex/control", payload),
  chartSnapshotCreate: (payload = {}) =>
    postWithTimeout("/api/chart/snapshot", payload, 90000),
  chartSnapshotCreateBatch: (payload = {}) =>
    postWithTimeout("/api/chart/snapshot/batch", payload, 180000),
  chartRefresh: (payload = {}) =>
    postWithTimeout("/api/chart/refresh", payload, 180000),
  chartSnapshotsAnalyze: (payload = {}) =>
    postWithTimeout("/api/chart/snapshots/analyze", payload, 180000),
  claudeFiles: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "")
        q.set(k, String(v));
    });
    return get(`/api/ai/claude/files${q.toString() ? `?${q.toString()}` : ""}`);
  },
  claudeFile: (fileId) =>
    get(`/api/ai/claude/files/${encodeURIComponent(fileId)}`),
  claudeFileContent: (fileId, download = false) =>
    getBlob(
      `/api/ai/claude/files/${encodeURIComponent(fileId)}/content${download ? "?download=1" : ""}`,
    ),
  claudeUploadSnapshots: (payload = {}) =>
    postWithTimeout("/api/ai/claude/files/upload-snapshots", payload, 90000),
  claudeDeleteFiles: (payload = {}) =>
    post("/api/ai/claude/files/delete", payload),
  chartCandles: (
    symbol = "",
    timeframe = "1m",
    bars = 1000,
    refresh = false,
    tradeSid = "",
    direction = "latest",
  ) => {
    const symbolParam = Array.isArray(symbol)
      ? symbol.map((value) => String(value || "").trim()).filter(Boolean).join(",")
      : String(symbol || "");
    return (
    get(
      `/api/chart/candles?symbol=${encodeURIComponent(symbolParam)}&timeframe=${encodeURIComponent(timeframe)}&bars=${encodeURIComponent(bars)}${refresh ? "&force=1" : ""}&direction=${encodeURIComponent(direction || "latest")}${String(tradeSid || "").trim() ? `&trade_sid=${encodeURIComponent(tradeSid)}` : ""}`,
    )
    );
  },
  chartSymbols: (q = "", provider = "ICMARKETS", limit = 20) =>
    get(
      `/api/chart/symbols?q=${encodeURIComponent(q)}&provider=${encodeURIComponent(provider)}&limit=${encodeURIComponent(limit)}`,
    ),
  chartSnapshots: (limit = 30) =>
    get(`/api/chart/snapshots?limit=${encodeURIComponent(limit)}`),
  tradeSnapshots: (tradeSid) =>
    get(`/api/trades/${encodeURIComponent(tradeSid)}/snapshots`),
  chartSnapshotsDelete: (payload = {}) =>
    post("/api/chart/snapshots/delete", payload),
  marketDataSnapshots: (symbol, limit = 5) =>
    get(
      `/api/market-data/snapshots/${encodeURIComponent(symbol)}?limit=${encodeURIComponent(limit)}`,
    ),
  marketDataFix: (payload = {}) =>
    post("/api/market-data/fix", payload),
  brokerBars: (symbol, tf, limit = 300, endTimeSec = null) =>
    get(
      `/api/market-data/broker-bars?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&limit=${encodeURIComponent(limit)}${Number.isFinite(Number(endTimeSec)) ? `&end_time_unix=${encodeURIComponent(Number(endTimeSec))}` : ""}`,
    ),
  realtimeChartBootstrap: (
    symbol = "",
    timeframe = "5m",
    bars = 300,
    endTimeSec = null,
  ) =>
    get(
      `/api/realtime/chart/bootstrap?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&bars=${encodeURIComponent(bars)}${Number.isFinite(Number(endTimeSec)) ? `&end_time_unix=${encodeURIComponent(Number(endTimeSec))}` : ""}`,
    ),
  createReplaySession: (payload = {}) =>
    post("/api/realtime/replay/session", payload),
  getReplaySession: (sessionId) =>
    get(`/api/realtime/replay/session/${encodeURIComponent(sessionId)}`),
  controlReplaySession: (sessionId, payload = {}) =>
    post(`/api/realtime/replay/session/${encodeURIComponent(sessionId)}/control`, payload),
  deleteReplaySession: (sessionId) =>
    del(`/api/realtime/replay/session/${encodeURIComponent(sessionId)}`),
  realtimeStreamUrl: (topic = "", options = {}) => {
    const base = runtimeApiBase();
    const params = new URLSearchParams();
    params.set("topic", String(topic || "").trim());
    const apiKey = runtimeApiKey();
    if (apiKey) {
      params.set("key", apiKey);
    }
    if (Number.isFinite(Number(options?.bars))) {
      params.set("bars", String(Number(options.bars)));
    }
    if (Number.isFinite(Number(options?.pollMs))) {
      params.set("poll_ms", String(Number(options.pollMs)));
    }
    if (Number.isFinite(Number(options?.endTimeSec))) {
      params.set("end_time_unix", String(Number(options.endTimeSec)));
    }
    return `${base}/api/realtime/stream?${params.toString()}`;
  },
  getSettings: () => get("/api/settings"),
  getSettingSecret: (type, name, field = "value") =>
    get(
      `/api/settings/secret?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}&field=${encodeURIComponent(field)}`,
    ),
  getAccountSecret: (accountId, field = "broker_password") =>
    get(
      `/api/accounts/${encodeURIComponent(accountId)}/secret?field=${encodeURIComponent(field)}`,
    ),
  upsertSetting: (payload = {}) => post("/api/settings", payload),
  notificationPulse: () => get("/api/notifications/pulse"),
  notificationStream: () => {
    // Returns an EventSource — caller manages lifecycle
    const base = runtimeApiBase();
    return new EventSource(`${base}/api/notifications/stream`, {
      withCredentials: true,
    });
  },
  notificationEvents: () => get("/api/notifications/events"),
  notificationSettings: () => get("/api/notifications/settings"),
  notificationSaveSettings: (settings) =>
    post("/api/notifications/settings", { settings }),
  notificationTest: (payload = {}) => post("/api/notifications/test", payload),
  notificationList: (limit = 100) =>
    get(`/api/notifications/list?limit=${encodeURIComponent(limit)}`),
  notificationClear: () => post("/api/notifications/clear", {}),
  runCron: (name) => post("/api/cron/run", { name }),
  calendarToday: () => get("/api/calendar/today"),
  calendarWeek: () => get("/api/calendar/week"),
  dynamicSymbolGroup: () => get("/api/symbol-groups/dynamic"),
  deleteSetting: (type, name) =>
    del(`/api/settings/${encodeURIComponent(type)}/${encodeURIComponent(name)}`),
};
