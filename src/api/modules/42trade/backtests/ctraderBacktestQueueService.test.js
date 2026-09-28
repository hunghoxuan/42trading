"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const queue = require("./ctraderBacktestQueueService");
const objectStore = require("../../../shared/objects/objectStoreRepo");

test("normalizes a native cTrader batch and preserves report dimensions", () => {
  const normalized = queue.__test.normalizeBatchRequest({
    robot_name: "TVBridge_CTrader",
    symbols: ["btcusd", "XAUUSD", "btcusd"],
    timeframes: ["5m", "60", "1d"],
    start_time_utc: "2025-09-01",
    end_time_utc: "2026-09-01",
    balance: "10000",
    parameters: { "1st Trade": "Now_Wick_L0_R15" },
  });

  assert.deepEqual(normalized.symbols, ["BTCUSD", "XAUUSD"]);
  assert.deepEqual(normalized.timeframes, ["m5", "h1", "d1"]);
  assert.equal(normalized.balance, 10000);
  assert.equal(normalized.apply_commission_automatically, true);
  assert.equal(normalized.parameters["1st Trade"], "Now_Wick_L0_R15");
});

test("creates, claims, progresses, and cancels cTrader jobs", async () => {
  const userId = `test-ctrader-queue-${crypto.randomBytes(6).toString("hex")}`;
  let jobs = [];
  try {
    const batch = await queue.createBatch(userId, {
      symbols: ["BTCUSD"],
      timeframes: ["m5", "h1"],
      start_time_utc: "2025-09-01T00:00:00Z",
      end_time_utc: "2026-09-01T00:00:00Z",
    });
    jobs = batch.jobs;
    assert.equal(batch.total_jobs, 2);

    const claimed = await queue.claimJobs(userId, { workerId: "test-worker", limit: 1 });
    assert.equal(claimed.jobs.length, 1);
    assert.equal(claimed.jobs[0].status, "claimed");

    const running = await queue.updateJob(
      userId,
      claimed.jobs[0].job_id,
      { status: "running", progress_pct: 42 },
      { workerId: "test-worker" },
    );
    assert.equal(running.status, "running");
    assert.equal(running.progress_pct, 42);

    const cancelled = await queue.cancelJob(userId, jobs[1].job_id);
    assert.equal(cancelled.status, "cancelled");
  } finally {
    for (const job of jobs) {
      await objectStore.deleteObject(userId, queue.OBJECT_TYPE, job.job_id).catch(() => {});
    }
  }
});
