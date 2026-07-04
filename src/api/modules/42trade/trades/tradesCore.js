"use strict";

const fs = require("fs");
const path = require("path");
const BetterSqlite3 = require("better-sqlite3");
const { drizzle: drizzleSqlite } = require("drizzle-orm/better-sqlite3");
const { drizzle: drizzlePg } = require("drizzle-orm/node-postgres");
const { sql } = require("drizzle-orm");
const { migrate: migrateSqlite } = require("drizzle-orm/better-sqlite3/migrator");
const pathToSqliteMigrations = path.resolve(
  __dirname,
  "../../db/migrations/sqlite",
);
const sqliteMigrationJournalPath = path.join(
  pathToSqliteMigrations,
  "meta",
  "_journal.json",
);
const syncGuards = require("../../../shared/utils/syncGuards");

const SQLITE_DBS = new Map();

function safeUserId(userId) {
  return String(userId || "default")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
}

function resolveUserTradeDbPath(userId, options = {}) {
  const projectRoot =
    options.projectRoot || path.resolve(__dirname, "..", "..", "..");
  return path.join(projectRoot, "data", "users", safeUserId(userId), "data.db");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
}

function bindQuestionSql(queryText, args = []) {
  const text = String(queryText || "");
  const parts = text.split("?");
  if (parts.length - 1 !== args.length) {
    throw new Error(
      `SQL placeholder mismatch: expected ${parts.length - 1} args but got ${args.length}`,
    );
  }
  const chunks = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i]) chunks.push(sql.raw(parts[i]));
    if (i < args.length) chunks.push(sql`${args[i]}`);
  }
  return sql.join(chunks, sql.raw(""));
}

function createDrizzleAdapter(db, dialect = "sqlite") {
  return {
    all(queryText, ...args) {
      return db.all(bindQuestionSql(queryText, args));
    },
    get(queryText, ...args) {
      if (typeof db.get === "function") {
        return db.get(bindQuestionSql(queryText, args));
      }
      const rows = db.all(bindQuestionSql(queryText, args));
      return rows[0] || undefined;
    },
    run(queryText, ...args) {
      const stmt = bindQuestionSql(queryText, args);
      if (dialect === "sqlite") {
        return db.run(stmt);
      }
      return db.execute(stmt);
    },
  };
}

function bindDollarSql(queryText, args = []) {
  const text = String(queryText || "");
  const regex = /\$(\d+)/g;
  let lastIndex = 0;
  const chunks = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const index = match.index;
    const paramIdx = Number(match[1]) - 1;
    if (index > lastIndex) {
      chunks.push(sql.raw(text.slice(lastIndex, index)));
    }
    chunks.push(sql`${args[paramIdx]}`);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    chunks.push(sql.raw(text.slice(lastIndex)));
  }
  return sql.join(chunks, sql.raw(""));
}

function attachSqliteCompat(db) {
  const adapter = createDrizzleAdapter(db, "sqlite");
  db.prepare = (queryText) => ({
    all: (...args) => adapter.all(queryText, ...args),
    get: (...args) => adapter.get(queryText, ...args),
    run: (...args) => adapter.run(queryText, ...args),
  });
  db.exec = (queryText) => db.run(sql.raw(String(queryText || "")));
  return db;
}

function createPgCompat(db) {
  const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  const isRetryableSelect = (queryText, error) => {
    const text = String(queryText || "").trim();
    if (!/^SELECT\b/i.test(text)) return false;
    const message = String(error?.message || "").toLowerCase();
    const causeMessage = String(error?.cause?.message || "").toLowerCase();
    const combined = `${message} ${causeMessage}`;
    return (
      combined.includes("connection terminated due to connection timeout") ||
      combined.includes("connection terminated unexpectedly") ||
      combined.includes("socket hang up") ||
      combined.includes("econnreset") ||
      combined.includes("etimedout") ||
      combined.includes("terminating connection") ||
      combined.includes("connection reset")
    );
  };
  return {
    query: async (queryText, args = []) => {
      const text = String(queryText || "");
      const stmt = bindDollarSql(text, args);
      try {
        const res = await db.execute(stmt);
        return {
          rows: res?.rows || [],
          rowCount: Number(res?.rowCount || 0),
        };
      } catch (error) {
        if (!isRetryableSelect(text, error)) throw error;
        await sleep(150);
        const retryRes = await db.execute(stmt);
        return {
          rows: retryRes?.rows || [],
          rowCount: Number(retryRes?.rowCount || 0),
        };
      }
    },
  };
}

function getSqliteDb(dbPath) {
  if (SQLITE_DBS.has(dbPath)) return SQLITE_DBS.get(dbPath);
  ensureDir(path.dirname(dbPath));
  const client = new BetterSqlite3(dbPath);
  const db = attachSqliteCompat(drizzleSqlite(client));
  db.run(sql.raw("PRAGMA journal_mode = WAL"));
  db.run(sql.raw("PRAGMA foreign_keys = ON"));
  ensureSqliteSchema(db);
  SQLITE_DBS.set(dbPath, db);
  return db;
}

function ensureSqliteSchema(db) {
  if (!fs.existsSync(sqliteMigrationJournalPath)) {
    return;
  }
  migrateSqlite(db, {
    migrationsFolder: pathToSqliteMigrations,
  });
}

