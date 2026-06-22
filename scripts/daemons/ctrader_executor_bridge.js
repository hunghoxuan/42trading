#!/usr/bin/env node
"use strict";

const http = require("http");
const crypto = require("crypto");

const TAG = "ctrader-executor";

function envStr(v, fallback = "") {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  return s ? s : fallback;
}

function asNum(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const CFG = {
  port: Math.max(1, Number(process.env.CTRADER_EXECUTOR_PORT || 8099)),
  apiKey: envStr(process.env.CTRADER_EXECUTOR_API_KEY),
  mode: envStr(process.env.CTRADER_MODE, "demo").toLowerCase(),
  accountId: envStr(process.env.CTRADER_ACCOUNT_ID),
  accountNumber: envStr(process.env.CTRADER_ACCOUNT_NUMBER),
  downstreamUrl: envStr(process.env.CTRADER_DOWNSTREAM_URL),
  downstreamApiKey: envStr(process.env.CTRADER_DOWNSTREAM_API_KEY),
  tokenClientId: envStr(process.env.CTRADER_CLIENT_ID),
  tokenClientSecret: envStr(process.env.CTRADER_CLIENT_SECRET),
  tokenRefreshToken: envStr(process.env.CTRADER_REFRESH_TOKEN),
};

let tokenState = {
  accessToken: envStr(process.env.CTRADER_ACCESS_TOKEN),
  refreshToken: envStr(process.env.CTRADER_REFRESH_TOKEN),
  expiresAtMs: 0,
  lastRefreshAtMs: 0,
};

const recentSignalIds = new Map();
const DEDUP_TTL_MS = 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function maskSecret(v, visible = 4) {
  const s = String(v || "");
  if (!s) return "";
  if (s.length <= visible) return "*".repeat(s.length);
  return `${"*".repeat(Math.max(0, s.length - visible))}${s.slice(-visible)}`;
}

function cleanupDedup() {
  const now = Date.now();
  for (const [k, exp] of recentSignalIds.entries()) {
    if (exp <= now) recentSignalIds.delete(k);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function normalizeAction(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (s === "BUY" || s === "LONG") return "BUY";
  if (s === "SELL" || s === "SHORT") return "SELL";
  throw new Error("Invalid side/action");
}

function normalizeOrderType(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "market";
  if (s === "buy_limit" || s === "sell_limit") return "limit";
  if (s === "buy_stop" || s === "sell_stop") return "stop";
  if (["market", "limit", "stop", "stop_limit"].includes(s)) return s;
  return "market";
}

function normalizeSignal(signalRaw) {
  const s = signalRaw && typeof signalRaw === "object" ? signalRaw : {};
  const symbol = String(s.symbol || s.ticker || "").trim().toUpperCase();
  if (!symbol) throw new Error("Missing symbol");
  const action = normalizeAction(s.action || s.side);
  const entry = asNum(s.entry ?? s.price, NaN);
  if (!Number.isFinite(entry) || entry <= 0) throw new Error("Invalid entry/price");
  const slN = asNum(s.sl, NaN);
  const tpN = asNum(s.tp, NaN);
  const volumeN = asNum(s.volume ?? s.quantity, NaN);
  return {
    id: envStr(s.id ?? s.signal_id ?? s.trade_id) || `sig_${Date.now().toString(36)}`,
    symbol,
    action,
    order_type: normalizeOrderType(s.order_type),
    entry,
    sl: Number.isFinite(slN) ? slN : null,
    tp: Number.isFinite(tpN) ? tpN : null,
    volume: Number.isFinite(volumeN) && volumeN > 0 ? volumeN : null,
    note: String(s.note || ""),
    chart_tf: envStr(s.chart_tf || s.timeframe),
    signal_tf: envStr(s.signal_tf),
    entry_model: envStr(s.entry_model),
    raw: s,
  };
}

function inferExecutionStatus(orderType) {
  return orderType === "market" ? "OPEN" : "PENDING";
}

async function refreshAccessTokenIfNeeded(force = false) {
  const now = Date.now();
  if (!CFG.tokenClientId || !CFG.tokenClientSecret || !tokenState.refreshToken) {
    return { ok: false, skipped: true, reason: "token-refresh-config-missing" };
  }
  if (!force && tokenState.expiresAtMs > now + 60_000) {
    return { ok: true, skipped: true, reason: "token-still-valid" };
  }

  const query = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokenState.refreshToken,
    client_id: CFG.tokenClientId,
    client_secret: CFG.tokenClientSecret,
  }).toString();

  const url = `https://openapi.ctrader.com/apps/token?${query}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`token refresh failed ${res.status}: ${JSON.stringify(body)}`);
  }

  const nextAccess = envStr(body.accessToken || body.access_token);
  const nextRefresh = envStr(body.refreshToken || body.refresh_token);
  const expiresInSec = Math.max(0, Number(body.expiresIn ?? body.expires_in ?? 0));
  tokenState.accessToken = nextAccess || tokenState.accessToken;
  tokenState.refreshToken = nextRefresh || tokenState.refreshToken;
  tokenState.lastRefreshAtMs = Date.now();
  tokenState.expiresAtMs = expiresInSec > 0 ? Date.now() + expiresInSec * 1000 : 0;
  return {
    ok: true,
    expiresInSec,
    refreshedAt: nowIso(),
  };
}

async function submitToDownstream(normalized, mode) {
  if (!CFG.downstreamUrl) {
    const executionStatus = inferExecutionStatus(normalized.order_type);
    return {
      ok: true,
      backend: "paper",
      order_id: `ct_mock_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      execution_status: executionStatus,
      accepted_at: nowIso(),
      message: "No CTRADER_DOWNSTREAM_URL set; paper execution accepted.",
    };
  }

  const payload = {
    mode,
    account_id: normalized?.account_id || CFG.accountId || null,
    account_number: normalized?.account_number || CFG.accountNumber || null,
    signal: normalized,
    auth: {
      access_token: tokenState.accessToken || null,
    },
  };
  const headers = { "content-type": "application/json" };
  if (CFG.downstreamApiKey) headers["x-api-key"] = CFG.downstreamApiKey;

  const res = await fetch(CFG.downstreamUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`downstream failed ${res.status}: ${JSON.stringify(body)}`);
  }
  return {
    ok: true,
    backend: "downstream",
    ...body,
  };
}

