"use strict";

const fs = require("fs");
const path = require("path");

const syncGuards = require("../../shared/utils/syncGuards");
const { createUniversalStoreFacade } = require("../../shared/universal-store");
const { tradesRepo: createLegacyTradesRepo } = require("../42trade/trades0");

const TRADES_SCOPE = "__trades__";
const TRADE_ENTITY_TYPE = "trade";
const SOURCE_SYSTEM = "42trade_trades";

function text(value, fallback = "") {
  const out = String(value ?? "").trim();
  if (!out || out.toLowerCase() === "null") return fallback;
  return out;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function numberOrNull(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function positiveNumberOrNull(value) {
  const out = Number(value);
  return Number.isFinite(out) && out > 0 ? out : null;
}

function computeRiskReward(entry, sl, tp) {
  const entryNum = Number(entry);
  const slNum = Number(sl);
  const tpNum = Number(tp);
  if (
    !Number.isFinite(entryNum) ||
    !Number.isFinite(slNum) ||
    !Number.isFinite(tpNum)
  ) {
    return null;
  }
  const risk = Math.abs(entryNum - slNum);
  const reward = Math.abs(tpNum - entryNum);
  if (!(risk > 0) || !(reward > 0)) return null;
  return Number((reward / risk).toFixed(6));
}

function objectValue(value, fallback = {}) {
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : fallback;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
  return clone(value);
}

function safeUserId(userId = "") {
  return String(userId || "default")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
}

function uniqStrings(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => text(value))
        .filter(Boolean),
    ),
  ];
}

function normalizeFilterList(value, normalize = (item) => text(item)) {
  const raw = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ""
      ? []
      : [value];
  return [
    ...new Set(
      raw
        .map((item) => normalize(item))
        .map((item) => text(item))
        .filter(Boolean),
    ),
  ];
}

function matchesAnyFilterValue(trade = {}, field = "", values = [], normalize = (item) => text(item)) {
  const wanted = normalizeFilterList(values, normalize);
  if (!wanted.length) return true;
  return wanted.includes(normalize(trade[field]));
}

function toIso(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function buildTradeJournalData(trade = {}, data = {}, entryType = "") {
  const base = clone(data) || {};
  const executionStatus = text(trade.execution_status).toUpperCase();
  const dispatchStatus = text(trade.dispatch_status).toUpperCase();
  const rejectionReason =
    text(base.rejection_reason || trade.rejection_reason || "") || null;
  const closeReason = text(base.close_reason || trade.close_reason || "") || null;
  const ackMessage =
    text(
      base.message ||
        base.error ||
        base.ack_error ||
        objectValue(trade.metadata, {}).ack_message ||
        objectValue(trade.metadata, {}).ack_error ||
        objectValue(trade.metadata, {}).last_broker_task_error ||
        "",
    ) || null;
  const derivedMessage =
    rejectionReason ||
    (executionStatus === "REJECTED" ? ackMessage : null) ||
    (["CLOSED", "CANCELLED"].includes(executionStatus) ? closeReason : null) ||
    null;

  return {
    ...base,
    execution_status: executionStatus || base.execution_status || null,
    dispatch_status: dispatchStatus || base.dispatch_status || null,
    symbol: text(trade.symbol) || base.symbol || null,
    action: text(trade.action) || base.action || null,
    order_type: text(trade.order_type) || base.order_type || null,
    rejection_reason: rejectionReason,
    close_reason: closeReason,
    ack_message: ackMessage,
    message: text(base.message || derivedMessage || "") || null,
    journal_entry_type: entryType || null,
  };
}

function buildSyntheticTradeStateEvent(trade = {}) {
  if (!trade?.sid) return null;
  const executionStatus = text(trade.execution_status).toUpperCase();
  const rejectionReason = text(trade.rejection_reason || "") || null;
  const closeReason = text(trade.close_reason || "") || null;
  const metadata = objectValue(trade.metadata, {});
  const ackMessage =
    text(
      metadata.ack_message ||
        metadata.ack_error ||
        metadata.last_broker_task_error ||
        "",
    ) || null;
  const message =
    rejectionReason ||
    (executionStatus === "REJECTED" ? ackMessage : null) ||
    closeReason ||
    null;
  if (!message) return null;
  return {
    id: `trade_state_${trade.sid}_${executionStatus || "UNKNOWN"}`,
    tenant_id: TRADES_SCOPE,
    tenantId: TRADES_SCOPE,
    entity_id: tradeEntityId(trade.sid),
    entityId: tradeEntityId(trade.sid),
    entity_type: TRADE_ENTITY_TYPE,
    entityType: TRADE_ENTITY_TYPE,
    entity_key: trade.sid,
    entityKey: trade.sid,
    user_id: trade.user_id || null,
    userId: trade.user_id || null,
    entry_type: "trade.state",
    entryType: "trade.state",
    direction: "none",
    amount: numberOrNull(trade.volume),
    currency: tradeCurrency(trade),
    happened_at: trade.updated_at || trade.closed_at || trade.created_at || toIso(new Date()),
    happenedAt: trade.updated_at || trade.closed_at || trade.created_at || toIso(new Date()),
    sort_order: 0,
    sortOrder: 0,
    created_at: trade.updated_at || trade.closed_at || trade.created_at || toIso(new Date()),
    createdAt: trade.updated_at || trade.closed_at || trade.created_at || toIso(new Date()),
    data: {
      source_system: SOURCE_SYSTEM,
      source_trade_sid: trade.sid,
      source_user_id: trade.user_id || null,
      execution_status: executionStatus || null,
      dispatch_status: text(trade.dispatch_status) || null,
      rejection_reason: rejectionReason,
      close_reason: closeReason,
      ack_message: ackMessage,
      message,
      reason: rejectionReason || closeReason || ackMessage || null,
      synthetic: true,
    },
  };
}

function sortTrades(items = []) {
  return [...items].sort((a, b) => {
    const aPrimary = Date.parse(a?.closed_at || a?.updated_at || 0) || 0;
    const bPrimary = Date.parse(b?.closed_at || b?.updated_at || 0) || 0;
    if (aPrimary !== bPrimary) return bPrimary - aPrimary;
    const aCreated = Date.parse(a?.created_at || 0) || 0;
    const bCreated = Date.parse(b?.created_at || 0) || 0;
    return bCreated - aCreated;
  });
}

function sortByTradePriority(a, b) {
  const aLeased = String(a?.dispatch_status || "").toUpperCase() === "LEASED";
  const bLeased = String(b?.dispatch_status || "").toUpperCase() === "LEASED";
  if (aLeased !== bLeased) return aLeased ? 1 : -1;
  const aCreated = Date.parse(a?.created_at || 0) || 0;
  const bCreated = Date.parse(b?.created_at || 0) || 0;
  return aCreated - bCreated;
}

function resolveTrades2ObjectStoreOptions(options = {}) {
  const objectStoreOptions =
    options.objectStore && typeof options.objectStore === "object"
      ? { ...options.objectStore }
      : {};
  if (!objectStoreOptions.provider) objectStoreOptions.provider = "postgres";
  if (options.sqlitePath && !objectStoreOptions.sqlitePath) {
    objectStoreOptions.sqlitePath = options.sqlitePath;
  }
  if (options.postgresUrl && !objectStoreOptions.postgresUrl) {
    objectStoreOptions.postgresUrl = options.postgresUrl;
  }
  return objectStoreOptions;
}

function resolveTrades2ProjectRoot(options = {}) {
  return options.projectRoot || path.resolve(__dirname, "..", "..", "..");
}

function listLegacySqliteTradeUserIds(options = {}) {
  const projectRoot = resolveTrades2ProjectRoot(options);
  const defaultUserId = text(options.defaultUserId || options.userId, "default");
  const usersRoot = path.join(projectRoot, "data", "users");
  const userIds = new Set([defaultUserId]);
  try {
    if (!fs.existsSync(usersRoot)) return [...userIds];
    for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dbPath = path.join(usersRoot, entry.name, "data.db");
      if (fs.existsSync(dbPath)) userIds.add(text(entry.name));
    }
  } catch {}
  return [...userIds].filter(Boolean);
}

