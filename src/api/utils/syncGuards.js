"use strict";

const crypto = require("crypto");

// dispatch_status → broker pull task type
// execution_status is now pure trade state (PENDING/FILLED/CLOSED...).
// dispatch_status carries the sync action: OPEN, MODIFY, CLOSE, CANCEL, LEASED, CONSUMED.
const DISPATCH_ACTION_TO_TASK = Object.freeze({
  OPEN: "OPEN",
  MODIFY: "MODIFY",
  CLOSE: "CLOSE",
  CANCEL: "CANCEL",
});

function normalizeTradeMetadata(value) {
  if (value == null) return {};

  let parsed = value;
  if (typeof parsed === "string") {
    const raw = parsed.trim();
    if (!raw) return {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const entries = Object.entries(parsed);
  const normalized = {};
  let numericKeyCount = 0;

  for (const [key, entryValue] of entries) {
    if (/^\d+$/.test(key)) {
      numericKeyCount++;
      continue;
    }
    normalized[key] = entryValue;
  }

  if (numericKeyCount > 0) {
    return normalized;
  }

  return parsed;
}

function brokerTaskTypeForTrade(row = {}) {
  const dispatch = String(row.dispatch_status || "").trim().toUpperCase();
  if (dispatch === "LEASED") {
    const metadata = normalizeTradeMetadata(row?.metadata);
    const leasedDispatch = String(
      metadata.leased_dispatch_status || metadata.leasedDispatchStatus || "",
    )
      .trim()
      .toUpperCase();
    if (DISPATCH_ACTION_TO_TASK[leasedDispatch]) {
      return DISPATCH_ACTION_TO_TASK[leasedDispatch];
    }
  }
  return DISPATCH_ACTION_TO_TASK[dispatch] || "OPEN";
}

function brokerActionForDispatch(executionStatus = "", newDispatch = "") {
  const d = String(newDispatch || "").trim().toUpperCase();
  if (d === "MODIFY") return "MODIFY";
  if (d === "CLOSE") return "CLOSE";
  if (d === "CANCEL") return "CANCEL";
  return "OPEN";
}

function leaseRetryCount(row = {}) {
  const raw =
    row?.metadata && typeof row.metadata === "object"
      ? row.metadata.lease_retry_count
      : null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function isExpiredLease(row = {}, now = new Date()) {
  if (String(row.dispatch_status || "").toUpperCase() !== "LEASED") return false;
  const expiresAt = new Date(row.lease_expires_at || 0);
  return Number.isFinite(expiresAt.getTime()) && expiresAt < now;
}

function nextLeaseRetryCount(row = {}, now = new Date()) {
  return leaseRetryCount(row) + (isExpiredLease(row, now) ? 1 : 0);
}

function shouldAutoRejectLeasedTrade(row = {}, maxRetries = 3, now = new Date()) {
  if (brokerTaskTypeForTrade(row) !== "OPEN") return false;
  return nextLeaseRetryCount(row, now) >= Math.max(1, Number(maxRetries) || 3);
}

function isNewTradeTooOld(row = {}, maxAgeHours = 0, now = new Date()) {
  const maxAge = Number(maxAgeHours);
  if (!Number.isFinite(maxAge) || maxAge <= 0) return false;
  const dispatch = String(row.dispatch_status || "").trim().toUpperCase();
  if (dispatch !== "OPEN" && dispatch !== "NEW") return false;
  const status = String(row.execution_status || "").trim().toUpperCase();
  if (status !== "PENDING") return false;
  const createdAt = new Date(row.created_at || 0);
  if (!Number.isFinite(createdAt.getTime())) return false;
  return now.getTime() - createdAt.getTime() > maxAge * 60 * 60 * 1000;
}

function normText(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(8));
}

function nullableIsoTimestamp(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function brokerSnapshotFingerprint(item = {}) {
  return {
    ticket: normText(item.ticket || item.broker_trade_id || item.position_id),
    sid: normText(item.sid || item.signal_id),
    symbol: normText(item.symbol),
    action: normText(item.action || item.side),
    order_type: normText(item.order_type || item.type),
    execution_status: normText(item.execution_status || item.status),
    close_reason: normText(item.close_reason || item.reason),
    entry: normNumber(item.entry ?? item.entry_price ?? item.target_price),
    sl: normNumber(item.sl ?? item.stop_loss),
    tp: normNumber(item.tp ?? item.take_profit),
    tp1: normNumber(item.tp1),
    tp2: normNumber(item.tp2),
    tp3: normNumber(item.tp3),
    volume: normNumber(item.volume ?? item.lots),
    pnl: normNumber(item.pnl ?? item.net_pnl ?? item.pnl_realized),
    pips: normNumber(item.pips),
    commission: normNumber(item.commission),
    swap: normNumber(item.swap),
    opened_at: String(item.opened_at || item.openedAt || "").trim(),
    closed_at: String(item.closed_at || item.closedAt || "").trim(),
  };
}

function brokerSnapshotHash(item = {}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(brokerSnapshotFingerprint(item)))
    .digest("hex");
}

function shouldClearRejectedDispatchFromBrokerSnapshot(row = {}, item = {}) {
  if (normText(row.dispatch_status) !== "REJECTED") return false;
  if (
    String(row.rejection_reason || "").trim() !==
    "broker ack lease retry limit exceeded"
  ) {
    return false;
  }
  const status = normText(item.execution_status || item.status_raw || item.status);
  if (
    ![
      "PENDING",
      "FILLED",
      "OPEN",
      "CLOSED",
      "CANCELLED",
      "TP",
      "SL",
    ].includes(status)
  ) {
    return false;
  }
  const brokerId = String(
    item.ticket ||
      item.broker_trade_id ||
      item.position_id ||
      row.broker_trade_id ||
      "",
  ).trim();
  const sid = String(item.sid || item.signal_id || row.sid || "").trim();
  return Boolean(brokerId || sid);
}

// Returns NEW dispatch_status for the broker queue action.
// Keeps execution_status unchanged — that's the trade state, not the sync action.
function brokerLinkedManualStatus(row = {}, requestedStatus = "") {
  const target = normText(requestedStatus);
  const current = normText(row.execution_status);
  const brokerId = String(row.broker_trade_id || "").trim();
  if (!brokerId) return { execution_status: target, dispatch_status: null };
  if (!["PENDING", "FILLED"].includes(current)) return { execution_status: target, dispatch_status: null };
  if (!["CLOSED", "CANCELLED", "REJECTED"].includes(target)) return { execution_status: target, dispatch_status: null };
  return {
    execution_status: current, // keep trade state unchanged
    dispatch_status: current === "PENDING" ? "CANCEL" : "CLOSE",
  };
}

module.exports = {
  brokerLinkedManualStatus,
  brokerSnapshotFingerprint,
  brokerSnapshotHash,
  brokerTaskTypeForTrade,
  normalizeTradeMetadata,
  nullableIsoTimestamp,
  shouldClearRejectedDispatchFromBrokerSnapshot,
  leaseRetryCount,
  nextLeaseRetryCount,
  shouldAutoRejectLeasedTrade,
  isNewTradeTooOld,
};
