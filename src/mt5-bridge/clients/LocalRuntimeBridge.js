"use strict";

// Local cTrader fallback. This adapter deliberately reuses the same repository
// and market-data modules as the API routes; it does not define a second schema.
const fs = require("fs");
const path = require("path");

const { createTradesService } = require("../../api/modules/trades/service");
const marketData = require("../../api/modules/42trade/marketData/marketDataRepo");
const chartArtifacts = require("../../api/modules/42trade/charts/chartArtifactService");

const LOCAL_IO_LOG_PATH = "/tmp/42trade-local-io.log";

function logIo(kind, mode, filePath, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    kind,
    mode,
    path: filePath,
    ...details,
  };
  const line = `[LocalIO] ${JSON.stringify(entry)}`;
  try { fs.appendFileSync(LOCAL_IO_LOG_PATH, `${line}\n`); } catch {}
  process.stderr.write(`${line}\n`);
}

function text(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function numberOrNull(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function safeUserId(value) {
  return text(value, "default").replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
}

function createRuntime(request) {
  const projectRoot = path.resolve(text(request.project_root, process.cwd()));
  const sqlitePath = path.resolve(
    projectRoot,
    text(request.sqlite_path, path.join("data", "database.db")),
  );
  const userId = safeUserId(request.user_id);
  const accountId = text(request.account_id);
  const service = createTradesService({
    projectRoot,
    userId,
    storageBackend: "sqlite",
    objectStore: { provider: "sqlite", sqlitePath },
    sqlitePath,
  });
  return { projectRoot, sqlitePath, userId, accountId, service };
}

function brokerItem(raw, status, runtime) {
  let item = raw && typeof raw === "object" ? raw : {};
  if (typeof raw === "string") {
    try { item = JSON.parse(raw); } catch { item = {}; }
  }
  const ticket = text(item.ticket || item.broker_trade_id);
  const symbol = text(item.symbol).toUpperCase();
  return {
    sid: text(item.sid || item.trade_id || item.signal_id),
    trade_id: text(item.trade_id || item.sid || item.signal_id),
    signal_id: text(item.signal_id || item.sid),
    account_id: runtime.accountId,
    user_id: runtime.userId,
    ticket,
    broker_trade_id: ticket || null,
    ticket_candidates: ticket ? [ticket] : [],
    symbol,
    action: text(item.action || item.side).toUpperCase(),
    order_type: text(item.order_type || item.type, "market").toLowerCase(),
    entry: numberOrNull(item.entry || item.target_price),
    sl: numberOrNull(item.sl),
    tp: numberOrNull(item.tp),
    volume: numberOrNull(item.volume || item.lots),
    lots: numberOrNull(item.lots),
    pnl: numberOrNull(item.pnl),
    pips: numberOrNull(item.pips),
    commission: numberOrNull(item.commission),
    swap: numberOrNull(item.swap),
    margin: numberOrNull(item.margin),
    execution_status: status,
    opened_at: item.opened_at || null,
    closed_at: item.closed_at || null,
    close_reason: item.close_reason || null,
    comment: item.comment || "",
    label: item.label || "",
    strategy: text(item.strategy || item.strategy_name, "") || null,
    metadata: {
      broker_data: item,
      has_partial: Boolean(item.has_partial),
    },
  };
}

function buildSyncItems(request, runtime) {
  const positions = Array.isArray(request.positions) ? request.positions : [];
  const orders = Array.isArray(request.orders) ? request.orders : [];
  const closed = Array.isArray(request.closed) ? request.closed : [];
  return [
    ...positions.map((item) => brokerItem(item, "FILLED", runtime)),
    ...orders.map((item) => brokerItem(item, "PENDING", runtime)),
    ...closed.map((item) => brokerItem(item, "CLOSED", runtime)),
  ].filter((item) => item.sid || item.ticket);
}

function normalizePullItem(item, runtime) {
  const metadata = item && typeof item.metadata === "object" ? item.metadata : {};
  const type = text(item.task_type || item.type || item.dispatch_status, "OPEN").toUpperCase();
  return {
    sid: item.sid,
    type,
    ticket: item.broker_trade_id || null,
    lease_token: item.lease_token,
    lease_expires_at: item.lease_expires_at,
    account_id: runtime.accountId,
    trade_id: item.trade_id || item.sid,
    signal_id: item.sid,
    source_id: item.source_id || null,
    symbol: item.symbol,
    action: item.action,
    entry: item.entry,
    order_type: item.order_type || "market",
    sl: item.sl,
    tp: item.tp,
    tp1: item.tp1,
    tp2: item.tp2,
    tp3: item.tp3,
    volume: item.volume,
    lots: item.volume,
    risk_money: item.risk_money_planned,
    risk_pct: item.risk_pct_planned,
    strategy: item.strategy || metadata.strategy || "",
    trade_tf: item.trade_tf || null,
    chart_tf: item.chart_tf || null,
    profile: item.profile || metadata.profile || null,
    note: item.note || null,
    metadata,
  };
}

async function run(request) {
  const runtime = createRuntime(request);
  const operation = text(request.operation).toLowerCase();
  if (operation === "pull") {
    logIo("sqlite", "read", runtime.sqlitePath, { operation, user: runtime.userId });
    const rows = await runtime.service.pullLeasedTrades(
      runtime.userId,
      runtime.accountId,
      Math.max(1, Math.min(100, Number(request.max_items) || 50)),
      30,
      null,
      { maxLeaseRetries: 3 },
    );
    const queue = await runtime.service.listStrategyQueueActions(runtime.userId, runtime.accountId);
    const terminal = await runtime.service.listStrategyQueueTerminalActionIds(runtime.userId, runtime.accountId);
    return {
      ok: true,
      items: rows.map((row) => normalizePullItem(row, runtime)),
      queue_actions: queue,
      queue_terminal_action_ids: terminal,
      symbols: [...new Set(rows.map((row) => text(row.symbol).toUpperCase()).filter(Boolean))],
      watchlist_symbols: [],
    };
  }
  if (operation === "ack") {
    logIo("sqlite", "write", runtime.sqlitePath, { operation, user: runtime.userId });
    return runtime.service.ackTrade(runtime.userId, runtime.accountId, request.payload || {}, {});
  }
  if (operation === "sync") {
    logIo("sqlite", "read/write", runtime.sqlitePath, { operation, user: runtime.userId });
    const result = await runtime.service.brokerSyncTrades(
      runtime.userId,
      runtime.accountId,
      buildSyncItems(request, runtime),
      {
        now: new Date().toISOString(),
        snapshotComplete: request.queue_snapshot_complete === true,
        brokerName: request.broker_name || "",
        providerCode: request.provider_code || "",
        // Mirror the API builder: source_id is the normalized broker name
        // (e.g. "IC Markets EU Ltd" -> "IC_MARKETS_EU_LTD"), falling back to
        // an explicit request source_id, then "BROKER" as last resort.
        sourceId: (() => {
          const brokerName = text(request.broker_name, "");
          if (brokerName) return brokerName.toUpperCase().replace(/\s+/g, "_");
          return text(request.source_id, "BROKER");
        })(),
      },
    );
    let queueActions = request.queue_actions;
    if (typeof queueActions === "string") {
      try { queueActions = JSON.parse(queueActions); } catch { queueActions = []; }
    }
    const queue = await runtime.service.syncStrategyQueueActions(
      runtime.userId,
      runtime.accountId,
      Array.isArray(queueActions) ? queueActions : [],
      { snapshotComplete: request.queue_snapshot_complete === true },
    );
    return { ok: true, ...result, queue_actions: queue.items, queue_terminal_action_ids: queue.terminalActionIds };
  }
  if (operation === "bars") {
    let inserted = 0;
    const writes = [];
    const items = Array.isArray(request.items) ? request.items : [];
    const rawBars = Array.isArray(request.raw_bars) ? request.raw_bars : [];
    for (const raw of rawBars) {
      let item = raw;
      if (typeof raw === "string") {
        try { item = JSON.parse(raw); } catch { item = null; }
      }
      if (!item) continue;
      let target = items.find((candidate) => candidate && candidate.symbol === item.s && candidate.tf === item.tf);
      if (!target) {
        target = { symbol: item.s, tf: item.tf, bars: [] };
        items.push(target);
      }
      target.bars.push({
        time: item.t,
        open: item.o,
        high: item.h,
        low: item.l,
        close: item.c,
        volume: item.v,
      });
    }
    for (const item of items) {
      const symbol = text(item.symbol).toUpperCase();
      const tf = text(item.tf);
      if (!symbol || !tf || !Array.isArray(item.bars)) continue;
      const stored = await marketData.mergeBarsAsync(symbol, tf, item.bars, {
        dataRoot: path.join(runtime.projectRoot, "data"),
        provider: process.env.BARS_STORAGE_PROVIDER || "parquet_duckdb",
      });
      inserted += stored;
      const filePath = marketData.resolveBarsPath(symbol, tf, {
        dataRoot: path.join(runtime.projectRoot, "data"),
      });
      logIo(
        "parquet",
        "read/write",
        filePath,
        { operation, symbol, tf, rows: item.bars.length, stored },
      );
      writes.push({ symbol, tf, path: filePath, received: item.bars.length, stored });
    }
    return { ok: true, inserted, writes };
  }
  if (operation === "artifacts_get" || operation === "artifacts_merge") {
    const dataRoot = path.join(runtime.projectRoot, "data");
    const requested = Array.isArray(request.artifacts)
      ? request.artifacts
      : Array.isArray(request.items)
        ? [{ symbol: request.symbol, tf: request.tf, items: request.items }]
        : [];
    const groups = new Map();
    for (const item of requested) {
      const symbol = text(item?.symbol || request.symbol).toUpperCase();
      const tf = text(item?.tf || item?.timeframe || request.tf);
      if (!symbol || !tf) continue;
      const key = `${symbol}|${tf}`;
      const group = groups.get(key) || { symbol, tf, items: [] };
      // Do not spread an unbounded artifact snapshot into push(). V8 turns every
      // element into a function argument and large lookbacks can exceed the maximum
      // call stack before the merge logic even starts.
      if (Array.isArray(item?.items)) {
        for (const artifact of item.items) group.items.push(artifact);
      }
      groups.set(key, group);
    }
    const results = [];
    for (const group of groups.values()) {
      const options = { dataRoot };
      const existing = chartArtifacts.readMarketArtifacts(group.symbol, group.tf, options);
      const artifactPath = path.join(
        dataRoot,
        "market_data",
        group.symbol,
        "chart",
        chartArtifacts.normalizeTf(group.tf),
        "latest.json",
      );
      logIo("json", operation === "artifacts_get" ? "read" : "read/write", artifactPath, {
        operation,
        symbol: group.symbol,
        tf: chartArtifacts.normalizeTf(group.tf),
        items: group.items.length,
        existing_items: Array.isArray(existing?.items) ? existing.items.length : 0,
      });
      if (operation === "artifacts_get") {
        results.push({
          symbol: group.symbol,
          tf: chartArtifacts.normalizeTf(group.tf),
          path: artifactPath,
          status: existing ? "loaded" : "not_found",
          artifacts: existing || null,
        });
        continue;
      }
      // cTrader sends a complete snapshot for this symbol/timeframe. Remove its
      // previous ownership before merging so corrected labels and deleted artifacts
      // do not remain forever in the shared file. Preserve artifacts from other
      // producers such as 42trade or AI analysis.
      const existingForMerge = operation === "artifacts_merge" && existing
        ? {
            ...existing,
            items: (Array.isArray(existing.items) ? existing.items : []).filter(
              (item) => String(item?.source || "").trim().toLowerCase() !== "ctrader",
            ),
          }
        : existing;
      const envelope = chartArtifacts.mergeMarketArtifactDelta({
        symbol: group.symbol,
        timeframe: group.tf,
        items: group.items,
        existing: existingForMerge,
        userId: runtime.userId,
      });
      chartArtifacts.writeMarketArtifacts(group.symbol, group.tf, envelope, options);
      results.push({
        symbol: group.symbol,
        tf: chartArtifacts.normalizeTf(group.tf),
        path: artifactPath,
        previous_item_count: Array.isArray(existing?.items) ? existing.items.length : 0,
        item_count: envelope.items.length,
        accepted: group.items.length,
      });
    }
    if (operation === "artifacts_merge") chartArtifacts.flushMarketArtifactStore();
    return { ok: true, results };
  }
  throw new Error(`Unsupported local runtime operation: ${operation}`);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("request file or '-' stdin marker is required");
  const input = inputPath === "-"
    ? fs.readFileSync(0, "utf8")
    : fs.readFileSync(inputPath, "utf8");
  const request = JSON.parse(input);
  process.stdout.write(`${JSON.stringify(await run(request))}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
