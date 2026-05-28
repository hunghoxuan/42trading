import assert from "node:assert/strict";
import test from "node:test";
import guards from "../../webhook/syncGuards.js";

test("brokerTaskTypeForTrade returns OPEN for normal pending create tasks", () => {
  assert.equal(
    guards.brokerTaskTypeForTrade({ execution_status: "PENDING" }),
    "OPEN",
  );
});

test("brokerTaskTypeForTrade maps control statuses to broker actions", () => {
  assert.equal(
    guards.brokerTaskTypeForTrade({ execution_status: "PENDING_MOD" }),
    "MODIFY",
  );
  assert.equal(
    guards.brokerTaskTypeForTrade({ execution_status: "PENDING_CLOSE" }),
    "CLOSE",
  );
  assert.equal(
    guards.brokerTaskTypeForTrade({ execution_status: "PENDING_CANCEL" }),
    "CANCEL",
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

test("isNewTradeTooOld catches stale unexecuted create tasks", () => {
  const now = new Date("2026-05-28T10:00:00.000Z");
  assert.equal(
    guards.isNewTradeTooOld(
      {
        dispatch_status: "NEW",
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

test("brokerLinkedManualStatus maps terminal manual edits to broker queue statuses", () => {
  assert.equal(
    guards.brokerLinkedManualStatus(
      { broker_trade_id: "pos-1", execution_status: "FILLED" },
      "CLOSED",
    ),
    "PENDING_CLOSE",
  );
  assert.equal(
    guards.brokerLinkedManualStatus(
      { broker_trade_id: "ord-1", execution_status: "PENDING" },
      "CANCELLED",
    ),
    "PENDING_CANCEL",
  );
});

test("brokerLinkedManualStatus leaves local-only terminal edits unchanged", () => {
  assert.equal(
    guards.brokerLinkedManualStatus(
      { broker_trade_id: "", execution_status: "PENDING" },
      "CANCELLED",
    ),
    "CANCELLED",
  );
});
