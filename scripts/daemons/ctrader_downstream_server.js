#!/usr/bin/env node
"use strict";

const http = require("http");
const crypto = require("crypto");
const { CTraderConnection } = require("@max89701/ctrader-layer");

const TAG = "ctrader-downstream";

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
  port: Math.max(1, Number(process.env.CTRADER_DOWNSTREAM_PORT || 8110)),
  apiKey: envStr(process.env.CTRADER_DOWNSTREAM_API_KEY),
  host: envStr(process.env.CTRADER_API_HOST, "demo.ctraderapi.com"),
  portApi: Math.max(1, Number(process.env.CTRADER_API_PORT || 5035)),
  mode: envStr(process.env.CTRADER_MODE, "demo").toLowerCase(),
  clientId: envStr(process.env.CTRADER_CLIENT_ID),
  clientSecret: envStr(process.env.CTRADER_CLIENT_SECRET),
  accessToken: envStr(process.env.CTRADER_ACCESS_TOKEN),
  refreshToken: envStr(process.env.CTRADER_REFRESH_TOKEN),
  accountId: envStr(process.env.CTRADER_ACCOUNT_ID),
  accountNumber: envStr(process.env.CTRADER_ACCOUNT_NUMBER),
  unitsPerLot: Math.max(1, Number(process.env.CTRADER_UNITS_PER_LOT || 100000)),
  minVolumeUnits: Math.max(1, Number(process.env.CTRADER_MIN_VOLUME_UNITS || 1000)),
};

let tokenState = {
  accessToken: CFG.accessToken,
  refreshToken: CFG.refreshToken,
  expiresAtMs: 0,
  refreshedAtMs: 0,
};

let conn = null;
let connOpen = false;
let connLastError = "";
const symbolCache = new Map();
let symbolCacheAccountId = null;
let symbolCacheTsMs = 0;
const SYMBOL_CACHE_TTL_MS = 5 * 60 * 1000;

