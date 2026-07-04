"use strict";

const DEFAULT_TIMEOUT_MS = 3000;

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function createMt5PythonBridgeClient(options = {}) {
  const enabled = Boolean(options.enabled);
  const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
  const port = Number(options.port || 3002) || 3002;
  const apiKey = String(options.apiKey || "").trim();
  const baseUrl = trimSlash(options.baseUrl || `http://${host}:${port}`);

  function buildHeaders(extra = {}) {
    const headers = { ...extra };
    if (apiKey) headers["x-bridge-key"] = apiKey;
    return headers;
  }

  async function request(path, { method = "GET", body, timeoutMs } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(250, Number(timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    );
    try {
      const headers = buildHeaders();
      let payload;
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(
          json?.error?.message ||
            json?.error ||
            `MT5 Python bridge HTTP ${res.status}`,
        );
        error.status = res.status;
        error.payload = json;
        throw error;
      }
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    enabled,
    host,
    port,
    baseUrl,
    configured: enabled && port > 0,
    async health() {
      return request("/health", { method: "GET" });
    },
    async ready() {
      return request("/ready", { method: "GET" });
    },
    async accountSummary(body) {
      return request("/bridge/account/summary", { method: "POST", body });
    },
    async accountReadiness(body) {
      return request("/bridge/account/readiness", { method: "POST", body });
    },
    async positions(body) {
      return request("/bridge/account/positions", { method: "POST", body });
    },
    async orders(body) {
      return request("/bridge/account/orders", { method: "POST", body });
    },
    async deals(body) {
      return request("/bridge/account/deals", { method: "POST", body });
    },
    async quote(body) {
      return request("/bridge/market/quote", { method: "POST", body });
    },
  };
}

module.exports = {
  createMt5PythonBridgeClient,
};
