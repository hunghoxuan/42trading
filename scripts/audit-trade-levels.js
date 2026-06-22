"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const USERS_ROOT = path.join(PROJECT_ROOT, "data", "users");
const Database = require(path.join(
  PROJECT_ROOT,
  "src",
  "api",
  "node_modules",
  "better-sqlite3",
));
const DEFAULT_STATUSES = new Set(["DRAFT", "PENDING", "FILLED"]);

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    fixFromPlan: args.has("--fix-from-plan"),
    includeClosed: args.has("--include-closed"),
    json: args.has("--json"),
  };
}

function walkUserDbs(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dbPath = path.join(rootDir, entry.name, "data.db");
    if (fs.existsSync(dbPath)) {
      out.push({
        userId: entry.name,
        dbPath,
      });
    }
  }
  return out.sort((a, b) => a.userId.localeCompare(b.userId));
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function firstTradePlan(raw = {}, metadata = {}) {
  const candidates = [
    raw?.trade_plan,
    metadata?.raw_json?.trade_plan,
    raw?.analysis_result?.trade_plan,
    metadata?.analysis_result?.trade_plan,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length && candidate[0] && typeof candidate[0] === "object") {
      return candidate[0];
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return {};
}

function extractPlanLevels(raw = {}, metadata = {}) {
  const plan = firstTradePlan(raw, metadata);
  const executionPlan =
    plan?.execution_plan && typeof plan.execution_plan === "object"
      ? plan.execution_plan
      : {};
  return {
    entry: toNum(
      executionPlan?.entry?.price ??
        raw?.entry ??
        plan?.entry,
    ),
    sl: toNum(
      executionPlan?.stop_loss?.price ??
        raw?.sl ??
        plan?.sl,
    ),
    tp1: toNum(
      executionPlan?.tp1?.price ??
        raw?.tp1 ??
        raw?.tp ??
        plan?.tp1 ??
        plan?.tp,
    ),
    tp2: toNum(
      executionPlan?.tp2?.price ??
        raw?.tp2 ??
        plan?.tp2,
    ),
    tp3: toNum(
      executionPlan?.tp3?.price ??
        raw?.tp3 ??
        plan?.tp3,
    ),
    strategy:
      String(plan?.strategy || raw?.strategy || metadata?.strategy || "").trim() ||
      null,
  };
}

function validateLevels({ side, entry, sl, tp1, tp2, tp3 }) {
  const normalizedSide = String(side || "").trim().toUpperCase();
  if (!["BUY", "SELL"].includes(normalizedSide)) return "bad_side";
  if (toNum(entry) == null || toNum(sl) == null || toNum(tp1) == null) {
    return "missing_core";
  }
  const entryNum = Number(entry);
  const slNum = Number(sl);
  const targets = [tp1, tp2, tp3].map(toNum).filter((value) => value != null);
  if (normalizedSide === "BUY") {
    if (!(slNum < entryNum)) return "buy_sl_not_below_entry";
    if (targets.some((value) => !(value > entryNum))) {
      return "buy_targets_not_above_entry";
    }
    for (let index = 1; index < targets.length; index += 1) {
      if (!(targets[index] > targets[index - 1])) {
        return `buy_tp${index + 1}_order`;
      }
    }
    return "";
  }
  if (!(slNum > entryNum)) return "sell_sl_not_above_entry";
  if (targets.some((value) => !(value < entryNum))) {
    return "sell_targets_not_below_entry";
  }
  for (let index = 1; index < targets.length; index += 1) {
    if (!(targets[index] < targets[index - 1])) {
      return `sell_tp${index + 1}_order`;
    }
  }
  return "";
}

function selectRows(db, includeClosed) {
  const rows = db
    .prepare(
      `SELECT sid, user_id, symbol, action, execution_status, entry, sl, tp, tp1, tp2, tp3, raw_json, metadata, updated_at
       FROM trades
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all();
  return rows.filter((row) => {
    if (includeClosed) return true;
    return DEFAULT_STATUSES.has(String(row.execution_status || "").toUpperCase());
  });
}

function repairRow(db, row, candidate) {
  const nextTp1 = candidate.tp1;
  const nextTp2 = candidate.tp2;
  const nextTp3 = candidate.tp3;
  const nextTp = nextTp1;
  const nextUpdatedAt = new Date().toISOString();
  const existingMeta = parseJson(row.metadata);
  const nextMeta = {
    ...existingMeta,
    trade_level_repair: {
      repaired_at: nextUpdatedAt,
      source: "scripts/audit-trade-levels.js",
      strategy: candidate.strategy || null,
      previous: {
        entry: toNum(row.entry),
        sl: toNum(row.sl),
        tp: toNum(row.tp),
        tp1: toNum(row.tp1),
        tp2: toNum(row.tp2),
        tp3: toNum(row.tp3),
      },
    },
  };
  db.prepare(
    `UPDATE trades
     SET entry = ?,
         sl = ?,
         tp = ?,
         tp1 = ?,
         tp2 = ?,
         tp3 = ?,
         metadata = ?,
         updated_at = ?
     WHERE sid = ?`,
  ).run(
    candidate.entry,
    candidate.sl,
    nextTp,
    nextTp1,
    nextTp2,
    nextTp3,
    JSON.stringify(nextMeta),
    nextUpdatedAt,
    row.sid,
  );
}

function auditDatabase({ dbPath, userId }, options) {
  const db = new Database(dbPath);
  try {
    const rows = selectRows(db, options.includeClosed);
    const invalid = [];
    let repaired = 0;
    for (const row of rows) {
      const reason = validateLevels({
        side: row.action,
        entry: row.entry,
        sl: row.sl,
        tp1: row.tp1 ?? row.tp,
        tp2: row.tp2,
        tp3: row.tp3,
      });
      if (!reason) continue;
      const raw = parseJson(row.raw_json);
      const metadata = parseJson(row.metadata);
      const candidate = extractPlanLevels(raw, metadata);
      const candidateReason = validateLevels({
        side: row.action,
        entry: candidate.entry,
        sl: candidate.sl,
        tp1: candidate.tp1,
        tp2: candidate.tp2,
        tp3: candidate.tp3,
      });
      const item = {
        sid: row.sid,
        userId,
        symbol: row.symbol,
        action: row.action,
        execution_status: row.execution_status,
        reason,
        row_levels: {
          entry: toNum(row.entry),
          sl: toNum(row.sl),
          tp: toNum(row.tp),
          tp1: toNum(row.tp1),
          tp2: toNum(row.tp2),
          tp3: toNum(row.tp3),
        },
        candidate_levels: candidate,
        repairable: !candidateReason,
      };
      if (options.fixFromPlan && !candidateReason) {
        repairRow(db, row, candidate);
        item.repaired = true;
        repaired += 1;
      }
      invalid.push(item);
    }
    return {
      userId,
      dbPath,
      total: rows.length,
      invalidCount: invalid.length,
      repaired,
      invalid,
    };
  } finally {
    db.close();
  }
}

function printHuman(results) {
  let totalRows = 0;
  let totalInvalid = 0;
  let totalRepaired = 0;
  for (const result of results) {
    totalRows += result.total;
    totalInvalid += result.invalidCount;
    totalRepaired += result.repaired;
  }
  console.log(
    `Trade level audit: ${totalInvalid} invalid / ${totalRows} checked / ${totalRepaired} repaired`,
  );
  for (const result of results) {
    console.log(
      `- ${result.userId}: ${result.invalidCount} invalid / ${result.total} checked / ${result.repaired} repaired`,
    );
    for (const item of result.invalid.slice(0, 20)) {
      console.log(
        `  ${item.sid} ${item.symbol} ${item.action} ${item.execution_status} -> ${item.reason}${item.repairable ? " (repairable)" : ""}${item.repaired ? " (repaired)" : ""}`,
      );
    }
    if (result.invalid.length > 20) {
      console.log(`  ... ${result.invalid.length - 20} more`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv);
  const dbs = walkUserDbs(USERS_ROOT);
  const results = dbs.map((entry) => auditDatabase(entry, options));
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  printHuman(results);
}

main();
