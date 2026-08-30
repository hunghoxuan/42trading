import { PROVIDER_IDS } from "../../contracts/providerTypes.js";

function toEveryMs(value, fallback = 1000) {
  return Math.max(1000, Number(value) || fallback);
}

export class BullMQAutomationProvider {
  constructor({
    QueueClass = null,
    WorkerClass = null,
    connection = null,
    queueNamePrefix = "runtime",
  } = {}) {
    this.id = PROVIDER_IDS.automation.bullmq;
    this.QueueClass = QueueClass;
    this.WorkerClass = WorkerClass;
    this.connection = connection;
    this.queueNamePrefix = String(queueNamePrefix || "runtime").trim() || "runtime";
    this.queues = new Map();
    this.workers = new Map();
  }

  queueName(name) {
    const taskName = String(name || "").trim() || "default";
    const safePrefix = this.queueNamePrefix.replace(/[:\s]+/g, "-");
    const safeTaskName = taskName.replace(/[:\s]+/g, "-");
    return `${safePrefix}-${safeTaskName}`;
  }

  ensureQueue(name) {
    if (!this.QueueClass || !this.connection) {
      return null;
    }

    const queueName = this.queueName(name);
    if (this.queues.has(queueName)) {
      return this.queues.get(queueName);
    }

    const queue = new this.QueueClass(queueName, {
      connection: this.connection,
    });
    this.queues.set(queueName, queue);
    return queue;
  }

  ensureWorker(name, handler) {
    if (!this.WorkerClass || !this.connection || typeof handler !== "function") {
      return null;
    }

    const queueName = this.queueName(name);
    if (this.workers.has(queueName)) {
      return this.workers.get(queueName);
    }

    const worker = new this.WorkerClass(
      queueName,
      async (job) => handler(job?.data),
      // lockDuration: the master cron handler runs all cron tasks (market data, download
      // bars, AI, snapshots) which can exceed BullMQ's default 30s job lock. A longer lock
      // prevents "Missing lock" storms on repeatable jobs that also stalled /health.
      { connection: this.connection, concurrency: 1, lockDuration: 300000 },
    );
    this.workers.set(queueName, worker);
    return worker;
  }

  async scheduleRecurring(name, { intervalMs, payload = {}, handler } = {}) {
    const taskName = String(name || "").trim() || "default";
    const queue = this.ensureQueue(taskName);
    this.ensureWorker(taskName, handler);
    if (!queue || typeof queue.upsertJobScheduler !== "function") {
      return {
        name: taskName,
        intervalMs: toEveryMs(intervalMs),
        queued: false,
      };
    }

    return queue.upsertJobScheduler(
      taskName,
      { every: toEveryMs(intervalMs) },
      { name: taskName, data: payload },
    );
  }

  enqueueNow(name, payload = {}) {
    const taskName = String(name || "").trim() || "default";
    const queue = this.ensureQueue(taskName);
    if (!queue || typeof queue.add !== "function") {
      return null;
    }
    return queue.add(taskName, payload);
  }

  async close() {
    const closers = [];
    for (const worker of this.workers.values()) {
      if (typeof worker?.close === "function") {
        closers.push(worker.close().catch(() => {}));
      }
    }
    this.workers.clear();
    for (const queue of this.queues.values()) {
      if (typeof queue?.close === "function") {
        closers.push(queue.close().catch(() => {}));
      }
    }
    this.queues.clear();
    await Promise.all(closers);
  }

  getStatus() {
    return {
      id: this.id,
      ready: Boolean(this.QueueClass && this.WorkerClass && this.connection),
      queueCount: this.queues.size,
      workerCount: this.workers.size,
    };
  }
}
