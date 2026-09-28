"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const objectStore = require("../../../shared/objects/objectStoreRepo");

const OBJECT_TYPE = "ctrader_backtest_jobs";
const ACTIVE_STATUSES = new Set(["claimed", "running"]);
const FINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const DATA_MODES = new Set(["ticks", "m1", "open"]);
const EXECUTION_MODES = new Set(["plugin", "cli"]);
const MAX_BATCH_JOBS = 500;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
let claimLock = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, fallback = "") {
  return String(value == null ? fallback : value).trim();
}

function safeIdPart(value, fallback = "job") {
  const normalized = safeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function uniqueTextList(values, transform = (value) => value) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => transform(safeText(value)))
        .filter(Boolean),
    ),
  ];
}

function normalizeTimeframe(value) {
  const tf = safeText(value).toLowerCase();
  const aliases = {
    "1": "m1",
    "5": "m5",
    "15": "m15",
    "30": "m30",
    "60": "h1",
    "240": "h4",
    "1440": "d1",
    "1m": "m1",
    "5m": "m5",
    "15m": "m15",
    "30m": "m30",
    "1h": "h1",
    "4h": "h4",
    "1d": "d1",
  };
  return aliases[tf] || tf;
}

function isSensitiveParameterName(value) {
  return /(?:api[_ -]?key|password|passwd|secret|token|credential|authorization|auth[_ -]?key)/iu.test(
    safeText(value),
  );
}

function sanitizeParameterOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([name, parameterValue]) => [
      name,
      isSensitiveParameterName(name) ? "[REDACTED]" : parameterValue,
    ]),
  );
}

function normalizeResolvedParameters(value) {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([name, parameterValue]) => ({
          name,
          value: parameterValue,
          source: "recorded",
        }))
      : [];
  return rows
    .slice(0, 2000)
    .map((row) => ({
      name: safeText(row?.name || row?.key),
      type: safeText(row?.type),
      value: isSensitiveParameterName(row?.name || row?.key)
        ? "[REDACTED]"
        : row?.value ?? null,
      source: safeText(row?.source || "recorded"),
    }))
    .filter((row) => row.name);
}