async function proxyDownstreamJson(pathname, payload = {}) {
  if (!CFG.downstreamUrl) {
    throw new Error("CTRADER_DOWNSTREAM_URL is not configured");
  }
  const baseUrl = String(CFG.downstreamUrl).replace(/\/execute\/?$/, "").replace(/\/+$/, "");
  const headers = { "content-type": "application/json" };
  if (CFG.downstreamApiKey) headers["x-api-key"] = CFG.downstreamApiKey;
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`downstream failed ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function requireApiKey(req) {
  if (!CFG.apiKey) return true;
  const key = envStr(req.headers["x-api-key"]);
  return key && key === CFG.apiKey;
}

async function handleExecute(req, res) {
  if (!requireApiKey(req)) return json(res, 401, { ok: false, error: "invalid api key" });
  let body = {};
  try {
    body = await readBody(req);
  } catch (error) {
    return json(res, 400, { ok: false, error: `invalid json: ${error.message}` });
  }

  const profile = body?.execution_profile && typeof body.execution_profile === "object" ? body.execution_profile : null;
  const mode = envStr(body.mode || profile?.ctrader_mode || CFG.mode || "demo").toLowerCase();
  if (!["demo", "live"].includes(mode)) {
    return json(res, 400, { ok: false, error: "invalid mode (demo|live)" });
  }

  let signal;
  try {
    signal = normalizeSignal(body.signal || body);
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message || String(error) });
  }

  cleanupDedup();
  const dedupKey = `${mode}:${signal.id}`;
  if (recentSignalIds.has(dedupKey)) {
    return json(res, 200, {
      ok: true,
      duplicate: true,
      signal_id: signal.id,
      message: "duplicate signal ignored",
    });
  }
  recentSignalIds.set(dedupKey, Date.now() + DEDUP_TTL_MS);

  try {
    await refreshAccessTokenIfNeeded(false).catch(() => null);
    const accountId = envStr(profile?.ctrader_account_id || profile?.account_id || CFG.accountId || null);
    const accountNumber = envStr(profile?.account_number || CFG.accountNumber || null);
    const out = await submitToDownstream({
      ...signal,
      account_id: accountId || null,
      account_number: accountNumber || null,
    }, mode);
    const executionStatus = envStr(out.execution_status, inferExecutionStatus(signal.order_type));
    console.log(
      `[${TAG}] execute ok signal=${signal.id} ${signal.action} ${signal.symbol} mode=${mode} type=${signal.order_type} status=${executionStatus} backend=${out.backend || "-"}`,
    );
    return json(res, 200, {
      ok: true,
      mode,
      account_id: accountId || CFG.accountId || null,
      account_number: accountNumber || CFG.accountNumber || null,
      signal_id: signal.id,
      symbol: signal.symbol,
      action: signal.action,
      order_type: signal.order_type,
      execution_status: executionStatus,
      broker_trade_id: out.order_id || out.broker_trade_id || null,
      backend: out.backend || "paper",
      response: out,
    });
  } catch (error) {
    console.error(`[${TAG}] execute failed signal=${signal.id} err=${error.message || error}`);
    return json(res, 500, { ok: false, error: error.message || String(error), signal_id: signal.id });
  }
}

async function handleRefresh(req, res) {
  if (!requireApiKey(req)) return json(res, 401, { ok: false, error: "invalid api key" });
  try {
    const out = await refreshAccessTokenIfNeeded(true);
    return json(res, 200, {
      ok: true,
      ...out,
      token_last4: tokenState.accessToken ? tokenState.accessToken.slice(-4) : null,
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message || String(error) });
  }
}

async function handleSymbolCalibration(req, res) {
  if (!requireApiKey(req)) return json(res, 401, { ok: false, error: "invalid api key" });
  let body = {};
  try {
    body = await readBody(req);
  } catch (error) {
    return json(res, 400, { ok: false, error: `invalid json: ${error.message}` });
  }
  try {
    const symbol = String(body.symbol || "").trim().toUpperCase();
    if (!symbol) {
      return json(res, 400, { ok: false, error: "symbol required" });
    }
    const accountId = envStr(body.account_id || CFG.accountId || null);
    const out = await proxyDownstreamJson("/symbol-calibration", {
      account_id: accountId,
      symbol,
    });
    return json(res, 200, out);
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message || String(error) });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: TAG,
      mode: CFG.mode,
      account_id: CFG.accountId || null,
      account_number: CFG.accountNumber || null,
      downstream_url: CFG.downstreamUrl || null,
      token_last4: tokenState.accessToken ? tokenState.accessToken.slice(-4) : null,
      token_refresh_last4: tokenState.refreshToken ? tokenState.refreshToken.slice(-4) : null,
      api_key_last4: CFG.apiKey ? maskSecret(CFG.apiKey).slice(-4) : null,
      time: nowIso(),
    });
  }

  if (req.method === "POST" && url.pathname === "/execute") return handleExecute(req, res);
  if (req.method === "POST" && url.pathname === "/auth/refresh") return handleRefresh(req, res);
  if (req.method === "POST" && url.pathname === "/symbol-calibration") return handleSymbolCalibration(req, res);
  return json(res, 404, { ok: false, error: "not found" });
});

server.listen(CFG.port, "0.0.0.0", () => {
  console.log(
    `[${TAG}] listening on :${CFG.port} mode=${CFG.mode} account_id=${CFG.accountId || "-"} account_no=${CFG.accountNumber || "-"} downstream=${CFG.downstreamUrl || "paper"}`,
  );
});