function normalizeStoredTrade(input = {}) {
  const raw = input && typeof input === "object" ? clone(input) : {};
  const sid = text(raw.sid || raw.trade_id || raw.signal_id);
  const userId = text(raw.user_id || raw.userId, "default");
  const accountId = text(raw.account_id || raw.accountId);
  const sourceId = text(raw.source_id || raw.sourceId);
  const symbol = text(raw.symbol).toUpperCase();
  const action = text(raw.action || raw.side).toUpperCase();
  const tradeTf = text(raw.trade_tf || raw.signal_tf || raw.tradeTf || raw.signalTf);
  const chartTf = text(raw.chart_tf || raw.chartTf);
  const dispatchStatus = text(raw.dispatch_status || raw.dispatchStatus || "NEW").toUpperCase();
  const executionStatus = text(
    raw.execution_status || raw.executionStatus || "PENDING",
  ).toUpperCase();
  const now = new Date().toISOString();
  const canonicalOrderType = resolveCanonicalStoredOrderType(
    raw,
    raw.order_type || raw.orderType || "",
  );

  return {
    ...raw,
    sid,
    user_id: userId,
    account_id: accountId,
    trade_id: text(raw.trade_id || raw.signal_id || sid),
    signal_id: text(raw.signal_id || raw.trade_id || sid),
    source_id: sourceId,
    strategy: text(raw.strategy) || null,
    entry_model: text(raw.entry_model || raw.entryModel) || null,
    trade_tf: tradeTf,
    signal_tf: tradeTf,
    chart_tf: chartTf,
    symbol,
    action,
    order_type: canonicalOrderType || null,
    volume: numberOrNull(raw.volume),
    entry: numberOrNull(raw.entry),
    sl: numberOrNull(raw.sl),
    tp: numberOrNull(raw.tp),
    tp1: numberOrNull(raw.tp1),
    tp2: numberOrNull(raw.tp2),
    tp3: numberOrNull(raw.tp3),
    rr_planned: numberOrNull(raw.rr_planned ?? raw.rrPlanned),
    risk_pct_planned: numberOrNull(raw.risk_pct_planned ?? raw.riskPctPlanned),
    risk_money_planned: numberOrNull(
      raw.risk_money_planned ?? raw.riskMoneyPlanned,
    ),
    confidence_pct: numberOrNull(raw.confidence_pct ?? raw.confidencePct),
    estimated_bars:
      raw.estimated_bars === null || raw.estimated_bars === undefined
        ? raw.estimatedBars === null || raw.estimatedBars === undefined
          ? null
          : Number(raw.estimatedBars)
        : Number(raw.estimated_bars),
    be_trigger: numberOrNull(raw.be_trigger ?? raw.beTrigger),
    profile: raw.profile ?? null,
    invalidation: raw.invalidation ?? null,
    entry_condition: raw.entry_condition ?? raw.entryCondition ?? null,
    exit_condition: raw.exit_condition ?? raw.exitCondition ?? null,
    confluence_checklist:
      raw.confluence_checklist ?? raw.confluenceChecklist ?? null,
    skip_recommendation:
      raw.skip_recommendation ?? raw.skipRecommendation ?? null,
    risk_management: raw.risk_management ?? raw.riskManagement ?? null,
    note: text(raw.note) || null,
    lease_token: text(raw.lease_token || raw.leaseToken) || null,
    lease_expires_at:
      raw.lease_expires_at || raw.leaseExpiresAt
        ? toIso(raw.lease_expires_at || raw.leaseExpiresAt, now)
        : null,
    dispatch_status: dispatchStatus,
    execution_status: executionStatus,
    close_reason: text(raw.close_reason || raw.closeReason) || null,
    rejection_reason: text(raw.rejection_reason || raw.rejectionReason) || null,
    broker_trade_id: text(raw.broker_trade_id || raw.brokerTradeId) || null,
    entry_exec: numberOrNull(raw.entry_exec ?? raw.entryExec),
    sl_exec: numberOrNull(raw.sl_exec ?? raw.slExec),
    tp_exec: numberOrNull(raw.tp_exec ?? raw.tpExec),
    broker_pips: numberOrNull(raw.broker_pips ?? raw.brokerPips),
    broker_lots: numberOrNull(raw.broker_lots ?? raw.brokerLots),
    broker_commission: numberOrNull(
      raw.broker_commission ?? raw.brokerCommission,
    ),
    broker_swap: numberOrNull(raw.broker_swap ?? raw.brokerSwap),
    broker_volume: numberOrNull(raw.broker_volume ?? raw.brokerVolume),
    broker_pnl: numberOrNull(raw.broker_pnl ?? raw.brokerPnl),
    broker_margin: numberOrNull(raw.broker_margin ?? raw.brokerMargin),
    planned_tp_pnl: numberOrNull(raw.planned_tp_pnl ?? raw.plannedTpPnl),
    planned_sl_pnl: numberOrNull(raw.planned_sl_pnl ?? raw.plannedSlPnl),
    broker_tp_pnl: numberOrNull(raw.broker_tp_pnl ?? raw.brokerTpPnl),
    broker_sl_pnl: numberOrNull(raw.broker_sl_pnl ?? raw.brokerSlPnl),
    opened_at:
      raw.opened_at || raw.openedAt ? toIso(raw.opened_at || raw.openedAt, now) : null,
    closed_at:
      raw.closed_at || raw.closedAt ? toIso(raw.closed_at || raw.closedAt, now) : null,
    pnl_realized: numberOrNull(raw.pnl_realized ?? raw.pnlRealized),
    metadata: objectValue(raw.metadata, {}),
    raw_json: objectValue(raw.raw_json ?? raw.rawJson, null),
    created_at: toIso(raw.created_at || raw.createdAt, now),
    updated_at: toIso(raw.updated_at || raw.updatedAt, now),
  };
}

function normalizeOrderTypeValue(value, fallback = "") {
  const fb = text(fallback).toLowerCase();
  const raw = text(value).toLowerCase().replace(/[_-]+/g, " ");
  if (!raw) return ["limit", "market", "stop"].includes(fb) ? fb : "";
  if (raw === "limit" || raw === "market" || raw === "stop") return raw;
  if (raw.includes("market")) return "market";
  if (raw.includes("stop")) return "stop";
  if (raw.includes("limit")) return "limit";
  return ["limit", "market", "stop"].includes(fb) ? fb : "";
}

function firstTradePlanValue(source = {}) {
  if (!source || typeof source !== "object") return {};
  if (Array.isArray(source.trade_plan)) return source.trade_plan[0] || {};
  if (source.trade_plan && typeof source.trade_plan === "object") {
    return source.trade_plan;
  }
  return {};
}

function resolveCanonicalStoredOrderType(row = {}, fallback = "") {
  const raw = objectValue(row.raw_json, {});
  const metadata = objectValue(row.metadata, {});
  const metadataRaw = objectValue(metadata.raw_json, {});
  const rawPlan = firstTradePlanValue(raw);
  const metadataRawPlan = firstTradePlanValue(metadataRaw);
  return (
    normalizeOrderTypeValue(
      raw.order_type ||
        raw.orderType ||
        metadataRaw.order_type ||
        metadataRaw.orderType ||
        rawPlan.order_type ||
        rawPlan.orderType ||
        rawPlan.type ||
        metadataRawPlan.order_type ||
        metadataRawPlan.orderType ||
        metadataRawPlan.type ||
        row.order_type ||
        metadata.trade_type ||
        metadata.tradeType ||
        metadata.order_type ||
        fallback,
      fallback,
    ) || null
  );
}

