"use strict";

const crypto = require("crypto");

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isCTraderReport(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.main &&
      typeof value.main === "object" &&
      value.history &&
      Array.isArray(value.history.items),
  );
}

function findCTraderReport(payload = {}) {
  const candidates = [
    payload?.ctrader_report,
    payload?.cTraderReport,
    payload?.json_report,
    payload?.jsonReport,
    payload?.report,
    payload,
  ];
  for (const candidate of candidates) {
    const parsed = parseJsonObject(candidate);
    if (isCTraderReport(parsed)) return parsed;
  }
  return null;
}

function normalizeCTraderTimeframe(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  const aliases = {
    m1: "1",
    "1m": "1",
    "1": "1",
    m5: "5",
    "5m": "5",
    "5": "5",
    m15: "15",
    "15m": "15",
    "15": "15",
    m30: "30",
    "30m": "30",
    "30": "30",
    h1: "60",
    "1h": "60",
    "60": "60",
    h4: "240",
    "4h": "240",
    "240": "240",
    d1: "1440",
    daily: "1440",
    "1d": "1440",
    "1440": "1440",
  };
  return aliases[normalized] || String(value || "").trim();
}

function timestampToMilliseconds(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric <= 0) return null;
    return numeric < 100000000000 ? numeric * 1000 : numeric;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timestampToIso(value) {
  const milliseconds = timestampToMilliseconds(value);
  return milliseconds == null ? null : new Date(milliseconds).toISOString();
}

function timestampToUnixSeconds(value) {
  const milliseconds = timestampToMilliseconds(value);
  return milliseconds == null ? null : Math.floor(milliseconds / 1000);
}

function parseTradeComment(comment = "") {
  const text = String(comment || "");
  const tpMatch = text.match(/\bTP:[^|/]*?\s(-?\d+(?:\.\d+)?)\s*(?=\/|\||$)/iu);
  const slMatch = text.match(/\bSL:[^|/]*?\s(-?\d+(?:\.\d+)?)\b/iu);
  const riskMatch = text.match(/\b1r\s+(-?\d+(?:\.\d+)?)\s*\$/iu);
  const rrMatch = text.match(/\bTP:rr[_-]?(\d+(?:[._]\d+)?)\b/iu);
  return {
    tp: finiteNumber(tpMatch?.[1]),
    sl: finiteNumber(slMatch?.[1]),
    risk_money_planned: finiteNumber(riskMatch?.[1]),
    rr_planned: rrMatch?.[1]
      ? finiteNumber(String(rrMatch[1]).replace(/_/gu, "."))
      : null,
  };
}

function classifyUtcSession(unixSeconds) {
  if (!Number.isFinite(Number(unixSeconds))) return "Unknown";
  const hour = new Date(Number(unixSeconds) * 1000).getUTCHours();
  if (hour >= 0 && hour < 8) return "Asian";
  if (hour >= 8 && hour < 13) return "London";
  if (hour >= 13 && hour < 17) return "London+NY";
  if (hour >= 17 && hour < 22) return "New York";
  return "Off-session";
}

function inferStrategyKey(report = {}, run = {}) {
  const explicit = String(run?.strategy_key || run?.strategy_id || "").trim();
  if (explicit) return explicit;
  const labels = (report?.history?.items || [])
    .map((trade) => String(trade?.label || "").trim().split(".")[0])
    .filter(Boolean);
  if (labels.length) {
    const counts = new Map();
    labels.forEach((label) => counts.set(label, (counts.get(label) || 0) + 1));
    return [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];
  }
  return String(report?.main?.cBotName || "ctrader").trim() || "ctrader";
}

function createRunId(report = {}, run = {}, strategyKey = "ctrader") {
  const explicit = String(run?.run_id || "").trim();
  if (explicit) return explicit;
  const main = report?.main || {};
  const fingerprint = crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        strategyKey,
        symbol: main.symbol,
        period: main.period,
        startDate: main.testingPeriod?.startDate,
        endDate: main.testingPeriod?.endDate,
        netProfit: main.netProfit,
        trades: report?.history?.items?.length || 0,
      }),
    )
    .digest("hex")
    .slice(0, 10);
  const safe = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "unknown";
  return `ctrader-${safe(strategyKey)}-${safe(main.symbol)}-${safe(main.period)}-${fingerprint}`;
}

