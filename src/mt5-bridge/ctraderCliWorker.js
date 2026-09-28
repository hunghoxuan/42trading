#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ALIASES = new Map(
  Object.entries({
    rulesprofile: "SelectedRiskTemplate",
    mdayloss: "MaxDailyLossPreset",
    mdaywin: "MaxDailyWinPreset",
    mdd: "MaxEquityDrawdownPreset",
    mriskcbottrade: "MaxRiskPreset",
    symbols: "StrategySymbols",
    timeframes: "StrategyTimeframes",
    newsblock: "SelectedNewsBlockPreset",
    "1sttrade": "FirstTradeMode",
    "2ndtrade": "SecondTradeMode",
    "3rdtrade": "ThirdTradeMode",
    ntrades: "StrategyOrderCount",
    entry: "SelectedStrategyEntryType",
    sl: "SelectedStrategyStopLossMode",
    tp: "SelectedStrategyTakeProfitMode",
    exitmode: "SelectedStrategyExitMode",
    enabletrade: "EnableLiveStrategyTrading",
    enabledebug: "EnableStrategyDebug",
    strategy: "SelectedBacktestStrategy",
    strategy2: "SelectedBacktestStrategy2",
    strategy3: "SelectedBacktestStrategy3",
    strategy4: "SelectedBacktestStrategy4",
    strategy5: "SelectedBacktestStrategy5",
  }),
);

function compact(value) {
  return String(value || "").replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function sensitive(value) {
  return /(?:api[_ -]?key|password|passwd|secret|token|credential|authorization|auth[_ -]?key)/iu.test(
    String(value || ""),
  );
}

function normalizeParameters(parameters) {
  return Object.fromEntries(
    Object.entries(parameters && typeof parameters === "object" ? parameters : {})
      .filter(([name]) => !sensitive(name))
      .map(([name, value]) => [ALIASES.get(compact(name)) || name, value]),
  );
}

function required(name, fallback = "") {
  const value = String(process.env[name] || fallback).trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const config = {
  apiBase: String(process.env.CTRADER_WORKER_API || "http://127.0.0.1:3001").replace(/\/$/u, ""),
  apiKey: required("SIGNAL_API_KEY"),
  cliPath: required("CTRADER_CLI_PATH", path.join(os.homedir(), ".local/bin/ctrader-cli")),
  ctid: required("CTRADER_CTID"),
  passwordFile: required("CTRADER_PWD_FILE"),
  account: required("CTRADER_ACCOUNT"),
  algoPath: required("CTRADER_CBOT_PATH"),
  workerId: String(process.env.CTRADER_WORKER_ID || `ctrader-cli-${os.hostname()}`).trim(),
  maxParallel: Math.max(1, Math.min(20, Number(process.env.CTRADER_WORKER_MAX_PARALLEL || 3))),
  pollMs: Math.max(1000, Number(process.env.CTRADER_WORKER_POLL_MS || 3000)),
  rootDir: path.resolve(
    process.env.CTRADER_WORKER_DATA_DIR || path.join(os.homedir(), ".local/share/42trade/ctrader"),
  ),
};

for (const filePath of [config.cliPath, config.passwordFile, config.algoPath]) {
  if (!fs.existsSync(filePath)) throw new Error(`Required file does not exist: ${filePath}`);
}
fs.mkdirSync(config.rootDir, { recursive: true });
if (process.argv.includes("--check")) {
  console.log(`Configuration valid for ${config.workerId}; parallel=${config.maxParallel}`);
  process.exit(0);
}

async function post(endpoint, payload) {
  const response = await fetch(`${config.apiBase}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.apiKey },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!response.ok) {
    const error = new Error(String(body?.error || `HTTP ${response.status}`));
    error.status = response.status;
    throw error;
  }
  return body;
}

function cliDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid cTrader date: ${value}`);
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function findFile(root, name) {
  const stack = [root];
  let best = null;
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.name === name) {
        const mtime = fs.statSync(fullPath).mtimeMs;
        if (!best || mtime > best.mtime) best = { path: fullPath, mtime };
      }
    }
  }
  return best?.path || "";
}

function resolvedParameters(dataDir, fallback) {
  const parameterFile = findFile(dataDir, "parameters.cbotset");
  let values = fallback;
  if (parameterFile) {
    try {
      values = JSON.parse(fs.readFileSync(parameterFile, "utf8"))?.Parameters || fallback;
    } catch {
      values = fallback;
    }
  }
  return Object.entries(values || {}).map(([name, value]) => ({
    name,
    type: Array.isArray(value) ? "array" : typeof value,
    value: sensitive(name) ? "[REDACTED]" : value,
    source: Object.prototype.hasOwnProperty.call(fallback, name) ? "override" : "resolved",
  }));
}

const active = new Map();
let stopping = false;
let pollTimer = null;