function mask(v, keep = 4) {
  const s = String(v || "");
  if (!s) return "";
  if (s.length <= keep) return "*".repeat(s.length);
  return `${"*".repeat(Math.max(0, s.length - keep))}${s.slice(-keep)}`;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
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

function requireApiKey(req) {
  if (!CFG.apiKey) return true;
  const got = envStr(req.headers["x-api-key"]);
  return got && got === CFG.apiKey;
}

async function refreshAccessToken() {
  if (!CFG.clientId || !CFG.clientSecret || !tokenState.refreshToken) {
    throw new Error("Missing cTrader OAuth config (client_id/client_secret/refresh_token)");
  }
  const query = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokenState.refreshToken,
    client_id: CFG.clientId,
    client_secret: CFG.clientSecret,
  }).toString();
  const url = `https://openapi.ctrader.com/apps/token?${query}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
  });
  const raw = await res.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }
  if (!res.ok || body?.errorCode) {
    throw new Error(`oauth refresh failed ${res.status}: ${JSON.stringify(body)}`);
  }
  const accessToken = envStr(body.accessToken || body.access_token);
  const refreshToken = envStr(body.refreshToken || body.refresh_token);
  const expiresInSec = Math.max(0, Number(body.expiresIn ?? body.expires_in ?? 0));
  if (!accessToken) throw new Error("oauth refresh response missing access token");
  tokenState.accessToken = accessToken;
  if (refreshToken) tokenState.refreshToken = refreshToken;
  tokenState.refreshedAtMs = Date.now();
  tokenState.expiresAtMs = expiresInSec > 0 ? Date.now() + expiresInSec * 1000 : 0;
  return { accessToken, refreshToken: tokenState.refreshToken, expiresInSec };
}

async function ensureConnectionOpen() {
  if (conn && connOpen) return conn;
  conn = new CTraderConnection({
    host: CFG.host,
    port: CFG.portApi,
    autoReconnect: true,
    maxReconnectAttempts: 20,
    reconnectDelayMs: 1000,
  });
  conn.on("error", (err) => {
    connLastError = String(err?.message || err || "");
  });
  await conn.open();
  connOpen = true;
  return conn;
}

function normalizeSymbolName(value) {
  return String(value || "").trim().toUpperCase().replace("/", "");
}

function normalizeOrderType(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "market";
  if (v === "buy_limit" || v === "sell_limit") return "limit";
  if (v === "buy_stop" || v === "sell_stop") return "stop";
  if (["market", "limit", "stop"].includes(v)) return v;
  return "market";
}

function normalizeTradeSide(actionRaw) {
  const a = String(actionRaw || "").trim().toUpperCase();
  if (a === "BUY" || a === "LONG") return "BUY";
  if (a === "SELL" || a === "SHORT") return "SELL";
  throw new Error("Invalid action/side");
}

function lotsToUnits(lotsRaw) {
  const lots = asNum(lotsRaw, NaN);
  const safeLots = Number.isFinite(lots) && lots > 0 ? lots : 0.01;
  const units = Math.max(CFG.minVolumeUnits, Math.round(safeLots * CFG.unitsPerLot));
  return units;
}

async function ensureAuthorized(accountIdRaw) {
  const connRef = await ensureConnectionOpen();
  const accountId = String(accountIdRaw || CFG.accountId || "").trim();
  if (!accountId) throw new Error("Missing cTrader account id");
  if (!tokenState.accessToken) {
    await refreshAccessToken();
  }
  await connRef.sendCommand("ProtoOAApplicationAuthReq", {
    clientId: CFG.clientId,
    clientSecret: CFG.clientSecret,
  });
  try {
    await connRef.sendCommand("ProtoOAAccountAuthReq", {
      ctidTraderAccountId: Number(accountId),
      accessToken: tokenState.accessToken,
    });
  } catch (error) {
    const text = String(error?.description || error?.message || "");
    if (text.includes("ACCESS_TOKEN") || text.includes("CH_ACCESS_TOKEN_INVALID")) {
      await refreshAccessToken();
      await connRef.sendCommand("ProtoOAAccountAuthReq", {
        ctidTraderAccountId: Number(accountId),
        accessToken: tokenState.accessToken,
      });
    } else {
      throw error;
    }
  }
  return { conn: connRef, accountId: Number(accountId) };
}

async function loadSymbols(accountId) {
  const now = Date.now();
  if (symbolCacheAccountId === accountId && now - symbolCacheTsMs < SYMBOL_CACHE_TTL_MS && symbolCache.size > 0) {
    return symbolCache;
  }
  const { conn: connRef } = await ensureAuthorized(accountId);
  const res = await connRef.sendCommand("ProtoOASymbolsListReq", {
    ctidTraderAccountId: Number(accountId),
    includeArchivedSymbols: false,
  });
  symbolCache.clear();
  const items = Array.isArray(res?.symbol) ? res.symbol : [];
  for (const s of items) {
    const id = Number(s?.symbolId);
    if (!Number.isFinite(id)) continue;
    const name = normalizeSymbolName(s?.symbolName);
    if (!name) continue;
    symbolCache.set(name, {
      symbolId: id,
      symbolName: String(s?.symbolName || name),
      lotSize: Number(s?.lotSize) || null,
    });
  }
  symbolCacheAccountId = accountId;
  symbolCacheTsMs = now;
  return symbolCache;
}

async function resolveSymbolId(accountId, symbolRaw) {
  const normalized = normalizeSymbolName(symbolRaw);
  if (!normalized) throw new Error("Missing symbol");
  const cache = await loadSymbols(accountId);
  if (cache.has(normalized)) return cache.get(normalized);
  const candidates = Array.from(cache.entries())
    .filter(([name]) => name.includes(normalized) || normalized.includes(name))
    .map(([, v]) => v);
  if (candidates.length > 0) return candidates[0];
  throw new Error(`Symbol not found on cTrader account: ${symbolRaw}`);
}

async function placeOrder(reqBody = {}) {
  const mode = envStr(reqBody.mode || CFG.mode || "demo").toLowerCase();
  if (!["demo", "live"].includes(mode)) throw new Error("Invalid mode");

  const signal = reqBody?.signal && typeof reqBody.signal === "object" ? reqBody.signal : reqBody;
  const action = normalizeTradeSide(signal?.action || signal?.side);
  const orderType = normalizeOrderType(signal?.order_type);
  const accountId = String(reqBody.account_id || signal.account_id || CFG.accountId || "").trim();
  const { conn: connRef } = await ensureAuthorized(accountId);

  const symbolResolved = await resolveSymbolId(accountId, signal?.symbol);
  const symbolId = Number(symbolResolved.symbolId);
  const volume = lotsToUnits(signal?.volume ?? signal?.quantity);
  const entry = asNum(signal?.entry ?? signal?.price, NaN);
  const sl = asNum(signal?.sl, NaN);
  const tp = asNum(signal?.tp, NaN);

  const payload = {
    ctidTraderAccountId: Number(accountId),
    symbolId,
    orderType: orderType.toUpperCase(),
    tradeSide: action,
    volume,
    label: envStr(signal?.id || signal?.signal_id || `sig_${Date.now()}`),
    comment: envStr(signal?.note || "").slice(0, 100),
  };

  if (orderType === "limit") payload.limitPrice = Number.isFinite(entry) ? entry : undefined;
  if (orderType === "stop") payload.stopPrice = Number.isFinite(entry) ? entry : undefined;
  if (Number.isFinite(sl) && sl > 0) payload.stopLoss = sl;
  if (Number.isFinite(tp) && tp > 0) payload.takeProfit = tp;

  const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const res = await connRef.sendCommand("ProtoOANewOrderReq", cleanPayload);

  const orderId = String(
    res?.order?.orderId ||
    res?.position?.positionId ||
    res?.execution?.orderId ||
    res?.clientOrderId ||
    `ct_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
  );
  const status = orderType === "market" ? "OPEN" : "PENDING";
  return {
    ok: true,
    backend: "ctrader-openapi",
    order_id: orderId,
    execution_status: status,
    accepted_at: new Date().toISOString(),
    account_id: accountId || null,
    symbol_id: symbolId,
    symbol: symbolResolved.symbolName,
    trade_side: action,
    order_type: orderType,
    volume_units: volume,
    raw: res || {},
  };
}

