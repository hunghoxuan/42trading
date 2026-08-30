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

test("trades service persists and terminates strategy queue actions", async () => {
  const service = createTradesService({
    sqlitePath: tempSqlitePath("strategy-actions"),
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });
  const waiting = {
    action_id: "ENTRYBAR|custom_trade|BTCUSD|h4|Buy|1",
    status: "WAITING",
    symbol: "BTCUSD",
    side: "BUY",
    tf: "h4",
    trigger_time: "2026-08-14T04:00:00.000Z",
    trade_chain_slot: 2,
    trade_chain_mode: "Wait_confirm",
    entry_bar_mode: "First_bar_same_trend",
  };

  const firstSync = await service.syncStrategyQueueActions(
    "user",
    "acc-1",
    [waiting],
  );
  const restored = await service.listStrategyQueueActions("user", "acc-1");
  const terminalSync = await service.syncStrategyQueueActions(
    "user",
    "acc-1",
    [{ action_id: waiting.action_id, status: "RELEASED" }],
  );

  assert.equal(firstSync.accepted, 1);
  assert.equal(firstSync.items.length, 1);
  assert.equal(restored[0].action_id, waiting.action_id);
  assert.equal(restored[0].trade_chain_slot, 2);
  assert.equal(restored[0].trade_chain_mode, "Wait_confirm");
  assert.equal(restored[0].entry_bar_mode, "First_bar_same_trend");
  assert.equal(terminalSync.accepted, 1);
  assert.equal(terminalSync.items.length, 0);
});

test("trades service edits and cancels queue actions without broker resurrection", async () => {
  const service = createTradesService({
    sqlitePath: tempSqlitePath("strategy-actions-admin"),
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });
  const waiting = {
    action_id: "ENTRYBAR|custom_trade|BTCUSD|h4|Buy|2",
    status: "WAITING",
    symbol: "BTCUSD",
    side: "BUY",
    tf: "h4",
    account_id: "acc-1",
    trigger_time: "2026-08-14T08:00:00.000Z",
    entry: 65000,
    sl: 64000,
    tp: 67000,
  };

  await service.syncStrategyQueueActions("user", "acc-1", [waiting]);
  const updated = await service.updateStrategyQueueAction(
    "user",
    waiting.action_id,
    { entry: 65100, note: "edited in queue" },
    "acc-1",
  );
  const allAccounts = await service.listStrategyQueueActions("user");
  await service.syncStrategyQueueActions("user", "acc-1", [waiting]);
  const afterStaleBrokerSync = await service.listStrategyQueueActions("user", "acc-1");
  await service.removeStrategyQueueAction("user", waiting.action_id, "acc-1");
  const resurrect = await service.syncStrategyQueueActions("user", "acc-1", [waiting]);

  assert.equal(updated.item.entry, 65100);
  assert.equal(updated.item.note, "edited in queue");
  assert.equal(allAccounts.length, 1);
  assert.equal(afterStaleBrokerSync[0].entry, 65100);
  assert.equal(afterStaleBrokerSync[0].note, "edited in queue");
  assert.equal(resurrect.accepted, 0);
  assert.equal(resurrect.items.length, 0);
});

test("trades service removes waiting actions missing from a complete queue snapshot", async () => {
  const service = createTradesService({
    sqlitePath: tempSqlitePath("strategy-actions-snapshot"),
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });
  const first = {
    action_id: "ENTRYBAR|BTCUSD|m5|1",
    status: "WAITING",
    symbol: "BTCUSD",
    side: "BUY",
    tf: "m5",
  };
  const second = {
    action_id: "POSITION|42|exit",
    action_type: "position.close",
    status: "WAITING",
    symbol: "ETHUSD",
    side: "SELL",
    tf: "m5",
  };

  await service.syncStrategyQueueActions("user", "acc-1", [first, second]);
  const result = await service.syncStrategyQueueActions(
    "user",
    "acc-1",
    [first],
    { snapshotComplete: true },
  );
  const staleReplay = await service.syncStrategyQueueActions("user", "acc-1", [second]);

  assert.equal(result.removed, 1);
  assert.deepEqual(result.items.map((item) => item.action_id), [first.action_id]);
  assert.ok(result.terminalActionIds.includes(second.action_id));
  assert.equal(staleReplay.accepted, 0);
  assert.equal(staleReplay.items.length, 1);
});

test("trades service preserves waiting actions before broker queue hydration", async () => {
  const service = createTradesService({
    sqlitePath: tempSqlitePath("strategy-actions-pre-hydration"),
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });
  const waiting = {
    action_id: "ENTRYBAR|custom_trade|BTCUSD|h1|Buy|3",
    status: "WAITING",
    symbol: "BTCUSD",
    side: "BUY",
    tf: "h1",
    account_id: "acc-1",
    trigger_time: "2026-08-14T09:00:00.000Z",
  };

  await service.syncStrategyQueueActions("user", "acc-1", [waiting]);
  const preHydration = await service.syncStrategyQueueActions(
    "user",
    "acc-1",
    [],
    { snapshotComplete: false },
  );

  assert.equal(preHydration.removed, 0);
  assert.deepEqual(preHydration.items.map((item) => item.action_id), [waiting.action_id]);
});

test("trades service filters plural execution statuses and deletes by sid", async () => {
  const service = createTradesService({
    sqlitePath: tempSqlitePath("service-delete"),
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  await service.upsertTrade({
    sid: "TRD_DEL_REJECTED",
    user_id: "user",
    trade_id: "TRD_DEL_REJECTED",
    symbol: "BTCUSD",
    action: "BUY",
    execution_status: "REJECTED",
  });
  await service.upsertTrade({
    sid: "TRD_DEL_PENDING",
    user_id: "user",
    trade_id: "TRD_DEL_PENDING",
    symbol: "BTCUSD",
    action: "BUY",
    execution_status: "PENDING",
  });

  const rejected = await service.listTrades({
    user_id: "user",
    execution_statuses: ["ERROR", "REJECTED"],
    page: 1,
    pageSize: 10,
  });
  const deleted = await service.deleteTradesBySids("user", ["TRD_DEL_REJECTED"]);
  const remaining = await service.listTrades({ user_id: "user", page: 1, pageSize: 10 });

  assert.equal(rejected.total, 1);
  assert.equal(rejected.items[0].sid, "TRD_DEL_REJECTED");
  assert.equal(deleted.deleted, 1);
  assert.deepEqual(remaining.items.map((item) => item.sid), ["TRD_DEL_PENDING"]);
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
