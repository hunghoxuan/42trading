"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  TRADES_SCOPE,
  TRADE_ENTITY_TYPE,
  createTradesRepo,
} = require("./repo");
const { createUniversalStoreFacade } = require("../../shared/universal-store");

function tempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `trades-${label}-`));
}

function seedRow(overrides = {}) {
  return {
    sid: "TRD_1",
    account_id: "acc-1",
    user_id: "user",
    trade_id: "TRD_1",
    source_id: "tv",
    strategy: "breakout",
    entry_model: "model-a",
    trade_tf: "15m",
    chart_tf: "1h",
    symbol: "BTCUSD",
    action: "BUY",
    order_type: "limit",
    volume: 0.2,
    entry: 65000,
    sl: 64800,
    tp: 65500,
    dispatch_status: "NEW",
    execution_status: "PENDING",
    note: "seeded trade",
    metadata: { provider_code: "ctrader" },
    raw_json: { source: "seed" },
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

async function openUniversalStore(sqlitePath) {
  const facade = createUniversalStoreFacade({
    provider: "sqlite",
    sqlitePath,
  });
  await facade.init();
  return facade;
}

test("trades can upsert and list trades from the universal-store backend", async () => {
  const sqlitePath = path.join(tempRoot("upsert"), "trades.sqlite");
  const repo = createTradesRepo({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  const saved = await repo.upsertTrade(seedRow());
  const listed = await repo.listTrades({ user_id: "user", page: 1, pageSize: 20 });
  const loaded = await repo.getTrade({ sid: "TRD_1", user_id: "user" });
  const counts = await repo.countTradesByExecutionStatus({ user_id: "user" });
  const store = await openUniversalStore(sqlitePath);
  const entity = await store.getEntity(TRADES_SCOPE, TRADE_ENTITY_TYPE, "TRD_1");

  assert.equal(saved.ok, true);
  assert.equal(loaded.trade.sid, "TRD_1");
  assert.equal(listed.items.length, 1);
  assert.equal(counts.counts.PENDING, 1);
  assert.equal(entity.data.symbol, "BTCUSD");
  assert.equal(entity.state, "PENDING");
});

test("trades clones current sqlite trades into the new universal store without changing source data", async () => {
  const projectRoot = tempRoot("clone");
  const targetSqlitePath = path.join(projectRoot, ".local", "trades.sqlite");
  fs.mkdirSync(path.dirname(targetSqlitePath), { recursive: true });
  const sourceRows = [
    seedRow(),
    seedRow({
      sid: "TRD_2",
      trade_id: "TRD_2",
      execution_status: "FILLED",
      dispatch_status: "CONSUMED",
      symbol: "ETHUSD",
      action: "SELL",
      updated_at: "2026-07-01T01:00:00.000Z",
    }),
  ];
  const sourceRepo = {
    async listTradesV2(userId, filters = {}, page = 1, pageSize = 50) {
      const scoped = sourceRows.filter((row) => {
        const effectiveUserId = filters.user_id || userId || "";
        return !effectiveUserId || row.user_id === effectiveUserId;
      });
      const offset = (Math.max(1, page) - 1) * pageSize;
      return {
        items: scoped.slice(offset, offset + pageSize),
        total: scoped.length,
        page,
        page_size: pageSize,
      };
    },
  };

  const repo = createTradesRepo({
    projectRoot,
    sqlitePath: targetSqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
    sourceRepo,
    sourceUserIds: ["user"],
    defaultUserId: "user",
  });

  const cloned = await repo.cloneFromCurrentTrades({ user_id: "user", pageSize: 50 });
  const listed = await repo.listTrades({ user_id: "user", page: 1, pageSize: 50 });

  assert.equal(cloned.ok, true);
  assert.equal(cloned.cloned, 2);
  assert.equal(listed.items.length, 2);
  assert.equal(sourceRows.length, 2);
  assert.deepEqual(
    listed.items.map((item) => item.sid).sort(),
    ["TRD_1", "TRD_2"],
  );
});

test("trades broker pull and ack update entity state and append journal entries", async () => {
  const sqlitePath = path.join(tempRoot("lease-ack"), "trades.sqlite");
  const repo = createTradesRepo({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });
  const store = await openUniversalStore(sqlitePath);

  await repo.upsertTrade(
    seedRow({
      sid: "TRD_ACK_1",
      trade_id: "TRD_ACK_1",
      note: "lease-ack",
    }),
    { appendJournal: false },
  );

  const leased = await repo.pullLeasedTrades(
    "user",
    "acc-1",
    1,
    30,
    null,
    {
      now: "2026-07-10T10:00:00.000Z",
      generateLeaseToken: () => "LEASE_1",
    },
  );
  assert.equal(leased.length, 1);
  assert.equal(leased[0].dispatch_status, "LEASED");
  assert.equal(leased[0].lease_token, "LEASE_1");

  const acked = await repo.ackTrade("user", "acc-1", {
    sid: "TRD_ACK_1",
    trade_id: "TRD_ACK_1",
    lease_token: "LEASE_1",
    execution_status: "FILLED",
    broker_trade_id: "9001",
    entry_exec: 65010,
  });
  const loaded = await repo.getTrade({ sid: "TRD_ACK_1", user_id: "user" });
  const journal = await store.listJournal({
    tenantId: TRADES_SCOPE,
    entityType: TRADE_ENTITY_TYPE,
    entityKey: "TRD_ACK_1",
    limit: 20,
  });

  assert.equal(acked.ok, true);
  assert.equal(acked.execution_status, "FILLED");
  assert.equal(loaded.trade.dispatch_status, "CONSUMED");
  assert.equal(loaded.trade.execution_status, "FILLED");
  assert.equal(loaded.trade.broker_trade_id, "9001");
  assert.equal(loaded.trade.lease_token, null);
  assert.equal(
    journal.some((item) => item.entry_type === "trade.task_leased"),
    true,
  );
  assert.equal(journal.some((item) => item.entry_type === "trade.ack"), true);
});

test("trades broker pull preserves planned lots from array trade_plan metadata", async () => {
  const sqlitePath = path.join(tempRoot("planned-lots"), "trades.sqlite");
  const repo = createTradesRepo({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  await repo.upsertTrade(
    seedRow({
      sid: "TRD_PLAN_1",
      trade_id: "TRD_PLAN_1",
      account_id: "",
      volume: 0,
      metadata: {
        trade_plan: [
          {
            lots: 0.13,
            volume: 0.13,
          },
        ],
      },
    }),
    { appendJournal: false },
  );

  const leased = await repo.pullLeasedTrades("user", "acc-1", 1, 30, null, {
    now: "2026-07-10T10:00:00.000Z",
    generateLeaseToken: () => "LEASE_PLAN_1",
  });
  const task = await repo.pullAndLockNextTask("acc-1", {
    userId: "user",
    now: "2026-07-10T10:00:40.000Z",
    generateLeaseToken: () => "LEASE_PLAN_2",
  });
  const loaded = await repo.getTrade({ sid: "TRD_PLAN_1", user_id: "user" });

  assert.equal(leased.length, 1);
  assert.equal(loaded.trade.account_id, "acc-1");
  assert.equal(task.lots, 0.13);
  assert.equal(task.volume, 0.13);
});

test("trades ack accepts leased rows that were created before account_id was assigned", async () => {
  const sqlitePath = path.join(tempRoot("blank-account-ack"), "trades.sqlite");
  const repo = createTradesRepo({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  await repo.upsertTrade(
    seedRow({
      sid: "TRD_ACK_EMPTY_ACCOUNT",
      trade_id: "TRD_ACK_EMPTY_ACCOUNT",
      account_id: "",
      dispatch_status: "LEASED",
      lease_token: "LEASE_EMPTY_1",
      lease_expires_at: "2026-07-10T10:00:30.000Z",
      metadata: {
        leased_dispatch_status: "OPEN",
      },
    }),
    { appendJournal: false },
  );

  const acked = await repo.ackTrade("user", "acc-1", {
    sid: "TRD_ACK_EMPTY_ACCOUNT",
    trade_id: "TRD_ACK_EMPTY_ACCOUNT",
    lease_token: "LEASE_EMPTY_1",
    execution_status: "PENDING",
    broker_trade_id: "9911",
  });
  const loaded = await repo.getTrade({
    sid: "TRD_ACK_EMPTY_ACCOUNT",
    user_id: "user",
  });

  assert.equal(acked.ok, true);
  assert.equal(loaded.trade.account_id, "acc-1");
  assert.equal(loaded.trade.broker_trade_id, "9911");
});

test("trades failed broker ack preserves planned levels on the trade row", async () => {
  const sqlitePath = path.join(tempRoot("ack-preserve-levels"), "trades.sqlite");
  const repo = createTradesRepo({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  await repo.upsertTrade(
    seedRow({
      sid: "TRD_ACK_FAIL_LEVELS",
      trade_id: "TRD_ACK_FAIL_LEVELS",
      account_id: "acc-1",
      dispatch_status: "LEASED",
      lease_token: "LEASE_FAIL_1",
      lease_expires_at: "2026-07-10T10:00:30.000Z",
      entry: 1.14408,
      sl: 1.14341,
      tp: 1.14542,
      tp1: 1.14542,
      metadata: {
        trade_plan: [
          {
            entry: 1.14408,
            sl: 1.14341,
            tp: 1.14542,
            tp1: 1.14542,
          },
        ],
      },
    }),
    { appendJournal: false },
  );

  const acked = await repo.ackTrade("user", "acc-1", {
    sid: "TRD_ACK_FAIL_LEVELS",
    trade_id: "TRD_ACK_FAIL_LEVELS",
    lease_token: "LEASE_FAIL_1",
    execution_status: "FAIL",
    message: "SL too close",
    entry_exec: 0,
  });
  const loaded = await repo.getTrade({
    sid: "TRD_ACK_FAIL_LEVELS",
    user_id: "user",
  });

  assert.equal(acked.ok, true);
  assert.equal(loaded.trade.execution_status, "REJECTED");
  assert.equal(loaded.trade.entry, 1.14408);
  assert.equal(loaded.trade.sl, 1.14341);
  assert.equal(loaded.trade.tp, 1.14542);
  assert.equal(loaded.trade.tp1, 1.14542);
});

test("trades ack applies adjusted broker levels and recalculates rr", async () => {
  const sqlitePath = path.join(tempRoot("ack-adjusted-levels"), "trades.sqlite");
  const repo = createTradesRepo({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  await repo.upsertTrade(
    seedRow({
      sid: "TRD_ACK_ADJUSTED",
      trade_id: "TRD_ACK_ADJUSTED",
      symbol: "EURUSD",
      entry: 1.14346,
      sl: 1.14403,
      tp: 1.14232,
      rr_planned: 2,
      dispatch_status: "LEASED",
      lease_token: "LEASE_ADJUSTED_1",
      lease_expires_at: "2026-07-17T18:45:30.000Z",
    }),
    { appendJournal: false },
  );

  const acked = await repo.ackTrade("user", "acc-1", {
    sid: "TRD_ACK_ADJUSTED",
    trade_id: "TRD_ACK_ADJUSTED",
    lease_token: "LEASE_ADJUSTED_1",
    execution_status: "FILLED",
    broker_trade_id: "9015",
    entry_exec: 1.14346,
    requested_sl: 1.14403,
    requested_tp: 1.14232,
    used_sl: 1.14496,
    used_tp: 1.14046,
    sl_exec: 1.14496,
    tp_exec: 1.14046,
  });
  const loaded = await repo.getTrade({
    sid: "TRD_ACK_ADJUSTED",
    user_id: "user",
  });

  assert.equal(acked.ok, true);
  assert.equal(loaded.trade.execution_status, "FILLED");
  assert.equal(loaded.trade.sl, 1.14496);
  assert.equal(loaded.trade.tp, 1.14046);
  assert.equal(loaded.trade.sl_exec, 1.14496);
  assert.equal(loaded.trade.tp_exec, 1.14046);
  assert.equal(loaded.trade.metadata.requested_sl, 1.14403);
  assert.equal(loaded.trade.metadata.used_sl, 1.14496);
  assert.equal(loaded.trade.rr_planned, 2);
});

test("trades broker sync creates discovered trades and snapshot-closes missing tickets", async () => {
  const sqlitePath = path.join(tempRoot("sync"), "trades.sqlite");
  const repo = createTradesRepo({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });
  const store = await openUniversalStore(sqlitePath);

  await repo.upsertTrade(
    seedRow({
      sid: "TRD_OPEN_1",
      trade_id: "TRD_OPEN_1",
      broker_trade_id: "111",
      dispatch_status: "CONSUMED",
      execution_status: "FILLED",
      opened_at: "2026-07-10T09:00:00.000Z",
    }),
    { appendJournal: false },
  );

  const synced = await repo.brokerSyncTrades(
    "user",
    "acc-1",
    [
      {
        ticket: "222",
        ticket_candidates: ["222"],
        symbol: "ETHUSD",
        action: "SELL",
        execution_status: "FILLED",
        lots: 0.15,
        volume: 0.15,
        entry: 3500,
        sl: 3550,
        tp: 3400,
        note: "new-remote-trade",
      },
    ],
    {
      now: "2026-07-10T10:30:00.000Z",
      snapshotComplete: true,
      brokerName: "ctrader",
      providerCode: "ctrader",
      sourceId: "CTRADER",
    },
  );

  const created = await repo.getTrade({ sid: "M_222", user_id: "user" });
  const closed = await repo.getTrade({ sid: "TRD_OPEN_1", user_id: "user" });
  const journal = await store.listJournal({
    tenantId: TRADES_SCOPE,
    limit: 50,
  });

  assert.equal(synced.ok, true);
  assert.equal(synced.results.some((item) => item.status === "Added"), true);
  assert.equal(synced.results.some((item) => item.sid === "M_222"), true);
  assert.equal(created.trade.symbol, "ETHUSD");
  assert.equal(created.trade.broker_trade_id, "222");
  assert.equal(created.trade.metadata.last_sync_source, "broker_sync_v2");
  assert.equal(closed.trade.execution_status, "CLOSED");
  assert.equal(closed.trade.close_reason, "MANUAL");
  assert.equal(
    journal.some((item) => item.entry_type === "trade.sync_create"),
    true,
  );
  assert.equal(
    journal.some(
      (item) =>
        item.entry_type === "trade.sync_close" &&
        item.entity_key === "TRD_OPEN_1",
    ),
    true,
  );
});

test("trades broker sync treats broker comment note suffix as non-identity", async () => {
  const sqlitePath = path.join(tempRoot("sync-comment-sid"), "trades.sqlite");
  const repo = createTradesRepo({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  await repo.upsertTrade(
    seedRow({
      sid: "TI9QDEGAI",
      trade_id: "TI9QDEGAI",
      broker_trade_id: "",
      dispatch_status: "LEASED",
      execution_status: "PENDING",
      symbol: "BTCUSD",
      action: "SELL",
    }),
    { appendJournal: false },
  );

  const synced = await repo.brokerSyncTrades(
    "user",
    "acc-1",
    [
      {
        ticket: "53668926",
        ticket_candidates: ["53668926"],
        comment: "TI9QDEGAI | Bearish setup with BOS + CHoCH",
        symbol: "BTCUSD",
        action: "SELL",
        execution_status: "PENDING",
        lots: 0.01,
        volume: 0.01,
        entry: 63062,
      },
    ],
    {
      now: "2026-07-10T10:30:00.000Z",
      snapshotComplete: false,
      brokerName: "ctrader",
      providerCode: "ctrader",
      sourceId: "CTRADER",
    },
  );

  const existing = await repo.getTrade({ sid: "TI9QDEGAI", user_id: "user" });
  const discovered = await repo.getTrade({ sid: "M_53668926", user_id: "user" });

  assert.equal(synced.ok, true);
  assert.equal(synced.results.some((item) => item.status === "Added"), false);
  assert.equal(existing.trade.broker_trade_id, "53668926");
  assert.equal(existing.trade.dispatch_status, "CONSUMED");
  assert.equal(discovered.trade, null);
});

test("trades broker sync preserves planned order type from raw_json for existing trades", async () => {
  const sqlitePath = path.join(tempRoot("sync-order-type"), "trades.sqlite");
  const repo = createTradesRepo({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  await repo.upsertTrade(
    seedRow({
      sid: "TRD_SYNC_TYPE_1",
      trade_id: "TRD_SYNC_TYPE_1",
      source_id: "ai_claude",
      order_type: "limit",
      execution_status: "PENDING",
      dispatch_status: "LEASED",
      metadata: {
        provider_code: "ctrader",
        raw_json: {
          order_type: "Limit",
          trade_plan: [{ order_type: "Limit" }],
        },
      },
      raw_json: {
        order_type: "Limit",
        trade_plan: [{ order_type: "Limit" }],
      },
      note: "TRD_SYNC_TYPE_1",
    }),
    { appendJournal: false },
  );

  const synced = await repo.brokerSyncTrades(
    "user",
    "acc-1",
    [
      {
        ticket: "654321",
        ticket_candidates: ["654321"],
        note: "TRD_SYNC_TYPE_1",
        symbol: "BTCUSD",
        action: "BUY",
        execution_status: "FILLED",
        order_type: "MARKET",
        lots: 0.2,
        volume: 0.2,
        entry: 65010,
        sl: 64800,
        tp: 65500,
      },
    ],
    {
      now: "2026-07-10T10:30:00.000Z",
      snapshotComplete: false,
      brokerName: "ctrader",
      providerCode: "ctrader",
      sourceId: "CTRADER",
    },
  );

  const loaded = await repo.getTrade({
    sid: "TRD_SYNC_TYPE_1",
    user_id: "user",
  });

  assert.equal(synced.ok, true);
  assert.equal(loaded.trade.order_type, "limit");
  assert.equal(loaded.trade.metadata.order_type, "limit");
  assert.equal(loaded.trade.metadata.broker_order_type, "market");
  assert.equal(loaded.trade.metadata.broker_data.order_type, "MARKET");
});

test("trades upsert canonicalizes stored order type from raw_json", async () => {
  const sqlitePath = path.join(tempRoot("upsert-order-type"), "trades.sqlite");
  const repo = createTradesRepo({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    sourceStorageBackend: "sqlite",
  });

  const saved = await repo.upsertTrade(
    seedRow({
      sid: "TRD_UPSERT_TYPE_1",
      trade_id: "TRD_UPSERT_TYPE_1",
      source_id: "ai_claude",
      order_type: "market",
      execution_status: "PENDING",
      dispatch_status: "NEW",
      metadata: {
        raw_json: {
          order_type: "Limit",
          trade_plan: [{ order_type: "Limit" }],
        },
      },
      raw_json: {
        order_type: "Limit",
        trade_plan: [{ order_type: "Limit" }],
      },
      note: "TRD_UPSERT_TYPE_1",
    }),
    { appendJournal: false },
  );

  const loaded = await repo.getTrade({
    sid: "TRD_UPSERT_TYPE_1",
    user_id: "user",
  });

  assert.equal(saved.trade.order_type, "limit");
  assert.equal(loaded.trade.order_type, "limit");
  assert.equal(loaded.trade.raw_json.order_type, "Limit");
});
