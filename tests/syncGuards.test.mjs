import assert from "node:assert/strict";
import test from "node:test";
import guards from "../src/api/utils/syncGuards.js";

test("brokerTaskTypeForTrade returns OPEN for normal pending create tasks", () => {
  assert.equal(
    guards.brokerTaskTypeForTrade({ dispatch_status: "OPEN" }),
    "OPEN",
  );
});

test("brokerTaskTypeForTrade maps dispatch_status to broker actions", () => {
  assert.equal(
    guards.brokerTaskTypeForTrade({ dispatch_status: "MODIFY" }),
    "MODIFY",
  );
  assert.equal(
    guards.brokerTaskTypeForTrade({ dispatch_status: "CLOSE" }),
    "CLOSE",
  );
  assert.equal(
    guards.brokerTaskTypeForTrade({ dispatch_status: "CANCEL" }),
    "CANCEL",
  );
});

test("brokerTaskTypeForTrade preserves original action for leased modify retries", () => {
  assert.equal(
    guards.brokerTaskTypeForTrade({
      dispatch_status: "LEASED",
      metadata: { leased_dispatch_status: "MODIFY" },
    }),
    "MODIFY",
  );
});

test("nullableIsoTimestamp treats blank broker timestamps as null", () => {
  assert.equal(guards.nullableIsoTimestamp(""), null);
  assert.equal(guards.nullableIsoTimestamp("   "), null);
  assert.equal(guards.nullableIsoTimestamp(null), null);
  assert.equal(
    guards.nullableIsoTimestamp("2026-06-02T13:58:58.976Z"),
    "2026-06-02T13:58:58.976Z",
  );
});

test("shouldAutoRejectLeasedTrade rejects expired leases after retry budget", () => {
  const now = new Date("2026-05-28T10:00:00.000Z");
  assert.equal(
    guards.shouldAutoRejectLeasedTrade(
      {
        dispatch_status: "LEASED",
        lease_expires_at: "2026-05-28T09:59:00.000Z",
        metadata: { lease_retry_count: 2 },
      },
      3,
      now,
    ),
    true,
  );
});

test("shouldAutoRejectLeasedTrade preserves expired leased modify tasks", () => {
  const now = new Date("2026-05-28T10:00:00.000Z");
  assert.equal(
    guards.shouldAutoRejectLeasedTrade(
      {
        dispatch_status: "LEASED",
        lease_expires_at: "2026-05-28T09:59:00.000Z",
        metadata: {
          lease_retry_count: 99,
          leased_dispatch_status: "MODIFY",
        },
      },
      3,
      now,
    ),
    false,
  );
});

test("isNewTradeTooOld catches stale unexecuted create tasks", () => {
  const now = new Date("2026-05-28T10:00:00.000Z");
  assert.equal(
    guards.isNewTradeTooOld(
      {
        dispatch_status: "OPEN",
        execution_status: "PENDING",
        created_at: "2026-05-26T09:00:00.000Z",
      },
      24,
      now,
    ),
    true,
  );
});

test("brokerSnapshotHash is stable for equivalent broker items", () => {
  const a = guards.brokerSnapshotHash({
    ticket: "123",
    symbol: "eurusd",
    action: "buy",
    execution_status: "FILLED",
    entry: "1.08000",
    sl: 1.075,
    tp: 1.09,
    volume: "1000",
    pnl: "10.50",
  });
  const b = guards.brokerSnapshotHash({
    pnl: 10.5,
    volume: 1000,
    tp: "1.09000",
    sl: "1.07500",
    entry: 1.08,
    execution_status: "filled",
    action: "BUY",
    symbol: "EURUSD",
    ticket: 123,
  });

  assert.equal(a, b);
});

test("brokerSnapshotHash changes when synced broker fields change", () => {
  const before = guards.brokerSnapshotHash({
    ticket: "123",
    symbol: "EURUSD",
    action: "BUY",
    execution_status: "FILLED",
    sl: 1.075,
    tp: 1.09,
    pnl: 10.5,
  });
  const after = guards.brokerSnapshotHash({
    ticket: "123",
    symbol: "EURUSD",
    action: "BUY",
    execution_status: "FILLED",
    sl: 1.076,
    tp: 1.09,
    pnl: 10.5,
  });

  assert.notEqual(before, after);
});

test("shouldClearRejectedDispatchFromBrokerSnapshot repairs stale lease retry rejects", () => {
  assert.equal(
    guards.shouldClearRejectedDispatchFromBrokerSnapshot(
      {
        sid: "TFOWSIUNW",
        dispatch_status: "REJECTED",
        rejection_reason: "broker ack lease retry limit exceeded",
      },
      {
        ticket: "976252918",
        execution_status: "PENDING",
      },
    ),
    true,
  );
});

test("shouldClearRejectedDispatchFromBrokerSnapshot preserves real rejects", () => {
  assert.equal(
    guards.shouldClearRejectedDispatchFromBrokerSnapshot(
      {
        sid: "TFOWSIUNW",
        dispatch_status: "REJECTED",
        rejection_reason: "broker rejected invalid stop loss",
      },
      {
        ticket: "976252918",
        execution_status: "PENDING",
      },
    ),
    false,
  );
});

test("brokerLinkedManualStatus maps terminal manual edits to broker queue statuses", () => {
  const result = guards.brokerLinkedManualStatus(
    { broker_trade_id: "pos-1", execution_status: "FILLED" },
    "CLOSED",
  );
  assert.equal(result.execution_status, "FILLED");
  assert.equal(result.dispatch_status, "CLOSE");
});

test("brokerLinkedManualStatus maps pending cancel", () => {
  const result = guards.brokerLinkedManualStatus(
    { broker_trade_id: "ord-1", execution_status: "PENDING" },
    "CANCELLED",
  );
  assert.equal(result.execution_status, "PENDING");
  assert.equal(result.dispatch_status, "CANCEL");
});

test("brokerLinkedManualStatus leaves local-only terminal edits unchanged", () => {
  const result = guards.brokerLinkedManualStatus(
    { broker_trade_id: "", execution_status: "PENDING" },
    "CANCELLED",
  );
  assert.equal(result.execution_status, "CANCELLED");
  assert.equal(result.dispatch_status, null);
});