function parseJsonField(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function jsonText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function toIso(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function normalizeBrokerSyncSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_-]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeBrokerSyncAction(value) {
  const action = String(value || "").trim().toUpperCase();
  if (action === "BUY" || action === "LONG") return "BUY";
  if (action === "SELL" || action === "SHORT") return "SELL";
  return "";
}

function isBrokerSyncNoteMatchCandidate(row) {
  if (!row) return false;
  const executionStatus = String(
    row.executionStatus || row.execution_status || "",
  )
    .trim()
    .toUpperCase();
  return executionStatus === "PENDING" || executionStatus === "FILLED";
}

function normalizeTradeRow(row) {
  if (!row) return null;
  const metadata = parseJsonField(row.metadata) || {};
  const rawJson = parseJsonField(row.raw_json);
  const tradeId = row.trade_id ?? row.signal_id ?? row.sid ?? null;
  const tradeTf = row.trade_tf ?? row.signal_tf ?? null;
  return {
    ...row,
    metadata,
    raw_json: rawJson,
    userId: row.user_id ?? null,
    accountId: row.account_id ?? null,
    tradeId,
    signalId: tradeId,
    sourceId: row.source_id ?? null,
    entryModel: row.entry_model ?? null,
    tradeTf,
    signalTf: tradeTf,
    chartTf: row.chart_tf ?? null,
    rrPlanned: row.rr_planned ?? null,
    riskPctPlanned: row.risk_pct_planned ?? null,
    riskMoneyPlanned: row.risk_money_planned ?? null,
    confidencePct: row.confidence_pct ?? null,
    estimatedBars: row.estimated_bars ?? null,
    beTrigger: row.be_trigger ?? null,
    leaseToken: row.lease_token ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    dispatchStatus: row.dispatch_status ?? null,
    executionStatus: row.execution_status ?? null,
    closeReason: row.close_reason ?? null,
    rejectionReason: row.rejection_reason ?? null,
    brokerTradeId: row.broker_trade_id ?? null,
    entryExec: row.entry_exec ?? null,
    brokerPips: row.broker_pips ?? null,
    brokerLots: row.broker_lots ?? null,
    brokerCommission: row.broker_commission ?? null,
    brokerSwap: row.broker_swap ?? null,
    brokerVolume: row.broker_volume ?? null,
    brokerPnl: row.broker_pnl ?? null,
    brokerMargin: row.broker_margin ?? null,
    plannedTpPnl: row.planned_tp_pnl ?? null,
    plannedSlPnl: row.planned_sl_pnl ?? null,
    brokerTpPnl: row.broker_tp_pnl ?? null,
    brokerSlPnl: row.broker_sl_pnl ?? null,
    openedAt: row.opened_at ?? null,
    closedAt: row.closed_at ?? null,
    pnlRealized: row.pnl_realized ?? null,
    rawJson,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    orderType: row.order_type ?? null,
  };
}

function sortByTradePriority(a, b) {
  const aLeased = String(a?.dispatch_status || "").toUpperCase() === "LEASED";
  const bLeased = String(b?.dispatch_status || "").toUpperCase() === "LEASED";
  if (aLeased !== bLeased) return aLeased ? 1 : -1;
  const aCreated = Date.parse(a?.created_at || 0) || 0;
  const bCreated = Date.parse(b?.created_at || 0) || 0;
  return aCreated - bCreated;
}

function leasedDispatchType(row) {
  return syncGuards.brokerTaskTypeForTrade(row);
}

function normalizeBrokerTaskTicket(ticket) {
  const raw = String(ticket || "").trim();
  if (!raw) return null;
  const oidMatch = raw.match(/^OID(\d+)$/i);
  if (oidMatch) return oidMatch[1];
  return raw;
}

function toTaskShape(row) {
  return {
    task_id: row.sid,
    type: leasedDispatchType(row),
    symbol: row.symbol,
    action: row.action,
    volume: row.volume,
    price: row.entry,
    sl: row.sl,
    tp: row.tp,
    risk_money_planned: row.riskMoneyPlanned ?? row.risk_money_planned ?? null,
    sid: row.sid,
    ticket: normalizeBrokerTaskTicket(
      row.brokerTradeId ?? row.broker_trade_id ?? null,
    ),
    raw_json: row.rawJson ?? row.raw_json ?? null,
    metadata: row.metadata || {},
    lease_token: row.leaseToken ?? row.lease_token ?? null,
    lease_expires_at: row.leaseExpiresAt ?? row.lease_expires_at ?? null,
  };
}

function isTerminalExecutionStatus(status) {
  return ["CLOSED", "CANCELLED", "REJECTED", "TP", "SL"].includes(
    String(status || "").trim().toUpperCase(),
  );
}

function mergeBrokerSyncMetadata(existingMetadata = {}, syncMeta = {}) {
  return {
    ...(existingMetadata && typeof existingMetadata === "object"
      ? existingMetadata
      : {}),
    ...(syncMeta && typeof syncMeta === "object" ? syncMeta : {}),
  };
}

function normalizeBrokerSnapshotExecutionStatus(snapshot = {}) {
  const raw = String(
    snapshot.execution_status || snapshot.status_raw || snapshot.status || "",
  )
    .trim()
    .toUpperCase();
  if (["OPEN", "FILLED", "ACTIVE", "EXECUTED", "START"].includes(raw)) {
    return "FILLED";
  }
  if (["PENDING", "PLACED", "NEW", "SUBMITTED"].includes(raw)) {
    return "PENDING";
  }
  if (["TP", "SL", "CLOSED"].includes(raw)) return "CLOSED";
  if (["CANCEL", "CANCELLED", "EXPIRED"].includes(raw)) return "CANCELLED";
  if (["REJECTED", "FAIL", "ERROR"].includes(raw)) return "REJECTED";
  return "";
}

function recoverBrokerLinkedFailureState(currentRow, failReason = "") {
  const taskType = syncGuards.brokerTaskTypeForTrade({
    dispatch_status: currentRow?.dispatchStatus || currentRow?.dispatch_status,
    lease_expires_at: currentRow?.leaseExpiresAt || currentRow?.lease_expires_at,
    metadata: currentRow?.metadata || {},
  });
  if (!["MODIFY", "CLOSE", "CANCEL"].includes(taskType)) return null;

  const brokerData =
    currentRow?.metadata && typeof currentRow.metadata === "object"
      ? currentRow.metadata.broker_data || {}
      : {};
  const brokerStatus = normalizeBrokerSnapshotExecutionStatus(brokerData);
  const fallbackStatus = String(currentRow?.executionStatus || "")
    .trim()
    .toUpperCase();
  const recoveredStatus =
    brokerStatus ||
    (["PENDING", "FILLED", "CLOSED", "CANCELLED"].includes(fallbackStatus)
      ? fallbackStatus
      : "");
  if (!recoveredStatus) return null;

  const recoveredVolume = Number(
    brokerData.volume ?? brokerData.lots ?? currentRow?.volume,
  );

  return {
    taskType,
    execution_status: recoveredStatus,
    rejection_reason: null,
    close_reason:
      ["CLOSED", "CANCELLED"].includes(recoveredStatus)
        ? currentRow?.closeReason ?? currentRow?.close_reason ?? null
        : null,
    entry:
      brokerData.entry != null && Number.isFinite(Number(brokerData.entry))
        ? Number(brokerData.entry)
        : null,
    sl:
      brokerData.sl != null && Number.isFinite(Number(brokerData.sl))
        ? Number(brokerData.sl)
        : null,
    tp:
      brokerData.tp != null && Number.isFinite(Number(brokerData.tp))
        ? Number(brokerData.tp)
        : null,
    tp1:
      brokerData.tp1 != null && Number.isFinite(Number(brokerData.tp1))
        ? Number(brokerData.tp1)
        : brokerData.tp != null && Number.isFinite(Number(brokerData.tp))
          ? Number(brokerData.tp)
          : null,
    tp2:
      brokerData.tp2 != null && Number.isFinite(Number(brokerData.tp2))
        ? Number(brokerData.tp2)
        : null,
    tp3:
      brokerData.tp3 != null && Number.isFinite(Number(brokerData.tp3))
        ? Number(brokerData.tp3)
        : null,
    volume: Number.isFinite(recoveredVolume) ? recoveredVolume : null,
    order_type: brokerData.order_type || null,
    broker_trade_id:
      String(
        brokerData.ticket ||
          brokerData.broker_trade_id ||
          currentRow?.brokerTradeId ||
          currentRow?.broker_trade_id ||
          "",
      ).trim() || null,
    opened_at:
      syncGuards.nullableIsoTimestamp(
        brokerData.opened_at || brokerData.openedAt,
      ) || null,
    closed_at:
      syncGuards.nullableIsoTimestamp(
        brokerData.closed_at || brokerData.closedAt,
      ) || null,
    fail_reason: failReason || null,
  };
}

function buildAckUpdate(currentRow, accountId, payload = {}, options = {}) {
  const nowIso = toIso(options.now || new Date());
  const requestedStatus = String(payload.execution_status || "")
    .trim()
    .toUpperCase();
  const normalizedStatus =
    requestedStatus === "FAIL" || requestedStatus === "EXPIRED"
      ? "REJECTED"
      : requestedStatus === "START" || requestedStatus === "PLACED"
        ? "PENDING"
        : requestedStatus;
  const isClosed = ["CLOSED", "TP", "SL", "CANCELLED", "REJECTED"].includes(
    normalizedStatus,
  );
  const usedVolumeRaw = Number(
    payload.used_volume ??
      payload.usedVolume ??
      payload.volume ??
      payload.requested_volume ??
      payload.requestedVolume,
  );
  const usedVolume =
    Number.isFinite(usedVolumeRaw) && usedVolumeRaw > 0 ? usedVolumeRaw : null;
  const riskMoneyPlannedRaw = Number(payload.risk_money_planned);
  const riskMoneyPlanned = Number.isFinite(riskMoneyPlannedRaw)
    ? riskMoneyPlannedRaw
    : null;
  const ackStatus = normalizedStatus;
  const isBrokerFail = ["ERROR", "FAIL", "REJECTED"].includes(
    String(payload.execution_status || "").trim().toUpperCase(),
  );
  const failReason = isBrokerFail
    ? String(
        payload.message ||
          payload.msg ||
          payload.error ||
          payload.note ||
          "Broker failed",
      ).trim()
    : null;
  const recoveredBrokerState = isBrokerFail
    ? recoverBrokerLinkedFailureState(currentRow, failReason)
    : null;
  const baseMeta =
    currentRow.metadata && typeof currentRow.metadata === "object"
      ? { ...currentRow.metadata }
      : {};
  const telemetryPatch = {
    requested_volume:
      payload.requested_volume ?? payload.requestedVolume ?? null,
    used_volume: usedVolume,
    requested_sl: payload.requested_sl ?? payload.requestedSl ?? null,
    requested_tp: payload.requested_tp ?? payload.requestedTp ?? null,
    used_sl: payload.used_sl ?? payload.usedSl ?? null,
    used_tp: payload.used_tp ?? payload.usedTp ?? null,
    margin_req: payload.margin_req ?? payload.marginReq ?? null,
    margin_budget: payload.margin_budget ?? payload.marginBudget ?? null,
    free_margin: payload.free_margin ?? payload.freeMargin ?? null,
    balance: payload.balance ?? null,
    equity: payload.equity ?? null,
    pip_value_per_lot:
      payload.pip_value_per_lot ?? payload.pipValuePerLot ?? null,
    sl_pips: payload.sl_pips ?? payload.slPips ?? null,
    tp_pips: payload.tp_pips ?? payload.tpPips ?? null,
    risk_money_actual:
      payload.risk_money_actual ?? payload.riskMoneyActual ?? null,
    reward_money_planned:
      payload.reward_money_planned ?? payload.rewardMoneyPlanned ?? null,
    entry_price_exec:
      payload.entry_price_exec ??
      payload.entry_exec ??
      payload.entryExec ??
      null,
    exit_price:
      payload.exit_price ??
      payload.exitPrice ??
      payload.close_price ??
      payload.closePrice ??
      null,
    signal_ts: payload.signal_ts ?? payload.signalTs ?? null,
    exec_ts: payload.exec_ts ?? payload.execTs ?? null,
    ack_result: payload.result ?? payload.retcode ?? payload.code ?? null,
    ack_message: payload.message ?? payload.msg ?? payload.error ?? null,
    ack_note: payload.note ?? null,
  };
  const mergedMetadata = {
    ...baseMeta,
    ...Object.fromEntries(
      Object.entries(telemetryPatch).filter(([, value]) => {
        if (value === null || value === undefined) return false;
        return String(value).trim() !== "";
      }),
    ),
  };
  if (recoveredBrokerState?.fail_reason) {
    mergedMetadata.last_broker_task_error = recoveredBrokerState.fail_reason;
    mergedMetadata.last_broker_task_error_at = nowIso;
    mergedMetadata.last_broker_task_error_type = recoveredBrokerState.taskType;
  }

  return {
    account_id: accountId,
    dispatch_status: payload.release_only === true ? "NEW" : "CONSUMED",
    execution_status: recoveredBrokerState
      ? recoveredBrokerState.execution_status
      : isBrokerFail
        ? "REJECTED"
      : isClosed
        ? normalizedStatus
        : normalizedStatus,
    rejection_reason: recoveredBrokerState
      ? null
      : isBrokerFail
      ? failReason || "Broker failed"
      : currentRow.rejectionReason ?? currentRow.rejection_reason ?? null,
    broker_trade_id:
      ["MANUAL", ""].includes(String(payload.broker_trade_id || "").trim())
        ? currentRow.brokerTradeId ?? currentRow.broker_trade_id ?? null
        : payload.broker_trade_id,
    entry_exec:
      payload.entry_exec != null
        ? Number(payload.entry_exec)
        : currentRow.entryExec ?? currentRow.entry_exec ?? null,
    pnl_realized: isClosed
      ? payload.pnl_realized != null
        ? Number(payload.pnl_realized)
        : currentRow.pnlRealized ?? currentRow.pnl_realized ?? null
      : currentRow.pnlRealized ?? currentRow.pnl_realized ?? null,
    volume:
      recoveredBrokerState?.volume != null
        ? recoveredBrokerState.volume
        : usedVolume != null
          ? usedVolume
          : currentRow.volume ?? currentRow.volume,
    risk_money_planned:
      riskMoneyPlanned != null
        ? riskMoneyPlanned
        : currentRow.riskMoneyPlanned ?? currentRow.risk_money_planned ?? null,
    order_type:
      recoveredBrokerState?.order_type ||
      payload.order_type ||
      currentRow.orderType ||
      currentRow.order_type ||
      null,
    entry:
      recoveredBrokerState?.entry != null ? recoveredBrokerState.entry : null,
    sl: recoveredBrokerState?.sl != null ? recoveredBrokerState.sl : null,
    tp: recoveredBrokerState?.tp != null ? recoveredBrokerState.tp : null,
    tp1: recoveredBrokerState?.tp1 != null ? recoveredBrokerState.tp1 : null,
    tp2: recoveredBrokerState?.tp2 != null ? recoveredBrokerState.tp2 : null,
    tp3: recoveredBrokerState?.tp3 != null ? recoveredBrokerState.tp3 : null,
    metadata: mergedMetadata,
    opened_at:
      recoveredBrokerState?.opened_at ||
      syncGuards.nullableIsoTimestamp(payload.opened_at || payload.openedAt) ||
      currentRow.openedAt ||
      currentRow.opened_at ||
      null,
    closed_at:
      (recoveredBrokerState &&
      !["CLOSED", "CANCELLED", "REJECTED"].includes(
        String(recoveredBrokerState.execution_status || "").toUpperCase(),
      )
        ? null
        : recoveredBrokerState?.closed_at) ||
      syncGuards.nullableIsoTimestamp(payload.closed_at || payload.closedAt) ||
      currentRow.closedAt ||
      currentRow.closed_at ||
      (isClosed ? nowIso : null),
    updated_at: nowIso,
    lease_token: currentRow.leaseToken ?? currentRow.lease_token ?? null,
    lease_expires_at:
      currentRow.leaseExpiresAt ?? currentRow.lease_expires_at ?? null,
    matched_status: normalizedStatus,
  };
}

function resolvePersistedOpenedAt(syncItem = {}, existingRow = null) {
  const brokerOpenedAt = syncGuards.nullableIsoTimestamp(
    syncItem?.opened_at || syncItem?.openedAt,
  );
  if (brokerOpenedAt) return brokerOpenedAt;
  const existingOpenedAt = syncGuards.nullableIsoTimestamp(
    existingRow?.openedAt || existingRow?.opened_at,
  );
  if (existingOpenedAt) return existingOpenedAt;
  return null;
}

function isAckStateAlreadyApplied(currentRow, payload = {}) {
  const requestedStatus = String(payload.execution_status || "")
    .trim()
    .toUpperCase();
  const normalizedStatus =
    requestedStatus === "FAIL" || requestedStatus === "EXPIRED"
      ? "REJECTED"
      : requestedStatus === "START" || requestedStatus === "PLACED"
        ? "PENDING"
        : requestedStatus;
  const currentStatus = String(currentRow?.executionStatus || "")
    .trim()
    .toUpperCase();
  if (!normalizedStatus || currentStatus !== normalizedStatus) return false;
  if (!payload.broker_trade_id) return true;
  return (
    String(currentRow?.brokerTradeId || "").trim() ===
    String(payload.broker_trade_id || "").trim()
  );
}

function appendFilterClauses(filters = {}, sqlParts, params, dialect = "sqlite") {
  const add = (fragment, value) => {
    if (dialect === "postgres") {
      params.push(value);
      sqlParts.push(fragment.replace("?", `$${params.length}`));
      return;
    }
    params.push(value);
    sqlParts.push(fragment);
  };

  const addIn = (column, values) => {
    const safeValues = Array.isArray(values)
      ? values.map((v) => String(v || "").trim()).filter(Boolean)
      : [];
    if (!safeValues.length) return;
    if (dialect === "postgres") {
      const placeholders = safeValues.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      sqlParts.push(`${column} IN (${placeholders.join(", ")})`);
      return;
    }
    const placeholders = safeValues.map(() => "?").join(", ");
    params.push(...safeValues);
    sqlParts.push(`${column} IN (${placeholders})`);
  };

  const normalizeArray = (value, options = {}) => {
    const uppercase = options.uppercase === true;
    const out = Array.isArray(value)
      ? value
      : value === undefined || value === null || value === ""
        ? []
        : [value];
    return out
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .map((item) => (uppercase ? item.toUpperCase() : item));
  };

  addIn("sid", filters.sids);
  if (filters.user_id) add("user_id = ?", String(filters.user_id));
  const accountIds = [
    ...normalizeArray(filters.account_ids),
    ...normalizeArray(filters.account_id),
  ];
  addIn("account_id", [...new Set(accountIds)]);
  const sourceIds = [
    ...normalizeArray(filters.source_ids),
    ...normalizeArray(filters.source_id),
  ];
  addIn("source_id", [...new Set(sourceIds)]);
  if (filters.dispatch_status)
    add("dispatch_status = ?", String(filters.dispatch_status));
  const executionStatuses = [
    ...normalizeArray(filters.execution_statuses || filters.statuses, {
      uppercase: true,
    }),
    ...normalizeArray(filters.execution_status, { uppercase: true }),
  ];
  addIn("execution_status", [...new Set(executionStatuses)]);
  if (filters.created_from) add("created_at >= ?", toIso(filters.created_from));
  if (filters.created_to) add("created_at <= ?", toIso(filters.created_to));
  const symbols = [
    ...normalizeArray(filters.symbols, { uppercase: true }),
    ...normalizeArray(filters.symbol, { uppercase: true }),
  ];
  addIn("symbol", [...new Set(symbols)]);
  const actions = [
    ...normalizeArray(filters.actions || filters.directions, {
      uppercase: true,
    }),
    ...normalizeArray(filters.action || filters.side, { uppercase: true }),
  ];
  addIn("action", [...new Set(actions)]);
  if (filters.entry_model)
    add("entry_model = ?", String(filters.entry_model));
  if (filters.chart_tf) add("chart_tf = ?", String(filters.chart_tf));
  const pnlState = String(
    filters.pnl_state || filters.profit_state || filters.win_lose || "",
  )
    .trim()
    .toLowerCase();
  if (pnlState === "win") {
    sqlParts.push(
      `(COALESCE(CAST(broker_pnl AS REAL), CAST(pnl_realized AS REAL), 0) > 0)`,
    );
  } else if (pnlState === "lose") {
    sqlParts.push(
      `(COALESCE(CAST(broker_pnl AS REAL), CAST(pnl_realized AS REAL), 0) < 0)`,
    );
  }
  if (filters.q) {
    const likeValue = `%${String(filters.q).toLowerCase()}%`;
    const searchCols = [
      "sid",
      "broker_trade_id",
      "symbol",
      "account_id",
      "source_id",
      "action",
      "entry_model",
      "note",
    ];
    if (dialect === "postgres") {
      params.push(likeValue);
      const idx = params.length;
      sqlParts.push(
        `(${searchCols
          .map((col) => `LOWER(COALESCE(${col}, '')) LIKE $${idx}`)
          .join(" OR ")})`,
      );
      return;
    }
    params.push(likeValue);
    sqlParts.push(
      `(${searchCols
        .map((col) => `LOWER(COALESCE(${col}, '')) LIKE ?`)
        .join(" OR ")})`,
    );
    for (let i = 1; i < searchCols.length; i += 1) params.push(likeValue);
  }
}

function buildWhereClause(filters = {}, dialect = "sqlite") {
  const sqlParts = [];
  const params = [];
  appendFilterClauses(filters, sqlParts, params, dialect);
  return {
    whereSql: sqlParts.length ? ` WHERE ${sqlParts.join(" AND ")}` : "",
    params,
  };
}

function defaultManualStatusResolver(row, requestedStatus) {
  return {
    execution_status: requestedStatus,
    dispatch_status: "CONSUMED",
  };
}

function computeManualUpdate(currentRow, payload = {}, options = {}) {
  const requestedStatus = String(
    payload.execution_status || payload.status || "",
  )
    .trim()
    .toUpperCase();
  if (!requestedStatus) {
    throw new Error("execution_status or account_id is required");
  }
  const resolver = options.computeManualStatus || defaultManualStatusResolver;
  const resolved = resolver(currentRow, requestedStatus) || {};
  const executionStatus = String(
    resolved.execution_status || requestedStatus,
  ).toUpperCase();
  const dispatchStatus =
    resolved.dispatch_status === undefined ? null : resolved.dispatch_status;
  const nowIso = toIso(options.now || new Date());
  const closeReason = String(payload.close_reason || payload.reason || "").trim();
  const nextMetadata = {
    ...(currentRow.metadata && typeof currentRow.metadata === "object"
      ? currentRow.metadata
      : {}),
    manual_requested_status: requestedStatus,
    manual_requested_reason: closeReason || null,
    manual_applied_execution_status: executionStatus,
    manual_new_dispatch_status: dispatchStatus || null,
    manual_edit_source: options.editSource || "vps",
    manual_edit_at: nowIso,
  };
  const pnlValue =
    payload.pnl_realized ?? payload.pnl ?? currentRow.pnlRealized ?? null;
  const pnlNumber =
    pnlValue === null || pnlValue === undefined || pnlValue === ""
      ? null
      : Number(pnlValue);

  return {
    execution_status: executionStatus,
    dispatch_status: dispatchStatus,
    account_id: String(payload.account_id || "").trim() || currentRow.accountId,
    pnl_realized: Number.isFinite(pnlNumber)
      ? pnlNumber
      : currentRow.pnlRealized ?? null,
    close_reason:
      closeReason &&
      (!dispatchStatus ||
        dispatchStatus === "CONSUMED" ||
        dispatchStatus === "REJECTED")
        ? closeReason
        : currentRow.closeReason ?? null,
    metadata: nextMetadata,
    lease_token: dispatchStatus ? null : currentRow.leaseToken ?? null,
    lease_expires_at: dispatchStatus ? null : currentRow.leaseExpiresAt ?? null,
    closed_at:
      !dispatchStatus &&
      ["CLOSED", "CANCELLED", "REJECTED"].includes(executionStatus)
        ? syncGuards.nullableIsoTimestamp(payload.closed_at || payload.closedAt) ||
          currentRow.closedAt ||
          nowIso
        : currentRow.closedAt ?? null,
    updated_at: nowIso,
  };
}

function coalescePatchValue(patchValue, currentValue) {
  return patchValue === null || patchValue === undefined
    ? currentValue
    : patchValue;
}

function sameTradeScalar(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum === bNum;
  return String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
}

function shouldQueueBrokerModify(currentRow, updatedRow, patch = {}) {
  if (patch.dispatch_modify_if_broker_linked !== true) return false;
  if (!updatedRow) return false;
  if (
    !["PENDING", "FILLED"].includes(
      String(updatedRow.executionStatus || "").toUpperCase(),
    )
  ) {
    return false;
  }
  if (!String(updatedRow.brokerTradeId || "").trim()) return false;
  if (String(updatedRow.dispatchStatus || "").toUpperCase() !== "CONSUMED") {
    return false;
  }

  const brokerEditableFields = [
    ["action", currentRow?.action, updatedRow?.action],
    ["entry", currentRow?.entry, updatedRow?.entry],
    ["sl", currentRow?.sl, updatedRow?.sl],
    ["tp", currentRow?.tp, updatedRow?.tp],
    ["tp1", currentRow?.tp1, updatedRow?.tp1],
    ["tp2", currentRow?.tp2, updatedRow?.tp2],
    ["tp3", currentRow?.tp3, updatedRow?.tp3],
    ["order_type", currentRow?.orderType, updatedRow?.orderType],
    ["volume", currentRow?.volume, updatedRow?.volume],
  ];

  return brokerEditableFields.some(([patchKey, beforeValue, afterValue]) => {
    if (patch[patchKey] === null || patch[patchKey] === undefined) return false;
    return !sameTradeScalar(beforeValue, afterValue);
  });
}

function preserveBrokerLinkedRejectedStatus(currentRow, patch = {}) {
  const requested = String(patch.execution_status || "")
    .trim()
    .toUpperCase();
  if (requested !== "REJECTED") return "";
  const currentStatus = String(currentRow?.executionStatus || "")
    .trim()
    .toUpperCase();
  const brokerTicket = String(
    patch.broker_trade_id || currentRow?.brokerTradeId || "",
  ).trim();
  if (!brokerTicket) return "";
  if (!["PENDING", "FILLED", "CLOSED", "CANCELLED"].includes(currentStatus)) {
    return "";
  }
  return currentStatus;
}

function tradeInsertValues(row = {}, userId, now) {
  return [
    row.sid,
    row.account_id ?? null,
    row.user_id ?? safeUserId(userId),
    row.trade_id ?? row.signal_id ?? row.sid ?? null,
    row.source_id ?? null,
    row.strategy ?? null,
    row.entry_model ?? null,
    row.trade_tf ?? row.signal_tf ?? null,
    row.chart_tf ?? null,
    row.symbol,
    row.action,
    row.order_type ?? null,
    row.volume ?? null,
    row.entry ?? null,
    row.sl ?? null,
    row.tp ?? null,
    row.tp1 ?? null,
    row.tp2 ?? null,
    row.tp3 ?? null,
    row.rr_planned ?? null,
    row.risk_pct_planned ?? null,
    row.risk_money_planned ?? null,
    row.confidence_pct ?? null,
    row.estimated_bars ?? null,
    row.be_trigger ?? null,
    row.profile ?? null,
    jsonText(row.invalidation),
    jsonText(row.entry_condition),
    jsonText(row.exit_condition),
    jsonText(row.confluence_checklist),
    jsonText(row.skip_recommendation),
    jsonText(row.risk_management),
    row.note ?? null,
    row.lease_token ?? null,
    row.lease_expires_at ? toIso(row.lease_expires_at, now) : null,
    row.dispatch_status ?? "NEW",
    row.execution_status ?? "PENDING",
    row.close_reason ?? null,
    row.rejection_reason ?? null,
    row.broker_trade_id ?? null,
    row.entry_exec ?? null,
    row.broker_pips ?? null,
    row.broker_lots ?? null,
    row.broker_commission ?? null,
    row.broker_swap ?? null,
    row.broker_volume ?? null,
    row.broker_pnl ?? null,
    row.broker_margin ?? null,
    row.planned_tp_pnl ?? null,
    row.planned_sl_pnl ?? null,
    row.broker_tp_pnl ?? null,
    row.broker_sl_pnl ?? null,
    row.opened_at ? toIso(row.opened_at, now) : null,
    row.closed_at ? toIso(row.closed_at, now) : null,
    row.pnl_realized ?? null,
    jsonText(row.metadata),
    jsonText(row.raw_json),
    toIso(row.created_at, now),
    toIso(row.updated_at, now),
  ];
}

function createSqliteRepository(options = {}) {
  const projectRoot =
    options.projectRoot || path.resolve(__dirname, "..", "..", "..");

  function dbForUser(userId) {
    return getSqliteDb(resolveUserTradeDbPath(userId, { projectRoot }));
  }

  return {
    async upsertUser(user = {}) {
      const userId = safeUserId(user.user_id || user.userId || "default");
      const db = dbForUser(userId);
      db.prepare(
        `
        INSERT INTO users (user_id, name, email, roles, permissions, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          name = excluded.name,
          email = excluded.email,
          roles = excluded.roles,
          permissions = excluded.permissions,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
      `,
      ).run(
        userId,
        user.name ?? null,
        user.email ?? null,
        jsonText(user.roles ?? []),
        jsonText(user.permissions ?? []),
        jsonText(user.metadata),
        toIso(user.created_at || user.createdAt),
        toIso(user.updated_at || user.updatedAt),
      );
    },

    async seedTrades(userId, rows = []) {
      const db = dbForUser(userId);
      const now = new Date().toISOString();
      const userIdSafe = safeUserId(userId);
      const insert = db.prepare(`
        INSERT OR REPLACE INTO trades (
          sid, account_id, user_id, trade_id, source_id, strategy, entry_model,
          trade_tf, chart_tf, symbol, action, order_type, volume, entry, sl, tp,
          tp1, tp2, tp3, rr_planned, risk_pct_planned, risk_money_planned,
          confidence_pct, estimated_bars, be_trigger, profile, invalidation,
          entry_condition, exit_condition, confluence_checklist, skip_recommendation,
          risk_management, note, lease_token, lease_expires_at, dispatch_status,
          execution_status, close_reason, rejection_reason, broker_trade_id,
          entry_exec, broker_pips, broker_lots, broker_commission, broker_swap,
          broker_volume, broker_pnl, broker_margin, planned_tp_pnl, planned_sl_pnl,
          broker_tp_pnl, broker_sl_pnl, opened_at, closed_at, pnl_realized,
          metadata, raw_json, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);
      db.transaction(() => {
        db.prepare(
          `
          INSERT INTO users (user_id, name, email, roles, permissions, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            name = excluded.name,
            email = excluded.email,
            roles = excluded.roles,
            permissions = excluded.permissions,
            metadata = excluded.metadata,
            updated_at = excluded.updated_at
        `,
        ).run(userIdSafe, userIdSafe, null, jsonText(["user"]), jsonText([]), null, now, now);
        for (const row of rows) {
          insert.run(...tradeInsertValues(row, userIdSafe, now));
        }
      });
    },

    async createTrades(userId, rows = []) {
      return this.seedTrades(userId, rows);
    },

    async listTradesV2(userId, filters = {}, page = 1, pageSize = 50) {
      const db = dbForUser(userId);
      const safePage = Math.max(1, Number(page) || 1);
      const safePageSize = Math.max(1, Math.min(5000, Number(pageSize) || 50));
      const offset = (safePage - 1) * safePageSize;
      const scopedFilters = {
        ...filters,
        user_id: filters.user_id || safeUserId(userId),
      };
      const { whereSql, params } = buildWhereClause(scopedFilters, "sqlite");
      const countRow = db
        .prepare(`SELECT COUNT(*) AS count FROM trades${whereSql}`)
        .get(...params);
      const rows = db
        .prepare(
          `SELECT * FROM trades${whereSql}
           ORDER BY COALESCE(closed_at, updated_at) DESC, created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, safePageSize, offset);
      return {
        items: rows.map(normalizeTradeRow),
        total: Number(countRow?.count || 0),
        page: safePage,
        page_size: safePageSize,
      };
    },

    async countTradesByExecutionStatus(userId, filters = {}) {
      const db = dbForUser(userId);
      const scopedFilters = {
        ...filters,
        user_id: filters.user_id || safeUserId(userId),
      };
      const { whereSql, params } = buildWhereClause(scopedFilters, "sqlite");
      const rows = db
        .prepare(
          `SELECT execution_status, COUNT(*) AS count
           FROM trades${whereSql}
           GROUP BY execution_status`,
        )
        .all(...params);
      return Object.fromEntries(
        rows.map((row) => [String(row.execution_status || ""), Number(row.count || 0)]),
      );
    },

    async loadTrade(userId, tradeId, filters = {}) {
      const db = dbForUser(userId);
      const params = [String(tradeId || "").trim(), filters.user_id || safeUserId(userId)];
      const row = db
        .prepare(
          `SELECT * FROM trades
           WHERE sid = ? AND user_id = ?
           ORDER BY updated_at DESC, created_at DESC
           LIMIT 1`,
        )
        .get(...params);
      return normalizeTradeRow(row);
    },

    async updateTradePlan(userId, tradeId, patch = {}) {
      const currentRow = await this.loadTrade(userId, tradeId, {
        user_id: userId,
      });
      if (!currentRow) return { ok: false, error: "trade not found" };
      const db = dbForUser(userId || currentRow.userId || "default");
      const nextUpdatedAt = toIso(patch.updated_at || new Date());
      const nextMetadata = coalescePatchValue(patch.metadata, currentRow.metadata);
      db.prepare(
        `UPDATE trades
         SET action = ?,
             entry = ?,
             sl = ?,
             tp = ?,
             tp1 = ?,
             tp2 = ?,
             tp3 = ?,
             note = ?,
             metadata = ?,
             confidence_pct = ?,
             estimated_bars = ?,
             profile = ?,
             be_trigger = ?,
             strategy = ?,
             entry_model = ?,
             source_id = ?,
             order_type = ?,
             risk_money_planned = ?,
             volume = ?,
             planned_tp_pnl = ?,
             planned_sl_pnl = ?,
             updated_at = ?
         WHERE sid = ?`,
      ).run(
        coalescePatchValue(patch.action, currentRow.action),
        coalescePatchValue(patch.entry, currentRow.entry),
        coalescePatchValue(patch.sl, currentRow.sl),
        coalescePatchValue(patch.tp, currentRow.tp),
        coalescePatchValue(patch.tp1, currentRow.tp1),
        coalescePatchValue(patch.tp2, currentRow.tp2),
        coalescePatchValue(patch.tp3, currentRow.tp3),
        coalescePatchValue(patch.note, currentRow.note),
        jsonText(nextMetadata),
        coalescePatchValue(patch.confidence_pct, currentRow.confidencePct),
        coalescePatchValue(patch.estimated_bars, currentRow.estimatedBars),
        coalescePatchValue(patch.profile, currentRow.profile),
        coalescePatchValue(patch.be_trigger, currentRow.beTrigger),
        coalescePatchValue(patch.strategy, currentRow.strategy),
        coalescePatchValue(patch.entry_model, currentRow.entryModel),
        coalescePatchValue(patch.source_id, currentRow.sourceId),
        coalescePatchValue(patch.order_type, currentRow.orderType),
        coalescePatchValue(
          patch.risk_money_planned,
          currentRow.riskMoneyPlanned,
        ),
        coalescePatchValue(patch.volume, currentRow.volume),
        coalescePatchValue(patch.planned_tp_pnl, currentRow.plannedTpPnl),
        coalescePatchValue(patch.planned_sl_pnl, currentRow.plannedSlPnl),
        nextUpdatedAt,
        currentRow.sid,
      );
      const updated = await this.loadTrade(userId || currentRow.userId, tradeId, {
        user_id: currentRow.userId,
      });
      if (shouldQueueBrokerModify(currentRow, updated, patch)) {
        db.prepare(
          `UPDATE trades
           SET dispatch_status = 'MODIFY',
               updated_at = ?
           WHERE sid = ? AND dispatch_status = 'CONSUMED'`,
        ).run(nextUpdatedAt, currentRow.sid);
        return {
          ok: true,
          item: await this.loadTrade(userId || currentRow.userId, tradeId, {
            user_id: currentRow.userId,
          }),
        };
      }
      return { ok: true, item: updated };
    },

    async updateTradeManual(userId, tradeId, payload = {}, options = {}) {
      const currentRow =
        (await this.loadTrade(userId, tradeId, { user_id: userId })) ||
        (await this.loadTrade("default", tradeId, { user_id: userId || "default" }));
      if (!currentRow) return { ok: false, error: "trade not found" };
      const next = computeManualUpdate(currentRow, payload, options);
      const db = dbForUser(userId || currentRow.userId || "default");
      db.prepare(
        `UPDATE trades
         SET execution_status = ?,
             dispatch_status = ?,
             account_id = ?,
             pnl_realized = ?,
             close_reason = ?,
             metadata = ?,
             lease_token = ?,
             lease_expires_at = ?,
             closed_at = ?,
             updated_at = ?
         WHERE sid = ?`,
      ).run(
        next.execution_status,
        next.dispatch_status || currentRow.dispatchStatus,
        next.account_id,
        next.pnl_realized,
        next.close_reason,
        jsonText(next.metadata),
        next.lease_token,
        next.lease_expires_at,
        next.closed_at,
        next.updated_at,
        currentRow.sid,
      );
      const updated = await this.loadTrade(userId || currentRow.userId, tradeId, {
        user_id: currentRow.userId,
      });
      return {
        ok: true,
        queued_broker_action: next.dispatch_status !== "CONSUMED",
        item: updated,
      };
    },

    async assignTradeAccount(userId, tradeId, accountId) {
      const currentRow = await this.loadTrade(userId, tradeId, {
        user_id: userId,
      });
      if (!currentRow) return { ok: false, error: "trade not found" };
      const db = dbForUser(userId || currentRow.userId || "default");
      db.prepare(
        `UPDATE trades
         SET account_id = ?, updated_at = ?
         WHERE sid = ?`,
      ).run(
        String(accountId || "").trim(),
        new Date().toISOString(),
        currentRow.sid,
      );
      return {
        ok: true,
        item: await this.loadTrade(userId || currentRow.userId, tradeId, {
          user_id: currentRow.userId,
        }),
      };
    },

    async deleteTradesBySids(userId, sids = []) {
      const safeSids = Array.isArray(sids)
        ? sids.map((sid) => String(sid || "").trim()).filter(Boolean)
        : [];
      if (!safeSids.length) return { deleted: 0 };
      const db = dbForUser(userId);
      const placeholders = safeSids.map(() => "?").join(", ");
      const result = db
        .prepare(`DELETE FROM trades WHERE user_id = ? AND sid IN (${placeholders})`)
        .run(safeUserId(userId), ...safeSids);
      return { deleted: Number(result.changes || 0) };
    },

    async listTradeFolderStates(userId, filters = {}) {
      const db = dbForUser(userId || filters.user_id || "default");
      const scopedFilters = {
        ...filters,
        user_id: filters.user_id || safeUserId(userId),
      };
      const { whereSql, params } = buildWhereClause(scopedFilters, "sqlite");
      return db
        .prepare(
          `SELECT sid, symbol, execution_status
           FROM trades${whereSql}
           ORDER BY created_at ASC`,
        )
        .all(...params)
        .map((row) => ({
          sid: String(row.sid || "").trim(),
          symbol: row.symbol ?? null,
          execution_status: row.execution_status ?? null,
        }));
    },

    async getTradesBySids(userId, sids = []) {
      const safeSids = Array.isArray(sids)
        ? sids.map((sid) => String(sid || "").trim()).filter(Boolean)
        : [];
      if (!safeSids.length) return [];
      const db = dbForUser(userId);
      const placeholders = safeSids.map(() => "?").join(", ");
      return db
        .prepare(
          `SELECT * FROM trades
           WHERE user_id = ? AND sid IN (${placeholders})
           ORDER BY updated_at DESC, created_at DESC`,
        )
        .all(safeUserId(userId), ...safeSids)
        .map(normalizeTradeRow);
    },

    async deleteTradesOlderThan(userId, isoTimestamp) {
      const db = dbForUser(userId);
      const result = db
        .prepare(`DELETE FROM trades WHERE user_id = ? AND created_at < ?`)
        .run(safeUserId(userId), toIso(isoTimestamp));
      return { deleted: Number(result.changes || 0) };
    },

    async applySignalAck(userId, tradeId, patch = {}) {
      const currentRow = await this.loadTrade(userId, tradeId, {
        user_id: userId,
      });
      if (!currentRow) return { ok: false, error: "trade not found" };
      const db = dbForUser(userId || currentRow.userId || "default");
      const metadata = mergeBrokerSyncMetadata(currentRow.metadata, patch.metadata || {});
      const requestedExecStatus = String(
        patch.execution_status || currentRow.executionStatus || "",
      )
        .trim()
        .toUpperCase();
      const preservedStatus = preserveBrokerLinkedRejectedStatus(currentRow, patch);
      const execStatus = preservedStatus || requestedExecStatus;
      const isClosed = preservedStatus ? false : Boolean(patch.is_closed);
      db.prepare(
        `UPDATE trades
         SET execution_status = ?,
             broker_trade_id = ?,
             pnl_realized = ?,
             order_type = ?,
             metadata = ?,
             closed_at = ?,
             updated_at = ?
         WHERE sid = ?`,
      ).run(
        execStatus || currentRow.executionStatus,
        String(patch.broker_trade_id || "").trim() || currentRow.brokerTradeId,
        isClosed
          ? coalescePatchValue(patch.pnl_realized, currentRow.pnlRealized)
          : currentRow.pnlRealized,
        coalescePatchValue(patch.order_type, currentRow.orderType),
        jsonText(metadata),
        isClosed ? toIso(patch.closed_at || new Date()) : currentRow.closedAt,
        toIso(patch.updated_at || new Date()),
        currentRow.sid,
      );
      return {
        ok: true,
        item: await this.loadTrade(userId || currentRow.userId, tradeId, {
          user_id: currentRow.userId,
        }),
      };
    },

    async updateTradeRiskLevels(userId, tradeId, patch = {}) {
      const currentRow = await this.loadTrade(userId, tradeId, {
        user_id: userId,
      });
      if (!currentRow) return { ok: false, error: "trade not found" };
      const db = dbForUser(userId || currentRow.userId || "default");
      db.prepare(
        `UPDATE trades
         SET sl = ?,
             tp = ?,
             updated_at = ?
         WHERE sid = ? AND execution_status IN ('FILLED','PENDING')`,
      ).run(
        coalescePatchValue(patch.sl, currentRow.sl),
        coalescePatchValue(patch.tp, currentRow.tp),
        toIso(patch.updated_at || new Date()),
        currentRow.sid,
      );
      return {
        ok: true,
        item: await this.loadTrade(userId || currentRow.userId, tradeId, {
          user_id: currentRow.userId,
        }),
      };
    },

    async pullLeasedTrades(
      userId,
      accountId,
      maxItems = 1,
      leaseSeconds = 30,
      taskTypeFilter = null,
      options = {},
    ) {
      const db = dbForUser(userId);
      const aid = String(accountId || "").trim();
      const safeLimit = Math.max(1, Math.min(100, Number(maxItems) || 1));
      const leaseSec = Math.max(5, Math.min(300, Number(leaseSeconds) || 30));
      const now = new Date(options.now || Date.now());
      const nowIso = now.toISOString();
      const taskFilter = String(taskTypeFilter || "").trim().toUpperCase();
      const rows = db
        .prepare(
          `SELECT * FROM trades
           WHERE user_id = ?
             AND (account_id = ? OR account_id = '' OR account_id IS NULL)
             AND (
               execution_status IN ('PENDING','FILLED')
               OR (dispatch_status IN ('CANCEL','CLOSE') AND execution_status IN ('CANCELLED','CLOSED'))
             )
             AND (
               dispatch_status IN ('OPEN', 'MODIFY', 'CLOSE', 'CANCEL')
               OR (dispatch_status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
             )`,
        )
        .all(safeUserId(userId), aid, nowIso)
        .sort(sortByTradePriority);
      const selected = [];
      for (const rawRow of rows) {
        if (selected.length >= safeLimit) break;
        const row = normalizeTradeRow(rawRow);
        const taskType = leasedDispatchType(row);
        if (taskFilter && taskType !== taskFilter) continue;
        const staleNew = syncGuards.isNewTradeTooOld(
          row,
          Number(options.maxAgeHours || 0),
          now,
        );
        if (staleNew) {
          const nextMetadata = {
            ...(row.metadata || {}),
            stale_pull_rejected_at: nowIso,
            stale_pull_max_age_hours: Number(options.maxAgeHours || 0),
          };
          db.prepare(
            `UPDATE trades
             SET dispatch_status = 'REJECTED',
                 execution_status = 'REJECTED',
                 rejection_reason = COALESCE(rejection_reason, ?),
                 metadata = ?,
                 updated_at = ?
             WHERE sid = ?`,
          ).run(
            "stale broker pull task",
            jsonText(nextMetadata),
            nowIso,
            row.sid,
          );
          continue;
        }
        const retryCount = syncGuards.nextLeaseRetryCount(row, now);
        const hasBroker = Boolean(String(row.brokerTradeId || "").trim());
        if (
          syncGuards.shouldAutoRejectLeasedTrade(
            row,
            Number(options.maxLeaseRetries || 3),
            now,
          ) &&
          !hasBroker
        ) {
          const nextMetadata = {
            ...(row.metadata || {}),
            stale_pull_rejected_at: nowIso,
            stale_pull_max_age_hours: Number(options.maxAgeHours || 0),
          };
          db.prepare(
            `UPDATE trades
             SET dispatch_status = ?,
                 execution_status = ?,
                 rejection_reason = COALESCE(rejection_reason, ?),
                 metadata = ?,
                 updated_at = ?
             WHERE sid = ?`,
          ).run(
            hasBroker ? "CANCEL" : "REJECTED",
            hasBroker ? "CANCELLED" : "REJECTED",
            "broker ack lease retry limit exceeded",
            jsonText(nextMetadata),
            nowIso,
            row.sid,
          );
          continue;
        }
        const leaseToken = String(
          (options.generateLeaseToken && options.generateLeaseToken()) ||
            `lease_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        );
        const leaseExpiresAt = new Date(
          now.getTime() + leaseSec * 1000,
        ).toISOString();
        const currentDispatch = String(row.dispatchStatus || row.dispatch_status || "")
          .trim()
          .toUpperCase();
        const currentLeasedDispatch =
          currentDispatch === "LEASED"
            ? String(row.metadata?.leased_dispatch_status || "").toUpperCase()
            : currentDispatch;
        const nextMetadata = {
          ...(row.metadata || {}),
          lease_retry_count: retryCount,
          leased_dispatch_status: syncGuards.brokerTaskTypeForTrade({
            dispatch_status: currentLeasedDispatch,
          }),
        };
        db.prepare(
          `UPDATE trades
           SET dispatch_status = 'LEASED',
               lease_token = ?,
               lease_expires_at = ?,
               metadata = ?,
               updated_at = ?
           WHERE sid = ?`,
        ).run(leaseToken, leaseExpiresAt, jsonText(nextMetadata), nowIso, row.sid);
        selected.push(
          normalizeTradeRow({
            ...rawRow,
            dispatch_status: "LEASED",
            lease_token: leaseToken,
            lease_expires_at: leaseExpiresAt,
            metadata: jsonText(nextMetadata),
            updated_at: nowIso,
          }),
        );
      }
      return selected;
    },

    async pullAndLockNextTask(accountId, options = {}) {
      const items = await this.pullLeasedTrades(
        options.userId || "default",
        accountId,
        1,
        60,
        null,
        options,
      );
      return items[0] ? toTaskShape(items[0]) : null;
    },

    async ackTrade(userId, accountId, payload = {}, options = {}) {
      const currentRow =
        (await this.loadTrade(userId, payload.sid || payload.trade_id, {
          user_id: userId,
        })) || null;
      if (!currentRow) return { ok: false, error: "trade not found" };
      const leaseToken = String(payload.lease_token || "").trim();
      const currentDispatch = String(currentRow.dispatchStatus || "").toUpperCase();
      const ackStateApplied = isAckStateAlreadyApplied(currentRow, payload);
      if (
        currentDispatch === "CONSUMED" &&
        ackStateApplied &&
        !currentRow.leaseToken &&
        !currentRow.leaseExpiresAt
      ) {
        return {
          ok: true,
          duplicate: true,
          dispatch_status: currentRow.dispatchStatus,
          execution_status: currentRow.executionStatus,
        };
      }
      if (ackStateApplied) {
        const next = buildAckUpdate(currentRow, accountId, payload, options);
        const db = dbForUser(userId || currentRow.userId || "default");
        db.prepare(
          `UPDATE trades
           SET dispatch_status = ?,
               execution_status = ?,
               rejection_reason = ?,
               broker_trade_id = ?,
               entry_exec = ?,
               pnl_realized = ?,
               volume = ?,
               risk_money_planned = ?,
               order_type = ?,
               entry = COALESCE(?, entry),
               sl = COALESCE(?, sl),
               tp = COALESCE(?, tp),
               tp1 = COALESCE(?, tp1),
               tp2 = COALESCE(?, tp2),
               tp3 = COALESCE(?, tp3),
               metadata = ?,
               opened_at = ?,
               closed_at = ?,
               updated_at = ?,
               lease_token = ?,
               lease_expires_at = ?
           WHERE sid = ?`,
        ).run(
          next.dispatch_status,
          next.execution_status,
          next.rejection_reason,
          next.broker_trade_id,
          next.entry_exec,
          next.pnl_realized,
          next.volume,
          next.risk_money_planned,
          next.order_type,
          next.entry,
          next.sl,
          next.tp,
          next.tp1,
          next.tp2,
          next.tp3,
          jsonText(next.metadata),
          next.opened_at,
          next.closed_at,
          next.updated_at,
          null,
          null,
          currentRow.sid,
        );
        const updated = await this.loadTrade(
          userId || currentRow.userId || "default",
          currentRow.sid,
          { user_id: currentRow.userId },
        );
        return {
          ok: true,
          duplicate: true,
          dispatch_status: updated.dispatchStatus,
          execution_status: updated.executionStatus,
          item: updated,
        };
      }
      if (
        currentDispatch !== "LEASED" ||
        String(currentRow.accountId || "") !== String(accountId || "") ||
        String(currentRow.leaseToken || "") !== leaseToken
      ) {
        return { ok: false, error: "stale or mismatched lease token" };
      }
      const next = buildAckUpdate(currentRow, accountId, payload, options);
      const db = dbForUser(userId || currentRow.userId || "default");
      db.prepare(
        `UPDATE trades
         SET dispatch_status = ?,
             execution_status = ?,
             rejection_reason = ?,
             broker_trade_id = ?,
             entry_exec = ?,
             pnl_realized = ?,
             volume = ?,
             risk_money_planned = ?,
             order_type = ?,
             entry = COALESCE(?, entry),
             sl = COALESCE(?, sl),
             tp = COALESCE(?, tp),
             tp1 = COALESCE(?, tp1),
             tp2 = COALESCE(?, tp2),
             tp3 = COALESCE(?, tp3),
             metadata = ?,
             opened_at = ?,
             closed_at = ?,
             updated_at = ?,
             lease_token = ?,
             lease_expires_at = ?
         WHERE sid = ?`,
      ).run(
        next.dispatch_status,
        next.execution_status,
        next.rejection_reason,
        next.broker_trade_id,
        next.entry_exec,
        next.pnl_realized,
        next.volume,
        next.risk_money_planned,
        next.order_type,
        next.entry,
        next.sl,
        next.tp,
        next.tp1,
        next.tp2,
        next.tp3,
        jsonText(next.metadata),
        next.opened_at,
        next.closed_at,
        next.updated_at,
        null,
        null,
        currentRow.sid,
      );
      const updated = await this.loadTrade(userId || currentRow.userId, currentRow.sid, {
        user_id: currentRow.userId,
      });
      return {
        ok: true,
        dispatch_status: updated.dispatchStatus,
        execution_status: updated.executionStatus,
        item: updated,
      };
    },

    async brokerSyncTrades(userId, accountId, items = [], options = {}) {
      const db = dbForUser(userId);
      const aid = String(accountId || "").trim();
      const nowIso = toIso(options.now || new Date());
      const allTrades = db
        .prepare(`SELECT * FROM trades WHERE user_id = ? AND account_id = ?`)
        .all(safeUserId(userId), aid)
        .map(normalizeTradeRow);
      const bySid = new Map(allTrades.map((row) => [String(row.sid || ""), row]));
      const byTicket = new Map(
        allTrades
          .filter((row) => String(row.brokerTradeId || "").trim())
          .map((row) => [String(row.brokerTradeId || "").trim(), row]),
      );
      const byNote = new Map(
        allTrades
          .filter(
            (row) =>
              String(row.note || "").trim() &&
              isBrokerSyncNoteMatchCandidate(row),
          )
          .map((row) => [String(row.note || "").trim().toUpperCase(), row]),
      );
      const oldStatusMap = new Map();
      const oldTicketMap = new Map();
      for (const row of allTrades) {
        const meta = row.metadata || {};
        const rowData = {
          sid: row.sid,
          broker_trade_id: row.brokerTradeId,
          execution_status: row.executionStatus,
          dispatch_status: row.dispatchStatus,
          rejection_reason: row.rejectionReason,
          sl: row.sl,
          tp: row.tp,
          pnl: row.brokerPnl,
          metadata: row.metadata,
          has_partial: String(meta.has_partial || "false"),
          last_broker_snapshot_hash: String(meta.last_broker_snapshot_hash || ""),
        };
        oldStatusMap.set(row.sid, rowData);
        if (row.brokerTradeId) oldTicketMap.set(String(row.brokerTradeId), rowData);
      }

      const results = [];
      let matched = 0;
      let synced = 0;
      const seenTickets = new Set();

      for (const it of Array.isArray(items) ? items : []) {
        const ticketCandidates =
          Array.isArray(it.ticket_candidates) && it.ticket_candidates.length
            ? it.ticket_candidates.map((v) => String(v || "").trim()).filter(Boolean)
            : it.ticket
              ? [String(it.ticket).trim()]
              : [];
        const syncSymbol =
          normalizeBrokerSyncSymbol(it.symbol) ||
          normalizeBrokerSyncSymbol(it.broker_symbol);
        const syncAction = normalizeBrokerSyncAction(it.action || it.side);
        ticketCandidates.forEach((ticket) => seenTickets.add(ticket));
        const snapshotHash = syncGuards.brokerSnapshotHash(it);
        const oldForItem =
          (it.sid && oldStatusMap.get(String(it.sid))) ||
          ticketCandidates.map((ticket) => oldTicketMap.get(ticket)).find(Boolean) ||
          null;
        const oldSnapshotHash = String(
          oldForItem?.last_broker_snapshot_hash ||
            oldForItem?.metadata?.last_broker_snapshot_hash ||
            "",
        ).trim();
        const clearRejectedDispatch =
          syncGuards.shouldClearRejectedDispatchFromBrokerSnapshot(
            oldForItem || {},
            it,
          );
        if (
          oldForItem &&
          oldSnapshotHash &&
          oldSnapshotHash === snapshotHash &&
          !clearRejectedDispatch
        ) {
          results.push({
            ticket: it.ticket,
            sid: oldForItem.sid || it.sid || null,
            status: "NoChange",
            symbol: it.symbol,
            action: it.action,
          });
          continue;
        }

        const noteCandidates = [
          String(it.note || "").trim(),
          String(it.trade_id || "").trim(),
          String(it.signal_id || "").trim(),
          String(it.sid || "").trim(),
        ]
          .filter(Boolean)
          .map((value) => value.toUpperCase());
        const existing =
          (it.sid && bySid.get(String(it.sid))) ||
          noteCandidates.map((value) => byNote.get(value)).find(Boolean) ||
          ticketCandidates.map((ticket) => byTicket.get(ticket)).find(Boolean) ||
          null;

        const syncMeta = {
          order_type: it.order_type || null,
          broker_name: options.brokerName || "",
          provider_code: options.providerCode || "",
          last_change_origin: "broker",
          last_inbound_event_id: `broker:${aid}:${snapshotHash}`,
          last_broker_snapshot_hash: snapshotHash,
          broker_data: {
            ...it,
            position_id: ticketCandidates[0] || null,
            ticket_candidates: ticketCandidates,
            snapshot_hash: snapshotHash,
            last_sync_at: nowIso,
          },
          last_sync_source: "broker_sync_v2",
          has_partial: Boolean(it.has_partial),
        };

        if (existing) {
          const nextExecutionStatus = String(it.execution_status || "")
            .trim()
            .toUpperCase();
          const consumeLease =
            clearRejectedDispatch ||
            String(existing.dispatchStatus || "").toUpperCase() === "LEASED";
          const nextDispatchStatus = consumeLease
            ? "CONSUMED"
            : existing.dispatchStatus;
          const nextMetadata = mergeBrokerSyncMetadata(existing.metadata, syncMeta);
          db.prepare(
            `UPDATE trades
             SET execution_status = ?,
                 dispatch_status = ?,
                 broker_trade_id = ?,
                 pnl_realized = ?,
                 broker_pnl = ?,
                 volume = ?,
                 broker_pips = ?,
                 broker_lots = ?,
                 broker_commission = ?,
                 broker_swap = ?,
                 broker_volume = ?,
                 broker_margin = ?,
                 broker_tp_pnl = ?,
                 broker_sl_pnl = ?,
                 entry_exec = COALESCE(?, entry_exec),
                 order_type = COALESCE(?, order_type),
                 close_reason = ?,
                 rejection_reason = ?,
                 note = COALESCE(NULLIF(note, ''), ?),
                 metadata = ?,
                 opened_at = ?,
                 closed_at = ?,
                 lease_token = ?,
                 lease_expires_at = ?,
                 sl = COALESCE(?, sl),
                 tp = COALESCE(?, tp),
                 tp1 = COALESCE(?, tp1),
                 tp2 = COALESCE(?, tp2),
                 tp3 = COALESCE(?, tp3),
                 updated_at = ?
             WHERE sid = ?`,
          ).run(
            nextExecutionStatus,
            nextDispatchStatus,
            ticketCandidates[0] || existing.brokerTradeId || null,
            isTerminalExecutionStatus(nextExecutionStatus)
              ? Number(it.pnl ?? existing.pnlRealized ?? 0)
              : existing.pnlRealized,
            Number(it.pnl ?? existing.brokerPnl ?? 0),
            Number(it.volume ?? existing.volume ?? 0),
            Number(it.pips ?? existing.brokerPips ?? 0),
            Number(it.lots ?? existing.brokerLots ?? 0),
            Number(it.commission ?? existing.brokerCommission ?? 0),
            Number(it.swap ?? existing.brokerSwap ?? 0),
            Number(it.broker_volume ?? existing.brokerVolume ?? 0),
            Number(it.margin ?? existing.brokerMargin ?? 0),
            it.tp_pnl ?? existing.brokerTpPnl ?? null,
            it.sl_pnl ?? existing.brokerSlPnl ?? null,
            it.entry ?? null,
            it.order_type || null,
            isTerminalExecutionStatus(nextExecutionStatus)
              ? it.close_reason || existing.closeReason || null
              : null,
            clearRejectedDispatch ? null : existing.rejectionReason,
            it.note || null,
            jsonText(nextMetadata),
            resolvePersistedOpenedAt(it, existing, nowIso),
            isTerminalExecutionStatus(nextExecutionStatus)
              ? it.closed_at || existing.closedAt || nowIso
              : null,
            consumeLease ? null : existing.leaseToken,
            consumeLease ? null : existing.leaseExpiresAt,
            it.sl ?? null,
            it.tp ?? null,
            it.tp1 ?? null,
            it.tp2 ?? null,
            it.tp3 ?? null,
            nowIso,
            existing.sid,
          );
          const updated = normalizeTradeRow(
            db.prepare(`SELECT * FROM trades WHERE sid = ?`).get(existing.sid),
          );
          bySid.set(updated.sid, updated);
          if (updated.brokerTradeId) byTicket.set(String(updated.brokerTradeId), updated);
          if (String(updated.note || "").trim()) {
            byNote.set(String(updated.note || "").trim().toUpperCase(), updated);
          }
          matched += 1;
          synced += 1;
          results.push({
            ticket: it.ticket,
            sid: updated.sid,
            status: "Ok",
            symbol: it.symbol,
            action: it.action,
          });
          continue;
        }

        if (!["FILLED", "PENDING"].includes(String(it.execution_status || "").toUpperCase())) {
          results.push({
            ticket: it.ticket,
            sid: null,
            status: "Skip",
            symbol: it.symbol,
            action: it.action,
          });
          continue;
        }

        if (!syncSymbol || !syncAction) {
          results.push({
            ticket: it.ticket,
            sid: null,
            status: "Skip",
            symbol: it.symbol,
            action: it.action,
            reason: "missing_symbol_or_action",
          });
          continue;
        }

        if (ticketCandidates[0] && byTicket.has(ticketCandidates[0])) {
          const duplicate = byTicket.get(ticketCandidates[0]);
          results.push({
            ticket: it.ticket,
            sid: duplicate.sid,
            status: "Skip",
            symbol: it.symbol,
            action: it.action,
            reason: `duplicate_broker_ticket_${duplicate.executionStatus}`,
          });
          continue;
        }

        const discoverySid = String(
          it.sid ||
            (ticketCandidates[0]
              ? `M_${ticketCandidates[0]}`
              : (options.generateSid && options.generateSid()) ||
                `M_${Date.now()}`),
        ).trim();
        const nextMetadata = mergeBrokerSyncMetadata({}, syncMeta);
        db.prepare(
          `INSERT OR REPLACE INTO trades (
             sid, account_id, user_id, symbol, action, order_type, volume,
             entry, sl, tp, tp1, tp2, tp3, note, execution_status,
             dispatch_status, source_id, metadata, broker_trade_id,
             broker_pips, broker_lots, broker_commission, broker_swap,
             broker_volume, broker_pnl, broker_margin, planned_tp_pnl,
             planned_sl_pnl, broker_tp_pnl, broker_sl_pnl, opened_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          discoverySid,
          aid,
          safeUserId(userId),
          syncSymbol,
          syncAction,
          it.order_type || null,
          Number(it.lots ?? it.volume ?? 0),
          it.entry || 0,
          it.sl ?? null,
          it.tp ?? null,
          it.tp1 ?? null,
          it.tp2 ?? null,
          it.tp3 ?? null,
          it.note || "",
          String(it.execution_status || "PENDING").toUpperCase(),
          "CONSUMED",
          options.sourceId || "BROKER",
          jsonText(nextMetadata),
          ticketCandidates[0] || "",
          Number(it.pips ?? 0),
          Number(it.lots ?? 0),
          Number(it.commission ?? 0),
          Number(it.swap ?? 0),
          Number(it.broker_volume ?? 0),
          Number(it.pnl ?? 0),
          Number(it.margin ?? 0),
          options.resolvePlannedTpPnl ? options.resolvePlannedTpPnl(it) : null,
          options.resolvePlannedSlPnl ? options.resolvePlannedSlPnl(it) : null,
          it.tp_pnl ?? null,
          it.sl_pnl ?? null,
          resolvePersistedOpenedAt(it, null, nowIso),
          nowIso,
          nowIso,
        );
        const created = normalizeTradeRow(
          db.prepare(`SELECT * FROM trades WHERE sid = ?`).get(discoverySid),
        );
        bySid.set(created.sid, created);
        if (created.brokerTradeId) byTicket.set(String(created.brokerTradeId), created);
        if (String(created.note || "").trim()) {
          byNote.set(String(created.note || "").trim().toUpperCase(), created);
        }
        matched += 1;
        results.push({
          ticket: it.ticket,
          sid: discoverySid,
          suggested_sid: discoverySid,
          status: "Added",
          symbol: it.symbol,
          action: it.action,
        });
      }

      let closedRows = [];
      if (options.snapshotComplete) {
        const accountTrades = Array.from(bySid.values());
        const toClose = accountTrades.filter((row) => {
          const exec = String(row.executionStatus || "").toUpperCase();
          if (!["FILLED", "PENDING"].includes(exec)) return false;
          if (seenTickets.size > 0) {
            const ticket = String(row.brokerTradeId || "").trim();
            return ticket && !seenTickets.has(ticket);
          }
          return true;
        });
        for (const row of toClose) {
          const nextExecution = String(row.executionStatus || "").toUpperCase() === "PENDING"
            ? "CANCELLED"
            : "CLOSED";
          const nextCloseReason =
            row.closeReason ||
            (nextExecution === "CANCELLED" ? "CANCEL" : "MANUAL");
          db.prepare(
            `UPDATE trades
             SET execution_status = ?,
                 close_reason = ?,
                 closed_at = COALESCE(closed_at, ?),
                 updated_at = ?
             WHERE sid = ?`,
          ).run(nextExecution, nextCloseReason, nowIso, nowIso, row.sid);
          const updatedRow = normalizeTradeRow(
            db.prepare(`SELECT * FROM trades WHERE sid = ?`).get(row.sid),
          );
          bySid.set(updatedRow.sid, updatedRow);
          if (updatedRow.brokerTradeId)
            byTicket.set(String(updatedRow.brokerTradeId), updatedRow);
          if (String(updatedRow.note || "").trim()) {
            byNote.set(String(updatedRow.note || "").trim().toUpperCase(), updatedRow);
          }
          closedRows.push(updatedRow);
        }
      }

      const latestBySid = new Map(bySid);
      const tradeUpdates = [];
      for (const it of Array.isArray(items) ? items : []) {
        const sid = String(it.sid || "").trim();
        if (!sid) continue;
        const oldRow = oldStatusMap.get(sid) || {};
        const latest = latestBySid.get(sid);
        if (!latest) continue;
        const oldStatus = oldRow.execution_status || null;
        const newStatus = latest.executionStatus;
        const oldSl = Number.isFinite(Number(oldRow.sl)) ? Number(oldRow.sl) : null;
        const newSl = latest.sl ?? null;
        const oldTp = Number.isFinite(Number(oldRow.tp)) ? Number(oldRow.tp) : null;
        const newTp = latest.tp ?? null;
        const oldHasPartial =
          oldRow.has_partial === "true" || oldRow.has_partial === true;
        const newHasPartial = Boolean(latest.metadata?.has_partial);
        const statusChanged = !oldStatus || oldStatus !== newStatus;
        const slChanged =
          oldSl !== null && newSl !== null && Math.abs(oldSl - newSl) > 0.000001;
        const tpChanged =
          oldTp !== null && newTp !== null && Math.abs(oldTp - newTp) > 0.000001;
        const partialChanged = oldHasPartial !== newHasPartial;
        if (statusChanged || slChanged || tpChanged || partialChanged) {
          tradeUpdates.push({
            sid,
            symbol: latest.symbol,
            pnl_realized: latest.pnlRealized,
            broker_pnl: latest.brokerPnl,
            broker_pips: latest.brokerPips,
            execution_status: latest.executionStatus,
            sl: newSl,
            sl_before: oldSl,
            tp: newTp,
            tp_before: oldTp,
            has_partial: newHasPartial,
            status_changed: statusChanged,
            sl_changed: slChanged,
            tp_changed: tpChanged,
            partial_changed: partialChanged,
          });
        }
      }

      return {
        ok: true,
        synced,
        matched,
        received: items.length,
        closed_by_snapshot: closedRows.length,
        results,
        tradeUpdates,
        closedRows,
      };
    },
  };
}

function createPostgresRepository(options = {}) {
  const pgPool = options.postgresPool;
  if (!pgPool) throw new Error("postgresPool is required for postgres repository");
  const db = drizzlePg(pgPool);
  const pool = createPgCompat(db);

  return {
    async upsertUser(user = {}) {
      await pool.query(
        `
        INSERT INTO users (user_id, name, email, roles, permissions, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)
        ON CONFLICT (user_id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          roles = EXCLUDED.roles,
          permissions = EXCLUDED.permissions,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `,
        [
          safeUserId(user.user_id || user.userId || "default"),
          user.name ?? null,
          user.email ?? null,
          jsonText(user.roles ?? []),
          jsonText(user.permissions ?? []),
          jsonText(user.metadata),
          toIso(user.created_at || user.createdAt),
          toIso(user.updated_at || user.updatedAt),
        ],
      );
    },

    async seedTrades(_userId, rows = []) {
      for (const row of rows) {
        await pool.query(
          `
          INSERT INTO trades (
            sid, account_id, user_id, trade_id, source_id, strategy, entry_model,
            trade_tf, chart_tf, symbol, action, order_type, volume, entry, sl, tp,
            tp1, tp2, tp3, rr_planned, risk_pct_planned, risk_money_planned,
            confidence_pct, estimated_bars, be_trigger, profile, invalidation,
            entry_condition, exit_condition, confluence_checklist, skip_recommendation,
            risk_management, note, lease_token, lease_expires_at, dispatch_status,
            execution_status, close_reason, rejection_reason, broker_trade_id,
            entry_exec, broker_pips, broker_lots, broker_commission, broker_swap,
            broker_volume, broker_pnl, broker_margin, planned_tp_pnl, planned_sl_pnl,
            broker_tp_pnl, broker_sl_pnl, opened_at, closed_at, pnl_realized,
            metadata, raw_json, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
            $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44,
            $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58, $59
          )
          ON CONFLICT (sid) DO UPDATE SET
            account_id = EXCLUDED.account_id,
            user_id = EXCLUDED.user_id,
            trade_id = EXCLUDED.trade_id,
            source_id = EXCLUDED.source_id,
            strategy = EXCLUDED.strategy,
            entry_model = EXCLUDED.entry_model,
            trade_tf = EXCLUDED.trade_tf,
            chart_tf = EXCLUDED.chart_tf,
            symbol = EXCLUDED.symbol,
            action = EXCLUDED.action,
            order_type = EXCLUDED.order_type,
            volume = EXCLUDED.volume,
            entry = EXCLUDED.entry,
            sl = EXCLUDED.sl,
            tp = EXCLUDED.tp,
            tp1 = EXCLUDED.tp1,
            tp2 = EXCLUDED.tp2,
            tp3 = EXCLUDED.tp3,
            rr_planned = EXCLUDED.rr_planned,
            risk_pct_planned = EXCLUDED.risk_pct_planned,
            risk_money_planned = EXCLUDED.risk_money_planned,
            confidence_pct = EXCLUDED.confidence_pct,
            estimated_bars = EXCLUDED.estimated_bars,
            be_trigger = EXCLUDED.be_trigger,
            profile = EXCLUDED.profile,
            invalidation = EXCLUDED.invalidation,
            entry_condition = EXCLUDED.entry_condition,
            exit_condition = EXCLUDED.exit_condition,
            confluence_checklist = EXCLUDED.confluence_checklist,
            skip_recommendation = EXCLUDED.skip_recommendation,
            risk_management = EXCLUDED.risk_management,
            note = EXCLUDED.note,
            lease_token = EXCLUDED.lease_token,
            lease_expires_at = EXCLUDED.lease_expires_at,
            execution_status = EXCLUDED.execution_status,
            dispatch_status = EXCLUDED.dispatch_status,
            close_reason = EXCLUDED.close_reason,
            rejection_reason = EXCLUDED.rejection_reason,
            broker_trade_id = EXCLUDED.broker_trade_id,
            entry_exec = EXCLUDED.entry_exec,
            broker_pips = EXCLUDED.broker_pips,
            broker_lots = EXCLUDED.broker_lots,
            broker_commission = EXCLUDED.broker_commission,
            broker_swap = EXCLUDED.broker_swap,
            broker_volume = EXCLUDED.broker_volume,
            broker_pnl = EXCLUDED.broker_pnl,
            broker_margin = EXCLUDED.broker_margin,
            planned_tp_pnl = EXCLUDED.planned_tp_pnl,
            planned_sl_pnl = EXCLUDED.planned_sl_pnl,
            broker_tp_pnl = EXCLUDED.broker_tp_pnl,
            broker_sl_pnl = EXCLUDED.broker_sl_pnl,
            opened_at = EXCLUDED.opened_at,
            closed_at = EXCLUDED.closed_at,
            pnl_realized = EXCLUDED.pnl_realized,
            metadata = EXCLUDED.metadata,
            raw_json = EXCLUDED.raw_json,
            updated_at = EXCLUDED.updated_at
        `,
          tradeInsertValues(row, _userId || row.user_id || "default", new Date().toISOString()),
        );
      }
    },

    async createTrades(userId, rows = []) {
      return this.seedTrades(userId, rows);
    },

    async listTradesV2(userId, filters = {}, page = 1, pageSize = 50) {
      const safePage = Math.max(1, Number(page) || 1);
      const safePageSize = Math.max(1, Math.min(5000, Number(pageSize) || 50));
      const offset = (safePage - 1) * safePageSize;
      const scopedFilters = {
        ...filters,
        user_id: filters.user_id || userId || undefined,
      };
      const { whereSql, params } = buildWhereClause(scopedFilters, "postgres");
      const countRes = await pool.query(
        `SELECT COUNT(*) AS count FROM trades${whereSql}`,
        params,
      );
      const dataRes = await pool.query(
        `SELECT * FROM trades${whereSql}
         ORDER BY COALESCE(closed_at, updated_at) DESC, created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, safePageSize, offset],
      );
      return {
        items: dataRes.rows.map(normalizeTradeRow),
        total: Number(countRes.rows?.[0]?.count || 0),
        page: safePage,
        page_size: safePageSize,
      };
    },

    async countTradesByExecutionStatus(userId, filters = {}) {
      const scopedFilters = {
        ...filters,
        user_id: filters.user_id || userId || undefined,
      };
      const { whereSql, params } = buildWhereClause(scopedFilters, "postgres");
      const rows = await pool.query(
        `SELECT execution_status, COUNT(*) AS count
         FROM trades${whereSql}
         GROUP BY execution_status`,
        params,
      );
      return Object.fromEntries(
        (rows.rows || []).map((row) => [
          String(row.execution_status || ""),
          Number(row.count || 0),
        ]),
      );
    },

    async loadTrade(userId, tradeId) {
      const params = [String(tradeId || "").trim()];
      let whereSql = "sid = $1";
      if (userId) {
        params.push(String(userId || "").trim());
        whereSql += ` AND user_id = $${params.length}`;
      }
      const res = await pool.query(
        `SELECT * FROM trades WHERE ${whereSql}
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`,
        params,
      );
      return normalizeTradeRow(res.rows?.[0] || null);
    },

    async updateTradePlan(userId, tradeId, patch = {}) {
      const currentRow =
        (await this.loadTrade(userId, tradeId)) || (await this.loadTrade(null, tradeId));
      if (!currentRow) return { ok: false, error: "trade not found" };
      const nextUpdatedAt = toIso(patch.updated_at || new Date());
      const nextMetadata = coalescePatchValue(patch.metadata, currentRow.metadata);
      const res = await pool.query(
        `
        UPDATE trades
        SET action = $1,
            entry = $2,
            sl = $3,
            tp = $4,
            tp1 = $5,
            tp2 = $6,
            tp3 = $7,
            note = $8,
            metadata = $9,
            confidence_pct = $10,
            estimated_bars = $11,
            profile = $12,
            be_trigger = $13,
            strategy = $14,
            entry_model = $15,
            source_id = $16,
            order_type = $17,
            risk_money_planned = $18,
            volume = $19,
            planned_tp_pnl = $20,
            planned_sl_pnl = $21,
            updated_at = $22
        WHERE sid = $23
        RETURNING *
      `,
        [
          coalescePatchValue(patch.action, currentRow.action),
          coalescePatchValue(patch.entry, currentRow.entry),
          coalescePatchValue(patch.sl, currentRow.sl),
          coalescePatchValue(patch.tp, currentRow.tp),
          coalescePatchValue(patch.tp1, currentRow.tp1),
          coalescePatchValue(patch.tp2, currentRow.tp2),
          coalescePatchValue(patch.tp3, currentRow.tp3),
          coalescePatchValue(patch.note, currentRow.note),
          jsonText(nextMetadata),
          coalescePatchValue(patch.confidence_pct, currentRow.confidencePct),
          coalescePatchValue(patch.estimated_bars, currentRow.estimatedBars),
          coalescePatchValue(patch.profile, currentRow.profile),
          coalescePatchValue(patch.be_trigger, currentRow.beTrigger),
          coalescePatchValue(patch.strategy, currentRow.strategy),
          coalescePatchValue(patch.entry_model, currentRow.entryModel),
          coalescePatchValue(patch.source_id, currentRow.sourceId),
          coalescePatchValue(patch.order_type, currentRow.orderType),
          coalescePatchValue(
            patch.risk_money_planned,
            currentRow.riskMoneyPlanned,
          ),
          coalescePatchValue(patch.volume, currentRow.volume),
          coalescePatchValue(patch.planned_tp_pnl, currentRow.plannedTpPnl),
          coalescePatchValue(patch.planned_sl_pnl, currentRow.plannedSlPnl),
          nextUpdatedAt,
          currentRow.sid,
        ],
      );
      let updated = normalizeTradeRow(res.rows?.[0] || null);
      if (shouldQueueBrokerModify(currentRow, updated, patch)) {
        const dispatchRes = await pool.query(
          `UPDATE trades
           SET dispatch_status = 'MODIFY',
               updated_at = $1
           WHERE sid = $2 AND dispatch_status = 'CONSUMED'
           RETURNING *`,
          [nextUpdatedAt, currentRow.sid],
        );
        updated = normalizeTradeRow(dispatchRes.rows?.[0] || null) || updated;
      }
      return { ok: true, item: updated };
    },

    async updateTradeManual(userId, tradeId, payload = {}, options = {}) {
      const currentRow =
        (await this.loadTrade(userId, tradeId)) || (await this.loadTrade(null, tradeId));
      if (!currentRow) return { ok: false, error: "trade not found" };
      const next = computeManualUpdate(currentRow, payload, options);
      const params = [
        next.execution_status,
        next.dispatch_status || currentRow.dispatchStatus,
        next.account_id,
        next.pnl_realized,
        next.close_reason,
        jsonText(next.metadata),
        next.lease_token,
        next.lease_expires_at,
        next.closed_at,
        next.updated_at,
        currentRow.sid,
      ];
      const res = await pool.query(
        `
        UPDATE trades
        SET execution_status = $1,
            dispatch_status = $2,
            account_id = $3,
            pnl_realized = $4,
            close_reason = $5,
            metadata = $6,
            lease_token = $7,
            lease_expires_at = $8,
            closed_at = $9,
            updated_at = $10
        WHERE sid = $11
        RETURNING *
      `,
        params,
      );
      return {
        ok: true,
        queued_broker_action: next.dispatch_status !== "CONSUMED",
        item: normalizeTradeRow(res.rows?.[0] || null),
      };
    },

    async assignTradeAccount(userId, tradeId, accountId) {
      const currentRow =
        (await this.loadTrade(userId, tradeId)) || (await this.loadTrade(null, tradeId));
      if (!currentRow) return { ok: false, error: "trade not found" };
      const res = await pool.query(
        `
        UPDATE trades
        SET account_id = $1,
            updated_at = $2
        WHERE sid = $3
        RETURNING *
      `,
        [String(accountId || "").trim(), new Date().toISOString(), currentRow.sid],
      );
      return {
        ok: true,
        item: normalizeTradeRow(res.rows?.[0] || null),
      };
    },

    async deleteTradesBySids(userId, sids = []) {
      const safeSids = Array.isArray(sids)
        ? sids.map((sid) => String(sid || "").trim()).filter(Boolean)
        : [];
      if (!safeSids.length) return { deleted: 0 };
      const params = [safeSids];
      let whereSql = "sid = ANY($1)";
      if (userId) {
        params.push(String(userId || "").trim());
        whereSql += ` AND user_id = $${params.length}`;
      }
      const res = await pool.query(`DELETE FROM trades WHERE ${whereSql}`, params);
      return { deleted: Number(res.rowCount || 0) };
    },

    async listTradeFolderStates(userId, filters = {}) {
      const scopedFilters = {
        ...filters,
        user_id: filters.user_id || userId || undefined,
      };
      const { whereSql, params } = buildWhereClause(scopedFilters, "postgres");
      const res = await pool.query(
        `SELECT sid, symbol, execution_status
         FROM trades${whereSql}
         ORDER BY created_at ASC`,
        params,
      );
      return (res.rows || []).map((row) => ({
        sid: String(row.sid || "").trim(),
        symbol: row.symbol ?? null,
        execution_status: row.execution_status ?? null,
      }));
    },

    async getTradesBySids(userId, sids = []) {
      const safeSids = Array.isArray(sids)
        ? sids.map((sid) => String(sid || "").trim()).filter(Boolean)
        : [];
      if (!safeSids.length) return [];
      const params = [safeSids];
      let whereSql = "sid = ANY($1)";
      if (userId) {
        params.push(String(userId || "").trim());
        whereSql += ` AND user_id = $${params.length}`;
      }
      const res = await pool.query(
        `SELECT * FROM trades WHERE ${whereSql}
         ORDER BY updated_at DESC, created_at DESC`,
        params,
      );
      return (res.rows || []).map(normalizeTradeRow);
    },

    async deleteTradesOlderThan(userId, isoTimestamp) {
      const params = [toIso(isoTimestamp)];
      let whereSql = "created_at < $1";
      if (userId) {
        params.push(String(userId || "").trim());
        whereSql += ` AND user_id = $${params.length}`;
      }
      const res = await pool.query(`DELETE FROM trades WHERE ${whereSql}`, params);
      return { deleted: Number(res.rowCount || 0) };
    },

    async applySignalAck(userId, tradeId, patch = {}) {
      const currentRow =
        (await this.loadTrade(userId, tradeId)) || (await this.loadTrade(null, tradeId));
      if (!currentRow) return { ok: false, error: "trade not found" };
      const metadata = mergeBrokerSyncMetadata(currentRow.metadata, patch.metadata || {});
      const requestedExecStatus = String(
        patch.execution_status || currentRow.executionStatus || "",
      )
        .trim()
        .toUpperCase();
      const preservedStatus = preserveBrokerLinkedRejectedStatus(currentRow, patch);
      const execStatus = preservedStatus || requestedExecStatus;
      const isClosed = preservedStatus ? false : Boolean(patch.is_closed);
      const res = await pool.query(
        `UPDATE trades
         SET execution_status = $1,
             broker_trade_id = $2,
             pnl_realized = $3,
             order_type = $4,
             metadata = $5,
             closed_at = $6,
             updated_at = $7
         WHERE sid = $8
         RETURNING *`,
        [
          execStatus || currentRow.executionStatus,
          String(patch.broker_trade_id || "").trim() || currentRow.brokerTradeId,
          isClosed
            ? coalescePatchValue(patch.pnl_realized, currentRow.pnlRealized)
            : currentRow.pnlRealized,
          coalescePatchValue(patch.order_type, currentRow.orderType),
          jsonText(metadata),
          isClosed ? toIso(patch.closed_at || new Date()) : currentRow.closedAt,
          toIso(patch.updated_at || new Date()),
          currentRow.sid,
        ],
      );
      return { ok: true, item: normalizeTradeRow(res.rows?.[0] || null) };
    },

    async updateTradeRiskLevels(userId, tradeId, patch = {}) {
      const currentRow =
        (await this.loadTrade(userId, tradeId)) || (await this.loadTrade(null, tradeId));
      if (!currentRow) return { ok: false, error: "trade not found" };
      const res = await pool.query(
        `UPDATE trades
         SET sl = $1,
             tp = $2,
             updated_at = $3
         WHERE sid = $4 AND execution_status IN ('FILLED','PENDING')
         RETURNING *`,
        [
          coalescePatchValue(patch.sl, currentRow.sl),
          coalescePatchValue(patch.tp, currentRow.tp),
          toIso(patch.updated_at || new Date()),
          currentRow.sid,
        ],
      );
      return { ok: true, item: normalizeTradeRow(res.rows?.[0] || null) };
    },

    async pullLeasedTrades(
      userId,
      accountId,
      maxItems = 1,
      leaseSeconds = 30,
      taskTypeFilter = null,
      options = {},
    ) {
      const safeLimit = Math.max(1, Math.min(100, Number(maxItems) || 1));
      const leaseSec = Math.max(5, Math.min(300, Number(leaseSeconds) || 30));
      const now = new Date(options.now || Date.now());
      const nowIso = now.toISOString();
      const params = [String(userId || "default"), String(accountId || "").trim(), nowIso];
      const res = await pool.query(
        `
        SELECT * FROM trades
        WHERE user_id = $1
          AND (account_id = $2 OR account_id = '' OR account_id IS NULL)
          AND (
            execution_status IN ('PENDING','FILLED')
            OR (dispatch_status IN ('CANCEL','CLOSE') AND execution_status IN ('CANCELLED','CLOSED'))
          )
          AND (
            dispatch_status IN ('OPEN', 'MODIFY', 'CLOSE', 'CANCEL')
            OR (dispatch_status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at < $3)
          )
        ORDER BY created_at ASC
      `,
        params,
      );
      const rows = (res.rows || []).sort(sortByTradePriority);
      const selected = [];
      for (const rawRow of rows) {
        if (selected.length >= safeLimit) break;
        const row = normalizeTradeRow(rawRow);
        const taskType = leasedDispatchType(row);
        if (taskTypeFilter && String(taskTypeFilter).trim().toUpperCase() !== taskType) {
          continue;
        }
        const staleNew = syncGuards.isNewTradeTooOld(
          row,
          Number(options.maxAgeHours || 0),
          now,
        );
        if (staleNew) {
          const nextMetadata = {
            ...(row.metadata || {}),
            stale_pull_rejected_at: nowIso,
            stale_pull_max_age_hours: Number(options.maxAgeHours || 0),
          };
          await pool.query(
            `UPDATE trades
             SET dispatch_status = 'REJECTED',
                 execution_status = 'REJECTED',
                 rejection_reason = COALESCE(rejection_reason, $1),
                 metadata = $2,
                 updated_at = $3
             WHERE sid = $4`,
            ["stale broker pull task", jsonText(nextMetadata), nowIso, row.sid],
          );
          continue;
        }
        const retryCount = syncGuards.nextLeaseRetryCount(row, now);
        const hasBroker = Boolean(String(row.brokerTradeId || "").trim());
        if (
          syncGuards.shouldAutoRejectLeasedTrade(
            row,
            Number(options.maxLeaseRetries || 3),
            now,
          ) &&
          !hasBroker
        ) {
          const nextMetadata = {
            ...(row.metadata || {}),
            stale_pull_rejected_at: nowIso,
            stale_pull_max_age_hours: Number(options.maxAgeHours || 0),
          };
          await pool.query(
            `UPDATE trades
             SET dispatch_status = $1,
                 execution_status = $2,
                 rejection_reason = COALESCE(rejection_reason, $3),
                 metadata = $4,
                 updated_at = $5
             WHERE sid = $6`,
            [
              hasBroker ? "CANCEL" : "REJECTED",
              hasBroker ? "CANCELLED" : "REJECTED",
              "broker ack lease retry limit exceeded",
              jsonText(nextMetadata),
              nowIso,
              row.sid,
            ],
          );
          continue;
        }
        const leaseToken = String(
          (options.generateLeaseToken && options.generateLeaseToken()) ||
            `lease_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        );
        const leaseExpiresAt = new Date(now.getTime() + leaseSec * 1000).toISOString();
        const currentDispatch = String(row.dispatchStatus || "").toUpperCase();
        const currentLeasedDispatch =
          currentDispatch === "LEASED"
            ? String(row.metadata?.leased_dispatch_status || "").toUpperCase()
            : currentDispatch;
        const nextMetadata = {
          ...(row.metadata || {}),
          lease_retry_count: retryCount,
          leased_dispatch_status: syncGuards.brokerTaskTypeForTrade({
            dispatch_status: currentLeasedDispatch,
          }),
        };
        await pool.query(
          `UPDATE trades
           SET dispatch_status = 'LEASED',
               lease_token = $1,
               lease_expires_at = $2,
               metadata = $3,
               updated_at = $4
           WHERE sid = $5`,
          [leaseToken, leaseExpiresAt, jsonText(nextMetadata), nowIso, row.sid],
        );
        selected.push(
          normalizeTradeRow({
            ...rawRow,
            dispatch_status: "LEASED",
            lease_token: leaseToken,
            lease_expires_at: leaseExpiresAt,
            metadata: jsonText(nextMetadata),
            updated_at: nowIso,
          }),
        );
      }
      return selected;
    },

    async pullAndLockNextTask(accountId, options = {}) {
      const items = await this.pullLeasedTrades(
        options.userId || "default",
        accountId,
        1,
        60,
        null,
        options,
      );
      return items[0] ? toTaskShape(items[0]) : null;
    },

    async ackTrade(userId, accountId, payload = {}, options = {}) {
      const currentRow =
        (await this.loadTrade(userId, payload.sid || payload.trade_id)) ||
        (await this.loadTrade(null, payload.sid || payload.trade_id));
      if (!currentRow) return { ok: false, error: "trade not found" };
      const leaseToken = String(payload.lease_token || "").trim();
      const currentDispatch = String(currentRow.dispatchStatus || "").toUpperCase();
      const ackStateApplied = isAckStateAlreadyApplied(currentRow, payload);
      if (
        currentDispatch === "CONSUMED" &&
        ackStateApplied &&
        !currentRow.leaseToken &&
        !currentRow.leaseExpiresAt
      ) {
        return {
          ok: true,
          duplicate: true,
          dispatch_status: currentRow.dispatchStatus,
          execution_status: currentRow.executionStatus,
        };
      }
      if (ackStateApplied) {
        const next = buildAckUpdate(currentRow, accountId, payload, options);
        const res = await pool.query(
          `UPDATE trades
           SET dispatch_status = $1,
               execution_status = $2,
               rejection_reason = $3,
               broker_trade_id = $4,
               entry_exec = $5,
               pnl_realized = $6,
               volume = $7,
               risk_money_planned = $8,
               order_type = $9,
               entry = COALESCE($10, entry),
               sl = COALESCE($11, sl),
               tp = COALESCE($12, tp),
               tp1 = COALESCE($13, tp1),
               tp2 = COALESCE($14, tp2),
               tp3 = COALESCE($15, tp3),
               metadata = $16,
               opened_at = $17,
               closed_at = $18,
               updated_at = $19,
               lease_token = NULL,
               lease_expires_at = NULL
           WHERE sid = $20
           RETURNING *`,
          [
            next.dispatch_status,
            next.execution_status,
            next.rejection_reason,
            next.broker_trade_id,
            next.entry_exec,
            next.pnl_realized,
            next.volume,
            next.risk_money_planned,
            next.order_type,
            next.entry,
            next.sl,
            next.tp,
            next.tp1,
            next.tp2,
            next.tp3,
            jsonText(next.metadata),
            next.opened_at,
            next.closed_at,
            next.updated_at,
            currentRow.sid,
          ],
        );
        const updated = normalizeTradeRow(res.rows?.[0] || null);
        return {
          ok: true,
          duplicate: true,
          dispatch_status: updated?.dispatchStatus || null,
          execution_status: updated?.executionStatus || null,
          item: updated,
        };
      }
      if (
        currentDispatch !== "LEASED" ||
        String(currentRow.accountId || "") !== String(accountId || "") ||
        String(currentRow.leaseToken || "") !== leaseToken
      ) {
        return { ok: false, error: "stale or mismatched lease token" };
      }
      const next = buildAckUpdate(currentRow, accountId, payload, options);
      const res = await pool.query(
        `UPDATE trades
         SET dispatch_status = $1,
             execution_status = $2,
             rejection_reason = $3,
             broker_trade_id = $4,
             entry_exec = $5,
             pnl_realized = $6,
             volume = $7,
             risk_money_planned = $8,
             order_type = $9,
             entry = COALESCE($10, entry),
             sl = COALESCE($11, sl),
             tp = COALESCE($12, tp),
             tp1 = COALESCE($13, tp1),
             tp2 = COALESCE($14, tp2),
             tp3 = COALESCE($15, tp3),
             metadata = $16,
             opened_at = $17,
             closed_at = $18,
             updated_at = $19,
             lease_token = NULL,
             lease_expires_at = NULL
         WHERE sid = $20
         RETURNING *`,
        [
          next.dispatch_status,
          next.execution_status,
          next.rejection_reason,
          next.broker_trade_id,
          next.entry_exec,
          next.pnl_realized,
          next.volume,
          next.risk_money_planned,
          next.order_type,
          next.entry,
          next.sl,
          next.tp,
          next.tp1,
          next.tp2,
          next.tp3,
          jsonText(next.metadata),
          next.opened_at,
          next.closed_at,
          next.updated_at,
          currentRow.sid,
        ],
      );
      const updated = normalizeTradeRow(res.rows?.[0] || null);
      return {
        ok: true,
        dispatch_status: updated?.dispatchStatus || null,
        execution_status: updated?.executionStatus || null,
        item: updated,
      };
    },

    async brokerSyncTrades(userId, accountId, items = [], options = {}) {
      const aid = String(accountId || "").trim();
      const uid = String(userId || "default").trim() || "default";
      const nowIso = toIso(options.now || new Date());
      const allRes = await pool.query(
        `SELECT * FROM trades WHERE user_id = $1 AND account_id = $2`,
        [uid, aid],
      );
      const allTrades = (allRes.rows || []).map(normalizeTradeRow);
      const bySid = new Map(allTrades.map((row) => [String(row.sid || ""), row]));
      const byTicket = new Map(
        allTrades
          .filter((row) => String(row.brokerTradeId || "").trim())
          .map((row) => [String(row.brokerTradeId || "").trim(), row]),
      );
      const byNote = new Map(
        allTrades
          .filter(
            (row) =>
              String(row.note || "").trim() &&
              isBrokerSyncNoteMatchCandidate(row),
          )
          .map((row) => [String(row.note || "").trim().toUpperCase(), row]),
      );
      const oldStatusMap = new Map();
      const oldTicketMap = new Map();
      for (const row of allTrades) {
        const meta = row.metadata || {};
        const rowData = {
          sid: row.sid,
          broker_trade_id: row.brokerTradeId,
          execution_status: row.executionStatus,
          dispatch_status: row.dispatchStatus,
          rejection_reason: row.rejectionReason,
          sl: row.sl,
          tp: row.tp,
          pnl: row.brokerPnl,
          metadata: row.metadata,
          has_partial: String(meta.has_partial || "false"),
          last_broker_snapshot_hash: String(meta.last_broker_snapshot_hash || ""),
        };
        oldStatusMap.set(row.sid, rowData);
        if (row.brokerTradeId) oldTicketMap.set(String(row.brokerTradeId), rowData);
      }

      const results = [];
      let matched = 0;
      let synced = 0;
      const seenTickets = new Set();

      for (const it of Array.isArray(items) ? items : []) {
        const ticketCandidates =
          Array.isArray(it.ticket_candidates) && it.ticket_candidates.length
            ? it.ticket_candidates.map((v) => String(v || "").trim()).filter(Boolean)
            : it.ticket
              ? [String(it.ticket).trim()]
              : [];
        const syncSymbol =
          normalizeBrokerSyncSymbol(it.symbol) ||
          normalizeBrokerSyncSymbol(it.broker_symbol);
        const syncAction = normalizeBrokerSyncAction(it.action || it.side);
        ticketCandidates.forEach((ticket) => seenTickets.add(ticket));
        const snapshotHash = syncGuards.brokerSnapshotHash(it);
        const oldForItem =
          (it.sid && oldStatusMap.get(String(it.sid))) ||
          ticketCandidates.map((ticket) => oldTicketMap.get(ticket)).find(Boolean) ||
          null;
        const oldSnapshotHash = String(
          oldForItem?.last_broker_snapshot_hash ||
            oldForItem?.metadata?.last_broker_snapshot_hash ||
            "",
        ).trim();
        const clearRejectedDispatch =
          syncGuards.shouldClearRejectedDispatchFromBrokerSnapshot(
            oldForItem || {},
            it,
          );
        if (
          oldForItem &&
          oldSnapshotHash &&
          oldSnapshotHash === snapshotHash &&
          !clearRejectedDispatch
        ) {
          results.push({
            ticket: it.ticket,
            sid: oldForItem.sid || it.sid || null,
            status: "NoChange",
            symbol: it.symbol,
            action: it.action,
          });
          continue;
        }

        const noteCandidates = [
          String(it.note || "").trim(),
          String(it.trade_id || "").trim(),
          String(it.signal_id || "").trim(),
          String(it.sid || "").trim(),
        ]
          .filter(Boolean)
          .map((value) => value.toUpperCase());
        const existing =
          (it.sid && bySid.get(String(it.sid))) ||
          noteCandidates.map((value) => byNote.get(value)).find(Boolean) ||
          ticketCandidates.map((ticket) => byTicket.get(ticket)).find(Boolean) ||
          null;

        const syncMeta = {
          order_type: it.order_type || null,
          broker_name: options.brokerName || "",
          provider_code: options.providerCode || "",
          last_change_origin: "broker",
          last_inbound_event_id: `broker:${aid}:${snapshotHash}`,
          last_broker_snapshot_hash: snapshotHash,
          broker_data: {
            ...it,
            position_id: ticketCandidates[0] || null,
            ticket_candidates: ticketCandidates,
            snapshot_hash: snapshotHash,
            last_sync_at: nowIso,
          },
          last_sync_source: "broker_sync_v2",
          has_partial: Boolean(it.has_partial),
        };

        if (existing) {
          const nextExecutionStatus = String(it.execution_status || "")
            .trim()
            .toUpperCase();
          const consumeLease =
            clearRejectedDispatch ||
            String(existing.dispatchStatus || "").toUpperCase() === "LEASED";
          const nextDispatchStatus = consumeLease
            ? "CONSUMED"
            : existing.dispatchStatus;
          const nextMetadata = mergeBrokerSyncMetadata(existing.metadata, syncMeta);
          const updateRes = await pool.query(
            `UPDATE trades
             SET execution_status = $1,
                 dispatch_status = $2,
                 broker_trade_id = $3,
                 pnl_realized = $4,
                 broker_pnl = $5,
                 volume = $6,
                 broker_pips = $7,
                 broker_lots = $8,
                 broker_commission = $9,
                 broker_swap = $10,
                 broker_volume = $11,
                 broker_margin = $12,
                 broker_tp_pnl = $13,
                 broker_sl_pnl = $14,
                 entry_exec = COALESCE($15, entry_exec),
                 order_type = COALESCE($16, order_type),
                 close_reason = $17,
                 rejection_reason = $18,
                 note = COALESCE(NULLIF(note, ''), $19),
                 metadata = $20,
                 opened_at = $21,
                 closed_at = $22,
                 lease_token = $23,
                 lease_expires_at = $24,
                 sl = COALESCE($25, sl),
                 tp = COALESCE($26, tp),
                 tp1 = COALESCE($27, tp1),
                 tp2 = COALESCE($28, tp2),
                 tp3 = COALESCE($29, tp3),
                 updated_at = $30
             WHERE sid = $31
             RETURNING *`,
            [
              nextExecutionStatus,
              nextDispatchStatus,
              ticketCandidates[0] || existing.brokerTradeId || null,
              isTerminalExecutionStatus(nextExecutionStatus)
                ? Number(it.pnl ?? existing.pnlRealized ?? 0)
                : existing.pnlRealized,
              Number(it.pnl ?? existing.brokerPnl ?? 0),
              Number(it.volume ?? existing.volume ?? 0),
              Number(it.pips ?? existing.brokerPips ?? 0),
              Number(it.lots ?? existing.brokerLots ?? 0),
              Number(it.commission ?? existing.brokerCommission ?? 0),
              Number(it.swap ?? existing.brokerSwap ?? 0),
              Number(it.broker_volume ?? existing.brokerVolume ?? 0),
              Number(it.margin ?? existing.brokerMargin ?? 0),
              it.tp_pnl ?? existing.brokerTpPnl ?? null,
              it.sl_pnl ?? existing.brokerSlPnl ?? null,
              it.entry ?? null,
              it.order_type || null,
              isTerminalExecutionStatus(nextExecutionStatus)
                ? it.close_reason || existing.closeReason || null
                : null,
              clearRejectedDispatch ? null : existing.rejectionReason,
              it.note || null,
              jsonText(nextMetadata),
              resolvePersistedOpenedAt(it, existing, nowIso),
              isTerminalExecutionStatus(nextExecutionStatus)
                ? it.closed_at || existing.closedAt || nowIso
                : null,
              consumeLease ? null : existing.leaseToken,
              consumeLease ? null : existing.leaseExpiresAt,
              it.sl ?? null,
              it.tp ?? null,
              it.tp1 ?? null,
              it.tp2 ?? null,
              it.tp3 ?? null,
              nowIso,
              existing.sid,
            ],
          );
          const updated = normalizeTradeRow(updateRes.rows?.[0] || null);
          bySid.set(updated.sid, updated);
          if (updated.brokerTradeId) byTicket.set(String(updated.brokerTradeId), updated);
          if (String(updated.note || "").trim()) {
            byNote.set(String(updated.note || "").trim().toUpperCase(), updated);
          }
          matched += 1;
          synced += 1;
          results.push({
            ticket: it.ticket,
            sid: updated.sid,
            status: "Ok",
            symbol: it.symbol,
            action: it.action,
          });
          continue;
        }

        if (!["FILLED", "PENDING"].includes(String(it.execution_status || "").toUpperCase())) {
          results.push({
            ticket: it.ticket,
            sid: null,
            status: "Skip",
            symbol: it.symbol,
            action: it.action,
          });
          continue;
        }

        if (!syncSymbol || !syncAction) {
          results.push({
            ticket: it.ticket,
            sid: null,
            status: "Skip",
            symbol: it.symbol,
            action: it.action,
            reason: "missing_symbol_or_action",
          });
          continue;
        }

        if (ticketCandidates[0] && byTicket.has(ticketCandidates[0])) {
          const duplicate = byTicket.get(ticketCandidates[0]);
          results.push({
            ticket: it.ticket,
            sid: duplicate.sid,
            status: "Skip",
            symbol: it.symbol,
            action: it.action,
            reason: `duplicate_broker_ticket_${duplicate.executionStatus}`,
          });
          continue;
        }

        const discoverySid = String(
          it.sid ||
            (ticketCandidates[0]
              ? `M_${ticketCandidates[0]}`
              : (options.generateSid && options.generateSid()) ||
                `M_${Date.now()}`),
        ).trim();
        const nextMetadata = mergeBrokerSyncMetadata({}, syncMeta);
        const insertRes = await pool.query(
          `INSERT INTO trades (
             sid, account_id, user_id, symbol, action, order_type, volume,
             entry, sl, tp, tp1, tp2, tp3, note, execution_status,
             dispatch_status, source_id, metadata, broker_trade_id,
             broker_pips, broker_lots, broker_commission, broker_swap,
             broker_volume, broker_pnl, broker_margin, planned_tp_pnl,
             planned_sl_pnl, broker_tp_pnl, broker_sl_pnl, opened_at, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19,
             $20, $21, $22, $23,
             $24, $25, $26, $27,
             $28, $29, $30, $31, $32, $33
           )
           ON CONFLICT (sid) DO UPDATE SET
             account_id = EXCLUDED.account_id,
             user_id = EXCLUDED.user_id,
             symbol = EXCLUDED.symbol,
             action = EXCLUDED.action,
             order_type = EXCLUDED.order_type,
             volume = EXCLUDED.volume,
             entry = EXCLUDED.entry,
             sl = EXCLUDED.sl,
             tp = EXCLUDED.tp,
             tp1 = EXCLUDED.tp1,
             tp2 = EXCLUDED.tp2,
             tp3 = EXCLUDED.tp3,
             note = EXCLUDED.note,
             execution_status = EXCLUDED.execution_status,
             dispatch_status = EXCLUDED.dispatch_status,
             source_id = EXCLUDED.source_id,
             metadata = EXCLUDED.metadata,
             broker_trade_id = EXCLUDED.broker_trade_id,
             broker_pips = EXCLUDED.broker_pips,
             broker_lots = EXCLUDED.broker_lots,
             broker_commission = EXCLUDED.broker_commission,
             broker_swap = EXCLUDED.broker_swap,
             broker_volume = EXCLUDED.broker_volume,
             broker_pnl = EXCLUDED.broker_pnl,
             broker_margin = EXCLUDED.broker_margin,
             planned_tp_pnl = EXCLUDED.planned_tp_pnl,
             planned_sl_pnl = EXCLUDED.planned_sl_pnl,
             broker_tp_pnl = EXCLUDED.broker_tp_pnl,
             broker_sl_pnl = EXCLUDED.broker_sl_pnl,
             updated_at = EXCLUDED.updated_at
           RETURNING *`,
          [
            discoverySid,
            aid,
            uid,
            syncSymbol,
            syncAction,
            it.order_type || null,
            Number(it.lots ?? it.volume ?? 0),
            it.entry || 0,
            it.sl ?? null,
            it.tp ?? null,
            it.tp1 ?? null,
            it.tp2 ?? null,
            it.tp3 ?? null,
            it.note || "",
            String(it.execution_status || "PENDING").toUpperCase(),
            "CONSUMED",
            options.sourceId || "BROKER",
            jsonText(nextMetadata),
            ticketCandidates[0] || "",
            Number(it.pips ?? 0),
            Number(it.lots ?? 0),
            Number(it.commission ?? 0),
            Number(it.swap ?? 0),
            Number(it.broker_volume ?? 0),
            Number(it.pnl ?? 0),
            Number(it.margin ?? 0),
            options.resolvePlannedTpPnl ? options.resolvePlannedTpPnl(it) : null,
            options.resolvePlannedSlPnl ? options.resolvePlannedSlPnl(it) : null,
            it.tp_pnl ?? null,
            it.sl_pnl ?? null,
            resolvePersistedOpenedAt(it, null, nowIso),
            nowIso,
            nowIso,
          ],
        );
        const created = normalizeTradeRow(insertRes.rows?.[0] || null);
        bySid.set(created.sid, created);
        if (created.brokerTradeId) byTicket.set(String(created.brokerTradeId), created);
        if (String(created.note || "").trim()) {
          byNote.set(String(created.note || "").trim().toUpperCase(), created);
        }
        matched += 1;
        results.push({
          ticket: it.ticket,
          sid: discoverySid,
          suggested_sid: discoverySid,
          status: "Added",
          symbol: it.symbol,
          action: it.action,
        });
      }

      let closedRows = [];
      if (options.snapshotComplete) {
        const accountTrades = Array.from(bySid.values());
        const toClose = accountTrades.filter((row) => {
          const exec = String(row.executionStatus || "").toUpperCase();
          if (!["FILLED", "PENDING"].includes(exec)) return false;
          if (seenTickets.size > 0) {
            const ticket = String(row.brokerTradeId || "").trim();
            return ticket && !seenTickets.has(ticket);
          }
          return true;
        });
        for (const row of toClose) {
          const nextExecution =
            String(row.executionStatus || "").toUpperCase() === "PENDING"
              ? "CANCELLED"
              : "CLOSED";
          const nextCloseReason =
            row.closeReason ||
            (nextExecution === "CANCELLED" ? "CANCEL" : "MANUAL");
          const closeRes = await pool.query(
            `UPDATE trades
             SET execution_status = $1,
                 close_reason = $2,
                 closed_at = COALESCE(closed_at, $3),
                 updated_at = $4
             WHERE sid = $5
             RETURNING *`,
            [nextExecution, nextCloseReason, nowIso, nowIso, row.sid],
          );
          const updatedRow = normalizeTradeRow(closeRes.rows?.[0] || null);
          bySid.set(updatedRow.sid, updatedRow);
          if (updatedRow.brokerTradeId)
            byTicket.set(String(updatedRow.brokerTradeId), updatedRow);
          if (String(updatedRow.note || "").trim()) {
            byNote.set(String(updatedRow.note || "").trim().toUpperCase(), updatedRow);
          }
          closedRows.push(updatedRow);
        }
      }

      const latestBySid = new Map(bySid);
      const tradeUpdates = [];
      for (const it of Array.isArray(items) ? items : []) {
        const sid = String(it.sid || "").trim();
        if (!sid) continue;
        const oldRow = oldStatusMap.get(sid) || {};
        const latest = latestBySid.get(sid);
        if (!latest) continue;
        const oldStatus = oldRow.execution_status || null;
        const newStatus = latest.executionStatus;
        const oldSl = Number.isFinite(Number(oldRow.sl)) ? Number(oldRow.sl) : null;
        const newSl = latest.sl ?? null;
        const oldTp = Number.isFinite(Number(oldRow.tp)) ? Number(oldRow.tp) : null;
        const newTp = latest.tp ?? null;
        const oldHasPartial =
          oldRow.has_partial === "true" || oldRow.has_partial === true;
        const newHasPartial = Boolean(latest.metadata?.has_partial);
        const statusChanged = !oldStatus || oldStatus !== newStatus;
        const slChanged =
          oldSl !== null && newSl !== null && Math.abs(oldSl - newSl) > 0.000001;
        const tpChanged =
          oldTp !== null && newTp !== null && Math.abs(oldTp - newTp) > 0.000001;
        const partialChanged = oldHasPartial !== newHasPartial;
        if (statusChanged || slChanged || tpChanged || partialChanged) {
          tradeUpdates.push({
            sid,
            symbol: latest.symbol,
            pnl_realized: latest.pnlRealized,
            broker_pnl: latest.brokerPnl,
            broker_pips: latest.brokerPips,
            execution_status: latest.executionStatus,
            sl: newSl,
            sl_before: oldSl,
            tp: newTp,
            tp_before: oldTp,
            has_partial: newHasPartial,
            partial_before: oldHasPartial,
            rejection_reason: latest.rejectionReason || null,
          });
        }
      }
      for (const row of closedRows) {
        const oldRow =
          oldStatusMap.get(row.sid) ||
          (row.brokerTradeId ? oldTicketMap.get(String(row.brokerTradeId)) : null) ||
          {};
        if (
          oldRow.execution_status === row.executionStatus &&
          String(oldRow.rejection_reason || "") === String(row.rejectionReason || "")
        ) {
          continue;
        }
        tradeUpdates.push({
          sid: row.sid,
          symbol: row.symbol,
          pnl_realized: row.pnlRealized,
          broker_pnl: row.brokerPnl,
          broker_pips: row.brokerPips,
          execution_status: row.executionStatus,
          sl: row.sl ?? null,
          sl_before: Number.isFinite(Number(oldRow.sl)) ? Number(oldRow.sl) : null,
          tp: row.tp ?? null,
          tp_before: Number.isFinite(Number(oldRow.tp)) ? Number(oldRow.tp) : null,
          has_partial: Boolean(row.metadata?.has_partial),
          partial_before:
            oldRow.has_partial === "true" || oldRow.has_partial === true,
          rejection_reason: row.rejectionReason || null,
        });
      }

      return {
        ok: true,
        results,
        matched,
        synced,
        seenTickets: [...seenTickets],
        tradeUpdates,
      };
    },
  };
}

module.exports = {
  createSqliteTradesProvider: createSqliteRepository,
  createPostgresTradesProvider: createPostgresRepository,
  resolveUserTradeDbPath,
  normalizeTradeRow,
  parseJsonField,
  jsonText,
  toTaskShape,
};