function tradeEntityId(sid = "") {
  return `trade_${text(sid).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function tradeFromEntity(entity = null) {
  if (!entity) return null;
  const data = entity.data && typeof entity.data === "object" ? clone(entity.data) : {};
  return normalizeStoredTrade({
    ...data,
    sid: data.sid || entity.entity_key || entity.entityKey,
    user_id: data.user_id || entity.user_id || entity.userId,
    source_id: data.source_id || entity.source_id || entity.sourceId || null,
    dispatch_status:
      data.dispatch_status || entity.sync_status || entity.syncStatus || "NEW",
    execution_status: data.execution_status || entity.state || "PENDING",
    created_at: data.created_at || entity.created_at || entity.createdAt || null,
    updated_at: data.updated_at || entity.updated_at || entity.updatedAt || null,
  });
}

function buildTradeSearchText(trade = {}) {
  return [
    trade.sid,
    trade.trade_id,
    trade.symbol,
    trade.account_id,
    trade.source_id,
    trade.action,
    trade.entry_model,
    trade.note,
  ]
    .map((value) => text(value))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function tradeCurrency(trade = {}) {
  return (
    text(
      trade.metadata?.currency ||
        trade.raw_json?.currency ||
        trade.raw_json?.account_currency,
    ).toUpperCase() || null
  );
}

function matchesTradeFilters(trade = {}, filters = {}) {
  if (!trade) return false;
  const exact = (field, value, normalized = (x) => text(x)) => {
    if (!value) return true;
    return normalized(trade[field]) === normalized(value);
  };
  if (!exact("user_id", filters.user_id || filters.userId)) return false;
  if (
    !matchesAnyFilterValue(
      trade,
      "account_id",
      [
        ...(Array.isArray(filters.account_ids) ? filters.account_ids : []),
        filters.account_id || filters.accountId,
      ],
    )
  ) {
    return false;
  }
  if (
    !matchesAnyFilterValue(
      trade,
      "source_id",
      [
        ...(Array.isArray(filters.source_ids) ? filters.source_ids : []),
        filters.source_id || filters.sourceId,
      ],
    )
  ) {
    return false;
  }
  if (
    !exact("dispatch_status", filters.dispatch_status, (x) =>
      text(x).toUpperCase(),
    )
  ) {
    return false;
  }
  if (
    !matchesAnyFilterValue(
      trade,
      "execution_status",
      [
        ...(Array.isArray(filters.execution_statuses) ? filters.execution_statuses : []),
        ...(Array.isArray(filters.statuses) ? filters.statuses : []),
        filters.execution_status || filters.executionStatus || filters.status,
      ],
      (x) => tradesCanonicalStatus(x),
    )
  ) {
    return false;
  }
  if (
    !matchesAnyFilterValue(
      trade,
      "symbol",
      [
        ...(Array.isArray(filters.symbols) ? filters.symbols : []),
        filters.symbol,
      ],
      (x) => text(x).toUpperCase(),
    )
  ) {
    return false;
  }
  if (
    !matchesAnyFilterValue(
      trade,
      "action",
      [
        ...(Array.isArray(filters.actions) ? filters.actions : []),
        ...(Array.isArray(filters.directions) ? filters.directions : []),
        filters.action || filters.side,
      ],
      (x) => text(x).toUpperCase(),
    )
  ) {
    return false;
  }
  if (!exact("entry_model", filters.entry_model)) return false;
  if (!exact("chart_tf", filters.chart_tf || filters.chartTf)) return false;
  if (
    !exact("trade_tf", filters.trade_tf || filters.tradeTf, (x) => text(x))
  ) {
    return false;
  }
  const fromIso = text(filters.created_from || filters.createdFrom);
  if (fromIso) {
    const created = Date.parse(trade.created_at || 0) || 0;
    if (created < (Date.parse(fromIso) || 0)) return false;
  }
  const toIsoValue = text(filters.created_to || filters.createdTo);
  if (toIsoValue) {
    const created = Date.parse(trade.created_at || 0) || 0;
    if (created > (Date.parse(toIsoValue) || Number.MAX_SAFE_INTEGER)) return false;
  }
  const pnlState = text(
    filters.pnl_state || filters.profit_state || filters.win_lose,
  ).toLowerCase();
  const pnl = numberOrNull(trade.broker_pnl ?? trade.pnl_realized) || 0;
  if (pnlState === "win" && !(pnl > 0)) return false;
  if (pnlState === "lose" && !(pnl < 0)) return false;
  const q = text(filters.q || filters.search).toLowerCase();
  if (q) {
    const haystack = [
      trade.sid,
      trade.broker_trade_id,
      trade.symbol,
      trade.account_id,
      trade.source_id,
      trade.action,
      trade.entry_model,
      trade.note,
    ]
      .map((value) => text(value).toLowerCase())
      .join(" ");
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function tradesCanonicalStatus(value = "", closeReason = "") {
  const raw = text(value).toUpperCase();
  if (["TP", "SL"].includes(raw)) return raw;
  if (["PLACED", "OPEN", "ACTIVE", "EXECUTED", "START"].includes(raw)) {
    return "FILLED";
  }
  if (["NEW", "LOCKED", "SUBMITTED"].includes(raw)) return "PENDING";
  if (["CANCEL", "CANCELLED", "EXPIRED"].includes(raw)) return "CANCELLED";
  if (["FAIL", "FAILED", "ERROR"].includes(raw)) return "REJECTED";
  if (raw === "CLOSED") {
    const close = text(closeReason).toUpperCase();
    if (close === "TP" || close === "SL") return close;
    return "CLOSED";
  }
  return raw;
}

function tradesPnlValue(trade = {}) {
  const pnl = Number(trade.broker_pnl ?? trade.pnl_realized);
  return Number.isFinite(pnl) ? pnl : null;
}

function tradesTradeTimestampMs(trade = {}) {
  const raw =
    trade.closed_at || trade.opened_at || trade.updated_at || trade.created_at;
  const ms = Date.parse(String(raw || ""));
  return Number.isFinite(ms) ? ms : NaN;
}

function tradesFilterRows(rows, { from = null, to = null } = {}) {
  const fromMs = from ? Date.parse(String(from)) : NaN;
  const toMs = to ? Date.parse(String(to)) : NaN;
  return (Array.isArray(rows) ? rows : []).filter((trade) => {
    const tradeMs = tradesTradeTimestampMs(trade);
    if (Number.isFinite(fromMs) && (!Number.isFinite(tradeMs) || tradeMs < fromMs)) {
      return false;
    }
    if (Number.isFinite(toMs) && (!Number.isFinite(tradeMs) || tradeMs > toMs)) {
      return false;
    }
    return true;
  });
}

function tradesLocalPeriodRange(period = "all") {
  const now = new Date();
  const end = now.toISOString();
  if (period === "all") return { start: null, end: null };
  if (period === "today") {
    return {
      start: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      ).toISOString(),
      end,
    };
  }
  if (period === "yesterday") {
    return {
      start: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 1,
      ).toISOString(),
      end: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      ).toISOString(),
    };
  }
  if (period === "week") {
    const day = now.getDay() || 7;
    return {
      start: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - (day - 1),
      ).toISOString(),
      end,
    };
  }
  if (period === "last_week") {
    const day = now.getDay() || 7;
    return {
      start: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - (day - 1) - 7,
      ).toISOString(),
      end: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - (day - 1),
      ).toISOString(),
    };
  }
  if (period === "month") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      end,
    };
  }
  if (period === "last_month") {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
      end: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    };
  }
  if (period === "year") {
    return {
      start: new Date(now.getFullYear(), 0, 1).toISOString(),
      end,
    };
  }
  return { start: null, end: null };
}

function tradesSourceIdFromRow(row = {}) {
  const raw = row.raw_json || {};
  return text(row.source_id || raw.source_id || row.source || raw.source);
}

function tradesStrategyLabelFromRow(row = {}) {
  const raw = row.raw_json || {};
  return text(row.strategy || raw.strategy);
}

function tradesEntryModelLabelFromRow(row = {}) {
  const raw = row.raw_json || {};
  const firstPlan = Array.isArray(raw.trade_plan)
    ? raw.trade_plan[0] || {}
    : raw.trade_plan && typeof raw.trade_plan === "object"
      ? raw.trade_plan
      : {};
  const metadataPlan =
    row.metadata?.trade_plan && typeof row.metadata.trade_plan === "object"
      ? row.metadata.trade_plan
      : {};
  const candidate = text(
    firstPlan.entry_model ||
      metadataPlan.entry_model ||
      raw.entry_model ||
      raw.entryModel ||
      row.entry_model,
  );
  if (/^ai[_-]/i.test(candidate)) return "";
  return candidate;
}

function tradesOrderTypeFromRow(row = {}) {
  const raw = row.raw_json || {};
  const metadata = row.metadata || {};
  const firstPlan = Array.isArray(raw.trade_plan)
    ? raw.trade_plan[0] || {}
    : raw.trade_plan && typeof raw.trade_plan === "object"
      ? raw.trade_plan
      : {};
  const orderTypeRaw = text(
    row.order_type ||
      metadata.order_type ||
      raw.order_type ||
      raw.orderType ||
      firstPlan.order_type,
    "LIMIT",
  ).toLowerCase();
  if (orderTypeRaw.includes("market")) return "market";
  if (orderTypeRaw.includes("stop")) return "stop";
  return "limit";
}

function tradesClosedRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const status = tradesCanonicalStatus(
      row.execution_status || row.status,
      row.close_reason,
    );
    const closeReason = text(row.close_reason).toUpperCase();
    const pnl = tradesPnlValue(row);
    return (
      ["CLOSED", "TP", "SL"].includes(status) ||
      closeReason === "TP" ||
      closeReason === "SL" ||
      (status === "CANCELLED" && pnl !== null)
    );
  });
}

function tradesComputeTradeMetrics(rows = []) {
  const all = Array.isArray(rows) ? rows : [];
  const countPending = all.filter((row) => {
    const status = tradesCanonicalStatus(
      row.execution_status || row.status,
      row.close_reason,
    );
    return status === "PENDING";
  }).length;
  const countFilled = all.filter((row) => {
    const status = tradesCanonicalStatus(
      row.execution_status || row.status,
      row.close_reason,
    );
    return status === "FILLED";
  }).length;
  const countClosed = all.filter((row) => {
    const status = tradesCanonicalStatus(
      row.execution_status || row.status,
      row.close_reason,
    );
    return ["CLOSED", "TP", "SL"].includes(status);
  }).length;
  const countCancelled = all.filter((row) => {
    const status = tradesCanonicalStatus(
      row.execution_status || row.status,
      row.close_reason,
    );
    return status === "CANCELLED";
  }).length;
  const trades = tradesClosedRows(all);
  let totalPnl = 0;
  let winSumPnl = 0;
  let loseSumPnl = 0;
  let wins = 0;
  let losses = 0;
  for (const row of trades) {
    const status = tradesCanonicalStatus(
      row.execution_status || row.status,
      row.close_reason,
    );
    const closeReason = text(row.close_reason).toUpperCase();
    const pnl = tradesPnlValue(row);
    if (status === "TP" || closeReason === "TP") wins += 1;
    else if (status === "SL" || closeReason === "SL") losses += 1;
    else if (pnl !== null && pnl > 0) wins += 1;
    else if (pnl !== null && pnl < 0) losses += 1;
    if (pnl !== null) {
      totalPnl += pnl;
      if (pnl > 0) winSumPnl += pnl;
      if (pnl < 0) loseSumPnl += pnl;
    }
  }
  const filledOpenRows = all.filter((row) => {
    const status = tradesCanonicalStatus(
      row.execution_status || row.status,
      row.close_reason,
    );
    return status === "FILLED";
  });
  const filledOpenPnl = filledOpenRows.reduce((sum, row) => {
    const pnl = tradesPnlValue(row);
    return pnl !== null ? sum + pnl : sum;
  }, 0);
  const filledOpenWinSumPnl = filledOpenRows.reduce((sum, row) => {
    const pnl = tradesPnlValue(row);
    return pnl !== null && pnl > 0 ? sum + pnl : sum;
  }, 0);
  const filledOpenLoseSumPnl = filledOpenRows.reduce((sum, row) => {
    const pnl = tradesPnlValue(row);
    return pnl !== null && pnl < 0 ? sum + pnl : sum;
  }, 0);
  const filledOpenPlannedTpPnl = filledOpenRows.reduce((sum, row) => {
    const pnl = Number(row.broker_tp_pnl ?? row.planned_tp_pnl ?? 0);
    return Number.isFinite(pnl) ? sum + pnl : sum;
  }, 0);
  const filledOpenPlannedSlPnl = filledOpenRows.reduce((sum, row) => {
    const pnl = Number(row.broker_sl_pnl ?? row.planned_sl_pnl ?? 0);
    return Number.isFinite(pnl) ? sum + pnl : sum;
  }, 0);
  const filledOpenWins = filledOpenRows.filter((row) => {
    const pnl = tradesPnlValue(row);
    return pnl !== null && pnl > 0;
  }).length;
  const filledOpenLosses = filledOpenRows.filter((row) => {
    const pnl = tradesPnlValue(row);
    return pnl !== null && pnl < 0;
  }).length;
  const decided = wins + losses;
  return {
    total_signals: all.length,
    total_trades: countPending + countFilled + countClosed,
    wins,
    losses,
    win_rate: decided > 0 ? (wins / decided) * 100 : 0,
    total_pnl: totalPnl,
    buy_pnl: 0,
    sell_pnl: 0,
    win_sum_pnl: winSumPnl,
    lose_sum_pnl: loseSumPnl,
    total_rr: 0,
    count_pending: countPending,
    count_filled: countFilled,
    count_closed: countClosed,
    count_cancelled: countCancelled,
    filled_open_pnl: filledOpenPnl,
    filled_open_win_sum_pnl: filledOpenWinSumPnl,
    filled_open_lose_sum_pnl: filledOpenLoseSumPnl,
    filled_open_planned_tp_pnl: filledOpenPlannedTpPnl,
    filled_open_planned_sl_pnl: filledOpenPlannedSlPnl,
    filled_open_wins: filledOpenWins,
    filled_open_losses: filledOpenLosses,
  };
}

function tradesComputeTopWinrateRows(
  rows = [],
  keyPicker,
  { limit = 10, includeDirection = false } = {},
) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const baseKey = text(keyPicker(row));
    if (!baseKey) continue;
    const direction = text(row.action).toUpperCase();
    const directionSafe =
      direction === "BUY" || direction === "SELL" ? direction : "-";
    const key = includeDirection ? `${baseKey} | ${directionSafe}` : baseKey;
    const status = tradesCanonicalStatus(
      row.execution_status || row.status,
      row.close_reason,
    );
    const closeReason = text(row.close_reason).toUpperCase();
    const pnl = tradesPnlValue(row);
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: baseKey,
        direction: directionSafe,
        wins: 0,
        losses: 0,
        trades: 0,
        pnl_total: 0,
        rr_total: 0,
        rr_sum: 0,
        rr_count: 0,
      });
    }
    const stat = map.get(key);
    if (
      status === "CLOSED" ||
      status === "TP" ||
      status === "SL" ||
      closeReason === "TP" ||
      closeReason === "SL"
    ) {
      stat.trades += 1;
      if (status === "TP" || closeReason === "TP") stat.wins += 1;
      else if (status === "SL" || closeReason === "SL") stat.losses += 1;
      else if (pnl !== null && pnl > 0) stat.wins += 1;
      else if (pnl !== null && pnl < 0) stat.losses += 1;
      if (pnl !== null) stat.pnl_total += pnl;
    }
  }
  let entries = [...map.values()].map((item) => {
    const decided = item.wins + item.losses;
    return {
      ...item,
      win_rate: decided > 0 ? (item.wins / decided) * 100 : 0,
    };
  });
  entries = entries.filter(
    (item) =>
      Math.abs(item.pnl_total) > 0.001 ||
      item.win_rate > 0 ||
      item.wins > 0 ||
      item.losses > 0,
  );
  entries.sort(
    (a, b) =>
      b.win_rate - a.win_rate ||
      b.trades - a.trades ||
      (a.key < b.key ? -1 : 1),
  );
  return limit > 0 ? entries.slice(0, limit) : entries;
}

function tradesBuildAccountsSummary(rows = []) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const accountId = text(row.account_id);
    if (!accountId) continue;
    if (!grouped.has(accountId)) {
      grouped.set(accountId, {
        account_id: accountId,
        name:
          text(
            row.metadata?.account_name ||
              row.raw_json?.account_name ||
              row.raw_json?.accountName,
          ) || accountId,
      });
    }
  }
  return [...grouped.values()].sort((a, b) =>
    a.account_id.localeCompare(b.account_id),
  );
}

function countByExecutionStatus(items = []) {
  const counts = {};
  for (const item of items) {
    const key = text(item?.execution_status).toUpperCase();
    if (!key) continue;
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
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

function normalizeBrokerTaskTicket(ticket) {
  const raw = String(ticket || "").trim();
  if (!raw) return null;
  const oidMatch = raw.match(/^OID(\d+)$/i);
  if (oidMatch) return oidMatch[1];
  return raw;
}

function normalizeBrokerCommentSid(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.split("|")[0].trim();
}

function normalizeBrokerIdentitySid(value) {
  const collapsed = String(value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .trim()
    .toUpperCase();
  return /^[A-Z0-9]{9}$/.test(collapsed) ? collapsed : "";
}

function firstTradePlanCandidate(value) {
  if (Array.isArray(value)) {
    return value.find((item) => item && typeof item === "object") || {};
  }
  return value && typeof value === "object" ? value : {};
}

function plannedTradeSizing(row = {}) {
  const metadata = objectValue(row.metadata, {});
  const rawJson = objectValue(row.raw_json, {});
  const metadataPlan = firstTradePlanCandidate(metadata.trade_plan);
  const rawPlan = firstTradePlanCandidate(rawJson.trade_plan);
  const directVolume = numberOrNull(row.volume);
  const plannedLots =
    numberOrNull(metadata.volume_basis_lots) ??
    numberOrNull(metadataPlan.lots ?? metadataPlan.volume_basis_lots) ??
    numberOrNull(rawPlan.lots ?? rawPlan.volume_basis_lots) ??
    numberOrNull(rawJson.lots ?? rawJson.volume_basis_lots);
  const plannedVolume =
    (Number.isFinite(directVolume) && directVolume > 0 ? directVolume : null) ??
    numberOrNull(metadataPlan.volume) ??
    numberOrNull(rawPlan.volume) ??
    numberOrNull(metadata.volume) ??
    numberOrNull(rawJson.volume);
  return {
    plannedLots,
    plannedVolume,
  };
}

function accountMatchesTrade(row = {}, accountId = "") {
  const current = String(row.account_id || "").trim();
  const incoming = String(accountId || "").trim();
  if (!current || !incoming) return true;
  return current === incoming;
}

function toTaskShape(row) {
  const sizing = plannedTradeSizing(row);
  return {
    task_id: row.sid,
    type: syncGuards.brokerTaskTypeForTrade(row),
    symbol: row.symbol,
    action: row.action,
    volume: sizing.plannedVolume,
    lots: sizing.plannedLots,
    price: row.entry,
    sl: row.sl,
    tp: row.tp,
    risk_money_planned: row.risk_money_planned ?? null,
    sid: row.sid,
    ticket: normalizeBrokerTaskTicket(row.broker_trade_id ?? null),
    raw_json: row.raw_json ?? null,
    metadata: objectValue(row.metadata, {}),
    lease_token: row.lease_token ?? null,
    lease_expires_at: row.lease_expires_at ?? null,
  };
}

function isBrokerSyncNoteMatchCandidate(row) {
  if (!row) return false;
  const executionStatus = String(row.execution_status || "")
    .trim()
    .toUpperCase();
  if (!(executionStatus === "PENDING" || executionStatus === "FILLED")) return false;
  return Boolean(normalizeBrokerIdentitySid(row.note || row.sid || ""));
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
  if (["PENDING", "PLACED", "NEW", "SUBMITTED"].includes(raw)) return "PENDING";
  if (["TP", "SL", "CLOSED"].includes(raw)) return "CLOSED";
  if (["CANCEL", "CANCELLED", "EXPIRED"].includes(raw)) return "CANCELLED";
  if (["REJECTED", "FAIL", "ERROR"].includes(raw)) return "REJECTED";
  return "";
}

function recoverBrokerLinkedFailureState(currentRow, failReason = "") {
  const taskType = syncGuards.brokerTaskTypeForTrade({
    dispatch_status: currentRow?.dispatch_status,
    lease_expires_at: currentRow?.lease_expires_at,
    metadata: currentRow?.metadata || {},
  });
  if (!["MODIFY", "CLOSE", "CANCEL"].includes(taskType)) return null;

  const brokerData =
    currentRow?.metadata && typeof currentRow.metadata === "object"
      ? currentRow.metadata.broker_data || {}
      : {};
  const brokerStatus = normalizeBrokerSnapshotExecutionStatus(brokerData);
  const fallbackStatus = String(currentRow?.execution_status || "")
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
        ? currentRow?.close_reason ?? null
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
  const requestedStatus = String(
    payload.execution_status || payload.status || "",
  )
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
  const ackEntryExec = positiveNumberOrNull(
    payload.entry_price_exec ??
      payload.entry_exec ??
      payload.entryExec ??
      payload.entry,
  );
  const ackSlExec = positiveNumberOrNull(
    payload.sl_exec ?? payload.used_sl ?? payload.usedSl ?? payload.sl,
  );
  const ackTpExec = positiveNumberOrNull(
    payload.tp_exec ?? payload.used_tp ?? payload.usedTp ?? payload.tp,
  );
  const isBrokerFail = ["ERROR", "FAIL", "REJECTED"].includes(
    String(payload.execution_status || payload.status || "").trim().toUpperCase(),
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
  const baseMeta = objectValue(currentRow.metadata, {});
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
      payload.entry_price_exec ?? payload.entry_exec ?? payload.entryExec ?? null,
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
  const nextEntry =
    recoveredBrokerState?.entry != null
      ? recoveredBrokerState.entry
      : currentRow.entry != null
        ? currentRow.entry
        : ackEntryExec;
  const nextSl =
    recoveredBrokerState?.sl != null
      ? recoveredBrokerState.sl
      : ackSlExec != null
        ? ackSlExec
        : currentRow.sl ?? null;
  const nextTp =
    recoveredBrokerState?.tp != null
      ? recoveredBrokerState.tp
      : ackTpExec != null
        ? ackTpExec
        : currentRow.tp ?? null;
  const rrPlanned =
    computeRiskReward(
      ackEntryExec ?? currentRow.entry_exec ?? nextEntry,
      nextSl,
      nextTp,
    ) ??
    currentRow.rr_planned ??
    null;
  const preservedOrderType = resolveCanonicalStoredOrderType(
    currentRow,
    recoveredBrokerState?.order_type ||
      payload.order_type ||
      currentRow.order_type ||
      "",
  );

  return {
    account_id: accountId,
    dispatch_status: payload.release_only === true ? "NEW" : "CONSUMED",
    execution_status: recoveredBrokerState
      ? recoveredBrokerState.execution_status
      : isBrokerFail
        ? "REJECTED"
        : normalizedStatus,
    rejection_reason: recoveredBrokerState
      ? null
      : isBrokerFail
        ? failReason || "Broker failed"
        : currentRow.rejection_reason ?? null,
    broker_trade_id:
      ["MANUAL", ""].includes(String(payload.broker_trade_id || "").trim())
        ? currentRow.broker_trade_id ?? null
        : payload.broker_trade_id || currentRow.broker_trade_id || null,
    entry_exec:
      ackEntryExec != null ? ackEntryExec : currentRow.entry_exec ?? null,
    sl_exec: ackSlExec != null ? ackSlExec : currentRow.sl_exec ?? null,
    tp_exec: ackTpExec != null ? ackTpExec : currentRow.tp_exec ?? null,
    pnl_realized: isClosed
      ? payload.pnl_realized != null
        ? Number(payload.pnl_realized)
        : currentRow.pnl_realized ?? null
      : currentRow.pnl_realized ?? null,
    volume:
      recoveredBrokerState?.volume != null
        ? recoveredBrokerState.volume
        : usedVolume != null
          ? usedVolume
          : currentRow.volume ?? null,
    risk_money_planned:
      riskMoneyPlanned != null
        ? riskMoneyPlanned
        : currentRow.risk_money_planned ?? null,
    rr_planned: rrPlanned,
    order_type: preservedOrderType,
    entry: nextEntry ?? null,
    sl: nextSl,
    tp: nextTp,
    tp1:
      recoveredBrokerState?.tp1 != null
        ? recoveredBrokerState.tp1
        : currentRow.tp1 ?? null,
    tp2:
      recoveredBrokerState?.tp2 != null
        ? recoveredBrokerState.tp2
        : currentRow.tp2 ?? null,
    tp3:
      recoveredBrokerState?.tp3 != null
        ? recoveredBrokerState.tp3
        : currentRow.tp3 ?? null,
    metadata: mergedMetadata,
    opened_at:
      recoveredBrokerState?.opened_at ||
      syncGuards.nullableIsoTimestamp(payload.opened_at || payload.openedAt) ||
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
      currentRow.closed_at ||
      (isClosed ? nowIso : null),
    updated_at: nowIso,
    lease_token: null,
    lease_expires_at: null,
  };
}

function resolvePersistedOpenedAt(syncItem = {}, existingRow = null, nowIso = null) {
  const brokerOpenedAt = syncGuards.nullableIsoTimestamp(
    syncItem?.opened_at || syncItem?.openedAt,
  );
  if (brokerOpenedAt) return brokerOpenedAt;
  const existingOpenedAt = syncGuards.nullableIsoTimestamp(
    existingRow?.opened_at,
  );
  if (existingOpenedAt) return existingOpenedAt;
  return nowIso ? syncGuards.nullableIsoTimestamp(nowIso) : null;
}

function isAckStateAlreadyApplied(currentRow, payload = {}) {
  const requestedStatus = String(payload.execution_status || payload.status || "")
    .trim()
    .toUpperCase();
  const normalizedStatus =
    requestedStatus === "FAIL" || requestedStatus === "EXPIRED"
      ? "REJECTED"
      : requestedStatus === "START" || requestedStatus === "PLACED"
        ? "PENDING"
        : requestedStatus;
  const currentStatus = String(currentRow?.execution_status || "")
    .trim()
    .toUpperCase();
  if (!normalizedStatus || currentStatus !== normalizedStatus) return false;
  if (!payload.broker_trade_id) return true;
  return (
    String(currentRow?.broker_trade_id || "").trim() ===
    String(payload.broker_trade_id || "").trim()
  );
}

function currentTradesRepo(options = {}) {
  if (typeof options.sourceRepoFactory === "function") {
    return options.sourceRepoFactory(options);
  }
  if (options.sourceRepo && typeof options.sourceRepo.listTradesV2 === "function") {
    return options.sourceRepo;
  }
  return createLegacyTradesRepo({
    storageBackend: text(options.sourceStorageBackend || options.storageBackend, "sqlite")
      .toLowerCase(),
    postgresPool: options.sourcePostgresPool || options.postgresPool || null,
    sqlitePath: options.sourceSqlitePath || options.sqlitePath || "",
    projectRoot: resolveTrades2ProjectRoot(options),
    userId: options.userId || options.defaultUserId || "default",
  });
}

function universalStore(options = {}) {
  const objectStoreOptions = resolveTrades2ObjectStoreOptions(options);
  return createUniversalStoreFacade({
    provider: objectStoreOptions.provider,
    sqlitePath: objectStoreOptions.sqlitePath,
    postgresUrl: objectStoreOptions.postgresUrl || options.postgresUrl,
  });
}

function createTradesRepo(options = {}) {
  const repo = universalStore(options);
  const projectRoot = resolveTrades2ProjectRoot(options);
  const sourceBackend = text(
    options.sourceStorageBackend || options.storageBackend,
    "sqlite",
  ).toLowerCase();

  async function appendTradeJournal(trade = {}, entryType = "", data = {}, happenedAt = null) {
    if (!trade?.sid || !entryType) return null;
    return repo.appendJournal({
      tenantId: TRADES_SCOPE,
      entityId: tradeEntityId(trade.sid),
      entityType: TRADE_ENTITY_TYPE,
      entityKey: trade.sid,
      userId: trade.user_id,
      entryType,
      direction: "none",
      amount: numberOrNull(trade.volume),
      currency: tradeCurrency(trade),
      happenedAt: happenedAt || trade.updated_at || toIso(new Date()),
      data: buildTradeJournalData(trade, data, entryType),
    });
  }

  async function upsertTradeRow(input = {}, meta = {}) {
    const trade = normalizeStoredTrade(input);
    if (!trade.sid) throw new Error("sid is required");
    const entity = await repo.upsertEntity({
      id: tradeEntityId(trade.sid),
      tenantId: TRADES_SCOPE,
      entityType: TRADE_ENTITY_TYPE,
      entityKey: trade.sid,
      userId: trade.user_id,
      ownerId: trade.user_id,
      title: `${trade.symbol || "TRADE"} ${trade.action || ""} ${trade.sid}`.trim(),
      subtitle: [trade.account_id, trade.entry_model, trade.chart_tf]
        .filter(Boolean)
        .join(" / "),
      status: "ACTIVE",
      state: trade.execution_status,
      category: "trade",
      subtype: text(trade.order_type || trade.action).toLowerCase() || null,
      visibility: "PRIVATE",
      accessLevel: "OWNER_ONLY",
      scopeType: "TENANT",
      scopeTenantId: TRADES_SCOPE,
      scopeModule: "trades",
      scopeUserId: trade.user_id,
      currency: tradeCurrency(trade),
      amount: numberOrNull(trade.volume),
      price: numberOrNull(trade.entry),
      sourceSystem: SOURCE_SYSTEM,
      sourceId: trade.source_id || trade.trade_id || trade.sid,
      syncStatus: trade.dispatch_status,
      startAt: trade.opened_at || null,
      endAt: trade.closed_at || null,
      searchText: buildTradeSearchText(trade),
      createdAt: trade.created_at,
      updatedAt: trade.updated_at,
      meta: {
        migration:
          meta.migration && typeof meta.migration === "object"
            ? clone(meta.migration)
            : undefined,
      },
      data: trade,
    });
    const saved = tradeFromEntity(entity);
    if (meta.appendJournal !== false) {
      await appendTradeJournal(
        saved,
        meta.entryType || "trade.upsert",
        {
          source_system: SOURCE_SYSTEM,
          source_trade_sid: saved.sid,
          source_user_id: saved.user_id,
          reason: meta.reason || null,
          migration: meta.migration || null,
        },
        saved.updated_at,
      );
    }
    return saved;
  }

  async function updateTradePatch(currentTrade = {}, patch = {}, meta = {}) {
    const nextTrade = normalizeStoredTrade({
      ...currentTrade,
      ...patch,
      metadata: {
        ...objectValue(currentTrade.metadata, {}),
        ...objectValue(patch.metadata, {}),
      },
      raw_json:
        patch.raw_json === undefined
          ? currentTrade.raw_json
          : objectValue(patch.raw_json, null),
      created_at: currentTrade.created_at,
      updated_at: patch.updated_at || toIso(new Date()),
    });
    return upsertTradeRow(nextTrade, meta);
  }

  async function listAllTradesRaw() {
    const rows = await repo.listEntities({
      tenantId: TRADES_SCOPE,
      entityType: TRADE_ENTITY_TYPE,
      limit: 100000,
      offset: 0,
    });
    return rows.map(tradeFromEntity).filter(Boolean);
  }

  async function loadTradeBySid(sid = "") {
    if (!sid) return null;
    const entity = await repo.getEntity(TRADES_SCOPE, TRADE_ENTITY_TYPE, sid);
    return tradeFromEntity(entity);
  }

  return {
    getStorageInfo() {
      const info = repo.info();
      return {
        provider: info.backend,
        connection_target: info.connectionTarget || null,
        current_store_path: info.connectionTarget || null,
        source_backend: sourceBackend,
        project_root: projectRoot,
      };
    },

    async upsertTrade(input = {}, options = {}) {
      return {
        ok: true,
        trade: await upsertTradeRow(input, {
          appendJournal: options.appendJournal !== false,
          entryType: options.entryType || "trade.upsert",
          reason: options.reason || "manual_upsert",
        }),
      };
    },

    async getTrade(input = {}) {
      const sid = text(input.sid || input.trade_id || input.signal_id);
      if (!sid) return { ok: true, trade: null };
      const trade = await loadTradeBySid(sid);
      if (trade && !matchesTradeFilters(trade, input)) {
        return { ok: true, trade: null };
      }
      return { ok: true, trade };
    },

    async listTradeEvents(input = {}) {
      const sid = text(input.sid || input.trade_id || input.signal_id);
      if (!sid) return { ok: true, sid, items: [] };
      const limit = Math.max(
        1,
        Math.min(1000, Number(input.limit) || 200),
      );
      const items = await repo.listJournal({
        tenantId: TRADES_SCOPE,
        entityType: TRADE_ENTITY_TYPE,
        entityKey: sid,
        limit,
      });
      const normalizedItems = Array.isArray(items) ? items : [];
      const trade = await loadTradeBySid(sid);
      const synthetic = buildSyntheticTradeStateEvent(trade);
      const alreadyCovered =
        synthetic &&
        normalizedItems.some((item) => {
          const data = objectValue(item?.data, {});
          const itemMessage = text(
            data.message ||
              data.rejection_reason ||
              data.close_reason ||
              data.ack_message ||
              "",
          );
          const syntheticMessage = text(
            synthetic.data?.message ||
              synthetic.data?.rejection_reason ||
              synthetic.data?.close_reason ||
              "",
          );
          return syntheticMessage && itemMessage === syntheticMessage;
        });
      const mergedItems =
        synthetic && !alreadyCovered
          ? [synthetic, ...normalizedItems].slice(0, limit)
          : normalizedItems;
      return { ok: true, sid, items: mergedItems };
    },

    async listTrades(filters = {}) {
      const page = Math.max(1, Number(filters.page) || 1);
      const pageSize = Math.max(
        1,
        Math.min(5000, Number(filters.pageSize || filters.limit) || 50),
      );
      const all = sortTrades(
        (await listAllTradesRaw()).filter((item) =>
          matchesTradeFilters(item, filters),
        ),
      );
      const offset = (page - 1) * pageSize;
      return {
        ok: true,
        items: all.slice(offset, offset + pageSize),
        total: all.length,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(all.length / pageSize)),
      };
    },

    async deleteTradesBySids(userId, sids = []) {
      const safeSids = uniqStrings(sids);
      if (!safeSids.length) return { ok: true, deleted: 0, sids: [] };
      let deleted = 0;
      for (const sid of safeSids) {
        const existing = await loadTradeBySid(sid);
        if (existing && !matchesTradeFilters(existing, { user_id: userId || existing.user_id })) {
          continue;
        }
        const result = await repo.deleteEntity(TRADES_SCOPE, TRADE_ENTITY_TYPE, sid);
        const changes = Number(result?.changes ?? result?.rowCount ?? 0);
        if (changes > 0 || existing) deleted += 1;
      }
      return { ok: true, deleted, sids: safeSids };
    },

    async countTradesByExecutionStatus(filters = {}) {
      const all = (await listAllTradesRaw()).filter((item) =>
        matchesTradeFilters(item, filters),
      );
      return {
        ok: true,
        counts: countByExecutionStatus(all),
      };
    },

    async dashboard(filters = {}) {
      const range = text(filters.range, "all").toLowerCase();
      const allRows = (await listAllTradesRaw()).filter((item) =>
        matchesTradeFilters(item, {
          ...filters,
          created_from: "",
          created_to: "",
          range: "",
        }),
      );
      const rowsByDimension = allRows.filter((row) => {
        if (
          filters.entry_model &&
          tradesEntryModelLabelFromRow(row) !== text(filters.entry_model)
        ) {
          return false;
        }
        if (
          filters.chart_tf &&
          text(row.chart_tf || row.raw_json?.chart_tf || row.raw_json?.chartTf) !==
            text(filters.chart_tf)
        ) {
          return false;
        }
        if (
          filters.trade_tf &&
          text(
            row.trade_tf ||
              row.raw_json?.trade_tf ||
              row.raw_json?.sourceTf ||
              row.raw_json?.timeframe,
          ) !== text(filters.trade_tf)
        ) {
          return false;
        }
        return true;
      });
      const selectedPeriod = tradesLocalPeriodRange(range);
      const selectedRows = tradesFilterRows(rowsByDimension, {
        from: selectedPeriod.start,
        to: selectedPeriod.end,
      });
      const periods = [
        "all",
        "today",
        "yesterday",
        "last_week",
        "last_month",
        "week",
        "month",
        "year",
      ];
      const periodTotals = {};
      for (const period of periods) {
        const scopedPeriod = tradesLocalPeriodRange(period);
        const scopedRows = tradesFilterRows(rowsByDimension, {
          from: scopedPeriod.start,
          to: scopedPeriod.end,
        });
        const metrics = tradesComputeTradeMetrics(scopedRows);
        periodTotals[period] = {
          total_pnl: metrics.total_pnl,
          total_rr: metrics.total_rr,
          total_trades: metrics.total_trades,
          total_wins: metrics.wins,
          total_losses: metrics.losses,
          win_sum_pnl: metrics.win_sum_pnl,
          lose_sum_pnl: metrics.lose_sum_pnl,
        };
      }
      const seriesBucket = range === "today" ? "hour" : "day";
      const seriesMap = new Map();
      for (const row of selectedRows) {
        const status = tradesCanonicalStatus(
          row.execution_status || row.status,
          row.close_reason,
        );
        const pnl = tradesPnlValue(row);
        if (
          !["CLOSED", "TP", "SL"].includes(status) &&
          !(status === "CANCELLED" && pnl !== null)
        ) {
          continue;
        }
        if (pnl === null) continue;
        const date = new Date(
          row.closed_at || row.opened_at || row.updated_at || row.created_at,
        );
        if (!Number.isFinite(date.getTime())) continue;
        const key =
          seriesBucket === "hour"
            ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:00`
            : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        seriesMap.set(key, (seriesMap.get(key) || 0) + pnl);
      }
      const symbols = [
        ...new Set(rowsByDimension.map((row) => text(row.symbol).toUpperCase()).filter(Boolean)),
      ].sort();
      const accounts = [
        ...new Set(rowsByDimension.map((row) => text(row.account_id)).filter(Boolean)),
      ].sort();
      return {
        ok: true,
        accounts_summary: tradesBuildAccountsSummary(allRows),
        filters: {
          user_id: text(filters.user_id || filters.userId || "default"),
          symbol: text(filters.symbol).toUpperCase(),
          source: text(filters.source_id || filters.source),
          entry_model: text(filters.entry_model),
          chart_tf: text(filters.chart_tf),
          trade_tf: text(filters.trade_tf),
          direction: text(filters.action || filters.side).toUpperCase(),
          pnl_state: text(filters.pnl_state).toLowerCase(),
          range,
          accounts,
          symbols,
          sources: [
            ...new Set(rowsByDimension.map((row) => tradesSourceIdFromRow(row)).filter(Boolean)),
          ].sort(),
          strategies: [
            ...new Set(
              rowsByDimension.map((row) => tradesStrategyLabelFromRow(row)).filter(Boolean),
            ),
          ].sort(),
          entry_models: [
            ...new Set(
              rowsByDimension.map((row) => tradesEntryModelLabelFromRow(row)).filter(Boolean),
            ),
          ].sort(),
          chart_tfs: [
            ...new Set(
              rowsByDimension
                .map((row) =>
                  text(
                    row.chart_tf ||
                      row.raw_json?.chart_tf ||
                      row.raw_json?.chartTf ||
                      row.trade_tf ||
                      row.raw_json?.trade_tf ||
                      row.raw_json?.sourceTf ||
                      row.raw_json?.timeframe,
                  ),
                )
                .filter(Boolean),
            ),
          ].sort(),
          trade_tfs: [
            ...new Set(
              rowsByDimension
                .map((row) =>
                  text(
                    row.trade_tf ||
                      row.raw_json?.trade_tf ||
                      row.raw_json?.sourceTf ||
                      row.raw_json?.timeframe,
                  ),
                )
                .filter(Boolean),
            ),
          ].sort(),
        },
        metrics: tradesComputeTradeMetrics(selectedRows),
        period_totals: periodTotals,
        top_winrate: {
          symbols: tradesComputeTopWinrateRows(
            selectedRows,
            (row) => text(row.symbol).toUpperCase(),
            { limit: 100, includeDirection: false },
          ),
          entry_models: tradesComputeTopWinrateRows(
            selectedRows,
            (row) => tradesEntryModelLabelFromRow(row),
            { limit: 100, includeDirection: false },
          ),
          strategies: tradesComputeTopWinrateRows(
            selectedRows,
            (row) => tradesStrategyLabelFromRow(row),
            { limit: 100, includeDirection: false },
          ),
          accounts: tradesComputeTopWinrateRows(
            selectedRows,
            (row) => text(row.account_id),
            { limit: 100, includeDirection: false },
          ),
          sources: tradesComputeTopWinrateRows(
            selectedRows,
            (row) => tradesSourceIdFromRow(row),
            { limit: 100, includeDirection: false },
          ),
          directional: tradesComputeTopWinrateRows(
            selectedRows,
            (row) => {
              const dir = text(row.action || row.side, "BUY").toLowerCase();
              const typeRaw = tradesOrderTypeFromRow(row);
              const capitalize = (value) =>
                value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
              return `${capitalize(dir)} ${capitalize(typeRaw)}`;
            },
            { limit: 100, includeDirection: false },
          ),
        },
        pnl_series: [...seriesMap.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([x, y]) => ({ x, y })),
      };
    },

    async cloneFromCurrentTrades(input = {}) {
      const requestedUserId = text(input.user_id || input.userId);
      const pageSize = Math.max(
        1,
        Math.min(5000, Number(input.pageSize || input.limit) || 500),
      );
      const sourceUserIds =
        sourceBackend === "sqlite"
          ? requestedUserId
            ? [requestedUserId]
            : Array.isArray(options.sourceUserIds) && options.sourceUserIds.length
              ? uniqStrings(options.sourceUserIds)
              : listLegacySqliteTradeUserIds({
                  projectRoot,
                  defaultUserId: options.defaultUserId || options.userId,
                })
          : [requestedUserId || null];

      let scanned = 0;
      let cloned = 0;
      const userCounts = {};

      for (const sourceUserId of sourceUserIds) {
        const sourceRepo = currentTradesRepo({
          ...options,
          userId: sourceUserId || options.userId || options.defaultUserId,
        });
        let page = 1;
        while (true) {
          const out = await sourceRepo.listTradesV2(
            sourceUserId || options.defaultUserId || null,
            sourceUserId ? { user_id: sourceUserId } : {},
            page,
            pageSize,
          );
          const items = Array.isArray(out?.items) ? out.items : [];
          if (!items.length) break;
          for (const item of items) {
            scanned += 1;
            await upsertTradeRow(item, {
              entryType: "trade.clone",
              reason: "clone_from_current_trades",
              migration: {
                source_backend: sourceBackend,
                cloned_at: new Date().toISOString(),
              },
            });
            const userKey = text(item?.user_id, "default");
            userCounts[userKey] = Number(userCounts[userKey] || 0) + 1;
            cloned += 1;
          }
          if (items.length < pageSize) break;
          page += 1;
        }
      }

      return {
        ok: true,
        scanned,
        cloned,
        source_backend: sourceBackend,
        users: userCounts,
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
      const aid = String(accountId || "").trim();
      const uid = safeUserId(userId || "default");
      const safeLimit = Math.max(1, Math.min(100, Number(maxItems) || 1));
      const leaseSec = Math.max(5, Math.min(300, Number(leaseSeconds) || 30));
      const now = new Date(options.now || Date.now());
      const nowIso = now.toISOString();
      const taskFilter = String(taskTypeFilter || "").trim().toUpperCase();

      const rows = (await listAllTradesRaw())
        .filter((row) => {
          if (safeUserId(row.user_id) !== uid) return false;
          if (
            String(row.account_id || "").trim() !== aid &&
            String(row.account_id || "").trim() !== ""
          ) {
            return false;
          }
          const exec = String(row.execution_status || "").toUpperCase();
          const dispatch = String(row.dispatch_status || "").toUpperCase();
          const leaseExpired =
            dispatch === "LEASED" &&
            row.lease_expires_at &&
            Date.parse(row.lease_expires_at) < now.getTime();
          const validExec =
            ["PENDING", "FILLED"].includes(exec) ||
            (["CANCEL", "CLOSE"].includes(dispatch) &&
              ["CANCELLED", "CLOSED"].includes(exec));
          const validDispatch =
            ["OPEN", "NEW", "MODIFY", "CLOSE", "CANCEL"].includes(dispatch) ||
            leaseExpired;
          return validExec && validDispatch;
        })
        .sort(sortByTradePriority);

      const selected = [];
      for (const row of rows) {
        if (selected.length >= safeLimit) break;
        const taskType = syncGuards.brokerTaskTypeForTrade(row);
        if (taskFilter && taskType !== taskFilter) continue;

        const staleNew = syncGuards.isNewTradeTooOld(
          row,
          Number(options.maxAgeHours || 0),
          now,
        );
        if (staleNew) {
          await updateTradePatch(
            row,
            {
              dispatch_status: "REJECTED",
              execution_status: "REJECTED",
              rejection_reason: row.rejection_reason || "stale broker pull task",
              metadata: {
                ...objectValue(row.metadata, {}),
                stale_pull_rejected_at: nowIso,
                stale_pull_max_age_hours: Number(options.maxAgeHours || 0),
              },
              updated_at: nowIso,
            },
            {
              entryType: "trade.auto_reject",
              reason: "stale_broker_pull_task",
            },
          );
          continue;
        }

        const retryCount = syncGuards.nextLeaseRetryCount(row, now);
        const hasBroker = Boolean(String(row.broker_trade_id || "").trim());
        if (
          syncGuards.shouldAutoRejectLeasedTrade(
            row,
            Number(options.maxLeaseRetries || 3),
            now,
            Number(options.maxAgeHours || 0),
          ) &&
          !hasBroker
        ) {
          await updateTradePatch(
            row,
            {
              dispatch_status: hasBroker ? "CANCEL" : "REJECTED",
              execution_status: hasBroker ? "CANCELLED" : "REJECTED",
              rejection_reason:
                row.rejection_reason || "broker ack lease retry limit exceeded",
              metadata: {
                ...objectValue(row.metadata, {}),
                stale_pull_rejected_at: nowIso,
                stale_pull_max_age_hours: Number(options.maxAgeHours || 0),
              },
              updated_at: nowIso,
            },
            {
              entryType: "trade.auto_reject",
              reason: "broker_ack_lease_retry_limit_exceeded",
            },
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
        const currentDispatch = String(row.dispatch_status || "").trim().toUpperCase();
        const currentLeasedDispatch =
          currentDispatch === "LEASED"
            ? String(row.metadata?.leased_dispatch_status || "").toUpperCase()
            : currentDispatch;
        const nextMetadata = {
          ...objectValue(row.metadata, {}),
          lease_retry_count: retryCount,
          leased_dispatch_status: syncGuards.brokerTaskTypeForTrade({
            dispatch_status: currentLeasedDispatch,
          }),
        };
        const leased = await updateTradePatch(
          row,
          {
            account_id: String(row.account_id || "").trim() || aid || null,
            dispatch_status: "LEASED",
            lease_token: leaseToken,
            lease_expires_at: leaseExpiresAt,
            metadata: nextMetadata,
            updated_at: nowIso,
          },
          {
            entryType: "trade.task_leased",
            reason: "broker_pull",
          },
        );
        selected.push(leased);
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
        (await loadTradeBySid(text(payload.sid || payload.trade_id))) || null;
      if (!currentRow) return { ok: false, error: "trade not found" };
      const leaseToken = String(payload.lease_token || "").trim();
      const currentDispatch = String(currentRow.dispatch_status || "").toUpperCase();
      const ackStateApplied = isAckStateAlreadyApplied(currentRow, payload);
      if (
        currentDispatch === "CONSUMED" &&
        ackStateApplied &&
        !currentRow.lease_token &&
        !currentRow.lease_expires_at
      ) {
        return {
          ok: true,
          duplicate: true,
          dispatch_status: currentRow.dispatch_status,
          execution_status: currentRow.execution_status,
          item: currentRow,
        };
      }

      if (
        !ackStateApplied &&
        (currentDispatch !== "LEASED" ||
          !accountMatchesTrade(currentRow, accountId) ||
          String(currentRow.lease_token || "") !== leaseToken)
      ) {
        return { ok: false, error: "stale or mismatched lease token" };
      }

      const next = buildAckUpdate(currentRow, accountId, payload, options);
      const updated = await updateTradePatch(
        currentRow,
        {
          account_id:
            String(currentRow.account_id || "").trim() ||
            String(accountId || "").trim() ||
            null,
          ...next,
          updated_at: next.updated_at,
        },
        {
          entryType: ackStateApplied ? "trade.ack_duplicate" : "trade.ack",
          reason: ackStateApplied ? "duplicate_ack" : "broker_ack",
        },
      );
      return {
        ok: true,
        duplicate: ackStateApplied,
        dispatch_status: updated.dispatch_status,
        execution_status: updated.execution_status,
        item: updated,
      };
    },

    async brokerSyncTrades(userId, accountId, items = [], options = {}) {
      const aid = String(accountId || "").trim();
      const uid = safeUserId(userId || "default");
      const nowIso = toIso(options.now || new Date());
      const allTrades = (await listAllTradesRaw()).filter(
        (row) =>
          safeUserId(row.user_id) === uid &&
          accountMatchesTrade(row, aid),
      );
      const bySid = new Map(allTrades.map((row) => [String(row.sid || ""), row]));
      const byTicket = new Map(
        allTrades
          .filter((row) => String(row.broker_trade_id || "").trim())
          .map((row) => [String(row.broker_trade_id || "").trim(), row]),
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
        const meta = objectValue(row.metadata, {});
        const rowData = {
          sid: row.sid,
          broker_trade_id: row.broker_trade_id,
          execution_status: row.execution_status,
          dispatch_status: row.dispatch_status,
          rejection_reason: row.rejection_reason,
          sl: row.sl,
          tp: row.tp,
          pnl: row.broker_pnl,
          metadata: row.metadata,
          has_partial: String(meta.has_partial || "false"),
          last_broker_snapshot_hash: String(meta.last_broker_snapshot_hash || ""),
        };
        oldStatusMap.set(row.sid, rowData);
        if (row.broker_trade_id) {
          oldTicketMap.set(String(row.broker_trade_id), rowData);
        }
      }

      const results = [];
      let matched = 0;
      let synced = 0;
      const seenTickets = new Set();
      const closedRows = [];

      for (const it of Array.isArray(items) ? items : []) {
        const trustedSidCandidates = [
          normalizeBrokerIdentitySid(it.sid),
          normalizeBrokerIdentitySid(it.comment),
          normalizeBrokerIdentitySid(it.trade_id),
          normalizeBrokerIdentitySid(it.signal_id),
        ].filter(Boolean);
        const identityCandidates = [
          ...trustedSidCandidates,
        ].filter(Boolean);
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
          identityCandidates.map((value) => oldStatusMap.get(String(value))).find(Boolean) ||
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
          normalizeBrokerIdentitySid(it.note),
          normalizeBrokerIdentitySid(it.comment),
          normalizeBrokerIdentitySid(it.trade_id),
          normalizeBrokerIdentitySid(it.signal_id),
          normalizeBrokerIdentitySid(it.sid),
        ]
          .filter(Boolean)
          .map((value) => value.toUpperCase());
        const existing =
          identityCandidates.map((value) => bySid.get(String(value))).find(Boolean) ||
          noteCandidates.map((value) => byNote.get(value)).find(Boolean) ||
          ticketCandidates.map((ticket) => byTicket.get(ticket)).find(Boolean) ||
          null;

      const syncMeta = {
          order_type: normalizeOrderTypeValue(it.order_type) || null,
          broker_order_type: normalizeOrderTypeValue(it.order_type) || null,
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
          const preservedOrderType = resolveCanonicalStoredOrderType(
            existing,
            existing.order_type || it.order_type || "",
          );
          const nextExecutionStatus = String(it.execution_status || "")
            .trim()
            .toUpperCase();
          const nextOrderType =
            preservedOrderType ||
            normalizeOrderTypeValue(it.order_type) ||
            existing.order_type ||
            null;
          const shouldSyncPendingEntry =
            nextExecutionStatus === "PENDING" &&
            nextOrderType !== "market" &&
            Number.isFinite(Number(it.entry));
          const consumeLease =
            clearRejectedDispatch ||
            String(existing.dispatch_status || "").toUpperCase() === "LEASED";
          const nextDispatchStatus = consumeLease
            ? "CONSUMED"
            : existing.dispatch_status;
          const nextMetadata = mergeBrokerSyncMetadata(existing.metadata, {
            ...syncMeta,
            order_type: preservedOrderType || null,
          });
          const updated = await updateTradePatch(
            existing,
            {
              execution_status: nextExecutionStatus,
              dispatch_status: nextDispatchStatus,
              broker_trade_id: ticketCandidates[0] || existing.broker_trade_id || null,
              pnl_realized: isTerminalExecutionStatus(nextExecutionStatus)
                ? Number(it.pnl ?? existing.pnl_realized ?? 0)
                : existing.pnl_realized,
              broker_pnl: Number(it.pnl ?? existing.broker_pnl ?? 0),
              volume: Number(it.volume ?? existing.volume ?? 0),
              broker_pips: Number(it.pips ?? existing.broker_pips ?? 0),
              broker_lots: Number(it.lots ?? existing.broker_lots ?? 0),
              broker_commission: Number(
                it.commission ?? existing.broker_commission ?? 0,
              ),
              broker_swap: Number(it.swap ?? existing.broker_swap ?? 0),
              broker_volume: Number(
                it.broker_volume ?? existing.broker_volume ?? 0,
              ),
              broker_margin: Number(it.margin ?? existing.broker_margin ?? 0),
              broker_tp_pnl: it.tp_pnl ?? existing.broker_tp_pnl ?? null,
              broker_sl_pnl: it.sl_pnl ?? existing.broker_sl_pnl ?? null,
              entry: shouldSyncPendingEntry
                ? Number(it.entry)
                : existing.entry ?? null,
              entry_exec: it.entry ?? existing.entry_exec ?? null,
              order_type: nextOrderType,
              close_reason: isTerminalExecutionStatus(nextExecutionStatus)
                ? it.close_reason || existing.close_reason || null
                : null,
              rejection_reason: clearRejectedDispatch
                ? null
                : existing.rejection_reason,
              note: existing.note || it.note || null,
              metadata: nextMetadata,
              opened_at: resolvePersistedOpenedAt(it, existing, nowIso),
              closed_at: isTerminalExecutionStatus(nextExecutionStatus)
                ? it.closed_at || existing.closed_at || nowIso
                : null,
              lease_token: consumeLease ? null : existing.lease_token,
              lease_expires_at: consumeLease ? null : existing.lease_expires_at,
              sl: it.sl ?? existing.sl ?? null,
              tp: it.tp ?? existing.tp ?? null,
              tp1: it.tp1 ?? existing.tp1 ?? null,
              tp2: it.tp2 ?? existing.tp2 ?? null,
              tp3: it.tp3 ?? existing.tp3 ?? null,
              updated_at: nowIso,
            },
            {
              entryType: "trade.sync_update",
              reason: "broker_sync",
            },
          );
          bySid.set(updated.sid, updated);
          if (updated.broker_trade_id) {
            byTicket.set(String(updated.broker_trade_id), updated);
          }
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

        if (
          !["FILLED", "PENDING"].includes(
            String(it.execution_status || "").toUpperCase(),
          )
        ) {
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
            reason: `duplicate_broker_ticket_${duplicate.execution_status}`,
          });
          continue;
        }

        const discoverySid = String(
          identityCandidates[0] ||
            (ticketCandidates[0]
              ? `M_${ticketCandidates[0]}`
              : (options.generateSid && options.generateSid()) ||
                `M_${Date.now()}`),
        ).trim();
        const created = await upsertTradeRow(
          {
            sid: discoverySid,
            account_id: aid,
            user_id: uid,
            trade_id: String(it.trade_id || it.signal_id || discoverySid).trim(),
            signal_id: String(it.signal_id || it.trade_id || discoverySid).trim(),
            symbol: syncSymbol,
            action: syncAction,
            strategy:
              String(
                it.strategy ||
                  it.strategy_name ||
                  it.metadata?.strategy ||
                  it.raw_json?.strategy ||
                  options.sourceId ||
                  "BROKER",
              ).trim() || null,
            entry_model:
              String(
                it.entry_model ||
                  it.entryModel ||
                  it.metadata?.entry_model ||
                  it.raw_json?.entry_model ||
                  "",
              ).trim() || null,
            order_type: it.order_type || null,
            volume: Number(it.lots ?? it.volume ?? 0),
            entry: it.entry || 0,
            sl: it.sl ?? null,
            tp: it.tp ?? null,
            tp1: it.tp1 ?? null,
            tp2: it.tp2 ?? null,
            tp3: it.tp3 ?? null,
            note: it.note || "",
            execution_status: String(it.execution_status || "PENDING").toUpperCase(),
            dispatch_status: "CONSUMED",
            source_id: options.sourceId || "BROKER",
            metadata: mergeBrokerSyncMetadata({}, syncMeta),
            broker_trade_id: ticketCandidates[0] || "",
            broker_pips: Number(it.pips ?? 0),
            broker_lots: Number(it.lots ?? 0),
            broker_commission: Number(it.commission ?? 0),
            broker_swap: Number(it.swap ?? 0),
            broker_volume: Number(it.broker_volume ?? 0),
            broker_pnl: Number(it.pnl ?? 0),
            broker_margin: Number(it.margin ?? 0),
            planned_tp_pnl: options.resolvePlannedTpPnl
              ? options.resolvePlannedTpPnl(it)
              : null,
            planned_sl_pnl: options.resolvePlannedSlPnl
              ? options.resolvePlannedSlPnl(it)
              : null,
            broker_tp_pnl: it.tp_pnl ?? null,
            broker_sl_pnl: it.sl_pnl ?? null,
            opened_at: resolvePersistedOpenedAt(it, null, nowIso),
            created_at: nowIso,
            updated_at: nowIso,
          },
          {
            entryType: "trade.sync_create",
            reason: "broker_sync_discovery",
          },
        );
        bySid.set(created.sid, created);
        if (created.broker_trade_id) {
          byTicket.set(String(created.broker_trade_id), created);
        }
        if (String(created.note || "").trim()) {
          byNote.set(String(created.note || "").trim().toUpperCase(), created);
        }
        matched += 1;
        synced += 1;
        results.push({
          ticket: it.ticket,
          sid: discoverySid,
          suggested_sid: discoverySid,
          status: "Added",
          symbol: it.symbol,
          action: it.action,
        });
      }

      if (options.snapshotComplete) {
        const accountTrades = Array.from(bySid.values());
        const toClose = accountTrades.filter((row) => {
          const exec = String(row.execution_status || "").toUpperCase();
          if (!["FILLED", "PENDING"].includes(exec)) return false;
          if (seenTickets.size > 0) {
            const ticket = String(row.broker_trade_id || "").trim();
            return ticket && !seenTickets.has(ticket);
          }
          return true;
        });
        for (const row of toClose) {
          const nextExecution =
            String(row.execution_status || "").toUpperCase() === "PENDING"
              ? "CANCELLED"
              : "CLOSED";
          const nextCloseReason =
            row.close_reason ||
            (nextExecution === "CANCELLED" ? "CANCEL" : "MANUAL");
          const updatedRow = await updateTradePatch(
            row,
            {
              execution_status: nextExecution,
              close_reason: nextCloseReason,
              closed_at: row.closed_at || nowIso,
              updated_at: nowIso,
            },
            {
              entryType: "trade.sync_close",
              reason: "snapshot_missing_ticket",
            },
          );
          bySid.set(updatedRow.sid, updatedRow);
          if (updatedRow.broker_trade_id) {
            byTicket.set(String(updatedRow.broker_trade_id), updatedRow);
          }
          if (String(updatedRow.note || "").trim()) {
            byNote.set(
              String(updatedRow.note || "").trim().toUpperCase(),
              updatedRow,
            );
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
        const newStatus = latest.execution_status;
        const oldEntry = Number.isFinite(Number(oldRow.entry)) ? Number(oldRow.entry) : null;
        const newEntry = Number.isFinite(Number(latest.entry)) ? Number(latest.entry) : null;
        const oldSl = Number.isFinite(Number(oldRow.sl)) ? Number(oldRow.sl) : null;
        const newSl = latest.sl ?? null;
        const oldTp = Number.isFinite(Number(oldRow.tp)) ? Number(oldRow.tp) : null;
        const newTp = latest.tp ?? null;
        const oldHasPartial =
          oldRow.has_partial === "true" || oldRow.has_partial === true;
        const newHasPartial = Boolean(latest.metadata?.has_partial);
        const statusChanged = !oldStatus || oldStatus !== newStatus;
        const entryChanged =
          oldEntry !== null && newEntry !== null && Math.abs(oldEntry - newEntry) > 0.000001;
        const slChanged =
          oldSl !== null && newSl !== null && Math.abs(oldSl - newSl) > 0.000001;
        const tpChanged =
          oldTp !== null && newTp !== null && Math.abs(oldTp - newTp) > 0.000001;
        const partialChanged = oldHasPartial !== newHasPartial;
        if (statusChanged || entryChanged || slChanged || tpChanged || partialChanged) {
          tradeUpdates.push({
            sid,
            symbol: latest.symbol,
            pnl_realized: latest.pnl_realized,
            broker_pnl: latest.broker_pnl,
            broker_pips: latest.broker_pips,
            execution_status: latest.execution_status,
            entry: newEntry,
            entry_before: oldEntry,
            sl: newSl,
            sl_before: oldSl,
            tp: newTp,
            tp_before: oldTp,
            has_partial: newHasPartial,
            partial_before: oldHasPartial,
            rejection_reason: latest.rejection_reason || null,
          });
        }
      }
      for (const row of closedRows) {
        const oldRow =
          oldStatusMap.get(row.sid) ||
          (row.broker_trade_id
            ? oldTicketMap.get(String(row.broker_trade_id))
            : null) ||
          {};
        if (
          oldRow.execution_status === row.execution_status &&
          String(oldRow.rejection_reason || "") ===
            String(row.rejection_reason || "")
        ) {
          continue;
        }
        tradeUpdates.push({
          sid: row.sid,
          symbol: row.symbol,
          pnl_realized: row.pnl_realized,
          broker_pnl: row.broker_pnl,
          broker_pips: row.broker_pips,
          execution_status: row.execution_status,
          sl: row.sl ?? null,
          sl_before: Number.isFinite(Number(oldRow.sl)) ? Number(oldRow.sl) : null,
          tp: row.tp ?? null,
          tp_before: Number.isFinite(Number(oldRow.tp)) ? Number(oldRow.tp) : null,
          has_partial: Boolean(row.metadata?.has_partial),
          partial_before:
            oldRow.has_partial === "true" || oldRow.has_partial === true,
          rejection_reason: row.rejection_reason || null,
        });
      }

      return {
        ok: true,
        results,
        matched,
        synced,
        seenTickets: [...seenTickets],
        tradeUpdates,
        closedRows,
      };
    },
  };
}

module.exports = {
  TRADES_SCOPE,
  TRADE_ENTITY_TYPE,
  SOURCE_SYSTEM,
  createTradesRepo,
  normalizeStoredTrade,
  tradeFromEntity,
  listLegacySqliteTradeUserIds,
};
