function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
  var level = String((item && item.type) || "info");
  var inferredStatus =
    String((item && item.status) || "").trim().toLowerCase() ||
    (String(level).toLowerCase() === "error" ||
    errorText.trim() ||
    /\b(fail(?:ed)?|error)\b/i.test(eventName) ||
    /\b(fail(?:ed)?|error)\b/i.test(message)
      ? "error"
      : "ok");
  var requestId =
    "srv:" +
    createdAt +
    ":" +
    eventName +
    ":" +
    String((item && item.symbol) || "") +
    ":" + message;
  return {
    requestId: requestId,
    type: eventTypeToHubType(eventName),
    status: inferredStatus,
    createdAt: createdAt,
    completedAt: createdAt,
    symbol: String((item && item.symbol) || ""),
    extra: message,
    message: message,
    event: eventName,
    level: level,
    source: "server",
    durationMs: Number(
      (item && item.duration_ms) ||
        (item && item.durationMs) ||
        (item && item.data && item.data.duration_ms) ||
        (item &&
          item.data &&
          item.data._timing &&
          item.data._timing.total_ms) ||
        0,
    ) || null,
    dbDurationMs: Number(
      (item && item.db_duration_ms) ||
        (item && item.dbDurationMs) ||
        (item && item.data && item.data.db_duration_ms) ||
        (item &&
          item.data &&
          item.data._timing &&
          item.data._timing.db_ms) ||
        0,
    ) || null,
    data: (item && item.data) || item || {},
    cron_name: String((item && item.cron_name) || ""),
    sid: String((item && item.sid) || ""),
    error: errorText,
  };
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
    (entry && entry.data && entry.data.signal_id) ||
      (entry && entry.data && entry.data.id) ||
      (entry && entry.data && entry.data.sid) ||
      (entry &&
        entry.data &&
        entry.data.signal &&
        (entry.data.signal.sid ||
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

export function buildNotificationDisplay(entry) {
  var metaLabel = TYPE_LABELS[entry.type] || "";
  var eventName = String(entry.event || "").trim().toLowerCase();
  var symbol = cleanText(entry.symbol).toUpperCase();
  var extra = cleanText(entry.extra || entry.message || "");
  var status = String(entry.status || "").trim().toLowerCase();
  var tradeSid = resolveTradeSid(entry);
  var signalSid = resolveSignalSid(entry);
  var snapshotFiles = resolveSnapshotFiles(entry);
  var cronName = cleanText(
    (entry.data && entry.data.cron_name) || entry.cron_name || "",
  );
  var tradeLabel =
    tradeSid && symbol
      ? tradeSid + "-" + symbol
      : tradeSid || symbol || "";

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
      title: cronName || "Signal",
      detail: signalSid
        ? signalSid + " created"
        : symbol
          ? symbol + ": created"
          : extra || "Signal created",
    };
  }
  if (eventName === "cron_ai") {
    var aiMatch = extra.match(/^([^-\s,]+)-([A-Z0-9._-]+),\s*(\d+)\s+created$/i);
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
