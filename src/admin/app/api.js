import { NotificationFacade } from "../modules/42trade/services/NotificationFacade";
import { formatNonJsonApiResponseError } from "../shared/utils/apiErrors.js";
import * as authPolicy from "../shared/utils/authPolicy.js";
import {
  normalizeActivityResult,
  resultStatusToToastType,
} from "../shared/utils/activityResult.js";

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
    const normalizedPath =
      String(u.pathname || "").trim() && u.pathname !== "/"
        ? u.pathname.replace(/\/+$/, "")
        : "";
    return `${u.origin}${normalizedPath}`;
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

function runtimeRealtimeSocketBase() {
  const base = runtimeApiBase();
  const normalizedProxyTarget = normalizeApiBase(
    ENV_API_PROXY_TARGET || "http://127.0.0.1:3001",
  );
  if (!import.meta.env.DEV) return base;
  try {
    const resolved = new URL(base);
    if (resolved.hostname === "localhost") {
      return normalizedProxyTarget || base.replace("://localhost", "://127.0.0.1");
    }
  } catch {}
  return base;
}

function runtimeDirectDevApiBase() {
  if (!import.meta.env.DEV) return "";
  const { hostname, protocol } = window.location;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") return "";
  const configuredTarget = normalizeApiBase(
    ENV_API_PROXY_TARGET || "http://127.0.0.1:3001",
  );
  if (configuredTarget) {
    try {
      const targetUrl = new URL(configuredTarget);
      const loopbackTarget =
        targetUrl.hostname === "localhost" ||
        targetUrl.hostname === "127.0.0.1";
      if (loopbackTarget) {
        const normalizedPath =
          String(targetUrl.pathname || "").trim() && targetUrl.pathname !== "/"
            ? targetUrl.pathname.replace(/\/+$/, "")
            : "";
        return `${protocol}//${hostname}:${targetUrl.port || "3001"}${normalizedPath}`;
      }
      return configuredTarget;
    } catch {}
  }
  return `${protocol}//${hostname}:3001`;
}

function shouldRetryAbortedProxyResponse(path, res, data, attemptedUrl, retryUrl) {
  if (!import.meta.env.DEV) return false;
  if (!String(path || "").startsWith("/api/")) return false;
  if (!retryUrl || retryUrl === attemptedUrl) return false;
  if (Number(res?.status || 0) < 500) return false;
  const message = String(data?.error || "").trim().toLowerCase();
  return message.includes("operation was aborted");
}

