"use strict";

function num(value, fallback) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function queryValue(url, ...names) {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value !== null && value !== undefined) return value;
  }
  return "";
}

function sidFromRoute(route = {}) {
  return String(route.sid || "").trim();
}

function buildTradeFilters(url, payload = {}, defaults = {}) {
  return {
    user_id:
      queryValue(url, "user_id", "userId") ||
      payload.user_id ||
      payload.userId ||
      defaults.user_id ||
      defaults.userId ||
      "",
    account_id:
      queryValue(url, "account_id", "accountId") ||
      payload.account_id ||
      payload.accountId ||
      defaults.account_id ||
      defaults.accountId ||
      "",
    source_id:
      queryValue(url, "source_id", "sourceId") ||
      payload.source_id ||
      payload.sourceId ||
      defaults.source_id ||
      defaults.sourceId ||
      "",
    dispatch_status:
      queryValue(url, "dispatch_status", "dispatchStatus") ||
      payload.dispatch_status ||
      payload.dispatchStatus ||
      defaults.dispatch_status ||
      defaults.dispatchStatus ||
      "",
    execution_status:
      queryValue(url, "execution_status", "executionStatus", "status") ||
      payload.execution_status ||
      payload.executionStatus ||
      payload.status ||
      defaults.execution_status ||
      defaults.executionStatus ||
      defaults.status ||
      "",
    pnl_state:
      queryValue(url, "pnl_state", "profit_state", "win_lose") ||
      payload.pnl_state ||
      payload.profit_state ||
      payload.win_lose ||
      defaults.pnl_state ||
      defaults.profit_state ||
      defaults.win_lose ||
      "",
    created_from:
      queryValue(url, "created_from", "createdFrom") ||
      payload.created_from ||
      payload.createdFrom ||
      defaults.created_from ||
      defaults.createdFrom ||
      "",
    created_to:
      queryValue(url, "created_to", "createdTo") ||
      payload.created_to ||
      payload.createdTo ||
      defaults.created_to ||
      defaults.createdTo ||
      "",
    symbol: queryValue(url, "symbol") || payload.symbol || defaults.symbol || "",
    action:
      queryValue(url, "action", "side") ||
      payload.action ||
      payload.side ||
      defaults.action ||
      defaults.side ||
      "",
    entry_model:
      queryValue(url, "entry_model", "entryModel") ||
      payload.entry_model ||
      payload.entryModel ||
      defaults.entry_model ||
      defaults.entryModel ||
      "",
    chart_tf:
      queryValue(url, "chart_tf", "chartTf") ||
      payload.chart_tf ||
      payload.chartTf ||
      defaults.chart_tf ||
      defaults.chartTf ||
      "",
    trade_tf:
      queryValue(url, "trade_tf", "tradeTf", "timeframe") ||
      payload.trade_tf ||
      payload.tradeTf ||
      payload.timeframe ||
      defaults.trade_tf ||
      defaults.tradeTf ||
      defaults.timeframe ||
      "",
    q:
      queryValue(url, "q", "search") ||
      payload.q ||
      payload.search ||
      defaults.q ||
      defaults.search ||
      "",
    range: queryValue(url, "range") || payload.range || defaults.range || "",
    page: num(queryValue(url, "page"), num(payload.page, 1)),
    pageSize: num(queryValue(url, "pageSize", "limit"), num(payload.pageSize || payload.limit, 50)),
  };
}

async function handleTradesList({ url, service, defaults = {} }) {
  return service.listTrades(buildTradeFilters(url, {}, defaults));
}

async function handleTradesCounts({ url, service, defaults = {} }) {
  return service.countTradesByExecutionStatus(buildTradeFilters(url, {}, defaults));
}

async function handleTradesDashboard({ url, service, defaults = {} }) {
  return service.dashboard(buildTradeFilters(url, {}, defaults));
}

async function handleTradesGet({ url, service, route = {}, defaults = {} }) {
  return service.getTrade({
    ...buildTradeFilters(url, {}, defaults),
    sid: sidFromRoute(route),
  });
}

async function handleTradesUpsert({ payload, service, route = {}, defaults = {} }) {
  return service.upsertTrade({
    ...(defaults || {}),
    ...(payload || {}),
    ...(sidFromRoute(route) ? { sid: sidFromRoute(route) } : {}),
  });
}

async function handleTradesClone({ payload, url, service }) {
  return service.cloneFromCurrentTrades({
    user_id:
      (payload && (payload.user_id || payload.userId)) ||
      queryValue(url, "user_id", "userId") ||
      "",
    pageSize:
      (payload && (payload.pageSize || payload.limit)) ||
      num(queryValue(url, "pageSize", "limit"), 500),
  });
}

module.exports = {
  handleTradesList,
  handleTradesCounts,
  handleTradesDashboard,
  handleTradesGet,
  handleTradesUpsert,
  handleTradesClone,
};