function normalizeUtcDate(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date/time`);
  }
  return date.toISOString();
}

function parseStoredJob(row) {
  if (!row) return null;
  let data = row.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const job = data?.job && typeof data.job === "object" ? data.job : data;
  return job && typeof job === "object" && job.job_id ? job : null;
}

function normalizeBatchRequest(payload = {}) {
  const robotName = safeText(payload.robot_name || payload.robotName || "TVBridge_CTrader");
  const symbols = uniqueTextList(payload.symbols, (value) => value.toUpperCase());
  const timeframes = uniqueTextList(payload.timeframes, normalizeTimeframe);
  if (!robotName) throw new Error("robot_name is required");
  if (!symbols.length) throw new Error("symbols must contain at least one symbol");
  if (!timeframes.length) throw new Error("timeframes must contain at least one timeframe");
  if (symbols.length * timeframes.length > MAX_BATCH_JOBS) {
    throw new Error(`A cTrader batch may contain at most ${MAX_BATCH_JOBS} jobs`);
  }
  const startTimeUtc = normalizeUtcDate(
    payload.start_time_utc || payload.start || payload.date_from,
    "start_time_utc",
  );
  const endTimeUtc = normalizeUtcDate(
    payload.end_time_utc || payload.end || payload.date_to,
    "end_time_utc",
  );
  if (new Date(endTimeUtc).getTime() <= new Date(startTimeUtc).getTime()) {
    throw new Error("end_time_utc must be later than start_time_utc");
  }
  const dataMode = safeText(payload.data_mode || "m1").toLowerCase();
  if (!DATA_MODES.has(dataMode)) {
    throw new Error(`data_mode must be one of: ${Array.from(DATA_MODES).join(", ")}`);
  }
  const executionMode = safeText(payload.execution_mode || "plugin").toLowerCase();
  if (!EXECUTION_MODES.has(executionMode)) {
    throw new Error(`execution_mode must be one of: ${Array.from(EXECUTION_MODES).join(", ")}`);
  }
  const parameters =
    payload.parameters && typeof payload.parameters === "object" && !Array.isArray(payload.parameters)
      ? payload.parameters
      : {};
  const balance = Number(payload.balance || payload.initial_capital || 10000);
  return {
    robot_name: robotName,
    symbols,
    timeframes,
    start_time_utc: startTimeUtc,
    end_time_utc: endTimeUtc,
    balance: Number.isFinite(balance) ? Math.max(1, balance) : 10000,
    data_mode: dataMode,
    execution_mode: executionMode,
    spread_pips: Number.isFinite(Number(payload.spread_pips))
      ? Number(payload.spread_pips)
      : 0,
    commission_usd_per_million: Number.isFinite(Number(payload.commission_usd_per_million))
      ? Number(payload.commission_usd_per_million)
      : 0,
    apply_commission_automatically:
      payload.apply_commission_automatically === undefined
        ? true
        : Boolean(payload.apply_commission_automatically),
    strategy_key: safeText(payload.strategy_key || payload.strategy_id || "cTrader"),
    strategy_name: safeText(
      payload.strategy_name || payload.strategy_key || payload.strategy_id || "cTrader",
    ),
    parameters,
    config:
      payload.config && typeof payload.config === "object" && !Array.isArray(payload.config)
        ? payload.config
        : {},
  };
}

async function saveJob(userId, job) {
  await objectStore.upsertObject(
    userId,
    OBJECT_TYPE,
    job.job_id,
    { job },
    String(job.status || "queued").toUpperCase(),
    {
      created_at: job.created_at,
      updated_at: job.updated_at,
    },
  );
  return job;
}

async function listJobs(userId, { limit = 500, batchId = "" } = {}) {
  const rows = await objectStore.listObjectsByType(userId, OBJECT_TYPE).catch(() => []);
  const jobs = rows
    .map(parseStoredJob)
    .filter(Boolean)
    .filter((job) => !batchId || safeText(job.batch_id) === safeText(batchId))
    .sort((left, right) => safeText(right.created_at).localeCompare(safeText(left.created_at)));
  return jobs.slice(0, Math.max(1, Math.min(2000, Number(limit) || 500)));
}

async function getJob(userId, jobId) {
  const row = await objectStore.getObject(userId, OBJECT_TYPE, safeText(jobId));
  return parseStoredJob(row);
}

async function createBatch(userId, payload = {}) {
  const normalized = normalizeBatchRequest(payload);
  const batchId = makeId("ctbatch");
  const createdAt = nowIso();
  const jobs = [];
  for (const symbol of normalized.symbols) {
    for (const timeframe of normalized.timeframes) {
      const jobId = makeId("ctjob");
      const runId = [
        "ctrader",
        safeIdPart(normalized.robot_name, "robot"),
        safeIdPart(symbol, "symbol"),
        safeIdPart(timeframe, "tf"),
        safeIdPart(normalized.start_time_utc.slice(0, 10), "start"),
        safeIdPart(normalized.end_time_utc.slice(0, 10), "end"),
        jobId.slice(-8),
      ].join("-");
      const launchConfig = {
        robot_name: normalized.robot_name,
        symbol,
        timeframe,
        start_time_utc: normalized.start_time_utc,
        end_time_utc: normalized.end_time_utc,
        balance: normalized.balance,
        data_mode: normalized.data_mode,
        execution_mode: normalized.execution_mode,
        spread_pips: normalized.spread_pips,
        commission_usd_per_million: normalized.commission_usd_per_million,
        apply_commission_automatically: normalized.apply_commission_automatically,
        parameters: normalized.parameters,
      };
      jobs.push({
        job_id: jobId,
        batch_id: batchId,
        run_id: runId,
        user_id: userId,
        status: "queued",
        progress_pct: 0,
        strategy_key: normalized.strategy_key,
        strategy_name: normalized.strategy_name,
        symbol,
        timeframe,
        execution_mode: normalized.execution_mode,
        launch_config: launchConfig,
        config: normalized.config,
        created_at: createdAt,
        updated_at: createdAt,
        claimed_at: null,
        started_at: null,
        completed_at: null,
        worker_id: null,
        error: null,
      });
    }
  }
  for (const job of jobs) await saveJob(userId, job);
  return {
    ok: true,
    batch_id: batchId,
    total_jobs: jobs.length,
    jobs,
  };
}

function withClaimLock(operation) {
  const next = claimLock.then(operation, operation);
  claimLock = next.catch(() => {});
  return next;
}

async function claimJobs(
  userId,
  { workerId, limit = 1, leaseMs = DEFAULT_LEASE_MS, executionMode = "plugin" } = {},
) {
  const normalizedWorkerId = safeText(workerId);
  if (!normalizedWorkerId) throw new Error("worker_id is required");
  const claimLimit = Math.max(1, Math.min(20, Number(limit) || 1));
  const normalizedExecutionMode = safeText(executionMode || "plugin").toLowerCase();
  if (!EXECUTION_MODES.has(normalizedExecutionMode)) {
    throw new Error(`execution_mode must be one of: ${Array.from(EXECUTION_MODES).join(", ")}`);
  }
  return withClaimLock(async () => {
    const jobs = await listJobs(userId, { limit: 2000 });
    const now = Date.now();
    const selected = jobs
      .filter((job) => {
        const jobExecutionMode = safeText(
          job.execution_mode || job.launch_config?.execution_mode || "plugin",
        ).toLowerCase();
        if (jobExecutionMode !== normalizedExecutionMode) return false;
        if (job.status === "queued") return true;
        if (!ACTIVE_STATUSES.has(job.status)) return false;
        const leaseTime = new Date(job.heartbeat_at || job.claimed_at || 0).getTime();
        return Number.isFinite(leaseTime) && now - leaseTime > leaseMs;
      })
      .sort((left, right) => safeText(left.created_at).localeCompare(safeText(right.created_at)))
      .slice(0, claimLimit);
    const claimed = [];
    for (const job of selected) {
      const updatedAt = nowIso();
      const nextJob = {
        ...job,
        status: "claimed",
        worker_id: normalizedWorkerId,
        claimed_at: updatedAt,
        heartbeat_at: updatedAt,
        updated_at: updatedAt,
        error: null,
      };
      await saveJob(userId, nextJob);
      claimed.push(nextJob);
    }
    return { ok: true, jobs: claimed };
  });
}

async function updateJob(userId, jobId, patch = {}, { workerId = "" } = {}) {
  const job = await getJob(userId, jobId);
  if (!job) throw new Error("cTrader backtest job not found");
  if (FINAL_STATUSES.has(job.status) && !FINAL_STATUSES.has(safeText(patch.status))) {
    return job;
  }
  const normalizedWorkerId = safeText(workerId);
  if (normalizedWorkerId && job.worker_id && job.worker_id !== normalizedWorkerId) {
    throw new Error("cTrader backtest job is owned by another worker");
  }
  const updatedAt = nowIso();
  const status = safeText(patch.status || job.status).toLowerCase();
  const nextJob = {
    ...job,
    ...patch,
    status,
    progress_pct: Math.max(0, Math.min(100, Number(patch.progress_pct ?? job.progress_pct) || 0)),
    worker_id: normalizedWorkerId || job.worker_id || null,
    heartbeat_at: ACTIVE_STATUSES.has(status) ? updatedAt : job.heartbeat_at || null,
    started_at:
      status === "running" && !job.started_at ? updatedAt : patch.started_at || job.started_at || null,
    completed_at: FINAL_STATUSES.has(status)
      ? patch.completed_at || updatedAt
      : job.completed_at || null,
    updated_at: updatedAt,
  };
  return saveJob(userId, nextJob);
}

async function cancelJob(userId, jobId) {
  const job = await getJob(userId, jobId);
  if (!job) throw new Error("cTrader backtest job not found");
  if (FINAL_STATUSES.has(job.status)) return job;
  return updateJob(userId, jobId, { status: "cancelled", error: "Cancelled from 42trade" });
}

async function archiveHtmlReport(userId, runId, htmlReport) {
  const html = safeText(htmlReport);
  if (!html) return null;
  const root = objectStore.userRootDir(userId);
  const reportDir = path.join(root, "backtests-artifacts", safeIdPart(runId, "run"));
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "report.html");
  fs.writeFileSync(reportPath, html, "utf8");
  return reportPath;
}

module.exports = {
  OBJECT_TYPE,
  createBatch,
  listJobs,
  getJob,
  claimJobs,
  updateJob,
  cancelJob,
  archiveHtmlReport,
  normalizeResolvedParameters,
  sanitizeParameterOverrides,
  __test: {
    normalizeBatchRequest,
    normalizeTimeframe,
    parseStoredJob,
    normalizeResolvedParameters,
    sanitizeParameterOverrides,
  },
};
