"use strict";

const crypto = require("crypto");

const CONTROL_STATUS_TO_TASK = Object.freeze({
  PENDING_MOD: "MODIFY",
  PENDING_CLOSE: "CLOSE",
  PENDING_CANCEL: "CANCEL",
});

function brokerTaskTypeForTrade(row = {}) {
  const status = String(row.execution_status || "").trim().toUpperCase();
  return CONTROL_STATUS_TO_TASK[status] || "OPEN";
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
  return nextLeaseRetryCount(row, now) >= Math.max(1, Number(maxRetries) || 3);
}

function isNewTradeTooOld(row = {}, maxAgeHours = 0, now = new Date()) {
  const maxAge = Number(maxAgeHours);
  if (!Number.isFinite(maxAge) || maxAge <= 0) return false;
  if (String(row.dispatch_status || "").toUpperCase() !== "NEW") return false;
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

function brokerLinkedManualStatus(row = {}, requestedStatus = "") {
  const target = normText(requestedStatus);
  const current = normText(row.execution_status);
  const brokerId = String(row.broker_trade_id || "").trim();
  if (!brokerId) return target;
  if (!["PENDING", "FILLED"].includes(current)) return target;
  if (!["CLOSED", "CANCELLED", "REJECTED"].includes(target)) return target;
  return current === "PENDING" ? "PENDING_CANCEL" : "PENDING_CLOSE";
}

module.exports = {
  brokerLinkedManualStatus,
  brokerSnapshotFingerprint,
  brokerSnapshotHash,
  brokerTaskTypeForTrade,
  leaseRetryCount,
  nextLeaseRetryCount,
  shouldAutoRejectLeasedTrade,
  isNewTradeTooOld,
};