function shouldRetryDevProxyStatus(path, res, attemptedUrl, retryUrl) {
  if (!import.meta.env.DEV) return false;
  if (!String(path || "").startsWith("/api/")) return false;
  if (!retryUrl || retryUrl === attemptedUrl) return false;
  return Number(res?.status || 0) === 404;
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

export function getRuntimeDirectDevApiBase() {
  return runtimeDirectDevApiBase();
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
  const err = String(data?.error || "").toLowerCase();
  if (status === 401) return true;
  if (status === 403) {
    if (data?.permission_denied === true) return false;
    return (
      err.includes("auth_required") ||
      err.includes("unauthorized") ||
      err.includes("session") ||
      err.includes("login required")
    );
  }
  return (
    err.includes("unauthorized") ||
    err.includes("auth_required") ||
    err.includes("session") ||
    err.includes("login required")
  );
}

function redirectToLogin() {
  if (
    !authPolicy.shouldRedirectToLoginOnAuthFailure({
      isDev: import.meta.env.DEV,
      envApiBase: ENV_API_BASE,
      envApiProxyTarget: ENV_API_PROXY_TARGET,
    })
  )
    return;
  try {
    window.dispatchEvent(new CustomEvent(authPolicy.AUTH_REQUIRED_EVENT));
  } catch {
    // ignore dispatch failures
  }
  try {
    localStorage.removeItem("tvbridge_api_key");
  } catch {
    // ignore
  }
  if (window.location.pathname.endsWith("/login")) return;
  try {
    sessionStorage.setItem(
      "tvbridge_pending_return_url",
      `${window.location.pathname}${window.location.search}${window.location.hash || ""}`,
    );
  } catch {
    // ignore
  }
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
  const result = normalizeActivityResult(data, { ok: data?.ok !== false });
  return {
    ...data,
    result,
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

function dispatchApiResponseNotification(data, meta) {
  const notification =
    data && typeof data === "object" && data.notification && typeof data.notification === "object"
      ? data.notification
      : null;
  if (!notification) return;
  try {
    const result = normalizeActivityResult(data, { ok: data?.ok !== false });
    const detail = {
      ...notification,
      result,
      type:
        notification.type ||
        resultStatusToToastType(result.status),
      status: notification.status || result.status,
      message: String(notification.message || result.message || "").trim(),
      data:
        notification.data && typeof notification.data === "object"
          ? {
              ...notification.data,
              result,
              _request: meta,
            }
          : {
              result,
              _request: meta,
            },
    };
    window.dispatchEvent(
      new CustomEvent("server-notification", {
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
      result: normalizeActivityResult(
        {
          ok: false,
          message,
          errors: [{ code: "api_error", message }],
        },
        { ok: false },
      ),
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
const API_UNSUPPORTED_PATHS = new Set();

function isApiPathUnsupported(path = "") {
  return API_UNSUPPORTED_PATHS.has(String(path || "").trim());
}

function markApiPathUnsupported(path = "") {
  const key = String(path || "").trim();
  if (!key) return;
  API_UNSUPPORTED_PATHS.add(key);
}

function getOptionalApiPathAlternatives(path = "") {
  const normalized = String(path || "").trim();
  if (!normalized) return [];
  const variants = [normalized];
  if (normalized.startsWith("/api/")) {
    variants.push(`/v2/${normalized.slice(5)}`);
  } else if (normalized.startsWith("/v2/")) {
    variants.push(`/api/${normalized.slice(4)}`);
  }
  return [...new Set(variants)];
}

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
  const directDevBase = runtimeDirectDevApiBase();
  const directDevUrl = directDevBase ? buildUrl(directDevBase, path) : "";
  const startedAt = Date.now();
  let finalUrl = primaryUrl;

  async function doFetch(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const reqHeaders = { ...headers };
      applyRuntimeHeaders(reqHeaders);
      const isFormDataBody = typeof FormData !== "undefined" && body instanceof FormData;
      if (isFormDataBody) {
        delete reqHeaders["Content-Type"];
      }
      const options = {
        method,
        signal: ctrl.signal,
        credentials: "include",
        headers: reqHeaders,
      };
      if (cache) options.cache = cache;
      if (body !== undefined) {
        options.body = isFormDataBody ? body : JSON.stringify(body || {});
      }
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

  if (shouldRetryDevProxyStatus(path, res, finalUrl, directDevUrl)) {
    res = await doFetch(directDevUrl);
    finalUrl = directDevUrl;
  }

  let data;
  async function readJsonResponse(response, responseUrl) {
    try {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(
          formatNonJsonApiResponseError({
            path,
            status: response.status,
            text,
            isDev: import.meta.env.DEV,
          }),
        );
      }
    } catch (err) {
      const meta = {
        method,
        path,
        status: response.status,
        url: responseUrl,
        durationMs: Math.max(0, Date.now() - startedAt),
        timing: null,
      };
      const wrapped = makeApiError(
        err.message.includes("Server returned non-JSON")
          ? err.message
          : `Failed to read response body (${response.status})`,
        meta,
      );
      if (shouldRecordApiError(meta, wrapped.message, notifyOnError)) {
        recordApiError(meta, wrapped.message);
      }
      emitApiRequestEvent({ ok: false, ...meta, error: wrapped.message });
      throw wrapped;
    }
  }

  data = await readJsonResponse(res, finalUrl);
  if (shouldRetryAbortedProxyResponse(path, res, data, finalUrl, directDevUrl)) {
    res = await doFetch(directDevUrl);
    finalUrl = directDevUrl;
    data = await readJsonResponse(res, finalUrl);
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

  dispatchApiResponseNotification(decorated, meta);

  if (!res.ok || !decorated.ok) {
    if (
      authPolicy.shouldHandleAuthFailureWithGlobalRedirect(path) &&
      path !== "/auth/login" &&
      isAuthFailure(res.status, decorated)
    ) {
      redirectToLogin();
      const wrapped = makeApiError(
        "Session expired. Redirecting to login.",
        meta,
      );
      wrapped.apiResponse = decorated;
      wrapped.authRedirect = true;
      if (shouldRecordApiError(meta, wrapped.message, notifyOnError)) {
        recordApiError(meta, wrapped.message);
      }
      throw wrapped;
    }
    const wrapped = makeApiError(
      decorated.error || `Request failed: ${res.status}`,
      meta,
    );
    wrapped.apiResponse = decorated;
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
  dispatchApiResponseNotification(decorated, meta);

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
    if (
      authPolicy.shouldHandleAuthFailureWithGlobalRedirect(path) &&
      isAuthFailure(res.status, data)
    ) {
      redirectToLogin();
      const error = new Error("Session expired. Redirecting to login.");
      error.authRedirect = true;
      throw error;
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

async function postOptional(path, body = {}) {
  const candidates = getOptionalApiPathAlternatives(path).filter(
    (candidate) => !isApiPathUnsupported(candidate),
  );
  if (!candidates.length) {
    const error = new Error("API endpoint unavailable");
    error.unsupportedApiPath = true;
    throw error;
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await post(candidate, body);
    } catch (error) {
      lastError = error;
      const status = Number(error?.apiRequest?.status || 0);
      if (status === 404) {
        markApiPathUnsupported(candidate);
        error.unsupportedApiPath = true;
        continue;
      }
      throw error;
    }
  }

  if (lastError) throw lastError;
  const error = new Error("API endpoint unavailable");
  error.unsupportedApiPath = true;
  throw error;
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

async function del(path, body = undefined) {
  return requestJson(path, {
    method: "DELETE",
    body,
    headers:
      body === undefined
        ? undefined
        : {
            "Content-Type": "application/json",
          },
  });
}

function buildQueryString(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") {
      q.set(k, String(v));
    }
  });
  return q.toString();
}

function buildV2TradePath(tradeId = "", suffix = "", options = {}) {
  const id = encodeURIComponent(String(tradeId || "").trim());
  const tail = String(suffix || "");
  const scope = String(options?.scope || options?.module || "")
    .trim()
    .toLowerCase();
  const base =
    scope === "trades0"
      ? "/api/trades0"
      : "/api/trades";
  return `${base}/${id}${tail}`;
}

function normalizeV2TradeSnapshotResponse(tradeSid, response = {}, options = {}) {
  const basePath = buildV2TradePath(tradeSid, "/snapshots", options);
  const items = (Array.isArray(response?.items) ? response.items : Array.isArray(response?.files) ? response.files : [])
    .map((item) => {
      const fileName = String(item?.file_name || item?.name || "").trim();
      if (!fileName) return item;
      return {
        ...item,
        url: `${basePath}/${encodeURIComponent(fileName)}/content`,
      };
    });
  return {
    ...(response || {}),
    items,
    files: items,
  };
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
    if (
      authPolicy.shouldHandleAuthFailureWithGlobalRedirect(path) &&
      path !== "/auth/login" &&
      isAuthFailure(res.status, {})
    ) {
      redirectToLogin();
      const error = new Error("Session expired. Redirecting to login.");
      error.authRedirect = true;
      throw error;
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
  universalEntities: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/api/v2/universal-store/entities${q.size ? `?${q.toString()}` : ""}`);
  },
  universalEntity: (tenantId, entityType, entityKey, params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(
      `/api/v2/universal-store/entities/${encodeURIComponent(tenantId)}/${encodeURIComponent(entityType)}/${encodeURIComponent(entityKey)}${q.size ? `?${q.toString()}` : ""}`,
    );
  },
  universalUpsertEntity: (payload = {}) => post("/api/v2/universal-store/entities", payload),
  universalUpdateEntity: (tenantId, entityType, entityKey, payload = {}) =>
    put(
      `/api/v2/universal-store/entities/${encodeURIComponent(tenantId)}/${encodeURIComponent(entityType)}/${encodeURIComponent(entityKey)}`,
      payload,
    ),
  universalDeleteEntity: (tenantId, entityType, entityKey, params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return del(
      `/api/v2/universal-store/entities/${encodeURIComponent(tenantId)}/${encodeURIComponent(entityType)}/${encodeURIComponent(entityKey)}${q.size ? `?${q.toString()}` : ""}`,
    );
  },
  universalLinks: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/api/v2/universal-store/links${q.size ? `?${q.toString()}` : ""}`);
  },
  universalUpsertLink: (payload = {}) => post("/api/v2/universal-store/links", payload),
  universalDeleteLink: (id) =>
    del(`/api/v2/universal-store/links/${encodeURIComponent(id)}`),
  universalUserLinks: (userId, params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/api/v2/universal-store/users/${encodeURIComponent(userId)}/links${q.size ? `?${q.toString()}` : ""}`);
  },
  universalJournal: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/api/v2/universal-store/journal${q.size ? `?${q.toString()}` : ""}`);
  },
  universalAppendJournal: (payload = {}) => post("/api/v2/universal-store/journal", payload),
  universalUserJournal: (userId, params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/api/v2/universal-store/users/${encodeURIComponent(userId)}/journal${q.size ? `?${q.toString()}` : ""}`);
  },
  universalProcesses: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/api/v2/universal-store/processes${q.size ? `?${q.toString()}` : ""}`);
  },
  universalUpsertProcess: (payload = {}) => post("/api/v2/universal-store/processes", payload),
  pay42Dashboard: () => get("/api/42pay/dashboard"),
  pay42Products: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/api/42pay/products${q.size ? `?${q.toString()}` : ""}`);
  },
  pay42CreateProduct: (payload = {}) => post("/api/42pay/products", payload),
  pay42UpdateProduct: (sid, payload = {}) =>
    put(`/api/42pay/products/${encodeURIComponent(sid)}`, payload),
  pay42Offers: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/api/42pay/offers${q.size ? `?${q.toString()}` : ""}`);
  },
  pay42CreateOffer: (payload = {}) => post("/api/42pay/offers", payload),
  pay42UpdateOffer: (sid, payload = {}) =>
    put(`/api/42pay/offers/${encodeURIComponent(sid)}`, payload),
  pay42Orders: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/api/42pay/orders${q.size ? `?${q.toString()}` : ""}`);
  },
  pay42Wallet: () => get("/api/42pay/wallet"),
  pay42WalletTopups: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/api/42pay/wallet/topups${q.size ? `?${q.toString()}` : ""}`);
  },
  pay42TopupWallet: (payload = {}) => post("/api/42pay/wallet/topups", payload),
  pay42CreateOrder: (payload = {}) => post("/api/42pay/orders", payload),
  pay42PreviewQrCode: (payload = {}) => post("/api/42pay/scan/preview", payload),
  pay42ScanQrCode: (payload = {}) => post("/api/42pay/scan", payload),
  pay42AdminUsers: () => get("/api/42pay/admin/users"),
  authMe: () => get("/auth/me?hydrate=0"),
  authMeHydrated: () => get("/auth/me?hydrate=1"),
  authProfile: () => get("/auth/profile"),
  updateAuthProfile: (name, email) => put("/auth/profile", { name, email }),
  updateMetadata: (payload = {}) => put("/auth/metadata", payload),
  listUserSelectOptions: () => get("/auth/users/select"),
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
  v2Trades: (params = {}) => get(`/api/trades?${buildQueryString(params)}`),
  v2Trades2Counts: () => get("/api/trades/counts"),
  v2Trades2: (params = {}) =>
    get(`/api/trades?${buildQueryString(params)}`),
  v2TradesGet: (tradeId, params = {}) =>
    get(`/api/trades/${encodeURIComponent(tradeId)}?${buildQueryString(params)}`),
  v2CreateTrade: (payload = {}) => post("/api/trades", payload),
  v2UpdateTrade: (tradeId, payload = {}) =>
    put(`/api/trades/${encodeURIComponent(tradeId)}`, payload),
  v2TradesBulkAction: (action, filters = {}) =>
    post("/v2/trades/bulk-action", { action, ...filters }),
  v2TradeCounts: () => get("/api/trades/counts"),
  v2TradesCounts: () => get("/api/trades/counts"),
  v2TradeEvents: async (tradeId, limit = 200, options = {}) => {
    try {
      return await get(
        `${buildV2TradePath(tradeId, `/events?limit=${encodeURIComponent(limit)}`, options)}`,
      );
    } catch {
      return { ok: true, items: [] };
    }
  },
  listTempTrades: () => get("/api/trades0/temp"),
  listBacktests: () => get("/api/backtests"),
  runBacktest: (payload = {}) => post("/api/backtests/run", payload),
  runBacktestBatch: (payload = {}) => post("/api/backtests/run-batch", payload),
  saveBacktest: (payload = {}) => post("/api/backtests/save", payload),
  getBacktest: (runId) => get(`/api/backtests/${encodeURIComponent(runId)}`),
  deleteBacktest: (runId) => del(`/api/backtests/${encodeURIComponent(runId)}`),
  listRules: () => get("/api/rules"),
  saveRule: (payload = {}) => post("/api/rules", payload),
  listStrategies: () => get("/api/strategies"),
  listAvailableStrategies: () => get("/api/strategies"),
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
  health: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
    });
    return get(`/health${q.size ? `?${q.toString()}` : ""}`);
  },
  healthVerbose: () => get("/health?verbose=1"),
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
  tradesDashboard: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") {
        q.set(k, String(v));
      }
    });
    return get(`/api/trades/dashboard?${q.toString()}`);
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
  brokerSymbolMetadata: (params = {}) => {
    const symbol = String(params?.symbol || "").trim();
    const query = buildQueryString({
      provider: params?.provider,
      account_id: params?.account_id || params?.accountId,
    });
    const path = symbol
      ? `/api/broker/symbol-metadata/${encodeURIComponent(symbol)}`
      : "/api/broker/symbol-metadata";
    return get(query ? `${path}?${query}` : path);
  },
  brokerSymbolMetadataCalibrate: (payload = {}) =>
    post("/api/broker/symbol-metadata/calibrate", payload),
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
  trade: (tradeId) => get(`/mt5/trades/${encodeURIComponent(tradeId)}`),
  createTrade: (payload = {}) => post("/api/trades0/create", payload),
  createDraftTrade: (payload = {}) =>
    post("/api/trades0/create", { ...payload, execution_status: "Draft" }),
  promoteDraftTrade: (tradeId) =>
    post(buildV2TradePath(tradeId, "/promote")),
  createTradeDirect: (payload = {}) => post("/api/trades0/create", payload),
  saveTradePlan: (tradeId, payload = {}) =>
    post(buildV2TradePath(tradeId, "/trade-plan/save"), payload),
  uploadTradeDraftFile: async (tradeId, file, options = {}) => {
    const form = new FormData();
    form.append("file", file);
    return requestFormJson(
      buildV2TradePath(tradeId, "/files/upload", options),
      form,
      {
        method: "POST",
      },
    );
  },
  uploadTradeFile: async (tradeId, file, options = {}) => {
    const form = new FormData();
    form.append("file", file);
    return requestFormJson(
      buildV2TradePath(tradeId, "/files/upload", options),
      form,
      {
        method: "POST",
      },
    );
  },
  listTradeDraftFiles: (tradeId, options = {}) =>
    get(buildV2TradePath(tradeId, "/files", options)),
  deleteTradeDraftFile: (tradeId, fileName, options = {}) =>
    del(
      buildV2TradePath(tradeId, `/files/${encodeURIComponent(fileName)}`, options),
    ),
  listTradeFiles: (tradeId, options = {}) =>
    get(buildV2TradePath(tradeId, "/files", options)),
  deleteTradeFile: (tradeId, fileName, options = {}) =>
    del(
      buildV2TradePath(tradeId, `/files/${encodeURIComponent(fileName)}`, options),
    ),
  saveChartObjects: (tradeId, objects = [], options = {}) =>
    post(buildV2TradePath(tradeId, "/chart-objects", options), {
      objects,
    }),
  loadChartObjects: (tradeId, options = {}) =>
    get(buildV2TradePath(tradeId, "/chart-objects", options)),
  saveChartArtifacts: (tradeId, payload = {}) =>
    post(buildV2TradePath(tradeId, "/chart-artifacts"), payload),
  loadChartArtifacts: (tradeId, tf = "") =>
    get(
      `${buildV2TradePath(tradeId, "/chart-artifacts")}${String(tf || "").trim() ? `?tf=${encodeURIComponent(tf)}` : ""}`,
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
  systemBrowserTree: (scope = "files", userId = "", showFiles = false) => {
    const q = new URLSearchParams({ scope: String(scope || "files") });
    if (userId) q.set("userId", String(userId));
    if (showFiles) q.set("showFiles", "true");
    return get(`/api/system/browser/tree?${q.toString()}`);
  },
  systemBrowserList: ({
    scope = "files",
    userId = "",
    dir = "",
    q = "",
    page = 1,
    pageSize = 50,
  } = {}) => {
    const params = new URLSearchParams({
      scope: String(scope || "files"),
      dir: String(dir || ""),
      page: String(page || 1),
      pageSize: String(pageSize || 50),
    });
    if (userId) params.set("userId", String(userId));
    if (q) params.set("q", String(q));
    return get(`/api/system/browser/list?${params.toString()}`);
  },
  systemBrowserContent: ({ scope = "files", userId = "", file = "" } = {}) => {
    const q = new URLSearchParams({
      scope: String(scope || "files"),
      file: String(file || ""),
    });
    if (userId) q.set("userId", String(userId));
    return get(`/api/system/browser/content?${q.toString()}`);
  },
  systemBrowserDelete: (payload = {}) =>
    del("/api/system/browser/file", payload),
  systemBrowserDownload: async ({ scope = "files", userId = "", file = "" } = {}) => {
    const q = new URLSearchParams({
      scope: String(scope || "files"),
      file: String(file || ""),
    });
    if (userId) q.set("userId", String(userId));
    return getBlob(`/api/system/browser/download?${q.toString()}`);
  },
  systemBrowserUpload: async ({
    scope = "files",
    userId = "",
    dir = "",
    file,
  } = {}) => {
    const params = new URLSearchParams({
      scope: String(scope || "files"),
      dir: String(dir || ""),
    });
    if (userId) params.set("userId", String(userId));
    const form = new FormData();
    form.append("file", file);
    return post(`/api/system/browser/upload?${params.toString()}`, form);
  },
  systemLogFile: (source, id, file, limit = 200) =>
    get(
      `/api/system/logs/file?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}&limit=${limit}`,
    ),
  clearSystemLogFile: (source, id, file) =>
    del(
      `/api/system/logs/file?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`,
    ),
  systemHealthNodes: () => get("/api/system/health/nodes"),
  saveSystemHealthNodes: (nodes = []) =>
    put("/api/system/health/nodes", { nodes }),
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
  dbManagerConnections: () => get("/api/system/db-manager/connections"),
  dbManagerTables: (connectionId, q = "") =>
    get(
      `/api/system/db-manager/${encodeURIComponent(connectionId)}/tables${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),
  dbManagerSchema: (connectionId, schema, table) =>
    get(
      `/api/system/db-manager/${encodeURIComponent(connectionId)}/schema/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
    ),
  dbManagerIndexes: (connectionId, schema, table) =>
    get(
      `/api/system/db-manager/${encodeURIComponent(connectionId)}/indexes/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
    ),
  dbManagerRows: (connectionId, params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value) !== "") {
        q.set(key, String(value));
      }
    });
    return get(
      `/api/system/db-manager/${encodeURIComponent(connectionId)}/rows/${encodeURIComponent(params.schema || "public")}/${encodeURIComponent(params.table || "")}?${q.toString()}`,
    );
  },
  dbManagerQuery: (connectionId, sql) =>
    post(`/api/system/db-manager/${encodeURIComponent(connectionId)}/query`, {
      sql,
    }),
  dbManagerSync: (connectionId, schema, table, payload = {}) =>
    post(
      `/api/system/db-manager/${encodeURIComponent(connectionId)}/sync/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
      payload,
    ),
  dbManagerTableAction: (connectionId, schema, table, payload = {}) =>
    post(
      `/api/system/db-manager/${encodeURIComponent(connectionId)}/table-action/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
      payload,
    ),
  dbManagerIndexAction: (connectionId, schema, table, payload = {}) =>
    post(
      `/api/system/db-manager/${encodeURIComponent(connectionId)}/index-action/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
      payload,
    ),
  dbManagerInsertRow: (connectionId, schema, table, values = {}) =>
    post(
      `/api/system/db-manager/${encodeURIComponent(connectionId)}/write/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
      { values },
    ),
  dbManagerUpdateRow: (connectionId, schema, table, payload = {}) =>
    put(
      `/api/system/db-manager/${encodeURIComponent(connectionId)}/write/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
      payload,
    ),
  dbManagerDeleteRow: (connectionId, schema, table, payload = {}) =>
    del(
      `/api/system/db-manager/${encodeURIComponent(connectionId)}/write/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
      payload,
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
    endTimeSec = null,
  ) => {
    const symbolParam = Array.isArray(symbol)
      ? symbol.map((value) => String(value || "").trim()).filter(Boolean).join(",")
      : String(symbol || "");
    const timeframeParam = Array.isArray(timeframe)
      ? timeframe.map((value) => String(value || "").trim()).filter(Boolean).join(",")
      : String(timeframe || "");
    return (
    get(
      `/api/chart/candles?symbol=${encodeURIComponent(symbolParam)}&timeframe=${encodeURIComponent(timeframeParam)}&bars=${encodeURIComponent(bars)}${refresh ? "&force=1" : ""}&direction=${encodeURIComponent(direction || "latest")}${String(tradeSid || "").trim() ? `&trade_sid=${encodeURIComponent(tradeSid)}` : ""}${Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0 ? `&end_time_unix=${encodeURIComponent(Number(endTimeSec))}` : ""}`,
    )
    );
  },
  chartCandlesBatch: (payload = {}) =>
    postOptional("/api/chart/candles/batch", payload),
  chartSymbols: (q = "", provider = "ICMARKETS", limit = 20) =>
    get(
      `/api/chart/symbols?q=${encodeURIComponent(q)}&provider=${encodeURIComponent(provider)}&limit=${encodeURIComponent(limit)}`,
    ),
  chartSnapshots: (limit = 30) =>
    get(`/api/chart/snapshots?limit=${encodeURIComponent(limit)}`),
  tradeSnapshots: async (tradeSid, options = {}) =>
    normalizeV2TradeSnapshotResponse(
      tradeSid,
      await get(buildV2TradePath(tradeSid, "/snapshots", options)),
      options,
    ),
  tradeLogs: (tradeId, options = {}) =>
    get(buildV2TradePath(tradeId, "/logs", options)),
  deleteTradeLogs: (tradeId, options = {}) =>
    del(buildV2TradePath(tradeId, "/logs", options)),
  tradeLogContent: (tradeId, fileName, options = {}) =>
    get(
      buildV2TradePath(
        tradeId,
        `/logs/${encodeURIComponent(fileName)}/content`,
        options,
      ),
    ),
  chartSnapshotsDelete: (payload = {}) =>
    post("/api/chart/snapshots/delete", payload),
  marketDataSnapshots: (symbol, limit = 5) =>
    get(
      `/api/market-data/snapshots/${encodeURIComponent(symbol)}?limit=${encodeURIComponent(limit)}`,
    ),
  marketDataFix: (payload = {}) =>
    post("/api/market-data/fix", payload),
  marketDataRefreshFixChain: (payload = {}) =>
    post("/api/market-data/refresh-fix-chain", payload),
  brokerBars: (symbol, tf, limit = 300, endTimeSec = null) => {
    const symbolParam = Array.isArray(symbol)
      ? symbol.map((value) => String(value || "").trim()).filter(Boolean).join(",")
      : String(symbol || "");
    const tfParam = Array.isArray(tf)
      ? tf.map((value) => String(value || "").trim()).filter(Boolean).join(",")
      : String(tf || "");
    return get(
      `/api/market-data/broker-bars?symbol=${encodeURIComponent(symbolParam)}&tf=${encodeURIComponent(tfParam)}&limit=${encodeURIComponent(limit)}${Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0 ? `&end_time_unix=${encodeURIComponent(Number(endTimeSec))}` : ""}`,
    );
  },
  brokerBarsBatch: (payload = {}) =>
    postOptional("/api/market-data/broker-bars/batch", payload),
  realtimeChartBootstrap: (
    symbol = "",
    timeframe = "5m",
    bars = 300,
    endTimeSec = null,
    direction = "latest",
  ) => {
    const symbolParam = Array.isArray(symbol)
      ? symbol.map((value) => String(value || "").trim()).filter(Boolean).join(",")
      : String(symbol || "");
    const timeframeParam = Array.isArray(timeframe)
      ? timeframe.map((value) => String(value || "").trim()).filter(Boolean).join(",")
      : String(timeframe || "");
    return get(
      `/api/realtime/chart/bootstrap?symbol=${encodeURIComponent(symbolParam)}&timeframe=${encodeURIComponent(timeframeParam)}&bars=${encodeURIComponent(bars)}${Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0 ? `&end_time_unix=${encodeURIComponent(Number(endTimeSec))}` : ""}&direction=${encodeURIComponent(direction || "latest")}`,
    );
  },
  realtimeChartBootstrapBatch: (payload = {}) =>
    postOptional("/api/realtime/chart/bootstrap/batch", payload),
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
  realtimeSocketOptions: () => ({
    url: runtimeRealtimeSocketBase(),
    path: "/socket.io",
    auth: {
      apiKey: runtimeApiKey(),
    },
  }),
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
  notificationEvents: () => get("/api/notifications/events"),
  notificationSettings: () => get("/api/notifications/settings"),
  notificationSaveSettings: (settings) =>
    post("/api/notifications/settings", { settings }),
  notificationTest: (payload = {}) => post("/api/notifications/test", payload),
  chartStrategyCheckNotify: (payload = {}) =>
    post("/api/chart/strategy-checks/notify", payload),
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
