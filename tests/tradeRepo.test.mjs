import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createTradeRepository,
  resolveUserTradeDbPath,
} = require("../src/api/modules/42trade/trades0/tradesRepo.js");
const ctraderExecutorBridge = require("../scripts/daemons/ctrader_executor_bridge.js");
const ctraderDownstreamServer = require("../scripts/daemons/ctrader_downstream_server.js");

function makeTempProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trade-repo-"));
}

test("resolveUserTradeDbPath stores SQLite data under data/users/<user>/data.db", () => {
  const projectRoot = "/tmp/forty-two-trade";
  assert.equal(
    resolveUserTradeDbPath("alice", { projectRoot }),
    path.join(projectRoot, "data", "users", "alice", "data.db"),
  );
  assert.equal(
    resolveUserTradeDbPath("", { projectRoot }),
    path.join(projectRoot, "data", "users", "default", "data.db"),
  );
});

test("tradeRepo routes backend execution through Drizzle adapters", () => {
  const source = fs.readFileSync(
    path.resolve("src/api/trades/tradesCore.js"),
    "utf8",
  );
  const pgCompatStart = source.indexOf("function createPgCompat");
  const pgCompatEnd = source.indexOf("function getSqliteDb");
  const pgCompatSource =
    pgCompatStart >= 0 && pgCompatEnd > pgCompatStart
      ? source.slice(pgCompatStart, pgCompatEnd)
      : source;

  assert.match(source, /drizzle-orm\/better-sqlite3/);
  assert.match(source, /drizzle-orm\/node-postgres/);
  assert.doesNotMatch(source, /postgresPool\.query\s*\(/);
  assert.doesNotMatch(source, /require\("node:sqlite"\)/);
  assert.doesNotMatch(pgCompatSource, /db\.all\s*\(/);
});

test("sqlite schema bootstrap declares the expected trades indexes", () => {
  const sqliteMigrationSource = fs.readFileSync(
    path.resolve("src/db/migrations/sqlite/0000_core_schema.sql"),
    "utf8",
  );
  const postgresMigrationSource = fs.readFileSync(
    path.resolve("src/db/migrations/postgres/0000_core_schema.sql"),
    "utf8",
  );

  for (const indexName of [
    "idx_trades_created_at",
    "idx_trades_symbol",
    "idx_trades_exec_status",
    "idx_trades_account",
    "idx_trades_dispatch_queue",
    "idx_trades_signal_id",
    "idx_trades_broker_ticket",
  ]) {
    assert.match(sqliteMigrationSource, new RegExp(indexName));
    assert.match(postgresMigrationSource, new RegExp(indexName));
  }
});

test("sqlite repository lists, counts, and manually updates trades in a user-scoped database", async () => {
  const projectRoot = makeTempProjectRoot();
  const repo = createTradeRepository({
    storageBackend: "sqlite",
    projectRoot,
  });

  const seedRows = [
    {
      sid: "TRD_ALPHA",
      account_id: "acct-1",
      user_id: "alice",
      symbol: "XAUUSD",
      action: "BUY",
      execution_status: "PENDING",
      dispatch_status: "OPEN",
      entry: 2300.5,
      metadata: { seed: 1 },
      raw_json: { plan: "alpha" },
      created_at: "2026-06-10T10:00:00.000Z",
      updated_at: "2026-06-10T10:00:00.000Z",
    },
    {
      sid: "TRD_BETA",
      account_id: "acct-2",
      user_id: "alice",
      symbol: "BTCUSD",
      action: "SELL",
      execution_status: "FILLED",
      dispatch_status: "CONSUMED",
      entry: 105000,
      metadata: { seed: 2 },
      raw_json: { plan: "beta" },
      created_at: "2026-06-11T11:00:00.000Z",
      updated_at: "2026-06-11T11:00:00.000Z",
    },
  ];

  await repo.seedTrades("alice", seedRows);

  const list = await repo.listTradesV2("alice", { q: "XAU" }, 1, 50);
  assert.equal(list.total, 1);
  assert.equal(list.items[0].sid, "TRD_ALPHA");
  assert.equal(list.items[0].metadata.seed, 1);

  const counts = await repo.countTradesByExecutionStatus("alice");
  assert.deepEqual(counts, {
    FILLED: 1,
    PENDING: 1,
  });

  const updated = await repo.updateTradeManual("alice", "TRD_ALPHA", {
    execution_status: "CANCELLED",
    close_reason: "MANUAL",
    reason: "MANUAL",
    pnl_realized: -25.5,
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.item.executionStatus, "CANCELLED");
  assert.equal(updated.item.closeReason, "MANUAL");
  assert.equal(updated.item.pnlRealized, -25.5);
  assert.equal(updated.item.dispatchStatus, "CONSUMED");
  assert.equal(updated.item.metadata.manual_requested_status, "CANCELLED");

  const reloaded = await repo.loadTrade("alice", "TRD_ALPHA");
  assert.equal(reloaded.executionStatus, "CANCELLED");
  assert.equal(reloaded.closeReason, "MANUAL");
  assert.equal(reloaded.metadata.manual_requested_reason, "MANUAL");
});

test("sqlite repository can lease broker tasks and apply broker ack updates", async () => {
  const projectRoot = makeTempProjectRoot();
  const repo = createTradeRepository({
    storageBackend: "sqlite",
    projectRoot,
  });

  await repo.seedTrades("broker_user", [
    {
      sid: "TRD_LEASE",
      account_id: "acct-broker",
      user_id: "broker_user",
      symbol: "EURUSD",
      action: "BUY",
      execution_status: "PENDING",
      dispatch_status: "OPEN",
      volume: 0.25,
      entry: 1.101,
      sl: 1.099,
      tp: 1.105,
      metadata: {},
      created_at: "2026-06-12T08:00:00.000Z",
      updated_at: "2026-06-12T08:00:00.000Z",
    },
  ]);

  const leased = await repo.pullLeasedTrades(
    "broker_user",
    "acct-broker",
    1,
    30,
    null,
    {
      generateLeaseToken: () => "LEASE_TOKEN_1",
      now: "2026-06-12T08:01:00.000Z",
      maxAgeHours: 24,
      maxLeaseRetries: 3,
    },
  );

  assert.equal(leased.length, 1);
  assert.equal(leased[0].dispatchStatus, "LEASED");
  assert.equal(leased[0].leaseToken, "LEASE_TOKEN_1");

  const ack = await repo.ackTrade("broker_user", "acct-broker", {
    sid: "TRD_LEASE",
    lease_token: "LEASE_TOKEN_1",
    execution_status: "FILLED",
    broker_trade_id: "BRK-1",
    entry_exec: 1.1012,
    used_volume: 0.2,
    sl_pips: 20,
    tp_pips: 40,
  });

  assert.equal(ack.ok, true);
  assert.equal(ack.dispatch_status, "CONSUMED");
  assert.equal(ack.execution_status, "FILLED");
  assert.equal(ack.item.brokerTradeId, "BRK-1");
  assert.equal(ack.item.leaseToken, null);
  assert.equal(ack.item.metadata.sl_pips, 20);
  assert.equal(ack.item.metadata.tp_pips, 40);

  const duplicate = await repo.ackTrade("broker_user", "acct-broker", {
    sid: "TRD_LEASE",
    lease_token: "LEASE_TOKEN_1",
    execution_status: "FILLED",
    broker_trade_id: "BRK-1",
  });

  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
});

test("sqlite repository updates trade plans and escalates broker-linked consumed trades to MODIFY", async () => {
  const projectRoot = makeTempProjectRoot();
  const repo = createTradeRepository({
    storageBackend: "sqlite",
    projectRoot,
  });

  await repo.seedTrades("planner", [
    {
      sid: "PLAN_1",
      account_id: "acct-plan",
      user_id: "planner",
      symbol: "EURUSD",
      action: "BUY",
      execution_status: "PENDING",
      dispatch_status: "CONSUMED",
      broker_trade_id: "BRK-PLAN-1",
      entry: 1.1,
      sl: 1.09,
      tp: 1.12,
      metadata: { existing: true },
      created_at: "2026-06-12T09:00:00.000Z",
      updated_at: "2026-06-12T09:00:00.000Z",
    },
  ]);

  const out = await repo.updateTradePlan("planner", "PLAN_1", {
    entry: 1.1015,
    sl: 1.091,
    tp: 1.123,
    note: "reworked plan",
    metadata: { existing: true, planned: true },
    order_type: "limit",
    dispatch_modify_if_broker_linked: true,
  });

  assert.equal(out.ok, true);
  assert.equal(out.item.entry, 1.1015);
  assert.equal(out.item.sl, 1.091);
  assert.equal(out.item.tp, 1.123);
  assert.equal(out.item.note, "reworked plan");
  assert.equal(out.item.metadata.planned, true);
  assert.equal(out.item.dispatchStatus, "MODIFY");

  const folderRows = await repo.listTradeFolderStates("planner");
  assert.deepEqual(folderRows, [
    {
      sid: "PLAN_1",
      symbol: "EURUSD",
      execution_status: "PENDING",
    },
  ]);
});

test("sqlite repository broker sync updates matched trades and closes missing broker tickets on snapshot", async () => {
  const projectRoot = makeTempProjectRoot();
  const repo = createTradeRepository({
    storageBackend: "sqlite",
    projectRoot,
  });

  await repo.seedTrades("sync_user", [
    {
      sid: "SYNC_1",
      account_id: "acct-sync",
      user_id: "sync_user",
      symbol: "XAUUSD",
      action: "BUY",
      execution_status: "FILLED",
      dispatch_status: "LEASED",
      broker_trade_id: "TK-1",
      entry: 2300,
      sl: 2290,
      tp: 2320,
      metadata: {},
      created_at: "2026-06-12T07:00:00.000Z",
      updated_at: "2026-06-12T07:00:00.000Z",
    },
    {
      sid: "SYNC_2",
      account_id: "acct-sync",
      user_id: "sync_user",
      symbol: "BTCUSD",
      action: "SELL",
      execution_status: "FILLED",
      dispatch_status: "CONSUMED",
      broker_trade_id: "TK-2",
      entry: 105000,
      metadata: {},
      created_at: "2026-06-12T07:01:00.000Z",
      updated_at: "2026-06-12T07:01:00.000Z",
    },
  ]);

  const out = await repo.brokerSyncTrades(
    "sync_user",
    "acct-sync",
    [
      {
        sid: "SYNC_1",
        ticket: "TK-1",
        ticket_candidates: ["TK-1"],
        symbol: "XAUUSD",
        action: "BUY",
        execution_status: "FILLED",
        entry: 2301,
        sl: 2292,
        tp: 2325,
        pnl: 42,
        pips: 12,
        lots: 0.2,
        commission: -1.2,
        swap: 0,
        broker_volume: 20000,
        margin: 100,
        order_type: "LIMIT",
        has_partial: false,
      },
    ],
    {
      snapshotComplete: true,
      brokerName: "Test Broker",
      providerCode: "TEST",
      sourceId: "BROKER",
      now: "2026-06-12T08:30:00.000Z",
      generateSid: () => "GEN_SYNC",
    },
  );

  assert.equal(out.ok, true);
  assert.equal(out.matched, 1);
  assert.equal(out.closed_by_snapshot, 1);

  const updated = await repo.loadTrade("sync_user", "SYNC_1", {
    user_id: "sync_user",
  });
  assert.equal(updated.dispatchStatus, "CONSUMED");
  assert.equal(updated.brokerPnl, 42);
  assert.equal(updated.sl, 2292);
  assert.equal(updated.tp, 2325);
  assert.equal(updated.metadata.provider_code, "TEST");

  const closed = await repo.loadTrade("sync_user", "SYNC_2", {
    user_id: "sync_user",
  });
  assert.equal(closed.executionStatus, "CLOSED");
  assert.equal(closed.closeReason, "MANUAL");
});

test("sqlite repository broker sync inserts new trades using normalized symbol and action", async () => {
  const projectRoot = makeTempProjectRoot();
  const repo = createTradeRepository({
    storageBackend: "sqlite",
    projectRoot,
  });

  const out = await repo.brokerSyncTrades(
    "sync_user",
    "acct-sync",
    [
      {
        ticket: "TK-NEW-1",
        ticket_candidates: ["TK-NEW-1"],
        symbol: "OANDA:XAU/USD",
        action: "short",
        execution_status: "FILLED",
        entry: 3388.25,
        sl: 3394.5,
        tp: 3376.75,
        pnl: 18.5,
        pips: 115,
        lots: 0.1,
        broker_volume: 10000,
        margin: 50,
        order_type: "MARKET",
      },
    ],
    {
      snapshotComplete: true,
      brokerName: "Test Broker",
      providerCode: "TEST",
      sourceId: "BROKER",
      now: "2026-06-20T11:16:46.082Z",
      generateSid: () => "GEN_SYNC_NEW",
    },
  );

  assert.equal(out.ok, true);
  assert.equal(out.results[0].status, "Added");

  const inserted = await repo.loadTrade("sync_user", out.results[0].sid, {
    user_id: "sync_user",
  });
  assert.equal(inserted.symbol, "XAUUSD");
  assert.equal(inserted.action, "SELL");
  assert.equal(inserted.brokerTradeId, "TK-NEW-1");
  assert.equal(inserted.metadata.last_sync_source, "broker_sync_v2");
});

test("sqlite repository broker sync does not resurrect closed rows by reused broker comment", async () => {
  const projectRoot = makeTempProjectRoot();
  const repo = createTradeRepository({
    storageBackend: "sqlite",
    projectRoot,
  });

  await repo.seedTrades("sync_user", [
    {
      sid: "M_OLD_ETH",
      account_id: "acct-sync",
      user_id: "sync_user",
      symbol: "ETHUSD",
      action: "SELL",
      execution_status: "CLOSED",
      dispatch_status: "CONSUMED",
      broker_trade_id: "639768310",
      note: "TGRIPIT9N",
      entry: 1800,
      created_at: "2026-06-19T09:31:25.272Z",
      updated_at: "2026-06-19T09:31:25.272Z",
    },
  ]);

  const out = await repo.brokerSyncTrades(
    "sync_user",
    "acct-sync",
    [
      {
        sid: "TGRIPIT9N",
        note: "TGRIPIT9N",
        comment: "TGRIPIT9N",
        ticket: "OID983812667",
        ticket_candidates: ["OID983812667"],
        symbol: "ETHUSD",
        action: "SELL",
        execution_status: "PENDING",
        entry: 1837.55,
        sl: 1859.61,
        tp: 1778.5,
        lots: 2.5,
        broker_volume: 250000,
        order_type: "LIMIT",
      },
    ],
    {
      snapshotComplete: true,
      brokerName: "Test Broker",
      providerCode: "TEST",
      sourceId: "BROKER",
      now: "2026-06-28T07:53:36.214Z",
      generateSid: () => "GEN_SHOULD_NOT_BE_USED",
    },
  );

  assert.equal(out.ok, true);
  assert.equal(out.results[0].status, "Added");
  assert.equal(out.results[0].sid, "TGRIPIT9N");

  const closed = await repo.loadTrade("sync_user", "M_OLD_ETH", {
    user_id: "sync_user",
  });
  assert.equal(closed.executionStatus, "CLOSED");
  assert.equal(closed.brokerTradeId, "639768310");

  const inserted = await repo.loadTrade("sync_user", "TGRIPIT9N", {
    user_id: "sync_user",
  });
  assert.equal(inserted.executionStatus, "PENDING");
  assert.equal(inserted.brokerTradeId, "OID983812667");
  assert.equal(inserted.note, "TGRIPIT9N");
});

test("pullAndLockNextTask normalizes OID broker tickets for cTrader cancel tasks", async () => {
  const projectRoot = makeTempProjectRoot();
  const repo = createTradeRepository({
    storageBackend: "sqlite",
    projectRoot,
  });

  await repo.seedTrades("broker_user", [
    {
      sid: "M_OID988046010",
      account_id: "acct-broker",
      user_id: "broker_user",
      symbol: "ETHUSD",
      action: "SELL",
      execution_status: "CANCELLED",
      dispatch_status: "CANCEL",
      broker_trade_id: "OID988046010",
      note: "THBD03JEE",
      entry: 1595,
      sl: 1615,
      tp: 1563,
      created_at: "2026-06-28T08:00:00.000Z",
      updated_at: "2026-06-28T08:00:00.000Z",
    },
  ]);

  const task = await repo.pullAndLockNextTask("acct-broker", {
    userId: "broker_user",
    now: "2026-06-28T08:01:00.000Z",
    generateLeaseToken: () => "LEASE_OID_TASK",
    maxAgeHours: 24,
    maxLeaseRetries: 3,
  });

  assert.equal(task.sid, "M_OID988046010");
  assert.equal(task.type, "CANCEL");
  assert.equal(task.ticket, "988046010");
  assert.equal(task.lease_token, "LEASE_OID_TASK");
});

test("ctrader executor normalizes queued cancel tasks without requiring entry price", () => {
  const task = ctraderExecutorBridge.normalizeBrokerTaskItem({
    sid: "TRD_CANCEL_1",
    type: "CANCEL",
    ticket: "998877",
    symbol: "ethusd",
    action: "sell",
    account_id: "acct-ctrader",
  });

  assert.equal(task.id, "TRD_CANCEL_1");
  assert.equal(task.type, "CANCEL");
  assert.equal(task.ticket, "998877");
  assert.equal(task.symbol, "ETHUSD");
  assert.equal(task.entry, null);
});

test("ctrader broker task normalization preserves strategy labels", () => {
  const task = ctraderExecutorBridge.normalizeBrokerTaskItem({
    sid: "TRD_STRAT_1",
    type: "OPEN",
    symbol: "xauusd",
    action: "buy",
    entry: 3345.5,
    sl: 3335.5,
    tp: 3365.5,
    volume: 0.2,
    strategy: "Price Action v1",
  });

  assert.equal(task.strategy, "Price Action v1");
});

test("ctrader broker task normalization drops literal null strategy text", () => {
  const task = ctraderExecutorBridge.normalizeBrokerTaskItem({
    sid: "TRD_STRAT_NULL",
    type: "OPEN",
    symbol: "xauusd",
    action: "buy",
    entry: 3345.5,
    strategy: "null",
    note: "null",
  });

  assert.equal(task.strategy, "");
  assert.equal(task.note, "");
});

test("ctrader downstream matches broker tasks by ticket and label fallback", () => {
  const task = ctraderDownstreamServer.normalizeIncomingTask({
    signal: {
      id: "TRD_MODIFY_1",
      type: "MODIFY",
      ticket: "445566",
      symbol: "XAUUSD",
      action: "BUY",
      sl: 3340,
      tp: 3360,
    },
    account_id: "acct-ctrader",
  });

  const orderMatchByTicket = ctraderDownstreamServer.matchesTaskEntity(
    {
      orderId: 445566,
      tradeData: {
        label: "other",
        comment: "",
        symbolId: 77,
      },
    },
    task,
    null,
  );
  assert.equal(orderMatchByTicket, true);

  const orderMatchByLabel = ctraderDownstreamServer.matchesTaskEntity(
    {
      orderId: 778899,
      tradeData: {
        label: "TRD_MODIFY_1",
        comment: "",
        symbolId: 77,
      },
    },
    { ...task, ticket: "" },
    { symbolId: 77 },
  );
  assert.equal(orderMatchByLabel, true);
});

test("ctrader downstream uses strategy for label and keeps sid in comment", () => {
  assert.equal(
    ctraderDownstreamServer.buildBrokerLabel("Price Action v1", "TRD_123"),
    "Price Action v1",
  );
  assert.match(
    ctraderDownstreamServer.buildBrokerComment("TRD_123", "Entry on BOS retest"),
    /^TRD_123 \| Entry on BOS retest$/,
  );
});

test("ctrader downstream ignores literal null strategy and note text", () => {
  assert.equal(
    ctraderDownstreamServer.buildBrokerLabel("null", "TRD_123"),
    "TRD_123",
  );
  assert.equal(
    ctraderDownstreamServer.buildBrokerComment("TRD_123", "null"),
    "TRD_123",
  );
});