function normalizeCTraderTrade(rawTrade = {}, context = {}) {
  const openedAt = timestampToIso(rawTrade.entryTime);
  const closedAt = timestampToIso(rawTrade.closeTime);
  const openedAtSec = timestampToUnixSeconds(rawTrade.entryTime);
  const closedAtSec = timestampToUnixSeconds(rawTrade.closeTime);
  const direction = String(rawTrade.direction || rawTrade.tradeType || "")
    .trim()
    .toLowerCase();
  const action = direction === "sell" ? "SELL" : direction === "buy" ? "BUY" : "";
  const net = finiteNumber(rawTrade.net, 0);
  const parsedComment = parseTradeComment(rawTrade.comment);
  const riskMoney = parsedComment.risk_money_planned;
  const realizedR = riskMoney && riskMoney > 0 ? round(net / riskMoney, 5) : null;
  const entryHourUtc = openedAtSec == null
    ? null
    : new Date(openedAtSec * 1000).getUTCHours();
  const entryWeekdayUtc = openedAtSec == null
    ? null
    : new Date(openedAtSec * 1000).toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      });
  const tradeId = String(rawTrade.id ?? context.index + 1);
  const strategyKey = String(context.strategyKey || "ctrader").trim();
  const strategyName = String(context.strategyName || strategyKey).trim();
  const tf = String(context.tf || "").trim();
  return {
    sid: `${context.runId}:${tradeId}`,
    trade_id: tradeId,
    broker_trade_id: tradeId,
    source: "ctrader",
    symbol: String(rawTrade.symbol || rawTrade.symbolName || context.symbol || "")
      .trim()
      .toUpperCase(),
    action,
    side: direction,
    tf,
    timeframe: tf,
    strategy_id: strategyKey,
    strategy_key: strategyKey,
    strategy_name: strategyName,
    entry: finiteNumber(rawTrade.entryPrice),
    exit_price: finiteNumber(rawTrade.closePrice),
    exit_price_raw: finiteNumber(rawTrade.closePrice),
    created_at: openedAt,
    signal_bar_time: openedAt,
    opened_at: openedAt,
    closed_at: closedAt,
    entry_time_unix: openedAtSec,
    exit_time_unix: closedAtSec,
    pnl_realized: net,
    pnl: net,
    pnl_gross: finiteNumber(rawTrade.gross, 0),
    commission: finiteNumber(rawTrade.commissions ?? rawTrade.commission, 0),
    swap: finiteNumber(rawTrade.swaps ?? rawTrade.swap, 0),
    volume: finiteNumber(rawTrade.volume),
    quantity: finiteNumber(rawTrade.quantity),
    pips: finiteNumber(rawTrade.pips),
    balance: finiteNumber(rawTrade.balance),
    sl: parsedComment.sl,
    tp: parsedComment.tp,
    rr_planned: parsedComment.rr_planned,
    risk_money_planned: riskMoney,
    r_multiple: realizedR,
    realized_r: realizedR,
    result: net > 0 ? "win" : net < 0 ? "loss" : "flat",
    execution_status: "closed",
    label: String(rawTrade.label || "").trim(),
    comment: String(rawTrade.comment || "").trim(),
    balance_drawdown_pct: finiteNumber(rawTrade.balanceDrawdownPercent),
    equity_drawdown_pct: finiteNumber(rawTrade.equityDrawdownPercent),
    balance_drawdown_absolute: finiteNumber(rawTrade.balanceDrawdownAbsolute),
    equity_drawdown_absolute: finiteNumber(rawTrade.equityDrawdownAbsolute),
    session: classifyUtcSession(openedAtSec),
    entry_hour_utc: entryHourUtc,
    entry_weekday_utc: entryWeekdayUtc,
  };
}

function summarizeTradeGroup(trades = [], groupField = "key") {
  const totalTrades = trades.length;
  const wins = trades.filter((trade) => Number(trade?.pnl_realized || 0) > 0).length;
  const losses = trades.filter((trade) => Number(trade?.pnl_realized || 0) < 0).length;
  const totalPnl = trades.reduce(
    (sum, trade) => sum + Number(trade?.pnl_realized || 0),
    0,
  );
  const totalRealizedR = trades.reduce(
    (sum, trade) => sum + Number(trade?.r_multiple || 0),
    0,
  );
  return {
    [groupField]: null,
    total_trades: totalTrades,
    wins,
    losses,
    win_rate_pct: totalTrades ? round((wins / totalTrades) * 100, 2) : 0,
    total_pnl: round(totalPnl, 2) || 0,
    total_realized_r: round(totalRealizedR, 2) || 0,
  };
}

