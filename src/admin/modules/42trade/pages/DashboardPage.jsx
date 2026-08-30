import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../../app/api";
import { isAuthRedirectError } from "../../../shared/utils/authPolicy.js";
import { showToast } from "../../../shared/components/ToastContainer";
import { showDateTime } from "../../../shared/utils/format";
import {
  asMoney,
  asMoneySigned,
  asPct,
  asRR,
  moneyClass,
} from "../../../shared/utils/numberFormat";
import CronRunLauncher from "../components/CronRunLauncher";
import ComboButtonMenu from "../../../shared/components/ComboButtonMenu";
import GroupButtons from "../../../shared/components/GroupButtons";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import { StatusDisplay } from "../../../shared/components/StatusBadge";

const RANGE_OPTIONS = [
  { val: "all", lab: "ALL TIMES" },
  { val: "today", lab: "Today" },
  { val: "yesterday", lab: "Yesterday" },
  { val: "last_week", lab: "Last week" },
  { val: "last_month", lab: "Last month" },
  { val: "week", lab: "This Week" },
  { val: "month", lab: "This Month" },
  { val: "year", lab: "This Year" },
];
const SIDE_OPTIONS = [
  { val: "", lab: "ALL SIDES" },
  { val: "BUY", lab: "BUY" },
  { val: "SELL", lab: "SELL" },
];
const PNL_STATE_OPTIONS = [
  { val: "", lab: "WIN / LOSE" },
  { val: "win", lab: "PNL > 0" },
  { val: "lose", lab: "PNL < 0" },
];
function getDashboardAutoRefreshMs() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return 10000;
    const raw = Number(
      window.localStorage.getItem("tvbridge_refresh_ms") || 10000,
    );
    return Number.isFinite(raw) && raw > 0 ? raw : 10000;
  } catch {
    return 10000;
  }
}

const AUTO_REFRESH_MS = getDashboardAutoRefreshMs();

const PERIOD_DISPLAY = [
  { key: "filled_open", lab: "Now" },
  { key: "today", lab: "Today" },
  { key: "week", lab: "This Week" },
  { key: "month", lab: "This Month" },
  { key: "year", lab: "This Year" },
  { key: "all", lab: "All times" },
];

const DASHBOARD_CALENDAR_CACHE_KEY = "tvbridge_dashboard_calendar_master_v1";

function formatStaleAge(staleMs) {
  if (!Number.isFinite(staleMs) || staleMs < 0) return "never";
  const seconds = Math.floor(staleMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function brokerActivityTone(activity = {}) {
  if (activity?.status === "DISCONNECTED") return "ERROR";
  if (activity?.status === "CONNECTED") return "ONLINE";
  return "WARNING";
}

function trades2Text(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function trades2PnlValue(row = {}) {
  const value = Number(row?.broker_pnl ?? row?.pnl_realized);
  return Number.isFinite(value) ? value : null;
}

function trades2CanonicalStatus(row = {}) {
  const raw = trades2Text(row?.execution_status || row?.status).toUpperCase();
  const closeReason = trades2Text(row?.close_reason).toUpperCase();
  if (["TP", "SL"].includes(raw)) return raw;
  if (["PLACED", "OPEN", "ACTIVE", "EXECUTED", "START", "FILLED"].includes(raw)) {
    return "FILLED";
  }
  if (["NEW", "LOCKED", "SUBMITTED", "PENDING"].includes(raw)) return "PENDING";
  if (["CANCEL", "CANCELLED", "EXPIRED"].includes(raw)) return "CANCELLED";
  if (["FAIL", "FAILED", "ERROR", "REJECTED"].includes(raw)) return "REJECTED";
  if (raw === "CLOSED") {
    if (closeReason === "TP" || closeReason === "SL") return closeReason;
    return "CLOSED";
  }
  return raw;
}

function trades2TimestampMs(row = {}) {
  const value = row?.closed_at || row?.opened_at || row?.updated_at || row?.created_at;
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : NaN;
}

function trades2LocalPeriodRange(period = "all") {
  const now = new Date();
  const end = now.toISOString();
  if (period === "all") return { start: null, end: null };
  if (period === "today") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
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
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
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

function filterTrades2RowsByPeriod(rows = [], { start = null, end = null } = {}) {
  const fromMs = start ? Date.parse(String(start)) : NaN;
  const toMs = end ? Date.parse(String(end)) : NaN;
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const rowMs = trades2TimestampMs(row);
    if (Number.isFinite(fromMs) && (!Number.isFinite(rowMs) || rowMs < fromMs)) {
      return false;
    }
    if (Number.isFinite(toMs) && (!Number.isFinite(rowMs) || rowMs > toMs)) {
      return false;
    }
    return true;
  });
}

function trades2ClosedRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const status = trades2CanonicalStatus(row);
    const closeReason = trades2Text(row?.close_reason).toUpperCase();
    const pnl = trades2PnlValue(row);
    return (
      ["CLOSED", "TP", "SL"].includes(status) ||
      closeReason === "TP" ||
      closeReason === "SL" ||
      (status === "CANCELLED" && pnl !== null)
    );
  });
}

function trades2SourceIdFromRow(row = {}) {
  const raw = row?.raw_json || {};
  return trades2Text(row?.source_id || raw?.source_id || row?.source || raw?.source);
}

function trades2StrategyLabelFromRow(row = {}) {
  const raw = row?.raw_json || {};
  return trades2Text(row?.strategy || raw?.strategy);
}

function trades2EntryModelLabelFromRow(row = {}) {
  const raw = row?.raw_json || {};
  const firstPlan = Array.isArray(raw?.trade_plan)
    ? raw.trade_plan[0] || {}
    : raw?.trade_plan && typeof raw.trade_plan === "object"
      ? raw.trade_plan
      : {};
  const metadataPlan =
    row?.metadata?.trade_plan && typeof row.metadata.trade_plan === "object"
      ? row.metadata.trade_plan
      : {};
  const candidate = trades2Text(
    firstPlan?.entry_model ||
      metadataPlan?.entry_model ||
      raw?.entry_model ||
      raw?.entryModel ||
      row?.entry_model,
  );
  return /^ai[_-]/i.test(candidate) ? "" : candidate;
}

function trades2OrderTypeFromRow(row = {}) {
  const raw = row?.raw_json || {};
  const metadata = row?.metadata || {};
  const firstPlan = Array.isArray(raw?.trade_plan)
    ? raw.trade_plan[0] || {}
    : raw?.trade_plan && typeof raw.trade_plan === "object"
      ? raw.trade_plan
      : {};
  const orderTypeRaw = trades2Text(
    row?.order_type ||
      metadata?.order_type ||
      raw?.order_type ||
      raw?.orderType ||
      firstPlan?.order_type,
    "LIMIT",
  ).toLowerCase();
  if (orderTypeRaw.includes("market")) return "market";
  if (orderTypeRaw.includes("stop")) return "stop";
  return "limit";
}

