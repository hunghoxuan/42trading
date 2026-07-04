import assert from "node:assert/strict";
import test from "node:test";

import { createAppRuntime } from "../../shared/runtime/bootstrap/createAppRuntime.js";
import { BullMQAutomationProvider } from "../../shared/runtime/providers/automation/BullMQAutomationProvider.js";
import { NodeTimerAutomationProvider } from "../../shared/runtime/providers/automation/NodeTimerAutomationProvider.js";

test("NodeTimerAutomationProvider schedules one recurring task and prevents overlap", async () => {
  const calls = [];
  const scheduled = [];
  const provider = new NodeTimerAutomationProvider({
    setTimeoutImpl: (fn, delay) => {
      scheduled.push(fn);
      return { delay, unref() {} };
    },
    clearTimeoutImpl: () => {},
  });

  await provider.scheduleRecurring("demo", {
    intervalMs: 1000,
    handler: async () => {
      calls.push("run");
    },
  });

  assert.equal(scheduled.length, 1);
  await scheduled[0]();
  assert.equal(calls.length, 1);

  assert.equal(scheduled.length, 2);
  await scheduled[1]();

  assert.equal(calls.length, 2);
});

test("createAppRuntime composes the default node-timer automation facade", () => {
  const runtime = createAppRuntime({ env: {} });

  assert.ok(runtime.automation);
  assert.equal(typeof runtime.automation.scheduleRecurring, "function");
  assert.equal(runtime.config.providers.automation, "node_timer");
  assert.equal(runtime.automation.provider.id, "node_timer");
});

test("createAppRuntime selects BullMQ automation provider when configured", () => {
  class QueueStub {
    constructor(name, options) {
      this.name = name;
      this.options = options;
    }
  }

  const runtime = createAppRuntime({
    env: { AUTOMATION_PROVIDER: "bullmq" },
    bullmqFactory: {
      queue: QueueStub,
      worker: class {},
    },
    bullConnection: { host: "127.0.0.1", port: 6379 },
  });

  assert.equal(runtime.config.providers.automation, "bullmq");
  assert.equal(runtime.automation.provider.id, "bullmq");
  assert.ok(runtime.automation.provider instanceof BullMQAutomationProvider);
});

test("BullMQAutomationProvider schedules recurring work and boots one worker per task", async () => {
  const schedulerCalls = [];
  const workerRuns = [];

  class QueueStub {
    constructor(name, options) {
      this.name = name;
      this.options = options;
    }

    async upsertJobScheduler(name, schedule, job) {
      schedulerCalls.push({
        queueName: this.name,
        name,
        schedule,
        job,
      });
      return { id: `${this.name}:${name}` };
    }

    async close() {}
  }

  class WorkerStub {
    constructor(name, processor, options) {
      this.name = name;
      this.processor = processor;
      this.options = options;
    }

    async close() {}
  }

  const provider = new BullMQAutomationProvider({
    QueueClass: QueueStub,
    WorkerClass: WorkerStub,
    connection: { host: "127.0.0.1", port: 6379 },
  });

  await provider.scheduleRecurring("mt5-master-cron", {
    intervalMs: 60_000,
    payload: { source: "test" },
    handler: async (payload) => {
      workerRuns.push(payload);
    },
  });

  assert.equal(schedulerCalls.length, 1);
  assert.equal(provider.workers.size, 1);

  const worker = [...provider.workers.values()][0];
  await worker.processor({ data: { source: "queued" } });

  assert.deepEqual(workerRuns, [{ source: "queued" }]);
});
