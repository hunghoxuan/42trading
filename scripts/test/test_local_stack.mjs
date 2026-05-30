#!/usr/bin/env node

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:80";
const UI_URL = process.env.UI_URL || "http://127.0.0.1:5174";
const API_KEY = process.env.API_KEY || "";
const ACCOUNT = process.env.ACCOUNT || "local-test";
const EXPECT_STORAGE = (process.env.EXPECT_STORAGE || "").toLowerCase();
const TEST_SYMBOL = (process.env.TEST_SYMBOL || "TEST").toUpperCase();
const TV_WEBHOOK_TOKEN = process.env.TV_WEBHOOK_TOKEN || "";

function log(msg) {
  console.log(`[test] ${msg}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function withBaseUrl(path) {
  return `${BASE_URL}${path}`;
}

async function requestJson(path, options = {}) {
  const url = withBaseUrl(path);
  const headers = { ...(options.headers || {}) };
  if (API_KEY) headers["x-api-key"] = API_KEY;
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON at ${path}, got: ${text.slice(0, 220)}`);
  }
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function requestText(path, options = {}) {
  const url = withBaseUrl(path);
  const headers = { ...(options.headers || {}) };
  if (API_KEY) headers["x-api-key"] = API_KEY;
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}: ${text.slice(0, 220)}`);
  }
  return text;
}

async function main() {
  log(`BASE_URL=${BASE_URL}`);
  log(`UI_URL=${UI_URL}`);
  if (TEST_SYMBOL !== "TEST") {
    throw new Error(`Safety guard: TEST_SYMBOL must be TEST, got ${TEST_SYMBOL}`);
  }

  const health = await requestJson("/health");
  assert(health.ok === true, "health.ok must be true");
  log("/health ok");

  const mt5Health = await requestJson("/mt5/health");
  assert(mt5Health.ok === true, "/mt5/health ok must be true");
  if (EXPECT_STORAGE) {
    assert(String(mt5Health.storage || "").toLowerCase() === EXPECT_STORAGE, `Expected storage=${EXPECT_STORAGE}, got ${mt5Health.storage}`);
  }
  log(`/mt5/health ok (storage=${mt5Health.storage})`);

  const signalId = `local_test_${Date.now()}`;
  const payload = {
    id: signalId,
    action: "BUY",
    symbol: TEST_SYMBOL,
    price: 70000,
    volume: 0.01,
    sl: 65000,
    tp: 75000,
    rr: 2,
    risk_money: 25,
    note: "local smoke test",
  };

  const tvWebhookPath = TV_WEBHOOK_TOKEN
    ? `/mt5/tv/webhook/${encodeURIComponent(TV_WEBHOOK_TOKEN)}`
    : "/mt5/tv/webhook";
  const enqueue = await requestJson(tvWebhookPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log("[test] enqueue response:", JSON.stringify(enqueue));
  assert(enqueue.ok === true, "enqueue should return ok=true");
  assert(enqueue.signal_id === signalId, "enqueue signal_id mismatch");
  log("/mt5/tv/webhook enqueue ok");

  const pulled = await requestJson(`/mt5/ea/pull?account=${encodeURIComponent(ACCOUNT)}&signal_id=${encodeURIComponent(signalId)}`);
  assert(pulled.ok === true, "pull should return ok=true");
  assert(pulled.signal && pulled.signal.signal_id === signalId, `pull returned unexpected signal: ${JSON.stringify(pulled.signal || null)}`);
  log("/mt5/ea/pull ok");

  const ack = await requestJson("/mt5/ea/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signal_id: signalId,
      status: "OK",
      ticket: `T-${Date.now()}`,
      pnl_money_realized: 12.34,
      entry_price_exec: 70000,
      sl_exec: 65000,
      tp_exec: 75000,
    }),
  });
  assert(ack.ok === true, "ack should return ok=true");
  log("/mt5/ea/ack ok");

  const tradeDetail = await requestJson(`/mt5/trades/${encodeURIComponent(signalId)}`);
  assert(tradeDetail.ok === true && tradeDetail.trade, "trade detail should exist");
  assert(tradeDetail.trade.status === "DONE", `expected DONE after ACK OK, got ${tradeDetail.trade.status}`);
  assert(Array.isArray(tradeDetail.events), "trade detail events should be array");
  assert(
    tradeDetail.events.some((e) => String(e.event_type || "").startsWith("EA_ACK_")),
    "trade detail events should include ack event",
  );
  log("/mt5/trades/:id ok");

  const search = await requestJson(`/mt5/trades/search?q=${encodeURIComponent(signalId)}&page=1&pageSize=5`);
  assert(search.ok === true, "trade search should return ok=true");
  assert(Array.isArray(search.trades), "trade search trades must be array");
  assert(search.trades.some((t) => t.signal_id === signalId), "trade search should include inserted signal");
  log("/mt5/trades/search ok");

  const summary = await requestJson("/mt5/dashboard/summary");
  assert(summary.ok === true && summary.metrics, "dashboard summary should return metrics");
  log("/mt5/dashboard/summary ok");

  const pnlSeries = await requestJson("/mt5/dashboard/pnl-series?period=week");
  assert(pnlSeries.ok === true && Array.isArray(pnlSeries.points), "pnl-series should return points array");
  log("/mt5/dashboard/pnl-series ok");

  const symbols = await requestJson("/mt5/filters/symbols");
  assert(symbols.ok === true && Array.isArray(symbols.symbols), "filters/symbols should return symbols[]");
  log("/mt5/filters/symbols ok");

  const oldTrades = await requestJson("/mt5/trades?limit=20");
  assert(oldTrades.ok === true && Array.isArray(oldTrades.trades), "legacy /mt5/trades should return trades[]");
  log("/mt5/trades (legacy) ok");

  const csv = await requestText("/csv?limit=20&header=1");
  assert(csv.includes("timestamp;signal_id;action;symbol;volume;sl;tp;note"), "csv header missing");
  assert(csv.includes(signalId), "csv does not include inserted signal");
  log("/csv ok");

  const uiRes = await fetch(`${UI_URL}/dashboard`);
  const uiText = await uiRes.text();
  assert(uiRes.ok, `UI /dashboard HTTP ${uiRes.status}`);
  assert(uiText.toLowerCase().includes("<html"), "UI response does not look like HTML");
  log("UI /dashboard reachable");

  log("ALL CHECKS PASSED");
}

main().catch((err) => {
  console.error(`[test] FAILED: ${err.message}`);
  process.exit(1);
});
