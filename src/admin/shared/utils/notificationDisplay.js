function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function upperSnake(value) {
  return cleanText(value)
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function titleCaseWords(value) {
  return cleanText(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
}

const TYPE_LABELS = {
  analyze: "Analysis",
  snapshot: "Snapshot",
  cron_snapshot: "Snapshot Cron",
  twelve_data: "Twelve Data",
  news_alert: "News Alert",
  cancel_trade: "Trade Cancelled",
  close_trade: "Trade Closed",
  create_trade: "Trade",
  create_signal: "Signal",
  system_event: "Notification",
};

export function eventTypeToHubType(eventName) {
  var ev = String(eventName || "").trim().toLowerCase();
  if (!ev) return "system_event";
  if (ev === "cron_snapshot") return "cron_snapshot";
  if (ev === "snapshot_created" || ev.includes("snapshot")) return "snapshot";
  if (ev.includes("news")) return "news_alert";
  if (ev.includes("trade")) return "create_trade";
  if (ev.includes("signal")) return "create_signal";
  if (ev.includes("analy")) return "analyze";
  return "system_event";
}

export function normalizeServerEntry(item) {
  var ts = new Date(item && item.t).getTime();
  var createdAt = Number.isFinite(ts) ? ts : Date.now();
  var eventName = String((item && item.event) || "");
  var message = String((item && item.message) || "");
  var errorText = String((item && item.error) || "");
  var resultText = String((item && item.result) || "");
  var level = String((item && item.type) || "info");
  var payload = (item && item.data) || item || {};
  var inferredStatus =
    String((item && item.status) || "").trim().toLowerCase() ||
    (String(level).toLowerCase() === "error" ||
    errorText.trim() ||
    (resultText && resultText.trim().toLowerCase() === "error") ||
    /\b(fail(?:ed)?|error)\b/i.test(eventName) ||
    /\b(fail(?:ed)?|error)\b/i.test(message)
      ? "error"
      : "ok");
  var requestId =
    String(
      (item && (item.request_id || item.requestId)) ||
        (payload && (payload.request_id || payload.requestId)) ||
        "",
    ).trim() ||
    ("srv:" +
      createdAt +
      ":" +
      eventName +
      ":" +
      String((item && item.symbol) || "") +
      ":" +
      message);
  return {
    requestId: requestId,
    type: eventTypeToHubType(eventName),
    status: inferredStatus,
    result: resultText || inferredStatus,
    createdAt: createdAt,
    completedAt: createdAt,
    symbol: String((item && item.symbol) || ""),
    extra: message,
    message: message,
    event: eventName,
    level: level,
    source: "server",
    source_type: String(
      (item && item.source_type) || (payload && payload.source_type) || "",
    ),
    source_id: String(
      (item && item.source_id) || (payload && payload.source_id) || "",
    ),
    durationMs:
      Number(
        (item && item.duration_ms) ||
          (item && item.durationMs) ||
          (payload && payload.duration_ms) ||
          (item &&
            payload &&
            payload._timing &&
            payload._timing.total_ms) ||
          0,
      ) || null,
    dbDurationMs:
      Number(
        (item && item.db_duration_ms) ||
          (item && item.dbDurationMs) ||
          (payload && payload.db_duration_ms) ||
          (item &&
            payload &&
            payload._timing &&
            payload._timing.db_ms) ||
          0,
      ) || null,
    data: payload,
    cron_name: String((item && item.cron_name) || ""),
    sid: String((item && item.sid) || ""),
    error: errorText,
  };
}

function normalizeResultLabel(entry) {
  var rawStatus = String((entry && entry.status) || "").trim().toLowerCase();
  var level = String((entry && entry.level) || "").trim().toLowerCase();
  if (rawStatus === "running") return "warning";
  if (
    rawStatus === "error" ||
    rawStatus === "failed" ||
    rawStatus === "fail" ||
    level === "error" ||
    cleanText(entry && entry.error)
  ) {
    return "fail";
  }
  if (level === "warning" || rawStatus === "warning") return "warning";
  return "ok";
}

function normalizeSourceTypeLabel(value) {
  var sourceType = cleanText(value).toLowerCase();
  if (!sourceType) return "";
  return titleCaseWords(sourceType);
}

export function isErrorEntry(entry) {
  var status = String((entry && entry.status) || "").trim().toLowerCase();
  if (status === "error" || status === "failed") return true;
  var level = String((entry && entry.level) || "").trim().toLowerCase();
  if (level === "error") return true;
  var errorText = cleanText(entry && entry.error);
  if (errorText) return true;
  var eventName = String((entry && entry.event) || "").trim();
  var message = cleanText(
    (entry && (entry.extra || entry.message || "")) || "",
  );
  return (
    /\b(fail(?:ed)?|error)\b/i.test(eventName) ||
    /\b(fail(?:ed)?|error)\b/i.test(message)
  );
}

export function isMeaningfulEntry(entry) {
  if (entry && entry._ephemeral === true) return false;
  if (!hasNotificationContext(entry)) return false;
  var eventName = String((entry && entry.event) || "").trim().toLowerCase();
  var message = String((entry && (entry.extra || entry.message || "")) || "")
    .trim()
    .toLowerCase();
  if (eventName === "cron_tick" || eventName === "cron_md") return false;
  if (message.startsWith("cron ok")) return false;
  if (message.startsWith("market data cron:")) return false;
  return true;
}

function resolveTradeSid(entry) {
  var directSourceType = cleanText(
    (entry && entry.source_type) || (entry && entry.object_table) || "",
  ).toLowerCase();
  var directSourceId = cleanText(
    (entry && entry.source_id) || (entry && entry.object_id) || "",
  );
  if (
    (directSourceType === "trade" || directSourceType === "trades") &&
    directSourceId
  ) {
    return directSourceId;
  }
  if (Array.isArray(entry && entry.data) && entry.data.length > 0) {
    var firstTrade = entry.data.find(function (row) {
      return cleanText(row && (row.sid || row.trade_sid || row.source_id));
    });
    if (firstTrade) {
      return cleanText(
        firstTrade.sid || firstTrade.trade_sid || firstTrade.source_id || "",
      );
    }
  }
  return cleanText(
    (entry && entry.sid) ||
      (entry && entry.data && entry.data.sid) ||
      (entry && entry.data && entry.data.trade_sid) ||
      (entry && entry.data && entry.data.trade && entry.data.trade.sid) ||
      "",
  );
}

function resolveSignalSid(entry) {
  return cleanText(
    (entry && entry.data && (entry.data.trade_id || entry.data.signal_id)) ||
      (entry && entry.data && entry.data.id) ||
      (entry && entry.data && entry.data.sid) ||
      (entry &&
        entry.data &&
        entry.data.signal &&
        (entry.data.signal.sid ||
          entry.data.signal.trade_id ||
          entry.data.signal.signal_id ||
          entry.data.signal.id)) ||
      "",
  );
}

function resolveSnapshotFiles(entry) {
  var data = (entry && entry.data) || {};
  var files = [];
  if (Array.isArray(data.items)) {
    files = data.items
      .map(function (item) {
        return cleanText(item && item.file_name);
      })
      .filter(Boolean);
  }
  if (!files.length && Array.isArray(data.created)) {
    files = data.created
      .map(function (item) {
        return cleanText(item && item.file_name);
      })
      .filter(Boolean);
  }
  if (!files.length && Array.isArray(data.files)) {
    files = data.files.map(cleanText).filter(Boolean);
  }
  return files;
}

function resolveSymbols(entry) {
  var data = (entry && entry.data) || {};
  var directSymbols = Array.isArray(data.symbols)
    ? data.symbols
    : Array.isArray(entry && entry.symbols)
      ? entry.symbols
      : [];
  var resultSymbols = Array.isArray(data.results)
    ? data.results
        .map(function (row) {
          return cleanText(row && row.symbol).toUpperCase();
        })
        .filter(Boolean)
    : [];
  return [
    ...new Set(
      [...directSymbols, ...resultSymbols]
        .map(function (value) {
          return cleanText(value).toUpperCase();
        })
        .filter(Boolean),
    ),
  ];
}

function summarizeSymbols(symbols, limit = 4) {
  var list = Array.isArray(symbols) ? symbols.filter(Boolean) : [];
  if (!list.length) return "";
  if (list.length <= limit) return list.join(", ");
  return list.slice(0, limit).join(", ") + " +" + (list.length - limit);
}

function resolveApiName(entry) {
  return cleanText(
    (entry && entry.data && entry.data.api) ||
      (entry && entry.data && entry.data.provider) ||
      (entry && entry.meta && entry.meta.api) ||
      (entry && entry.meta && entry.meta.provider) ||
      "",
  );
}

function resolvePagePath(entry) {
  return cleanText(
    (entry && entry.page) ||
      (entry && entry.data && entry.data.page) ||
      (entry && entry.data && entry.data.page_id) ||
      "",
  );
}

function resolveCronName(entry) {
  return cleanText(
    (entry && entry.cron_name) ||
      (entry && entry.data && entry.data.cron_name) ||
      "",
  );
}

function resolveObjectTypeAndId(entry) {
  var explicitSourceType = cleanText(entry && entry.source_type);
  var explicitSourceId = cleanText(entry && entry.source_id);
  if (explicitSourceType && explicitSourceId) {
    return { type: explicitSourceType, id: explicitSourceId };
  }
  var tradeSid = resolveTradeSid(entry);
  if (tradeSid) return { type: "trade", id: tradeSid };
  var tradeDraftSid = resolveSignalSid(entry);
  if (tradeDraftSid) return { type: "trade", id: tradeDraftSid };
  var symbol = cleanText(entry && entry.symbol).toUpperCase();
  if (symbol) return { type: "symbol", id: symbol };
  var snapshotFiles = resolveSnapshotFiles(entry);
  if (snapshotFiles.length) return { type: "snapshot", id: snapshotFiles[0] };
  return { type: "", id: "" };
}

function resolveTradeUpdatePayload(entry) {
  if (Array.isArray(entry && entry.data) && entry.data.length > 0) {
    return entry.data[0] || {};
  }
  return entry && entry.data && typeof entry.data === "object" ? entry.data : {};
}

function resolveTradeExecutionStatus(entry) {
  var payload = resolveTradeUpdatePayload(entry);
  return cleanText(
    (entry && entry.execution_status) ||
      (payload && payload.execution_status) ||
      "",
  ).toUpperCase();
}

function statusToTradePath(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "OPEN":
    case "PLACED":
    case "PENDING":
      return "pending";
    case "FILLED":
    case "ACTIVE":
      return "filled";
    case "CLOSED":
    case "TP":
    case "SL":
      return "closed";
    case "CANCELLED":
    case "CANCELED":
    case "EXPIRED":
      return "cancelled";
    case "REJECTED":
      return "rejected";
    case "DRAFT":
      return "draft";
    default:
      return "";
  }
}

function formatPnlValue(value) {
  var num = Number(value);
  if (!Number.isFinite(num)) return "";
  var fixed = Math.abs(num) >= 100 ? num.toFixed(0) : num.toFixed(2);
  return (num > 0 ? "+" : "") + fixed;
}

function formatCount(value, noun) {
  var count = Number(value);
  if (!Number.isFinite(count) || count < 0) return "";
  return (
    new Intl.NumberFormat("en-US").format(count) +
    " " +
    noun +
    (count === 1 ? "" : "s")
  );
}

function stripLeadingFailurePrefix(value) {
  return cleanText(value)
    .replace(/^market data refresh failed:\s*/i, "")
    .replace(/^market data refreshed:\s*/i, "")
    .replace(/^chart artifacts refresh skipped:\s*/i, "")
    .replace(/^chart artifacts refreshed:\s*/i, "")
    .trim();
}

function prettifyProviderReason(value) {
  var text = cleanText(value);
  if (!text) return "";
  var lower = text.toLowerCase();
  if (lower === "twelvedata_empty" || lower === "empty values") {
    return "No bars returned for the requested range";
  }
  if (lower === "invalid symbol") {
    return "Symbol not supported by provider";
  }
  if (lower === "provider error") {
    return "Provider error";
  }
  if (lower.includes("api key") && lower.includes("missing")) {
    return "Provider API key missing";
  }
  if (lower.startsWith("http_429")) {
    return "Rate limit or credits exhausted";
  }
  if (lower.startsWith("http_403")) {
    return "Provider access denied";
  }
  if (lower.startsWith("http_401")) {
    return "Provider authentication failed";
  }
  if (lower.startsWith("http_400")) {
    return text.replace(/^http_400:\s*/i, "") || "Bad provider request";
  }
  return text;
}

function resolveNestedNotificationData(entry) {
  var data = (entry && entry.data) || {};
  return data && typeof data.data === "object" && data.data ? data.data : data;
}

function formatNotificationTimeframeLabel(value) {
  var tf = cleanText(value).toLowerCase();
  if (tf === "1" || tf === "1m" || tf === "1min") return "1m";
  if (tf === "5" || tf === "5m" || tf === "5min") return "5m";
  if (tf === "15" || tf === "15m" || tf === "15min") return "15m";
  if (tf === "60" || tf === "1h" || tf === "60m") return "1h";
  if (tf === "240" || tf === "4h" || tf === "240m") return "4h";
  if (tf === "1440" || tf === "1d" || tf === "day") return "1d";
  return tf;
}

function buildMarketDataFailureFallback(entry) {
  var sourceId = cleanText((entry && entry.source_id) || "");
  var symbol = cleanText(entry && entry.symbol).toUpperCase();
  var tf = "";
  if (sourceId.includes(":")) {
    var parts = sourceId.split(":");
    symbol = symbol || cleanText(parts[0]).toUpperCase();
    tf = formatNotificationTimeframeLabel(parts.slice(1).join(":"));
  }
  var rawMessage = cleanText(resolveNotificationMessage(entry)).toLowerCase();
  if (rawMessage.includes("fix chain failed")) {
    return cleanText(
      `Could not repair latest ${symbol || "market"}${tf ? ` ${tf}` : ""} bars.`,
    );
  }
  if (rawMessage.includes("refresh failed")) {
    return cleanText(
      `Could not refresh latest ${symbol || "market"}${tf ? ` ${tf}` : ""} bars.`,
    );
  }
  return "";
}

function extractMarketDataFailureDetail(message) {
  var stripped = stripLeadingFailurePrefix(message);
  if (!stripped) return "";
  if (stripped.includes(" · ")) {
    var parts = stripped.split(" · ").map(cleanText).filter(Boolean);
    if (parts.length > 1) return parts.slice(1).join(" · ");
  }
  return stripped;
}

function buildMarketDataNotificationSummary(entry) {
  var payload = (entry && entry.data) || {};
  var result = resolveNestedNotificationData(entry);
  var reason = prettifyProviderReason(
    (result && (result.remote_reason || result.last_error || result.reason)) ||
      payload.remote_reason ||
      payload.last_error ||
      payload.reason ||
      entry.error ||
      "",
  );
  var status = normalizeResultLabel(entry);
  if (status === "fail") {
    var detailedMessage = extractMarketDataFailureDetail(
      resolveNotificationMessage(entry),
    );
    return (
      reason ||
      detailedMessage ||
      buildMarketDataFailureFallback(entry)
    );
  }
  var storedBars =
    Number(result && result.stored_source_bars) ||
    Number(result && result.fetched_source_bars) ||
    Number(result && result.requested_source_bars) ||
    Number(result && result.requested_bars) ||
    Number(payload.bars_count) ||
    0;
  var fetchedBars =
    Number(result && result.fetched_source_bars) ||
    Number(result && result.requested_source_bars) ||
    Number(result && result.requested_bars) ||
    Number(payload.bars_count) ||
    0;
  var provider = cleanText(result && result.provider);
  var timeframe = cleanText(
    (result && (result.fetch_tf || result.requested_tf)) || payload.timeframe || "",
  );
  return cleanText(
    `+${formatCount(fetchedBars, "bar")} from ${provider || "source"}${timeframe ? ` ${timeframe}` : ""}, ${formatCount(storedBars, "bar")} stored.`,
  );
}

function buildChartArtifactsNotificationSummary(entry) {
  var payload = (entry && entry.data) || {};
  var result = resolveNestedNotificationData(entry);
  var reason = prettifyProviderReason(
    payload.no_data_reason ||
      (result && result.no_data_reason) ||
      payload.reason ||
      (result && result.reason) ||
      entry.error ||
      "",
  );
  var status = normalizeResultLabel(entry);
  if (payload.no_data || (result && result.no_data)) {
    return reason || "No bars found";
  }
  if (status === "fail") {
    return reason || stripLeadingFailurePrefix(resolveNotificationMessage(entry));
  }
  var barsCount =
    Number(payload.bars_count) ||
    Number(result && result.bars_count) ||
    Number(result && result.total_bars) ||
    0;
  var rebuildMode = cleanText(payload.rebuild_mode || (result && result.rebuild_mode));
  var parts = [];
  if (barsCount > 0) parts.push(formatCount(barsCount, "bar") + " scanned");
  if (rebuildMode) parts.push(rebuildMode);
  return cleanText(parts.join(" · "));
}

function resolveNotificationMessage(entry) {
  return cleanText(
    (entry && entry.message) ||
      (entry && entry.extra) ||
      (entry &&
        entry.data &&
        (entry.data.message ||
          entry.data.remote_reason ||
          entry.data.last_error ||
          entry.data.reason ||
          entry.data.last_error ||
          entry.data.remote_reason)) ||
      (entry && entry.error) ||
      "",
  );
}

function resolveEventTypeLabel(entry) {
  var rawEvent = upperSnake(entry && entry.event);
  return rawEvent || upperSnake(entry && entry.type) || "NOTIFICATION";
}

function buildFallbackNotificationMessage(entry) {
  var objectRef = resolveObjectTypeAndId(entry);
  var symbols = resolveSymbols(entry);
  var data = (entry && entry.data) || {};
  var insertedCount = Number(
    (data && data.inserted) ||
      (entry && entry.inserted) ||
      (data && data.bar_count) ||
      (entry && entry.bar_count) ||
      0,
  );
  var duplicatedCount = Number(
    (data && data.duplicated) || (entry && entry.duplicated) || 0,
  );
  var rejectedCount = Number(
    (data && data.rejected) || (entry && entry.rejected) || 0,
  );
  var rawEvent = String(entry && entry.event).toUpperCase();
  if (rawEvent === "TRADE_SYNC_UPDATE" || rawEvent === "TRADE_UPDATED") {
    var tradeSid = resolveTradeSid(entry);
    var tradePayload = resolveTradeUpdatePayload(entry);
    var tradeParts = [];
    if (tradeSid) tradeParts.push(tradeSid);
    var execStatus = cleanText(
      (tradePayload && tradePayload.execution_status) ||
        (entry && entry.execution_status) ||
        "",
    );
    if (execStatus) tradeParts.push(titleCaseWords(execStatus.toLowerCase()));
    var pnlValue =
      tradePayload && tradePayload.broker_pnl !== undefined
        ? tradePayload.broker_pnl
        : tradePayload && tradePayload.pnl_realized !== undefined
          ? tradePayload.pnl_realized
          : entry && entry.pnl;
    var formattedPnl = formatPnlValue(pnlValue);
    if (formattedPnl) tradeParts.push("PnL " + formattedPnl);
    if (
      Number.isFinite(Number(tradePayload && tradePayload.sl_before)) &&
      Number.isFinite(Number(tradePayload && tradePayload.sl_after)) &&
      Number(tradePayload.sl_before) !== Number(tradePayload.sl_after)
    ) {
      tradeParts.push(
        "SL " + tradePayload.sl_before + " -> " + tradePayload.sl_after,
      );
    }
    if (
      Number.isFinite(Number(tradePayload && tradePayload.tp_before)) &&
      Number.isFinite(Number(tradePayload && tradePayload.tp_after)) &&
      Number(tradePayload.tp_before) !== Number(tradePayload.tp_after)
    ) {
      tradeParts.push(
        "TP " + tradePayload.tp_before + " -> " + tradePayload.tp_after,
      );
    }
    if (tradeParts.length) return tradeParts.join(" · ");
  }
  if (
    rawEvent === "BROKER_PRICES_SYNC" ||
    rawEvent === "PRICES_SYNC" ||
    rawEvent === "BAR_SYNC"
  ) {
    var priceParts = [];
    var symbolSummary = summarizeSymbols(symbols, 5);
    if (symbolSummary) priceParts.push(symbolSummary);
    if (insertedCount > 0) priceParts.push(insertedCount + " inserted");
    if (duplicatedCount > 0) priceParts.push(duplicatedCount + " duplicated");
    if (rejectedCount > 0) priceParts.push(rejectedCount + " rejected");
    if (priceParts.length) return priceParts.join(" · ");
  }
  if (rawEvent === "BROKER_BARS" || rawEvent === "BAR_PUSH") {
    var barParts = [];
    var barSymbolSummary = summarizeSymbols(symbols, 5);
    if (barSymbolSummary) barParts.push(barSymbolSummary);
    if (insertedCount > 0) barParts.push(insertedCount + " bars");
    if (barParts.length) return barParts.join(" · ");
  }
  if (
    rawEvent === "BROKER_PRICES" ||
    rawEvent === "PRICE_PUSH" ||
    rawEvent === "TICK_PUSH"
  ) {
    var tickParts = [];
    var tickSymbolSummary = summarizeSymbols(symbols, 5);
    if (tickSymbolSummary) tickParts.push(tickSymbolSummary);
    var symbolCount = Number(
      (data && data.symbol_count) || (entry && entry.symbol_count) || 0,
    );
    if (symbolCount > 0) tickParts.push(symbolCount + " symbols");
    if (tickParts.length) return tickParts.join(" · ");
  }
  var parts = [];
  if (objectRef.type && objectRef.id) {
    parts.push(objectRef.type + " " + objectRef.id);
  }
  var cronName = resolveCronName(entry);
  if (cronName && !parts.includes("cron " + cronName)) {
    parts.push("cron " + cronName);
  }
  var symbol = cleanText(entry && entry.symbol).toUpperCase();
  if (symbol && !parts.some(function (part) { return part.includes(symbol); })) {
    parts.push(symbol);
  }
  var timeframe = cleanText(
    (entry && entry.timeframe) ||
      (entry && entry.tf) ||
      (entry &&
        entry.data &&
        (entry.data.timeframe || entry.data.tf || entry.data.fetch_tf)) ||
      "",
  );
  if (timeframe) {
    parts.push(timeframe);
  }
  var sourceId = cleanText(
    (entry && entry.source_id) || (entry && entry.object_id) || "",
  );
  if (sourceId && !parts.some(function (part) { return part.includes(sourceId); })) {
    parts.push(sourceId);
  }
  if (Array.isArray(entry && entry.data) && entry.data.length) {
    parts.push(entry.data.length + " items");
  }
  return cleanText(parts.join(" · "));
}

function resolveNotificationDetail(entry) {
  var sourceType = cleanText(entry && entry.source_type).toLowerCase();
  var eventName = cleanText(entry && entry.event).toUpperCase();
  if (sourceType === "market_data" || eventName === "CHART_REFRESH") {
    var marketDataSummary = buildMarketDataNotificationSummary(entry);
    if (marketDataSummary) return marketDataSummary;
  }
  if (
    sourceType === "chart_artifacts" ||
    eventName === "CHART_ARTIFACT_REFRESH"
  ) {
    var chartArtifactsSummary = buildChartArtifactsNotificationSummary(entry);
    if (chartArtifactsSummary) return chartArtifactsSummary;
  }
  var message = resolveNotificationMessage(entry);
  var eventLabel = resolveEventTypeLabel(entry);
  var normalizedMessage = upperSnake(message);
  if (
    message &&
    normalizedMessage !== eventLabel &&
    normalizedMessage !== upperSnake(entry && entry.event)
  ) {
    return message;
  }
  return buildFallbackNotificationMessage(entry);
}

function resolveNotificationContext(entry) {
  var objectRef = resolveObjectTypeAndId(entry);
  if (objectRef.type && objectRef.id) {
    return {
      contextType: objectRef.type,
      contextId: objectRef.id,
      sourceLabel: objectRef.type + " - " + objectRef.id,
    };
  }
  var cronName = resolveCronName(entry);
  if (cronName) {
    return {
      contextType: "cron",
      contextId: cronName,
      sourceLabel: "cron - " + cronName,
    };
  }
  var apiName = resolveApiName(entry);
  if (apiName) {
    return {
      contextType: "api",
      contextId: apiName,
      sourceLabel: "api - " + apiName,
    };
  }
  var pagePath = resolvePagePath(entry);
  if (pagePath) {
    return {
      contextType: "page",
      contextId: pagePath,
      sourceLabel: "web page - " + pagePath,
    };
  }
  var eventName = cleanText(entry && entry.event).toLowerCase();
  if (eventName) {
    return {
      contextType: "event",
      contextId: eventName,
      sourceLabel: "event - " + eventName,
    };
  }
  return { contextType: "", contextId: "", sourceLabel: "" };
}

export function hasNotificationContext(entry) {
  var type = cleanText(entry && entry.type);
  var message = resolveNotificationMessage(entry);
  var context = resolveNotificationContext(entry);
  return Boolean(type && message && context.contextId);
}

export function resolveNotificationTarget(entry) {
  var tradeSid = resolveTradeSid(entry);
  if (tradeSid) {
    var statusPath = statusToTradePath(resolveTradeExecutionStatus(entry));
    return statusPath
      ? "/trades/" + statusPath + "/" + tradeSid
      : "/trades/" + tradeSid;
  }
  var tradeDraftSid = resolveSignalSid(entry);
  if (tradeDraftSid) return "/trades/" + tradeDraftSid;
  if (entry && entry.type === "news_alert") return "/trades/news";
  if (entry && entry.type === "snapshot") return "/system/files";
  if (entry && entry.type === "cron_snapshot") return "/system/files";
  if (entry && entry.type === "analyze") {
    return "/trades/result?result=" + encodeURIComponent(entry.requestId || "");
  }
  var pagePath = resolvePagePath(entry);
  if (pagePath) return pagePath;
  var apiName = resolveApiName(entry);
  if (apiName) return "/system/logs";
  return "/system/logs";
}

export function navigateToNotificationTarget(entry) {
  var target = resolveNotificationTarget(entry);
  if (!target || typeof window === "undefined") return;
  window.history.pushState({}, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function buildNotificationRecord(entry) {
  if (!hasNotificationContext(entry)) return null;
  var message = resolveNotificationDetail(entry);
  var eventTypeLabel = resolveEventTypeLabel(entry);
  return {
    sourceLabel: eventTypeLabel,
    message: message,
    resultLabel: normalizeResultLabel(entry),
    target: resolveNotificationTarget(entry),
  };
}

export function buildNotificationHubMeta(entry) {
  var objectRef = resolveObjectTypeAndId(entry);
  var context = resolveNotificationContext(entry);
  var sourceType =
    normalizeSourceTypeLabel(entry && entry.source_type) ||
    normalizeSourceTypeLabel(objectRef.type) ||
    normalizeSourceTypeLabel(context.contextType) ||
    normalizeSourceTypeLabel(entry && entry.type) ||
    "Notification";
  var sourceId =
    cleanText(entry && entry.source_id) ||
    cleanText(objectRef.id) ||
    cleanText(context.contextId) ||
    cleanText(entry && entry.sid) ||
    cleanText(entry && entry.symbol).toUpperCase() ||
    "-";
  var resultLabel = normalizeResultLabel(entry);
  var statusLabel =
    resultLabel === "fail"
      ? "FAIL"
      : resultLabel === "warning"
        ? "WARNING"
        : "OK";
  var record = buildNotificationRecord(entry);
  var toneKey = String(sourceType || "").trim().toLowerCase();
  var tone =
    toneKey === "trade" || toneKey.includes("trade")
      ? "trade"
      : toneKey === "symbol" || toneKey.includes("chart")
        ? "symbol"
        : toneKey === "cron" || toneKey.includes("cron")
          ? "cron"
          : toneKey === "api" || toneKey.includes("api")
            ? "api"
            : toneKey === "event" ||
                toneKey.includes("channel") ||
                toneKey.includes("socket") ||
                toneKey.includes("realtime")
              ? "channel"
              : toneKey === "page"
                ? "page"
                : "default";
  return {
    sourceType: sourceType,
    sourceId: sourceId,
    status: statusLabel,
    message:
      cleanText(record && record.message) ||
      cleanText(resolveNotificationMessage(entry)) ||
      cleanText(entry && entry.event) ||
      "Notification",
    fullMessage:
      cleanText(resolveNotificationMessage(entry)) ||
      cleanText(record && record.message) ||
      cleanText(entry && entry.event) ||
      "Notification",
    tone: tone,
  };
}

export function buildNotificationChannels(entry) {
  var tradeSid = resolveTradeSid(entry);
  var symbol = cleanText(
    (entry && entry.symbol) ||
      (entry && entry.data && entry.data.symbol) ||
      (entry && entry.data && entry.data.trade && entry.data.trade.symbol) ||
      resolveSymbols(entry)[0] ||
      "",
  ).toUpperCase();
  return [
    tradeSid ? "TRADE_" + tradeSid : "",
    symbol ? "CHART_" + symbol : "",
  ].filter(Boolean);
}

export function buildNotificationDisplay(entry) {
  var metaLabel = TYPE_LABELS[entry.type] || "";
  var eventName = String(entry.event || "").trim().toLowerCase();
  var symbol = cleanText(entry.symbol).toUpperCase();
  var extra = cleanText(entry.extra || entry.message || "");
  var status = String(entry.status || "").trim().toLowerCase();
  var tradeSid = resolveTradeSid(entry);
  var tradeDraftSid = resolveSignalSid(entry);
  var snapshotFiles = resolveSnapshotFiles(entry);
  var cronName = cleanText(
    (entry.data && entry.data.cron_name) || entry.cron_name || "",
  );
  var tradeLabel =
    tradeSid && symbol ? tradeSid + "-" + symbol : tradeSid || symbol || "";

  if (status === "running") {
    return {
      title: metaLabel || titleCaseWords(entry.type || "Task"),
      detail: tradeLabel || symbol || "running",
    };
  }
  if (status === "error") {
    return {
      title:
        cronName ||
        metaLabel ||
        titleCaseWords(eventName || entry.type || "Error"),
      detail: cleanText(entry.error || extra || "Failed"),
    };
  }
  if (entry.type === "snapshot") {
    if (snapshotFiles.length) {
      return {
        title: cronName || "Snapshot",
        detail: snapshotFiles[0] + " created",
      };
    }
    var matchSnapshotSymbols = extra.match(/\(([^)]+)\)/);
    if (matchSnapshotSymbols && matchSnapshotSymbols[1]) {
      return {
        title: cronName || "Snapshot",
        detail: cleanText(matchSnapshotSymbols[1]).toUpperCase() + ": created",
      };
    }
    if (symbol) {
      return { title: cronName || "Snapshot", detail: symbol + ": created" };
    }
  }
  if (entry.type === "cron_snapshot" || eventName === "cron_snapshot") {
    return {
      title: "Snapshot Cron",
      detail: extra || (symbol ? symbol + ": created" : "Completed"),
    };
  }
  if (entry.type === "create_trade") {
    return {
      title: cronName || "Trade",
      detail: tradeLabel ? tradeLabel + " created" : extra || "created",
    };
  }
  if (entry.type === "close_trade") {
    return {
      title: cronName || "Trade Closed",
      detail: tradeLabel ? tradeLabel + " closed" : extra || "closed",
    };
  }
  if (entry.type === "cancel_trade") {
    return {
      title: cronName || "Trade Cancelled",
      detail: tradeLabel ? tradeLabel + " cancelled" : extra || "cancelled",
    };
  }
  if (entry.type === "create_signal") {
    return {
      title: cronName || "Trade Draft",
      detail: tradeDraftSid
        ? tradeDraftSid + " created"
        : symbol
          ? symbol + ": created"
          : extra || "Trade draft created",
    };
  }
  if (eventName === "cron_ai") {
    var aiMatch = extra.match(
      /^([^-\s,]+)-([A-Z0-9._-]+),\s*(\d+)\s+created$/i,
    );
    if (aiMatch) {
      var sid = cleanText(aiMatch[1]);
      var aiSymbol = cleanText(aiMatch[2]).toUpperCase();
      var count = Number(aiMatch[3] || 0);
      return {
        title: cronName || "AI Analysis Cron",
        detail:
          sid && sid !== "NO_SID"
            ? sid + " created (" + aiSymbol + ")"
            : aiSymbol + ": " + count + " created",
      };
    }
    return {
      title: cronName || "AI Analysis Cron",
      detail: extra || (symbol ? symbol + ": done" : "Completed"),
    };
  }
  if (entry.type === "news_alert") {
    return {
      title: "News Alert",
      detail: extra || (symbol ? symbol + ": update" : "Update"),
    };
  }
  return {
    title:
      cronName ||
      metaLabel ||
      titleCaseWords(eventName || entry.type || "Notification"),
    detail: extra || (symbol ? symbol + ": updated" : ""),
  };
}

export function formatNotificationLine(entry) {
  var display = buildNotificationDisplay(entry);
  return display.detail ? display.title + ": " + display.detail : display.title;
}