function groupTrades(trades = [], groupField, keyForTrade) {
  const groups = new Map();
  trades.forEach((trade) => {
    const key = keyForTrade(trade);
    if (key === null || key === undefined || key === "") return;
    const normalizedKey = String(key);
    if (!groups.has(normalizedKey)) groups.set(normalizedKey, []);
    groups.get(normalizedKey).push(trade);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([key, rows]) => ({
      ...summarizeTradeGroup(rows, groupField),
      [groupField]: key,
    }));
}

function normalizeCTraderBacktestPayload(payload = {}) {
  const report = findCTraderReport(payload);
  if (!report) return payload;

  const main = report.main || {};
  const equity = report.equity || {};
  const statistics = report.tradeStatistics || {};
  const baseRun = payload?.run && typeof payload.run === "object" ? payload.run : {};
  const strategyKey = inferStrategyKey(report, baseRun);
  const strategyName = String(baseRun.strategy_name || strategyKey).trim() || strategyKey;
  const tf = normalizeCTraderTimeframe(baseRun.tf || main.period);
  const symbol = String(baseRun.symbol || main.symbol || "").trim().toUpperCase();
  const runId = createRunId(report, baseRun, strategyKey);
  const testingStart = timestampToIso(main?.testingPeriod?.startDate);
  const testingEnd = timestampToIso(main?.testingPeriod?.endDate);
  const rawTrades = Array.isArray(report?.history?.items) ? report.history.items : [];
  const trades = rawTrades.map((trade, index) =>
    normalizeCTraderTrade(trade, {
      index,
      runId,
      strategyKey,
      strategyName,
      symbol,
      tf,
    }),
  );
  const winningTrades = finiteNumber(
    statistics?.winningTrades?.all,
    trades.filter((trade) => trade.result === "win").length,
  );
  const totalTrades = finiteNumber(statistics?.totalTrades?.all, trades.length) || 0;
  const totalRealizedR = trades.reduce(
    (sum, trade) => sum + Number(trade?.r_multiple || 0),
    0,
  );
  const config = {
    ...(payload?.config && typeof payload.config === "object" ? payload.config : {}),
    ...(baseRun?.config && typeof baseRun.config === "object" ? baseRun.config : {}),
    executor: "cTrader",
    symbol,
    timeframe: tf,
    date_from: testingStart,
    date_to: testingEnd,
    initial_capital: finiteNumber(main.startingCapital),
    ctrader: {
      cbot_name: main.cBotName || null,
      broker: main.brokerTitle || null,
      utc_offset_minutes: finiteNumber(main.utcOffset, 0),
      data: main.data || null,
      spread: main.spread || null,
      commissions: main.commissions || null,
      account_type: main.accountType || null,
      account_leverage: finiteNumber(main.accountLeverage),
    },
  };
  const monthly = groupTrades(
    trades,
    "month",
    (trade) => String(trade.closed_at || trade.opened_at || "").slice(0, 7),
  ).map((row) => ({
    ...row,
    trades: row.total_trades,
    net: row.total_pnl,
  }));
  const computedSummary = {
    source: "cTrader JsonReport",
    total_pnl: finiteNumber(main.netProfit, 0),
    total_trades: totalTrades,
    winning_trades: winningTrades,
    losing_trades: finiteNumber(
      statistics?.losingTrades?.all,
      Math.max(0, totalTrades - winningTrades),
    ),
    win_rate_pct: totalTrades ? round((winningTrades / totalTrades) * 100, 2) : 0,
    profit_factor: finiteNumber(statistics?.profitFactor?.all),
    total_realized_r: round(totalRealizedR, 2) || 0,
    roi_pct: finiteNumber(main.roi),
    starting_capital: finiteNumber(main.startingCapital),
    ending_balance: finiteNumber(main.endingBalance),
    ending_equity: finiteNumber(main.endingEquity),
    commissions: finiteNumber(statistics?.commissions?.all, 0),
    swaps: finiteNumber(statistics?.swaps?.all, 0),
    max_balance_drawdown_pct: finiteNumber(equity.maxBalanceDrawdownPercent),
    max_equity_drawdown_pct: finiteNumber(equity.maxEquityDrawdownPercent),
    max_balance_drawdown_absolute: finiteNumber(equity.maxBalanceDrawdownAbsolute),
    max_equity_drawdown_absolute: finiteNumber(equity.maxEquityDrawdownAbsolute),
    first_bar_at: testingStart || trades[0]?.opened_at || null,
    last_bar_at: testingEnd || trades[trades.length - 1]?.closed_at || null,
    testing_period: main.testingPeriod || null,
    monthly,
    by_entry_hour_utc: groupTrades(trades, "hour", (trade) => trade.entry_hour_utc),
    by_weekday_utc: groupTrades(trades, "weekday", (trade) => trade.entry_weekday_utc),
    by_session_utc: groupTrades(trades, "session", (trade) => trade.session),
    by_direction: groupTrades(trades, "direction", (trade) => trade.action),
    by_symbol: groupTrades(trades, "symbol", (trade) => trade.symbol),
    by_timeframe: groupTrades(trades, "tf", (trade) => trade.tf),
    by_strategy: groupTrades(trades, "strategy_key", (trade) => trade.strategy_key),
  };
  const summary = {
    ...(payload?.summary && typeof payload.summary === "object" ? payload.summary : {}),
    ...computedSummary,
  };
  const run = {
    ...baseRun,
    run_id: runId,
    strategy_key: strategyKey,
    strategy_id: String(baseRun.strategy_id || strategyKey).trim(),
    strategy_name: strategyName,
    symbol,
    tf,
    config,
    selection: {
      ...(baseRun?.selection && typeof baseRun.selection === "object"
        ? baseRun.selection
        : {}),
      symbols: [symbol],
      timeframes: [tf],
      strategy_ids: [strategyKey],
    },
    started_at: baseRun.started_at || payload.started_at || new Date().toISOString(),
    summary,
  };
  return {
    ...payload,
    run,
    summary,
    trades,
    events: Array.isArray(payload?.events) ? payload.events : [],
  };
}

module.exports = {
  findCTraderReport,
  normalizeCTraderBacktestPayload,
  normalizeCTraderTimeframe,
  parseTradeComment,
  timestampToIso,
};