async function runJob(job) {
  const launch = job.launch_config || {};
  const parameters = normalizeParameters(launch.parameters);
  const runDir = path.join(config.rootDir, String(job.job_id).replace(/[^a-z0-9._-]/giu, "-"));
  const dataDir = path.join(runDir, "data");
  const cbotsetPath = path.join(runDir, "parameters.cbotset");
  const jsonReportPath = path.join(runDir, "report.json");
  const htmlReportPath = path.join(runDir, "report.html");
  const logPath = path.join(runDir, "worker.log");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    cbotsetPath,
    JSON.stringify({ Chart: { Symbol: launch.symbol, Period: launch.timeframe }, Parameters: parameters }, null, 2),
    { mode: 0o600 },
  );

  const args = [
    "backtest",
    `--ctid=${config.ctid}`,
    `--pwd-file=${config.passwordFile}`,
    `--account=${config.account}`,
    config.algoPath,
    cbotsetPath,
    `--symbol=${launch.symbol}`,
    `--period=${launch.timeframe}`,
    `--start=${cliDate(launch.start_time_utc)}`,
    `--end=${cliDate(launch.end_time_utc)}`,
    `--data-mode=${launch.data_mode || "m1"}`,
    `--balance=${Number(launch.balance || 10000)}`,
    `--spread=${Number(launch.spread_pips || 0)}`,
    `--report=${htmlReportPath}`,
    `--report-json=${jsonReportPath}`,
    `--data-dir=${dataDir}`,
    "--full-access",
    "--exit-on-stop",
  ];
  if (launch.apply_commission_automatically) args.push("--commission-auto");
  else args.push(`--commission=${Number(launch.commission_usd_per_million || 0)}`);

  const log = fs.createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const child = spawn(config.cliPath, args, { stdio: ["ignore", log, log] });
  active.set(job.job_id, child);
  const snapshot = Object.entries(parameters).map(([name, value]) => ({
    name,
    type: typeof value,
    value,
    source: "override",
  }));
  try {
    await post(`/api/backtests/ctrader/worker/jobs/${encodeURIComponent(job.job_id)}/progress`, {
      worker_id: config.workerId,
      progress_pct: 0,
      operation: "cTrader CLI starting",
      resolved_parameters: snapshot,
    });
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }

  const heartbeat = setInterval(async () => {
    try {
      await post(`/api/backtests/ctrader/worker/jobs/${encodeURIComponent(job.job_id)}/progress`, {
        worker_id: config.workerId,
        operation: "cTrader CLI running",
      });
    } catch (error) {
      if (error.status === 409) child.kill("SIGTERM");
    }
  }, 20000);

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  }).finally(() => {
    clearInterval(heartbeat);
    active.delete(job.job_id);
    log.end();
  });
  if (exitCode.code !== 0) {
    throw new Error(`cTrader CLI exited with code ${exitCode.code ?? "none"}${exitCode.signal ? ` (${exitCode.signal})` : ""}; see ${logPath}`);
  }
  if (!fs.existsSync(jsonReportPath)) throw new Error("cTrader CLI produced no JSON report");
  await post(`/api/backtests/ctrader/worker/jobs/${encodeURIComponent(job.job_id)}/complete`, {
    worker_id: config.workerId,
    ctrader_report: fs.readFileSync(jsonReportPath, "utf8"),
    html_report: fs.existsSync(htmlReportPath) ? fs.readFileSync(htmlReportPath, "utf8") : "",
    resolved_parameters: resolvedParameters(dataDir, parameters),
  });
  console.log(`Completed ${job.job_id}: ${launch.symbol} ${launch.timeframe}`);
}

async function failJob(job, error) {
  console.error(`Failed ${job.job_id}: ${error.message || error}`);
  try {
    await post(`/api/backtests/ctrader/worker/jobs/${encodeURIComponent(job.job_id)}/fail`, {
      worker_id: config.workerId,
      error: String(error.message || error),
    });
  } catch (syncError) {
    console.error(`Could not sync failure for ${job.job_id}: ${syncError.message || syncError}`);
  }
}

async function poll() {
  if (stopping || active.size >= config.maxParallel) return;
  const result = await post("/api/backtests/ctrader/worker/claim", {
    worker_id: config.workerId,
    limit: config.maxParallel - active.size,
    execution_mode: "cli",
  });
  for (const job of result.jobs || []) runJob(job).catch((error) => failJob(job, error));
}

function stop() {
  stopping = true;
  if (pollTimer) clearInterval(pollTimer);
  for (const child of active.values()) child.kill("SIGTERM");
  if (!active.size) process.exit(0);
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(`42trade cTrader CLI worker ${config.workerId}; parallel=${config.maxParallel}`);
pollTimer = setInterval(
  () => poll().catch((error) => console.error(`Queue poll failed: ${error.message || error}`)),
  config.pollMs,
);
poll().catch((error) => console.error(`Queue poll failed: ${error.message || error}`));