const TF_MAP = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1D": 1440, "1d": 1440, "1W": 10080, "1w": 10080 };

async function fetchBars(reqBody = {}) {
  const accountId = String(reqBody.account_id || CFG.accountId || "").trim();
  if (!accountId) throw new Error("account_id required");

  const symbols = Array.isArray(reqBody.symbols) && reqBody.symbols.length
    ? reqBody.symbols
    : reqBody.symbol ? [reqBody.symbol] : [];
  if (!symbols.length) throw new Error("symbols required");

  const tfsRaw = Array.isArray(reqBody.timeframes) && reqBody.timeframes.length
    ? reqBody.timeframes
    : reqBody.timeframe ? [reqBody.timeframe] : ["1m", "5m", "15m", "1h", "4h", "1D"];

  const barCount = Math.max(10, Math.min(5000, Number(reqBody.bars || reqBody.bar_count || 500)));
  const webhookUrl = envStr(reqBody.webhook_url || process.env.WEBHOOK_URL || "http://127.0.0.1:3001");
  const webhookKey = envStr(reqBody.webhook_key || process.env.WEBHOOK_API_KEY || "");

  const { conn: connRef } = await ensureAuthorized(accountId);
  const symCache = await loadSymbols(accountId);
  const toMs = Math.floor(Date.now());

  const results = [];
  let totalBars = 0;

  for (const symRaw of symbols) {
    const symObj = await resolveSymbolId(accountId, symRaw).catch(() => null);
    if (!symObj) {
      results.push({ symbol: symRaw, error: "symbol_not_found" });
      continue;
    }
    const symName = String(symObj.symbolName || symRaw).toUpperCase();

    for (const tfRaw of tfsRaw) {
      const tfMin = TF_MAP[String(tfRaw).toLowerCase()] || TF_MAP[String(tfRaw).toLowerCase() + "m"] || 60;
      const tfSec = tfMin * 60;
      const fromMs = toMs - barCount * tfSec * 1000;

      try {
        const res = await connRef.sendCommand("ProtoOAGetTrendbarsReq", {
          ctidTraderAccountId: Number(accountId),
          symbolId: Number(symObj.symbolId),
          period: tfMin,
          from: fromMs,
          to: toMs,
        });

        const bars = Array.isArray(res?.trendbar) ? res.trendbar : [];
        if (!bars.length) {
          results.push({ symbol: symName, tf: tfRaw, bars: 0 });
          continue;
        }

        // Convert to webhook format
        const barItems = bars.map((b) => ({
          time: Math.floor(Number(b.timestamp || b.utcTimestampInMinutes || 0) * 60),
          open: Number(b.open || 0),
          high: Number(b.high || 0),
          low: Number(b.low || 0),
          close: Number(b.close || 0),
          volume: Number(b.volume || 0),
        })).filter((b) => Number.isFinite(b.time) && b.time > 0);

        // Push to webhook
        if (webhookUrl && barItems.length) {
          const syncPayload = {
            source_id: "Ctrader",
            account_id: accountId,
            sync_mode: "historical",
            items: [{
              symbol: symName,
              tf: String(tfRaw),
              bars: barItems,
            }],
          };
          try {
            const pushRes = await fetch(`${webhookUrl.replace(/\/+$/, "")}/v2/broker/prices-sync`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(webhookKey ? { "x-api-key": webhookKey } : {}),
              },
              body: JSON.stringify(syncPayload),
              signal: AbortSignal.timeout(30000),
            });
            if (!pushRes.ok) {
              const errText = await pushRes.text().catch(() => "");
              console.error(`[${TAG}] push failed for ${symName}/${tfRaw}: ${pushRes.status} ${errText.slice(0, 200)}`);
            }
          } catch (e) {
            console.error(`[${TAG}] push error for ${symName}/${tfRaw}: ${e.message}`);
          }
        }

        totalBars += barItems.length;
        results.push({ symbol: symName, tf: tfRaw, bars: barItems.length });
      } catch (e) {
        results.push({ symbol: symName, tf: tfRaw, error: e?.description || e?.message || String(e) });
      }
    }
  }

  return { ok: true, total_bars: totalBars, results };
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
      api_host: CFG.host,
      api_port: CFG.portApi,
      conn_open: connOpen,
      last_error: connLastError || null,
      token_last4: tokenState.accessToken ? tokenState.accessToken.slice(-4) : null,
      refresh_last4: tokenState.refreshToken ? tokenState.refreshToken.slice(-4) : null,
      api_key_last4: CFG.apiKey ? mask(CFG.apiKey).slice(-4) : null,
      time: new Date().toISOString(),
    });
  }

  if (req.method === "POST" && url.pathname === "/auth/refresh") {
    if (!requireApiKey(req)) return json(res, 401, { ok: false, error: "invalid api key" });
    try {
      const out = await refreshAccessToken();
      return json(res, 200, {
        ok: true,
        ...out,
        token_last4: tokenState.accessToken ? tokenState.accessToken.slice(-4) : null,
        refresh_last4: tokenState.refreshToken ? tokenState.refreshToken.slice(-4) : null,
      });
    } catch (error) {
      return json(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/execute") {
    if (!requireApiKey(req)) return json(res, 401, { ok: false, error: "invalid api key" });
    let body = {};
    try {
      body = await readBody(req);
    } catch (error) {
      return json(res, 400, { ok: false, error: `invalid json: ${error.message}` });
    }
    try {
      const out = await placeOrder(body);
      return json(res, 200, out);
    } catch (error) {
      const message = error?.description || error?.message || String(error);
      return json(res, 500, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/fetch-bars") {
    if (!requireApiKey(req)) return json(res, 401, { ok: false, error: "invalid api key" });
    let body = {};
    try {
      body = await readBody(req);
    } catch (error) {
      return json(res, 400, { ok: false, error: `invalid json: ${error.message}` });
    }
    try {
      const out = await fetchBars(body);
      return json(res, 200, out);
    } catch (error) {
      const message = error?.description || error?.message || String(error);
      return json(res, 500, { ok: false, error: message });
    }
  }

  return json(res, 404, { ok: false, error: "not found" });
});

server.listen(CFG.port, "0.0.0.0", () => {
  console.log(
    `[${TAG}] listening :${CFG.port} mode=${CFG.mode} account_id=${CFG.accountId || "-"} api=${CFG.host}:${CFG.portApi}`,
  );
});
