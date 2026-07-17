"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createTradesService } = require("./service");

function tempSqlitePath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `trades-service-${label}-`));
  return path.join(dir, "trades.sqlite");
}

test("trades service exposes universal-store backed trade CRUD and counts", async () => {
  const service = createTradesService({
    sqlitePath: tempSqlitePath("service"),
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  const saved = await service.upsertTrade({
    sid: "TRD_SVC_1",
    account_id: "acc-1",
    user_id: "user",
    trade_id: "TRD_SVC_1",
    symbol: "BTCUSD",
    action: "BUY",
    trade_tf: "15m",
    chart_tf: "1h",
    dispatch_status: "NEW",
    execution_status: "PENDING",
  });
  const loaded = await service.getTrade({ sid: "TRD_SVC_1", user_id: "user" });
  const listed = await service.listTrades({ user_id: "user", page: 1, pageSize: 10 });
  const counts = await service.countTradesByExecutionStatus({ user_id: "user" });

  assert.equal(service.getStorageInfo().provider, "sqlite");
  assert.equal(saved.ok, true);
  assert.equal(loaded.trade.symbol, "BTCUSD");
  assert.equal(listed.total, 1);
  assert.equal(counts.counts.PENDING, 1);
});

test("trades service exposes broker sync operations", async () => {
  const service = createTradesService({
    sqlitePath: tempSqlitePath("service-sync"),
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  await service.upsertTrade({
    sid: "TRD_SVC_SYNC_1",
    account_id: "acc-1",
    user_id: "user",
    trade_id: "TRD_SVC_SYNC_1",
    symbol: "BTCUSD",
    action: "BUY",
    dispatch_status: "NEW",
    execution_status: "PENDING",
  });

  const leased = await service.pullLeasedTrades("user", "acc-1", 1, 30, null, {
    generateLeaseToken: () => "LEASE_SVC_1",
  });
  const acked = await service.ackTrade("user", "acc-1", {
    sid: "TRD_SVC_SYNC_1",
    trade_id: "TRD_SVC_SYNC_1",
    lease_token: "LEASE_SVC_1",
    execution_status: "FILLED",
    broker_trade_id: "7001",
  });
  const synced = await service.brokerSyncTrades(
    "user",
    "acc-1",
    [
      {
        sid: "TRD_SVC_SYNC_1",
        ticket: "7001",
        ticket_candidates: ["7001"],
        symbol: "BTCUSD",
        action: "BUY",
        execution_status: "CLOSED",
        pnl: 125,
      },
    ],
    {
      snapshotComplete: false,
      sourceId: "CTRADER",
    },
  );
  const loaded = await service.getTrade({ sid: "TRD_SVC_SYNC_1", user_id: "user" });

  assert.equal(leased.length, 1);
  assert.equal(acked.ok, true);
  assert.equal(synced.ok, true);
  assert.equal(loaded.trade.execution_status, "CLOSED");
  assert.equal(loaded.trade.broker_trade_id, "7001");
});

test("trades service exposes dashboard aggregates", async () => {
  const service = createTradesService({
    sqlitePath: tempSqlitePath("service-dashboard"),
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  await service.upsertTrade({
    sid: "TRD_DASH_1",
    account_id: "acc-1",
    user_id: "user",
    trade_id: "TRD_DASH_1",
    symbol: "BTCUSD",
    action: "BUY",
    source_id: "alpha",
    strategy: "Breakout",
    entry_model: "ModelA",
    trade_tf: "15m",
    chart_tf: "1h",
    execution_status: "CLOSED",
    close_reason: "TP",
    pnl_realized: 120,
    closed_at: "2026-07-10T10:00:00.000Z",
  });
  await service.upsertTrade({
    sid: "TRD_DASH_2",
    account_id: "acc-2",
    user_id: "user",
    trade_id: "TRD_DASH_2",
    symbol: "ETHUSD",
    action: "SELL",
    source_id: "beta",
    strategy: "Fade",
    entry_model: "ModelB",
    trade_tf: "5m",
    chart_tf: "15m",
    execution_status: "FILLED",
    broker_pnl: -20,
    planned_tp_pnl: 50,
    planned_sl_pnl: -30,
    opened_at: "2026-07-11T10:00:00.000Z",
  });

  const dashboard = await service.dashboard({
    user_id: "user",
    range: "all",
  });

  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.metrics.count_closed, 1);
  assert.equal(dashboard.metrics.count_filled, 1);
  assert.equal(dashboard.metrics.total_pnl, 120);
  assert.equal(dashboard.metrics.filled_open_pnl, -20);
  assert.deepEqual(dashboard.filters.symbols, ["BTCUSD", "ETHUSD"]);
  assert.deepEqual(dashboard.filters.accounts, ["acc-1", "acc-2"]);
  assert.equal(dashboard.top_winrate.symbols[0].key, "BTCUSD");
  assert.equal(dashboard.accounts_summary.length, 2);
});
