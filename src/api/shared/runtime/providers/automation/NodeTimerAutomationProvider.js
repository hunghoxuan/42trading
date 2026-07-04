import { PROVIDER_IDS } from "../../contracts/providerTypes.js";

function toDelayMs(value, fallback = 1) {
  return Math.max(1, Number(value) || fallback);
}

export class NodeTimerAutomationProvider {
  constructor({
    setTimeoutImpl = global.setTimeout,
    clearTimeoutImpl = global.clearTimeout,
  } = {}) {
    this.id = PROVIDER_IDS.automation.node_timer;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.tasks = new Map();
  }

  async scheduleRecurring(name, { intervalMs, handler } = {}) {
    const taskName = String(name || "").trim();
    const delayMs = toDelayMs(intervalMs);
    const taskHandler = typeof handler === "function" ? handler : async () => {};
    const existingTask = this.tasks.get(taskName);

    if (existingTask) {
      existingTask.stopped = true;
      this.clearTimer(existingTask.timer);
    }

    const task = {
      name: taskName,
      intervalMs: delayMs,
      handler: taskHandler,
      running: false,
      stopped: false,
      timer: null,
    };

    const run = async (payload) => {
      if (task.stopped || task.running) return;
      task.running = true;
      try {
        await task.handler(payload);
      } finally {
        task.running = false;
        if (!task.stopped) {
          task.timer = this.setTimeoutImpl(() => {
            void run();
          }, task.intervalMs);
          if (typeof task.timer?.unref === "function") {
            task.timer.unref();
          }
        }
      }
    };

    task.run = run;
    task.cancel = () => {
      if (task.stopped) return;
      task.stopped = true;
      this.clearTimer(task.timer);
      this.tasks.delete(task.name);
    };

    this.tasks.set(taskName, task);
    task.timer = this.setTimeoutImpl(() => {
      void run();
    }, task.intervalMs);
    if (typeof task.timer?.unref === "function") {
      task.timer.unref();
    }

    return {
      name: taskName,
      intervalMs: delayMs,
      cancel: task.cancel,
    };
  }

  enqueueNow(name, payload) {
    const taskName = String(name || "").trim();
    const task = this.tasks.get(taskName);
    if (!task) {
      return null;
    }
    return task.run(payload);
  }

  async close() {
    for (const task of this.tasks.values()) {
      task.stopped = true;
      this.clearTimer(task.timer);
    }
    this.tasks.clear();
  }

  clearTimer(timer) {
    if (!timer) return;
    this.clearTimeoutImpl(timer);
  }

  getStatus() {
    return {
      id: this.id,
      ready: true,
      taskCount: this.tasks.size,
    };
  }
}