function computeTrades2Metrics(rows = []) {
  const all = Array.isArray(rows) ? rows : [];
  const countPending = all.filter((row) => trades2CanonicalStatus(row) === "PENDING").length;
  const countFilled = all.filter((row) => trades2CanonicalStatus(row) === "FILLED").length;
  const countClosed = all.filter((row) =>
    ["CLOSED", "TP", "SL"].includes(trades2CanonicalStatus(row)),
  ).length;
  const countCancelled = all.filter(
    (row) => trades2CanonicalStatus(row) === "CANCELLED",
  ).length;
  const closedRows = trades2ClosedRows(all);
  let wins = 0;
  let losses = 0;
  let totalPnl = 0;
  let winSumPnl = 0;
  let loseSumPnl = 0;
  for (const row of closedRows) {
    const status = trades2CanonicalStatus(row);
    const closeReason = trades2Text(row?.close_reason).toUpperCase();
    const pnl = trades2PnlValue(row);
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
  const filledRows = all.filter((row) => trades2CanonicalStatus(row) === "FILLED");
  const filledOpenPnl = filledRows.reduce((sum, row) => {
    const pnl = trades2PnlValue(row);
    return pnl !== null ? sum + pnl : sum;
  }, 0);
  const filledOpenWinSumPnl = filledRows.reduce((sum, row) => {
    const pnl = trades2PnlValue(row);
    return pnl !== null && pnl > 0 ? sum + pnl : sum;
  }, 0);
  const filledOpenLoseSumPnl = filledRows.reduce((sum, row) => {
    const pnl = trades2PnlValue(row);
    return pnl !== null && pnl < 0 ? sum + pnl : sum;
  }, 0);
  const filledOpenPlannedTpPnl = filledRows.reduce((sum, row) => {
    const pnl = Number(row?.broker_tp_pnl ?? row?.planned_tp_pnl ?? 0);
    return Number.isFinite(pnl) ? sum + pnl : sum;
  }, 0);
  const filledOpenPlannedSlPnl = filledRows.reduce((sum, row) => {
    const pnl = Number(row?.broker_sl_pnl ?? row?.planned_sl_pnl ?? 0);
    return Number.isFinite(pnl) ? sum + pnl : sum;
  }, 0);
  const filledOpenWins = filledRows.filter((row) => {
    const pnl = trades2PnlValue(row);
    return pnl !== null && pnl > 0;
  }).length;
  const filledOpenLosses = filledRows.filter((row) => {
    const pnl = trades2PnlValue(row);
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

function computeTrades2TopRows(rows = [], keyPicker, { limit = 100 } = {}) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const baseKey = trades2Text(keyPicker(row));
    if (!baseKey) continue;
    const status = trades2CanonicalStatus(row);
    const closeReason = trades2Text(row?.close_reason).toUpperCase();
    const pnl = trades2PnlValue(row);
    if (!map.has(baseKey)) {
      map.set(baseKey, {
        key: baseKey,
        name: baseKey,
        direction: trades2Text(row?.action).toUpperCase() || "BUY",
        wins: 0,
        losses: 0,
        trades: 0,
        pnl_total: 0,
        rr_total: 0,
        rr_sum: 0,
        rr_count: 0,
      });
    }
    const entry = map.get(baseKey);
    if (
      status === "CLOSED" ||
      status === "TP" ||
      status === "SL" ||
      closeReason === "TP" ||
      closeReason === "SL"
    ) {
      entry.trades += 1;
      if (status === "TP" || closeReason === "TP") entry.wins += 1;
      else if (status === "SL" || closeReason === "SL") entry.losses += 1;
      else if (pnl !== null && pnl > 0) entry.wins += 1;
      else if (pnl !== null && pnl < 0) entry.losses += 1;
      if (pnl !== null) entry.pnl_total += pnl;
    }
  }
  return [...map.values()]
    .map((entry) => {
      const decided = entry.wins + entry.losses;
      return {
        ...entry,
        win_rate: decided > 0 ? (entry.wins / decided) * 100 : 0,
      };
    })
    .filter(
      (entry) =>
        Math.abs(entry.pnl_total) > 0.001 ||
        entry.win_rate > 0 ||
        entry.wins > 0 ||
        entry.losses > 0,
    )
    .sort(
      (a, b) =>
        b.win_rate - a.win_rate ||
        b.trades - a.trades ||
        (a.key < b.key ? -1 : 1),
    )
    .slice(0, limit);
}

async function loadTrades2DashboardFromList(apiClient, filters = {}) {
  const baseParams = {
    account_id: filters.account_id || "",
    symbol: filters.symbol || "",
    source: filters.source || "",
    entry_model: filters.entry_model || "",
    action: filters.direction || "",
    pnl_state: filters.pnl_state || "",
    chart_tf: filters.chart_tf || "",
    trade_tf: filters.trade_tf || "",
    pageSize: 200,
  };
  let page = 1;
  let totalPages = 1;
  const allRows = [];
  while (page <= totalPages && allRows.length < 100000) {
    const out = await apiClient.v2Trades2({ ...baseParams, page });
    const items = Array.isArray(out?.items) ? out.items : [];
    allRows.push(...items);
    totalPages = Math.max(1, Number(out?.pages || 1));
    if (!items.length) break;
    page += 1;
  }

  const range = trades2Text(filters.range, "all").toLowerCase();
  const selectedRows = filterTrades2RowsByPeriod(
    allRows,
    trades2LocalPeriodRange(range),
  );
  const periodKeys = [
    "all",
    "today",
    "yesterday",
    "last_week",
    "last_month",
    "week",
    "month",
    "year",
  ];
  const periodTotals = Object.fromEntries(
    periodKeys.map((key) => {
      const metrics = computeTrades2Metrics(
        filterTrades2RowsByPeriod(allRows, trades2LocalPeriodRange(key)),
      );
      return [
        key,
        {
          total_pnl: metrics.total_pnl,
          total_rr: metrics.total_rr,
          total_trades: metrics.total_trades,
          total_wins: metrics.wins,
          total_losses: metrics.losses,
          win_sum_pnl: metrics.win_sum_pnl,
          lose_sum_pnl: metrics.lose_sum_pnl,
        },
      ];
    }),
  );

  const seriesBucket = range === "today" ? "hour" : "day";
  const seriesMap = new Map();
  for (const row of selectedRows) {
    const status = trades2CanonicalStatus(row);
    const pnl = trades2PnlValue(row);
    if (
      !["CLOSED", "TP", "SL"].includes(status) &&
      !(status === "CANCELLED" && pnl !== null)
    ) {
      continue;
    }
    if (pnl === null) continue;
    const date = new Date(
      row?.closed_at || row?.opened_at || row?.updated_at || row?.created_at,
    );
    if (!Number.isFinite(date.getTime())) continue;
    const key =
      seriesBucket === "hour"
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:00`
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    seriesMap.set(key, (seriesMap.get(key) || 0) + pnl);
  }

  return {
    ok: true,
    accounts_summary: [...new Set(allRows.map((row) => trades2Text(row?.account_id)).filter(Boolean))]
      .sort()
      .map((accountId) => ({ account_id: accountId, name: accountId })),
    filters: {
      user_id: trades2Text(allRows[0]?.user_id, "default"),
      symbol: trades2Text(filters.symbol).toUpperCase(),
      source: trades2Text(filters.source),
      entry_model: trades2Text(filters.entry_model),
      chart_tf: trades2Text(filters.chart_tf),
      trade_tf: trades2Text(filters.trade_tf),
      direction: trades2Text(filters.direction).toUpperCase(),
      pnl_state: trades2Text(filters.pnl_state).toLowerCase(),
      range,
      accounts: [...new Set(allRows.map((row) => trades2Text(row?.account_id)).filter(Boolean))].sort(),
      symbols: [...new Set(allRows.map((row) => trades2Text(row?.symbol).toUpperCase()).filter(Boolean))].sort(),
      sources: [...new Set(allRows.map((row) => trades2SourceIdFromRow(row)).filter(Boolean))].sort(),
      strategies: [...new Set(allRows.map((row) => trades2StrategyLabelFromRow(row)).filter(Boolean))].sort(),
      entry_models: [...new Set(allRows.map((row) => trades2EntryModelLabelFromRow(row)).filter(Boolean))].sort(),
      chart_tfs: [
        ...new Set(
          allRows
            .map((row) =>
              trades2Text(
                row?.chart_tf ||
                  row?.raw_json?.chart_tf ||
                  row?.raw_json?.chartTf ||
                  row?.trade_tf ||
                  row?.raw_json?.trade_tf ||
                  row?.raw_json?.sourceTf ||
                  row?.raw_json?.timeframe,
              ),
            )
            .filter(Boolean),
        ),
      ].sort(),
      trade_tfs: [
        ...new Set(
          allRows
            .map((row) =>
              trades2Text(
                row?.trade_tf ||
                  row?.raw_json?.trade_tf ||
                  row?.raw_json?.sourceTf ||
                  row?.raw_json?.timeframe,
              ),
            )
            .filter(Boolean),
        ),
      ].sort(),
    },
    metrics: computeTrades2Metrics(selectedRows),
    period_totals: periodTotals,
    top_winrate: {
      symbols: computeTrades2TopRows(selectedRows, (row) =>
        trades2Text(row?.symbol).toUpperCase(),
      ),
      entry_models: computeTrades2TopRows(selectedRows, (row) =>
        trades2EntryModelLabelFromRow(row),
      ),
      strategies: computeTrades2TopRows(selectedRows, (row) =>
        trades2StrategyLabelFromRow(row),
      ),
      accounts: computeTrades2TopRows(selectedRows, (row) =>
        trades2Text(row?.account_id),
      ),
      sources: computeTrades2TopRows(selectedRows, (row) =>
        trades2SourceIdFromRow(row),
      ),
      directional: computeTrades2TopRows(selectedRows, (row) => {
        const dir = trades2Text(row?.action || row?.side, "BUY").toLowerCase();
        const typeRaw = trades2OrderTypeFromRow(row);
        const capitalize = (value) =>
          value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
        return `${capitalize(dir)} ${capitalize(typeRaw)}`;
      }),
    },
    pnl_series: [...seriesMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([x, y]) => ({ x, y })),
  };
}

function normalizeDateKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.slice(0, 10);
}

function buildDailyPnlMap(points = []) {
  const map = {};
  for (const item of Array.isArray(points) ? points : []) {
    const d = normalizeDateKey(item?.x || item?.date || item?.day);
    if (!d) continue;
    const pnl = Number(item?.y ?? item?.pnl ?? item?.pnl_money ?? 0);
    if (!Number.isFinite(pnl)) continue;
    map[d] = { date: d, pnl };
  }
  return map;
}

function mergeDailyPnlMap(base = {}, incoming = {}) {
  const incomingKeys = Object.keys(incoming || {});
  // If incoming is empty, discard stale cache.
  if (!incomingKeys.length) return {};
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(incoming || {})) {
    const d = normalizeDateKey(k);
    if (!d) continue;
    const pnl = Number(v?.pnl ?? v?.pnl_money ?? 0);
    if (!Number.isFinite(pnl)) continue;
    out[d] = { date: d, pnl };
  }
  return out;
}

function loadCalendarCache() {
  try {
    const raw = sessionStorage.getItem(DASHBOARD_CALENDAR_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveCalendarCache(cache = {}) {
  try {
    sessionStorage.setItem(
      DASHBOARD_CALENDAR_CACHE_KEY,
      JSON.stringify(cache || {}),
    );
  } catch {
    // ignore storage quota/runtime issues
  }
}

function calendarScopeKey(filters = {}, userId = "") {
  return JSON.stringify({
    user_id: String(userId || ""),
    account_id: String(filters?.account_id || ""),
    symbol: String(filters?.symbol || "").toUpperCase(),
    source: String(filters?.source || ""),
    entry_model: String(filters?.entry_model || ""),
    direction: String(filters?.direction || "").toUpperCase(),
    pnl_state: String(filters?.pnl_state || "").toLowerCase(),
    chart_tf: String(filters?.chart_tf || ""),
    trade_tf: String(filters?.trade_tf || filters?.signal_tf || ""),
  });
}

function toDateKeyLocal(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sumCalendarPnlInRange(calendarData, startDate, endDate) {
  if (!calendarData || !startDate || !endDate) return 0;
  let sum = 0;
  const cur = new Date(startDate);
  while (cur <= endDate) {
    const key = toDateKeyLocal(cur);
    const pnl = Number(calendarData[key]?.pnl || 0);
    if (Number.isFinite(pnl)) sum += pnl;
    cur.setDate(cur.getDate() + 1);
  }
  return sum;
}

function shiftMonthCursor(year, month, delta) {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

function compareMonthCursor(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function monthCursorFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return { year: date.getFullYear(), month: date.getMonth() };
}

function clampMonthCursor(cursor, minCursor, maxCursor) {
  let next = cursor;
  if (minCursor && compareMonthCursor(next, minCursor) < 0) next = minCursor;
  if (maxCursor && compareMonthCursor(next, maxCursor) > 0) next = maxCursor;
  return next;
}

function getCalendarDataBounds(calendarData) {
  const keys = Object.keys(calendarData || {}).sort();
  if (!keys.length) return null;
  const first = new Date(`${keys[0]}T00:00:00`);
  const last = new Date(`${keys[keys.length - 1]}T00:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()))
    return null;
  return {
    minDate: first,
    maxDate: last,
    minCursor: monthCursorFromDate(first),
    maxCursor: monthCursorFromDate(last),
  };
}

function getDashboardChartWindow(unit, endYear, endMonth) {
  const safeUnit = String(unit || "day").toLowerCase();
  if (safeUnit === "week") {
    return {
      start: new Date(endYear, 0, 1),
      end: new Date(endYear, 11, 31),
      stepMonths: 12,
    };
  }
  if (safeUnit === "month") {
    return {
      start: new Date(endYear - 3, 0, 1),
      end: new Date(endYear, 11, 31),
      stepMonths: 12,
    };
  }
  if (safeUnit === "year") {
    return {
      start: new Date(endYear - 20, 0, 1),
      end: new Date(endYear, 11, 31),
      stepMonths: 240,
    };
  }
  return {
    start: new Date(endYear, endMonth - 1, 1),
    end: new Date(endYear, endMonth + 1, 0),
    stepMonths: 2,
  };
}

function formatDashboardChartWindowLabel(unit, start, end) {
  const safeUnit = String(unit || "day").toLowerCase();
  if (safeUnit === "week") {
    return `${start.getFullYear()} — ${end.getFullYear()}`;
  }
  if (safeUnit === "month") {
    return `${start.getFullYear()} — ${end.getFullYear()}`;
  }
  if (safeUnit === "year") {
    return `${start.getFullYear()} — ${end.getFullYear()}`;
  }
  return `${formatMonthShort(start)} ${start.getFullYear()} — ${formatMonthShort(new Date(end.getFullYear(), end.getMonth(), 1))} ${end.getFullYear()}`;
}

function startOfWeekLocal(date) {
  const next = new Date(date);
  const offset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - offset);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatMonthShort(date) {
  return date.toLocaleString("default", { month: "short" });
}

function formatMonthYearShort(date) {
  return `${formatMonthShort(date)} ${String(date.getFullYear()).slice(-2)}`;
}

function buildDashboardPnlBuckets(calendarData, unit, endYear, endMonth) {
  const { start, end } = getDashboardChartWindow(unit, endYear, endMonth);
  const buckets = [];
  const sumRange = (rangeStart, rangeEnd) =>
    sumCalendarPnlInRange(calendarData, rangeStart, rangeEnd);
  const spansMultipleYears = start.getFullYear() !== end.getFullYear();

  if (unit === "week") {
    let cursor = startOfWeekLocal(start);
    while (cursor <= end) {
      const bucketStart = new Date(cursor);
      const bucketEnd = new Date(cursor);
      bucketEnd.setDate(bucketEnd.getDate() + 6);
      const clampedStart = bucketStart < start ? new Date(start) : bucketStart;
      const clampedEnd = bucketEnd > end ? new Date(end) : bucketEnd;
      const pnl = sumRange(clampedStart, clampedEnd);
      buckets.push({
        key: `${toDateKeyLocal(bucketStart)}_week`,
        label: spansMultipleYears
          ? `${String(clampedStart.getDate()).padStart(2, "0")} ${formatMonthYearShort(clampedStart)}`
          : `${String(clampedStart.getDate()).padStart(2, "0")} ${formatMonthShort(clampedStart)}`,
        title: `${toDateKeyLocal(clampedStart)} → ${toDateKeyLocal(clampedEnd)}`,
        pnl,
        hasPnl: pnl !== 0,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
    return buckets;
  }

  if (unit === "month") {
    let bucketStart = new Date(start.getFullYear(), start.getMonth(), 1);
    while (bucketStart <= end) {
      const bucketEnd = new Date(
        bucketStart.getFullYear(),
        bucketStart.getMonth() + 1,
        0,
      );
      const clampedStart = bucketStart < start ? new Date(start) : bucketStart;
      const clampedEnd = bucketEnd > end ? new Date(end) : bucketEnd;
      const pnl = sumRange(clampedStart, clampedEnd);
      buckets.push({
        key: `${bucketStart.getFullYear()}-${bucketStart.getMonth()}_month`,
        label: spansMultipleYears
          ? formatMonthYearShort(bucketStart)
          : formatMonthShort(bucketStart),
        title: `${formatMonthShort(bucketStart)} ${bucketStart.getFullYear()}`,
        pnl,
        hasPnl: pnl !== 0,
      });
      bucketStart = new Date(
        bucketStart.getFullYear(),
        bucketStart.getMonth() + 1,
        1,
      );
    }
    return buckets;
  }

  if (unit === "year") {
    for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
      const bucketStart = new Date(year, 0, 1);
      const bucketEnd = new Date(year, 11, 31);
      const clampedStart = bucketStart < start ? new Date(start) : bucketStart;
      const clampedEnd = bucketEnd > end ? new Date(end) : bucketEnd;
      const pnl = sumRange(clampedStart, clampedEnd);
      buckets.push({
        key: `${year}_year`,
        label: String(year),
        title: String(year),
        pnl,
        hasPnl: pnl !== 0,
      });
    }
    return buckets;
  }

  const cursor = new Date(start);
  while (cursor <= end) {
    const dateStr = toDateKeyLocal(cursor);
    const item = calendarData ? calendarData[dateStr] : null;
    const pnl = item ? Number(item.pnl || item.pnl_money || 0) : 0;
    buckets.push({
      key: dateStr,
      label: String(cursor.getDate()).padStart(2, "0"),
      title: dateStr,
      date: dateStr,
      pnl: Number.isFinite(pnl) ? pnl : 0,
      hasPnl: item != null && Number.isFinite(pnl) && pnl !== 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}

function TableBlock({
  title,
  rows,
  noun = "ITEMS",
  nameFormatter = null,
  onRowClick = null,
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [sortKey, setSortKey] = useState("WR");
  const [sortDir, setSortDir] = useState("DESC");

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortKey(key);
      setSortDir("DESC");
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    let va, vb;
    if (sortKey === "Name") {
      va = String(a.key);
      vb = String(b.key);
    } else if (sortKey === "WR") {
      va = a.win_rate;
      vb = b.win_rate;
    } else if (sortKey === "PnL") {
      va = a.pnl_total;
      vb = b.pnl_total;
    } else return 0;

    if (va === vb) return 0;
    const res = va > vb ? 1 : -1;
    return sortDir === "DESC" ? -res : res;
  });

  const sortMarker = (key) => {
    if (sortKey !== key) return null;
    return sortDir === "ASC" ? " ↑" : " ↓";
  };

  return (
    <ResponsivePanel
      title={`${rows.length} ${String(noun || "items").toLowerCase()}`}
      className="fadeIn"
      open={isOpen}
      onOpenChange={setIsOpen}
      collapseDirection="top-down"
      bodyClassName="stack-layout"
      border="always"
    >
      {rows.length === 0 ? (
        <div className="minor-text">No data.</div>
      ) : (
        <div className="mini-table">
          <div
            className="mini-table-head wide"
            style={{
              borderBottom: "1px solid var(--border)",
              paddingBottom: "8px",
              marginBottom: "8px",
              background: "transparent",
              display: "flex",
              gap: "12px",
            }}
          >
            <span
              onClick={() => toggleSort("Name")}
              style={{
                flex: "2.5",
                fontSize: "10px",
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              NAME{sortMarker("Name")}
            </span>
            <span
              onClick={() => toggleSort("WR")}
              style={{
                flex: "1.8",
                textAlign: "right",
                fontSize: "10px",
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              WR% (W/L){sortMarker("WR")}
            </span>
            <span
              onClick={() => toggleSort("PnL")}
              style={{
                flex: "1.5",
                textAlign: "right",
                fontSize: "10px",
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              PNL{sortMarker("PnL")}
            </span>
            <span
              onClick={() => toggleSort("RR")}
              style={{
                flex: "1",
                textAlign: "right",
                fontSize: "10px",
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              RR{sortMarker("RR")}
            </span>
          </div>
          {sortedRows.map((r) => (
            <div
              className="mini-table-row wide"
              key={r.key}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                gap: "12px",
                alignItems: "center",
                cursor: onRowClick ? "pointer" : "default",
              }}
            >
              <span
                className="mini-name"
                style={{
                  flex: "2.5",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={r.key}
              >
                {nameFormatter ? nameFormatter(r.key, r) : r.key}
              </span>
              <span
                style={{
                  flex: "1.8",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                <span>{asPct(r.win_rate)}</span>
                <span
                  className="minor-text"
                  style={{ fontSize: "10px", marginLeft: "4px" }}
                >
                  <span>{r.wins}</span>
                  <span className="minor-text">/</span>
                  <span>{r.losses}</span>
                </span>
              </span>
              <span
                style={{ flex: "1.5", textAlign: "right" }}
                className={moneyClass(r.pnl_total)}
              >
                {asMoneySigned(r.pnl_total)}
              </span>
              <span
                style={{
                  flex: "1",
                  textAlign: "right",
                  fontSize: "10px",
                }}
              >
                {asRR(r.rr_total)}
              </span>
            </div>
          ))}
        </div>
      )}
    </ResponsivePanel>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isTrades2Route = location.pathname.startsWith("/trades2");
  const tradeRouteBase = isTrades2Route ? "/trades2" : "/trades";
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState([]);
  const [error, setError] = useState("");
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [selectedCronName, setSelectedCronName] = useState("");
  const [runCronLoading, setRunCronLoading] = useState(false);
  const [isFiltersPanelOpen, setIsFiltersPanelOpen] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    new Date().getMonth(),
  );
  const [calendarYear, setCalendarYear] = useState(() =>
    new Date().getFullYear(),
  );
  const [chartUnit, setChartUnit] = useState("day");
  const [chartEndMonth, setChartEndMonth] = useState(() =>
    new Date().getMonth(),
  );
  const [chartEndYear, setChartEndYear] = useState(() =>
    new Date().getFullYear(),
  );
  const [calendarData, setCalendarData] = useState(null);
  const [brokerAccounts, setBrokerAccounts] = useState([]);
  const [filters, setFilters] = useState({
    account_id: "",
    symbol: "",
    source: "",
    entry_model: "",
    direction: "",
    pnl_state: "",
    chart_tf: "",
    trade_tf: "",
    range: "all",
  });
  const inFlightRef = useRef(false);
  const calendarMasterRef = useRef(loadCalendarCache());
  const initialLoadKeyRef = useRef("");
  const settingsLoadStartedRef = useRef(false);

  async function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [resp, accountsResp] = await Promise.all([
        isTrades2Route
          ? loadTrades2DashboardFromList(api, filters)
          : api.dashboardAdvanced(filters),
        api.v2Accounts().catch(() => ({ items: [] })),
      ]);
      setData(resp);
      setBrokerAccounts(Array.isArray(accountsResp?.items) ? accountsResp.items : []);
      const userKey = calendarScopeKey(filters, resp?.filters?.user_id || "");
      const dailyMap = buildDailyPnlMap(resp?.pnl_series || []);
      const merged = mergeDailyPnlMap(
        calendarMasterRef.current?.[userKey] || {},
        dailyMap,
      );
      calendarMasterRef.current = {
        ...(calendarMasterRef.current || {}),
        [userKey]: merged,
      };
      saveCalendarCache(calendarMasterRef.current);
      setCalendarData(merged);
      setError("");
      setLastRefreshAt(new Date());
    } catch (e) {
      if (isAuthRedirectError(e)) return;
      setError(e?.message || "Failed to load dashboard");
    } finally {
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    const nextKey = JSON.stringify(filters);
    if (initialLoadKeyRef.current === nextKey) return;
    initialLoadKeyRef.current = nextKey;
    load();
  }, [
    isTrades2Route,
    filters.account_id,
    filters.symbol,
    filters.source,
    filters.entry_model,
    filters.direction,
    filters.pnl_state,
    filters.chart_tf,
    filters.trade_tf,
    filters.range,
  ]);

  useEffect(() => {
    const t = setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      )
        return;
      load();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [
    isTrades2Route,
    filters.account_id,
    filters.symbol,
    filters.source,
    filters.entry_model,
    filters.direction,
    filters.pnl_state,
    filters.chart_tf,
    filters.trade_tf,
    filters.range,
  ]);

  useEffect(() => {
    if (settingsLoadStartedRef.current) return;
    settingsLoadStartedRef.current = true;
    let cancelled = false;
    async function loadSettings() {
      try {
        const res = await api.getSettings();
        if (cancelled) return;
        setSettings(Array.isArray(res?.settings) ? res.settings : []);
      } catch {}
    }
    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const cronSettings = useMemo(
    () => settings.filter((s) => s?.type === "cron"),
    [settings],
  );

  useEffect(() => {
    if (!selectedCronName && cronSettings.length > 0) {
      setSelectedCronName(cronSettings[0].name || "");
    }
  }, [cronSettings, selectedCronName]);

  const calendarBounds = getCalendarDataBounds(calendarData);
  const calendarMinCurrentCursor = calendarBounds?.minCursor
    ? shiftMonthCursor(
        calendarBounds.minCursor.year,
        calendarBounds.minCursor.month,
        1,
      )
    : null;
  const chartMinEndCursor = calendarBounds?.minCursor
    ? shiftMonthCursor(
        calendarBounds.minCursor.year,
        calendarBounds.minCursor.month,
        Math.max(
          getDashboardChartWindow(chartUnit, chartEndYear, chartEndMonth)
            .stepMonths - 1,
          0,
        ),
      )
    : null;
  const chartMaxEndCursor = calendarBounds?.maxCursor || null;

  useEffect(() => {
    if (!calendarBounds?.maxCursor) return;
    const nextCalendar = clampMonthCursor(
      { year: calendarYear, month: calendarMonth },
      calendarMinCurrentCursor || calendarBounds.maxCursor,
      calendarBounds.maxCursor,
    );
    if (
      nextCalendar.year !== calendarYear ||
      nextCalendar.month !== calendarMonth
    ) {
      setCalendarYear(nextCalendar.year);
      setCalendarMonth(nextCalendar.month);
    }
  }, [
    calendarBounds?.maxCursor?.year,
    calendarBounds?.maxCursor?.month,
    calendarMinCurrentCursor?.year,
    calendarMinCurrentCursor?.month,
    calendarYear,
    calendarMonth,
  ]);

  useEffect(() => {
    if (!calendarBounds?.maxCursor) return;
    const nextChart = clampMonthCursor(
      { year: chartEndYear, month: chartEndMonth },
      chartMinEndCursor || calendarBounds.maxCursor,
      chartMaxEndCursor || calendarBounds.maxCursor,
    );
    if (nextChart.year !== chartEndYear || nextChart.month !== chartEndMonth) {
      setChartEndYear(nextChart.year);
      setChartEndMonth(nextChart.month);
    }
  }, [
    calendarBounds?.maxCursor?.year,
    calendarBounds?.maxCursor?.month,
    chartMinEndCursor?.year,
    chartMinEndCursor?.month,
    chartMaxEndCursor?.year,
    chartMaxEndCursor?.month,
    chartEndYear,
    chartEndMonth,
  ]);

  async function handleRunCron(cronNameOverride = "") {
    const cronName = String(cronNameOverride || selectedCronName || "").trim();
    if (!cronName) return;
    setRunCronLoading(true);
    try {
      await api.runCron(cronName);
      await load();
    } catch (e) {
      if (isAuthRedirectError(e)) return;
      setError(e?.message || "Failed to execute cron");
    } finally {
      setRunCronLoading(false);
    }
  }

  const brokerSyncAccounts = useMemo(
    () =>
      [...(Array.isArray(brokerAccounts) ? brokerAccounts : [])]
        .filter(
          (account) =>
            String(account?.status || "").toUpperCase() !== "ARCHIVED" &&
            account?.broker_activity?.trackable !== false,
        )
        .map((account) => ({
          ...account,
          brokerActivity: account?.broker_activity || {},
        }))
        .sort((left, right) => {
          const leftConnected = left?.brokerActivity?.disconnected ? 0 : 1;
          const rightConnected = right?.brokerActivity?.disconnected ? 0 : 1;
          if (leftConnected !== rightConnected) {
            return rightConnected - leftConnected;
          }
          const leftStale = Number(left?.brokerActivity?.stale_ms || 0);
          const rightStale = Number(right?.brokerActivity?.stale_ms || 0);
          return leftConnected ? leftStale - rightStale : rightStale - leftStale;
        }),
    [brokerAccounts],
  );

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Loading dashboard...</div>;

  const m = data.metrics || {};
  const periodTotals = data.period_totals || {};
  const top = data.top_winrate || {
    symbols: [],
    directional: [],
    sources: [],
    entry_models: [],
    strategies: [],
  };
  const f = data.filters || {};
  const accountRows = Array.isArray(data.accounts_summary)
    ? data.accounts_summary
    : [];
  const accountNameById = new Map(
    accountRows.map((a) => [
      String(a.account_id || ""),
      String(a.name || a.account_id || ""),
    ]),
  );
  const chartBuckets = buildDashboardPnlBuckets(
    calendarData,
    chartUnit,
    chartEndYear,
    chartEndMonth,
  );
  const calendarCurrentCursor = { year: calendarYear, month: calendarMonth };
  const canCalendarGoPrev = calendarMinCurrentCursor
    ? compareMonthCursor(calendarCurrentCursor, calendarMinCurrentCursor) > 0
    : false;
  const canCalendarGoNext = calendarBounds?.maxCursor
    ? compareMonthCursor(calendarCurrentCursor, calendarBounds.maxCursor) < 0
    : false;
  const {
    start: chartWindowStart,
    end: chartWindowEnd,
    stepMonths,
  } = getDashboardChartWindow(chartUnit, chartEndYear, chartEndMonth);
  const chartWindowLabel = formatDashboardChartWindowLabel(
    chartUnit,
    chartWindowStart,
    chartWindowEnd,
  );
  const chartMaxPnl = chartBuckets.reduce(
    (m, x) => Math.max(m, Number(x?.pnl || 0)),
    0,
  );
  const chartMinPnl = chartBuckets.reduce(
    (m, x) => Math.min(m, Number(x?.pnl || 0)),
    0,
  );
  const chartAveragePnl =
    chartBuckets.length > 0
      ? chartBuckets.reduce((acc, x) => acc + Number(x?.pnl || 0), 0) /
        chartBuckets.length
      : 0;
  const chartTotalPnl = chartBuckets.reduce(
    (acc, x) => acc + Number(x?.pnl || 0),
    0,
  );
  const roundUpNiceUnit = (v) => {
    const n = Math.max(1, Number(v) || 1);
    const p = 10 ** Math.floor(Math.log10(n));
    const m = n / p;
    const base = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return base * p;
  };
  const yAxisStep = roundUpNiceUnit(
    Math.max(1, Math.max(chartMaxPnl, Math.abs(chartMinPnl)) / 5),
  );
  const yAxisPosMax = chartMaxPnl > 0 ? yAxisStep * 5 : 0;
  const yAxisNegMin = chartMinPnl < 0 ? -(yAxisStep * 5) : 0;
  const yAxisPosScale = yAxisPosMax > 0 ? yAxisPosMax : 1;
  const yAxisNegScale = yAxisNegMin < 0 ? Math.abs(yAxisNegMin) : 1;
  const yAxisPosSteps = Array.from({ length: 5 }, (_, i) =>
    Math.round(yAxisStep * (i + 1)),
  ).filter((v) => v > 0);
  const yAxisNegSteps = Array.from({ length: 5 }, (_, i) =>
    Math.round(yAxisStep * (i + 1)),
  ).filter((v) => v > 0);
  const chartSummaryItems = [
    {
      label: "High",
      value: chartMaxPnl,
    },
    {
      label: "Low",
      value: chartMinPnl,
    },
    {
      label: "Average",
      value: chartAveragePnl,
    },
    {
      label: "Total",
      value: chartTotalPnl,
    },
  ];
  const chartEndCursor = { year: chartEndYear, month: chartEndMonth };
  const canChartGoPrev = chartMinEndCursor
    ? compareMonthCursor(chartEndCursor, chartMinEndCursor) > 0
    : false;
  const canChartGoNext = chartMaxEndCursor
    ? compareMonthCursor(chartEndCursor, chartMaxEndCursor) < 0
    : false;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - ((todayStart.getDay() + 6) % 7));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const displayPeriodTotals = {
    ...periodTotals,
    today: {
      ...(periodTotals.today || {}),
      total_pnl: sumCalendarPnlInRange(calendarData, todayStart, todayStart),
    },
    week: {
      ...(periodTotals.week || {}),
      total_pnl: sumCalendarPnlInRange(calendarData, weekStart, todayStart),
    },
    month: {
      ...(periodTotals.month || {}),
      total_pnl: sumCalendarPnlInRange(calendarData, monthStart, todayStart),
    },
  };

  const buildTradeSearch = (extra = {}) => {
    const params = new URLSearchParams();
    const merged = {
      account_id: filters.account_id || "",
      symbol: filters.symbol || "",
      source: filters.source || "",
      entry_model: filters.entry_model || "",
      direction: filters.direction || "",
      pnl_state: filters.pnl_state || "",
      chart_tf: filters.chart_tf || "",
      range: filters.range || "",
      ...extra,
    };
    Object.entries(merged).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const safe = String(value).trim();
      if (!safe || safe.toLowerCase() === "all") return;
      params.set(key, safe);
    });
    return params.toString();
  };

  const goTrades = ({ status = "closed", ...extra } = {}) => {
    const qs = buildTradeSearch(extra);
    navigate(
      `${tradeRouteBase}/${String(status).toLowerCase()}${qs ? `?${qs}` : ""}`,
    );
  };

  const periodCardClick = (key) => {
    if (key === "filled_open") {
      goTrades({ status: "filled", range: undefined, time: undefined });
      return;
    }
    goTrades({ status: "closed", time: key, range: undefined });
  };

  return (
    <section className="stack-layout fadeIn">
      <PageHeader
        title={isTrades2Route ? "Trades2 Dashboard" : "Trade Dashboard"}
        actions={
          <CronRunLauncher
            value={selectedCronName}
            onChange={setSelectedCronName}
            onRun={handleRunCron}
            options={cronSettings.map((cron) => ({
              value: cron.name,
              label: cron.name,
            }))}
            disabled={cronSettings.length === 0}
            loading={runCronLoading}
            selectAriaLabel="Dashboard cron selector"
            getConfirmOptions={(cronName) => ({
              title: "Run cron?",
              message: `Run cron "${cronName}" now?`,
              confirmLabel: "Run",
              tone: "danger",
            })}
          />
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 18,
          alignItems: "start",
        }}
        className="dashboard-main-grid"
      >
        <div className="stack-layout" style={{ gap: 18 }}>
          {brokerSyncAccounts.length > 0 ? (
            <div className="panel card-dense dashboard-broker-grid">
              {brokerSyncAccounts.map((account) => {
                  const activity = account?.brokerActivity || {};
                  const status = activity?.status || "UNKNOWN";
                  const source = activity?.last_sync_source || "";
                  const age = activity?.last_sync_at
                    ? formatStaleAge(activity?.stale_ms)
                    : "";
                  return (
                    <div
                      key={account.account_id}
                      className="dashboard-broker-cell"
                      title={[status, source, age].filter(Boolean).join(" · ")}
                    >
                      <StatusDisplay
                        status={brokerActivityTone(activity)}
                        tooltipContent={[status, source, age]
                          .filter(Boolean)
                          .join(" · ")}
                      />
                      <span className="dashboard-broker-cell__name">
                        {account.name || account.account_id}
                      </span>
                      {age ? (
                        <span className="dashboard-broker-cell__age">{age}</span>
                      ) : null}
                    </div>
                  );
                })}
            </div>
          ) : null}

          <div className="toolbar-panel dashboard-overview-toolbar">
            <div
              className="toolbar-group dashboard-summary-highlights"
              style={{
                display: "flex",
                gap: "20px",
                alignItems: "center",
                flexWrap: "nowrap",
                minWidth: 0,
                flex: "0 0 auto",
              }}
            >
              <div
                className="summary-item"
                onClick={() => goTrades({ status: "filled", time: undefined })}
                style={{ cursor: "pointer" }}
                title="Open filled trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  POSITIONS
                </span>
                <div style={{ fontSize: "16px" }}>{m.count_filled || 0}</div>
              </div>
              <div
                className="summary-item"
                onClick={() => goTrades({ status: "pending", time: undefined })}
                style={{ cursor: "pointer" }}
                title="Open pending trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  ORDERS
                </span>
                <div style={{ fontSize: "16px" }}>{m.count_pending || 0}</div>
              </div>
              <div
                className="summary-item"
                onClick={() =>
                  goTrades({ status: "closed", time: filters.range || "all" })
                }
                style={{ cursor: "pointer" }}
                title="Open closed trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  CLOSED
                </span>
                <div style={{ fontSize: "16px" }}>{m.count_closed || 0}</div>
              </div>
              <div
                className="summary-item"
                onClick={() =>
                  goTrades({ status: "closed", time: filters.range || "all" })
                }
                style={{ cursor: "pointer" }}
                title="Open closed trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  W/L
                </span>
                <div style={{ fontSize: "16px" }}>
                  {m.wins || 0} <span className="minor-text"> / </span>{" "}
                  {m.losses || 0}
                </div>
              </div>
            </div>

            <ResponsivePanel
              title="Filters"
              className="dashboard-filters-panel"
              headerMode="mobile"
              border="mobile"
              showToggle
              open={isFiltersPanelOpen}
              onOpenChange={setIsFiltersPanelOpen}
              style={{ flex: "1 1 0", minWidth: 0 }}
            >
              <div
                className="dashboard-filter-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                  gap: "12px",
                  width: "100%",
                  justifyContent: "stretch",
                  marginLeft: 0,
                  alignItems: "end",
                  minWidth: 0,
                  flex: "1 1 auto",
                }}
              >
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    ACCOUNT
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-account"
                    value={filters.account_id}
                    buttonText={
                      filters.account_id
                        ? accountNameById.get(String(filters.account_id)) ||
                          String(filters.account_id)
                        : "ALL ACCOUNTS"
                    }
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        account_id: nextValue,
                      }))
                    }
                    items={[
                      { value: "", label: "ALL ACCOUNTS" },
                      ...(f.accounts || []).map((v) => ({
                        value: String(v),
                        label: accountNameById.get(String(v)) || String(v),
                      })),
                    ]}
                    ariaLabel="Filter by account"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    SYMBOL
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-symbol"
                    value={filters.symbol}
                    buttonText={filters.symbol || "ALL SYMBOLS"}
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        symbol: nextValue,
                      }))
                    }
                    items={[
                      { value: "", label: "ALL SYMBOLS" },
                      ...(f.symbols || []).map((v) => ({
                        value: String(v),
                        label: String(v),
                      })),
                    ]}
                    ariaLabel="Filter by symbol"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    SOURCE
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-source"
                    value={filters.source}
                    buttonText={filters.source || "ALL SOURCES"}
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        source: nextValue,
                      }))
                    }
                    items={[
                      { value: "", label: "ALL SOURCES" },
                      ...(f.sources || []).map((v) => ({
                        value: String(v),
                        label: String(v),
                      })),
                    ]}
                    ariaLabel="Filter by source"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    MODEL
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-model"
                    value={filters.entry_model}
                    buttonText={filters.entry_model || "ALL MODELS"}
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        entry_model: nextValue,
                      }))
                    }
                    items={[
                      { value: "", label: "ALL MODELS" },
                      ...(f.entry_models || []).map((v) => ({
                        value: String(v),
                        label: String(v),
                      })),
                    ]}
                    ariaLabel="Filter by model"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    SIDE
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-side"
                    value={filters.direction}
                    buttonText={
                      SIDE_OPTIONS.find(
                        (option) => option.val === filters.direction,
                      )?.lab || "ALL SIDES"
                    }
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        direction: nextValue,
                      }))
                    }
                    items={SIDE_OPTIONS.map((option) => ({
                      value: String(option.val ?? ""),
                      label: option.lab,
                    }))}
                    ariaLabel="Filter by side"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    WIN / LOSE
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-pnl-state"
                    value={filters.pnl_state}
                    buttonText={
                      PNL_STATE_OPTIONS.find(
                        (option) => option.val === filters.pnl_state,
                      )?.lab || "WIN / LOSE"
                    }
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        pnl_state: String(nextValue || "").toLowerCase(),
                      }))
                    }
                    items={PNL_STATE_OPTIONS.map((option) => ({
                      value: String(option.val ?? ""),
                      label: option.lab,
                    }))}
                    ariaLabel="Filter by win or lose"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field dashboard-filter-field--wide-mobile">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    RANGE
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-range"
                    value={filters.range}
                    buttonText={
                      RANGE_OPTIONS.find(
                        (option) => option.val === filters.range,
                      )?.lab || "ALL TIMES"
                    }
                    onChange={(nextValue) =>
                      setFilters((prev) => ({ ...prev, range: nextValue }))
                    }
                    items={RANGE_OPTIONS.map((option) => ({
                      value: String(option.val ?? ""),
                      label: option.lab,
                    }))}
                    ariaLabel="Filter by range"
                    fullWidth
                  />
                </div>
              </div>
            </ResponsivePanel>
          </div>

          <div
            className="period-box-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "16px",
            }}
          >
            {PERIOD_DISPLAY.map((conf) => {
              const isFilledOpen = conf.key === "filled_open";
              const v = isFilledOpen
                ? {
                    total_pnl: m.filled_open_pnl || 0,
                    total_trades: m.count_filled || 0,
                    total_wins: m.filled_open_wins || 0,
                    total_losses: m.filled_open_losses || 0,
                    win_sum_pnl: m.filled_open_win_sum_pnl || 0,
                    lose_sum_pnl: m.filled_open_lose_sum_pnl || 0,
                    planned_tp_pnl: m.filled_open_planned_tp_pnl || 0,
                    planned_sl_pnl: m.filled_open_planned_sl_pnl || 0,
                  }
                : displayPeriodTotals[conf.key] || {};
              const winrate =
                v.total_wins + v.total_losses > 0
                  ? (v.total_wins / (v.total_wins + v.total_losses)) * 100
                  : 0;
              return (
                <article
                  className="kpi-card"
                  key={conf.key}
                  onClick={() => periodCardClick(conf.key)}
                  style={{ cursor: "pointer" }}
                  title={`Open ${conf.lab} trades`}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: "8px",
                    }}
                  >
                    <div className="panel-label" style={{ marginBottom: 0 }}>
                      {conf.lab.toUpperCase()}
                    </div>
                    <div
                      className="minor-text"
                      style={{
                        fontSize: "10px",
                        whiteSpace: "nowrap",
                        opacity: 0.9,
                        textAlign: "right",
                      }}
                    >
                      t: {v.total_trades || 0} | {v.total_wins || 0}{" "}
                      <span className="minor-text"> / </span>{" "}
                      {v.total_losses || 0}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: "4px",
                      height: 1,
                    }}
                  />
                  <div className="period-big-line">
                    <span
                      className={`kpi-value ${moneyClass(v.total_pnl)}`}
                      style={{ fontSize: "24px" }}
                    >
                      {asMoneySigned(v.total_pnl || 0)}
                    </span>
                  </div>
                  <div
                    className="minor-text"
                    style={{
                      marginTop: "2px",
                      fontSize: "10px",
                      whiteSpace: "nowrap",
                      opacity: 0.78,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {isFilledOpen ? (
                      <>
                        <span className="money-pos">
                          {asMoneySigned(v.planned_tp_pnl || 0)}
                        </span>
                        <span>|</span>
                        <span className="money-neg">
                          {asMoneySigned(v.planned_sl_pnl || 0)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="money-pos">
                          {asMoneySigned(v.win_sum_pnl || 0)}
                        </span>
                        <span>|</span>
                        <span className="money-neg">
                          {asMoneySigned(v.lose_sum_pnl || 0)}
                        </span>
                        <span>|</span>
                        <span>{asPct(winrate)}</span>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {/* Calendar + Daily PnL chart */}
          <div
            className="dashboard-calendar-layout"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(420px, 1.2fr) minmax(320px, 1fr)",
              gap: 16,
              alignItems: "stretch",
            }}
          >
            {/* Monthly PnL Calendar */}
            <div
              className="panel fadeIn dashboard-calendar-panel"
              style={{ padding: 12 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!canCalendarGoPrev}
                  onClick={() => {
                    if (!canCalendarGoPrev) return;
                    const next = shiftMonthCursor(
                      calendarYear,
                      calendarMonth,
                      -1,
                    );
                    setCalendarMonth(next.month);
                    setCalendarYear(next.year);
                  }}
                >
                  ◀
                </button>
                <span style={{ fontSize: 12 }}>
                  {(() => {
                    const pm = calendarMonth === 0 ? 11 : calendarMonth - 1;
                    const py =
                      calendarMonth === 0 ? calendarYear - 1 : calendarYear;
                    return `${new Date(py, pm).toLocaleString("default", { month: "short" })} — ${new Date(calendarYear, calendarMonth).toLocaleString("default", { month: "short", year: "numeric" })}`;
                  })()}
                </span>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!canCalendarGoNext}
                  onClick={() => {
                    if (!canCalendarGoNext) return;
                    const next = shiftMonthCursor(
                      calendarYear,
                      calendarMonth,
                      1,
                    );
                    setCalendarMonth(next.month);
                    setCalendarYear(next.year);
                  }}
                >
                  ▶
                </button>
              </div>
              {(() => {
                const prevMonth = calendarMonth === 0 ? 11 : calendarMonth - 1;
                const prevYear =
                  calendarMonth === 0 ? calendarYear - 1 : calendarYear;
                const renderGrid = (month, year, label) => {
                  const todayLocal = new Date();
                  todayLocal.setHours(0, 0, 0, 0);
                  const firstDay = new Date(year, month, 1).getDay();
                  const dim = new Date(year, month + 1, 0).getDate();
                  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
                  const cells = [];
                  for (let i = 0; i < firstDay; i++)
                    cells.push(<span key={"e" + i} />);
                  for (let d = 1; d <= dim; d++) {
                    const dateStr = `${prefix}${String(d).padStart(2, "0")}`;
                    const cellDate = new Date(`${dateStr}T00:00:00`);
                    const isPastDay = cellDate < todayLocal;
                    const item = calendarData ? calendarData[dateStr] : null;
                    const pnl = item
                      ? Number(item.pnl || item.pnl_money || 0)
                      : null;
                    cells.push(
                      <div
                        key={d}
                        onClick={
                          pnl != null
                            ? () =>
                                goTrades({
                                  status: "closed",
                                  time: dateStr,
                                  range: undefined,
                                })
                            : undefined
                        }
                        style={{
                          padding: "4px 2px 6px",
                          borderRadius: 5,
                          fontSize: 9,
                          border:
                            pnl != null
                              ? pnl > 0
                                ? "1px solid rgba(16,185,129,0.35)"
                                : pnl < 0
                                  ? "1px solid rgba(239,68,68,0.35)"
                                  : "1px solid rgba(148,163,184,0.25)"
                              : "1px solid transparent",
                          background:
                            pnl != null
                              ? pnl > 0
                                ? "linear-gradient(180deg, rgba(16,185,129,0.16), rgba(16,185,129,0.09))"
                                : pnl < 0
                                  ? "linear-gradient(180deg, rgba(239,68,68,0.16), rgba(239,68,68,0.09))"
                                  : "rgba(148,163,184,0.10)"
                              : "transparent",
                          minHeight: 34,
                          cursor: pnl != null ? "pointer" : "default",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                        title={
                          pnl != null
                            ? `${dateStr}: $${pnl.toFixed(2)}`
                            : dateStr
                        }
                      >
                        <div
                          className={isPastDay ? "time-past" : "time-current"}
                          style={{
                            fontSize: 9,
                            color: isPastDay
                              ? "rgba(148,163,184,0.62)"
                              : pnl != null
                                ? "var(--text)"
                                : "var(--muted)",
                          }}
                        >
                          {d}
                        </div>
                        {pnl != null && (
                          <div
                            className={`${pnl > 0 ? "money-pos" : "money-neg"} ${isPastDay ? "time-past" : "time-current"}`}
                            style={{
                              fontSize: 9,
                              letterSpacing: "0.1px",
                            }}
                          >
                            {pnl > 0 ? "+" : ""}
                            {pnl.toFixed(2)}
                          </div>
                        )}
                      </div>,
                    );
                  }
                  return (
                    <div key={label}>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--muted)",
                          marginBottom: 3,
                          fontWeight: 600,
                        }}
                      >
                        {new Date(year, month).toLocaleString("default", {
                          month: "long",
                          year: "numeric",
                        })}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(7, 1fr)",
                          gap: 1,
                          textAlign: "center",
                          fontSize: 9,
                        }}
                      >
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(
                          (day) => (
                            <span
                              key={day}
                              style={{
                                color: "var(--muted)",
                                padding: "1px 0",
                              }}
                            >
                              {day}
                            </span>
                          ),
                        )}
                        {cells}
                      </div>
                    </div>
                  );
                };
                return (
                  <div
                    className="dashboard-calendar-months"
                    style={{ display: "flex", gap: 16 }}
                  >
                    <div style={{ flex: 1 }}>
                      {renderGrid(prevMonth, prevYear, "prev")}
                    </div>
                    <div style={{ flex: 1 }}>
                      {renderGrid(calendarMonth, calendarYear, "curr")}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Last ~2 months PnL bar chart */}
            <div
              className="panel fadeIn dashboard-chart-panel"
              style={{ padding: 12 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  marginBottom: 10,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                    flex: "1 1 360px",
                  }}
                >
                  {chartSummaryItems.map((item) => (
                    <div
                      key={item.label}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <div
                        className="panel-label"
                        style={{ margin: 0, fontSize: 10 }}
                      >
                        {item.label}
                      </div>
                      <div
                        className={moneyClass(item.value)}
                        style={{ fontSize: 12, lineHeight: 1.2 }}
                      >
                        {item.value > 0 ? "+" : ""}
                        {asMoney(item.value)}
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  }}
                >
                  <GroupButtons
                    items={[
                      {
                        label: "Day",
                        value: "day",
                        selected: chartUnit === "day",
                      },
                      {
                        label: "Week",
                        value: "week",
                        selected: chartUnit === "week",
                      },
                      {
                        label: "Month",
                        value: "month",
                        selected: chartUnit === "month",
                      },
                      {
                        label: "Year",
                        value: "year",
                        selected: chartUnit === "year",
                      },
                    ]}
                    selectedItems={[chartUnit]}
                    onChange={(next) => setChartUnit(next?.[0] || "day")}
                    selectionMode="single"
                    border_type="multiple"
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!canChartGoPrev}
                    onClick={() => {
                      if (!canChartGoPrev) return;
                      const next = shiftMonthCursor(
                        chartEndYear,
                        chartEndMonth,
                        -stepMonths,
                      );
                      setChartEndYear(next.year);
                      setChartEndMonth(next.month);
                    }}
                  >
                    ◀
                  </button>
                  <div className="minor-text" style={{ minWidth: 150 }}>
                    {chartWindowLabel}
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!canChartGoNext}
                    onClick={() => {
                      if (!canChartGoNext) return;
                      const next = shiftMonthCursor(
                        chartEndYear,
                        chartEndMonth,
                        stepMonths,
                      );
                      setChartEndYear(next.year);
                      setChartEndMonth(next.month);
                    }}
                  >
                    ▶
                  </button>
                </div>
              </div>
              <div
                className="dashboard-chart-canvas"
                style={{
                  position: "relative",
                  height: 180,
                  borderRadius: 8,
                  background:
                    "linear-gradient(180deg, rgba(148,163,184,0.05), rgba(15,23,42,0.08))",
                  overflow: "hidden",
                  padding: "10px 8px 22px 48px",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 8,
                    top: 8,
                    bottom: 22,
                    width: 40,
                    pointerEvents: "none",
                  }}
                >
                  {yAxisPosSteps.map((v) => (
                    <span
                      key={`pos_${v}`}
                      style={{
                        position: "absolute",
                        right: 0,
                        top: `${50 - (v / yAxisPosScale) * 50}%`,
                        transform: "translateY(-50%)",
                        fontSize: 9,
                        color: "rgba(16,185,129,0.85)",
                        opacity: 0.45,
                      }}
                    >
                      {v}
                    </span>
                  ))}
                  <span
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "50%",
                      transform: "translateY(-50%)",
                      fontSize: 9,
                      color: "var(--muted)",
                      opacity: 0.9,
                    }}
                  >
                    0
                  </span>
                  {yAxisNegSteps.map((v) => (
                    <span
                      key={`neg_${v}`}
                      style={{
                        position: "absolute",
                        right: 0,
                        top: `${50 + (v / yAxisNegScale) * 50}%`,
                        transform: "translateY(-50%)",
                        fontSize: 9,
                        color: "rgba(239,68,68,0.85)",
                        opacity: 0.45,
                      }}
                    >
                      -{v}
                    </span>
                  ))}
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 48,
                    right: 8,
                    top: "47%",
                    border: "2px solid rgba(148, 163, 184, 0.45)",
                    zIndex: 3,
                  }}
                />
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.max(chartBuckets.length, 1)}, 1fr)`,
                    gap: 1,
                    alignItems: "stretch",
                  }}
                >
                  {chartBuckets.map((p) => {
                    const pnlNum = Number(p.pnl || 0);
                    const absRatio = p.hasPnl
                      ? Math.min(
                          1,
                          Math.abs(pnlNum) /
                            (pnlNum >= 0 ? yAxisPosScale : yAxisNegScale),
                        )
                      : 0;
                    const hPct = absRatio * 49;
                    const isPos = pnlNum >= 0;
                    const barTop = isPos ? 50 - hPct : 50;
                    return (
                      <div
                        key={p.key}
                        style={{
                          position: "relative",
                          display: "flex",
                          justifyContent: "center",
                        }}
                        title={
                          p.hasPnl
                            ? `${p.title}: $${pnlNum.toFixed(2)}`
                            : `${p.title}: no trades`
                        }
                      >
                        {p.hasPnl ? (
                          <div
                            style={{
                              position: "absolute",
                              width: "92%",
                              height: `${hPct}%`,
                              top: `${barTop}%`,
                              borderRadius: isPos
                                ? "2px 2px 0 0"
                                : "0 0 2px 2px",
                              background: isPos
                                ? "rgba(16,185,129,0.9)"
                                : "rgba(239,68,68,0.9)",
                              zIndex: 2,
                            }}
                          />
                        ) : null}
                        <div
                          style={{
                            position: "absolute",
                            bottom: -18,
                            fontSize: 8,
                            color: "rgba(148,163,184,0.88)",
                            fontWeight: 600,
                            letterSpacing: 0,
                          }}
                        >
                          {p.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div
            className="dashboard-grid tables"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
            }}
          >
            <TableBlock
              title="Symbols"
              noun="Symbols"
              rows={Array.isArray(top.symbols) ? top.symbols : []}
              onRowClick={(row) =>
                goTrades({
                  status: "closed",
                  time: filters.range || "all",
                  symbol: row?.key || "",
                })
              }
            />
            <TableBlock
              title="Strategy"
              noun="Strategies"
              rows={Array.isArray(top.strategies) ? top.strategies : []}
            />
            <TableBlock
              title="Entry Model"
              noun="Models"
              rows={Array.isArray(top.entry_models) ? top.entry_models : []}
              onRowClick={(row) =>
                goTrades({
                  status: "closed",
                  time: filters.range || "all",
                  entry_model: row?.key || "",
                })
              }
            />
            <TableBlock
              title="Source ID"
              noun="Sources"
              rows={Array.isArray(top.sources) ? top.sources : []}
              onRowClick={(row) =>
                goTrades({
                  status: "closed",
                  time: filters.range || "all",
                  source: row?.key || "",
                })
              }
            />
            <TableBlock
              title="Order Type"
              noun="Order Type"
              rows={Array.isArray(top.directional) ? top.directional : []}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
