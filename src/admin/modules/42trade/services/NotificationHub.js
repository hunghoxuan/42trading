// NotificationHub — Unified event & API call tracking
import {
  HUB_BROADCAST_CHANNEL,
  HUB_MAX_VISIBLE,
  HUB_TTL_MS,
  loadNotificationEntries,
  normalizeHubEntry,
  persistNotificationEntry,
  replaceNotificationEntry,
  clearNotificationEntries,
  saveNotificationEntries,
} from "./NotificationManager.js";
import { normalizeActivityResult } from "../../../shared/utils/activityResult.js";

var MAX = HUB_MAX_VISIBLE,
  TTL = HUB_TTL_MS,
  BC_NAME = HUB_BROADCAST_CHANNEL;
var listeners = new Map(),
  pending = new Map(),
  resultL = new Map();
var bc = null;
try {
  bc = new BroadcastChannel(BC_NAME);
} catch (_) {
  /* not supported */
}

function load() {
  return loadNotificationEntries();
}

function save(list) {
  saveNotificationEntries(list);
}

function persistServerNotification(entry) {
  try {
    var normalized = persistNotificationEntry(entry);
    window.dispatchEvent(new CustomEvent("hub-result", { detail: normalized }));
    if (bc) {
      try {
        bc.postMessage({ type: "hub-result", entry: normalized });
      } catch (_) {}
    }
  } catch (_) {}
}

function normalizeEntry(entry) {
  return normalizeHubEntry(entry);
}

function record(entry) {
  var normalized = normalizeEntry(entry);
  persistServerNotification(normalized);
  return normalized;
}

function emit(evt, sub, pay) {
  var e = { event: evt, subType: sub, payload: pay };
  var s = listeners.get(evt);
  if (s)
    s.forEach(function (fn) {
      fn(e);
    });
  window.dispatchEvent(new CustomEvent("hub-event", { detail: e }));
  if (pay && pay.page_id && pay.data != null) {
    window.dispatchEvent(
      new CustomEvent("data-update", {
        detail: { page_id: pay.page_id, data: pay.data },
      }),
    );
  }
  // Persist selected server-driven events into hub history
  // so they show in the Notification bell list.
  try {
    var evName = String((pay && pay.event) || evt || "").toLowerCase();
    var subName = String(sub || (pay && pay.sub_type) || "").toLowerCase();
    var now = Date.now();
    var payloadMessage = String((pay && pay.message) || "").trim();
    var payloadType = String((pay && pay.type) || "info").trim().toLowerCase();
    var payloadResult = normalizeActivityResult(pay || {}, {
      ok: !((pay && pay.ok) === false),
    });
    var payloadStatus =
      String((pay && pay.status) || payloadResult.status || "")
        .trim()
        .toLowerCase() ||
      (payloadType === "error" ? "error" : "info");
    var payloadEventId =
      String((pay && pay.requestId) || "").trim() ||
      [
        "hub",
        String((pay && pay.t) || now),
        evName || String(evt || "").toLowerCase(),
        String((pay && pay.source_type) || ""),
        String((pay && pay.source_id) || ""),
        payloadMessage,
      ].join(":");
    var shouldPersistGeneric =
      Boolean(payloadMessage) &&
      pay &&
      pay.hub !== false &&
      pay.notification !== false &&
      evName !== "cron_tick" &&
      evName !== "cron_md";
    if (shouldPersistGeneric) {
      persistServerNotification({
        requestId: payloadEventId,
        type: "system_event",
        symbol: String((pay && pay.symbol) || "").toUpperCase(),
        status: payloadStatus,
        createdAt: Number(new Date((pay && pay.t) || now).getTime()) || now,
        completedAt: Number(new Date((pay && pay.t) || now).getTime()) || now,
        message: String(payloadResult.message || payloadMessage || "").trim(),
        extra: String(payloadResult.message || payloadMessage || "").trim(),
        event: String((pay && pay.event) || evt || ""),
        level: payloadType,
        source: "server",
        source_type: String((pay && pay.source_type) || ""),
        source_id: String((pay && pay.source_id) || ""),
        durationMs:
          Number((pay && pay.duration_ms) || (pay && pay.durationMs) || 0) ||
          null,
        dbDurationMs:
          Number((pay && pay.db_duration_ms) || (pay && pay.dbDurationMs) || 0) ||
          null,
        data: pay || {},
        result: payloadResult,
        meta: pay || {},
        error:
          payloadStatus === "error"
            ? String((pay && pay.error) || payloadMessage || "")
            : "",
      });
    }
    if (!shouldPersistGeneric && evName === "snapshot_created") {
      var symbol = String((pay && pay.symbol) || "").toUpperCase();
      var timeframe = String((pay && pay.timeframe) || "");
      var reqId =
        "snapshot_evt_" + now + "_" + Math.random().toString(36).slice(2, 6);
      persistServerNotification({
        requestId: reqId,
        type: "snapshot",
        symbol: symbol,
        status: "info",
        createdAt: now,
        completedAt: now,
        extra: timeframe ? "TF: " + timeframe : "",
        result: normalizeActivityResult(
          { message: timeframe ? "TF: " + timeframe : "Snapshot created", processed: 1 },
          { ok: true },
        ),
        data: pay || {},
        meta: pay || {},
      });
    }
    // Cron events already come from the canonical server notification list.
    // Do not persist them again locally here, otherwise the bell shows
    // duplicate entries (for example `cron` + `cron_snapshot`) with the same message.
    if (!shouldPersistGeneric && evName === "news") {
      var nowNews = Date.now();
      var reqIdNews =
        "news_evt_" + nowNews + "_" + Math.random().toString(36).slice(2, 6);
      var title = String(
        (pay && (pay.title || pay.news_type || pay.message)) || "News Alert",
      );
      var symbols = Array.isArray(pay && pay.effective_symbols)
        ? pay.effective_symbols.slice(0, 4).join(", ")
        : "";
      persistServerNotification({
        requestId: reqIdNews,
        type: "news_alert",
        symbol: String((pay && pay.news_type) || "NEWS").toUpperCase(),
        status: "info",
        createdAt: nowNews,
        completedAt: nowNews,
        extra: symbols ? title + " • " + symbols : title,
        result: normalizeActivityResult(
          { message: symbols ? title + " • " + symbols : title, processed: 1 },
          { ok: true },
        ),
        data: pay || {},
        meta: pay || {},
      });
    }
  } catch (_) {}
}

function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return function () {
    listeners.get(evt).delete(fn);
  };
}

var ICONS = {
  analyze: "🧠",
  snapshot: "📷",
  cron: "⏱️",
  news_alert: "📰",
  create_trade: "📈",
  create_signal: "📡",
};

function track(type, pay, fetchFn) {
  var id =
    type + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  var sym = (pay && pay.symbol) || (pay && (pay.trade_id || pay.signal_id)) || "";
  var key = type + ":" + sym;
  if (pending.has(key)) return { requestId: id, promise: pending.get(key) };

  var entry = {
    requestId: id,
    type: type,
    symbol: sym,
    status: "running",
    createdAt: Date.now(),
    result: {
      status: "running",
      message: "Running",
      processed: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      created_ids: [],
      updated_ids: [],
      deleted_ids: [],
      affected_ids: [],
      errors: [],
    },
    meta: pay,
  };
  var list = load();
  list.push(entry);
  save(list);
  window.dispatchEvent(
    new CustomEvent("hub-status", { detail: { id: id, status: "running" } }),
  );

  var p = fetchFn()
    .then(function (d) {
      entry.status = "info";
      entry.data = d;
      entry.result = normalizeActivityResult(d || {}, { ok: true });
      entry.completedAt = Date.now();
      entry.durationMs = Math.max(0, entry.completedAt - entry.createdAt);
      if (d && typeof d === "object") {
        entry.extra = d._notify_extra || d.extra || "";
        if (d._timing && typeof d._timing === "object") {
          var totalMs = Number(d._timing.total_ms);
          var dbMs = Number(d._timing.db_ms);
          if (Number.isFinite(totalMs)) entry.durationMs = totalMs;
          if (Number.isFinite(dbMs)) entry.dbDurationMs = dbMs;
        }
      }
      replaceNotificationEntry(entry);
      window.dispatchEvent(new CustomEvent("hub-result", { detail: entry }));
      if (bc) {
        try {
          bc.postMessage({ type: "hub-result", entry: entry });
        } catch (_) {}
      }
      done(entry);
      return d;
    })
    .catch(function (e) {
      entry.status = "error";
      entry.error = (e && e.message) || String(e);
      entry.result = normalizeActivityResult(
        {
          ok: false,
          message: entry.error,
          errors: [{ code: "request_failed", message: entry.error }],
        },
        { ok: false },
      );
      entry.completedAt = Date.now();
      entry.durationMs = Math.max(0, entry.completedAt - entry.createdAt);
      if (e && e.apiTiming) {
        var totalMs = Number(e.apiTiming.total_ms);
        var dbMs = Number(e.apiTiming.db_ms);
        if (Number.isFinite(totalMs)) entry.durationMs = totalMs;
        if (Number.isFinite(dbMs)) entry.dbDurationMs = dbMs;
      }
      replaceNotificationEntry(entry);
      window.dispatchEvent(new CustomEvent("hub-result", { detail: entry }));
      if (bc) {
        try {
          bc.postMessage({ type: "hub-result", entry: entry });
        } catch (_) {}
      }
      done(entry);
      throw e;
    })
    .finally(function () {
      pending.delete(key);
    });

  pending.set(key, p);
  return { requestId: id, promise: p };
}

function done(entry) {
  var icon = ICONS[entry.type] || "🔔";
  var msg, evType;
  var resultStatus = String((entry && entry.result && entry.result.status) || entry.status || "")
    .trim()
    .toLowerCase();
  var displayMessage =
    (entry && entry.result && entry.result.message) || entry.message || entry.error || "";
  if (resultStatus === "info" || resultStatus === "success" || resultStatus === "ok") {
    msg = displayMessage || icon + " " + entry.type + ": " + (entry.symbol || "done");
    evType = "info";
  } else if (resultStatus === "warn" || resultStatus === "warning" || entry.status === "no_data") {
    msg = displayMessage || icon + " " + entry.type + ": " + (entry.symbol || "") + " - no data";
    evType = "warning";
  } else {
    msg = displayMessage || icon + " " + entry.type + " failed: " + (entry.error || "error");
    evType = "error";
  }
  emit("SYSTEM_EVENT", "api_complete", {
    message: msg,
    requestId: entry.requestId,
    type: evType,
    ticker: true,
    toast: true,
    data: entry,
  });
  var subs = resultL.get(entry.requestId);
  if (subs)
    subs.forEach(function (fn) {
      fn(entry);
    });
}

function onResult(id, fn) {
  if (!resultL.has(id)) resultL.set(id, new Set());
  resultL.get(id).add(fn);
  return function () {
    resultL.get(id).delete(fn);
  };
}

function getResult(id) {
  return (
    load().find(function (r) {
      return r.requestId === id;
    }) || null
  );
}
function listResults(type) {
  var a = load();
  return type
    ? a.filter(function (r) {
        return r.type === type;
      })
    : a;
}
function clearResults() {
  clearNotificationEntries();
}

var NotificationHub = {
  emit: emit,
  on: on,
  track: track,
  record: record,
  onResult: onResult,
  getResult: getResult,
  listResults: listResults,
  clearResults: clearResults,
};
export {
  NotificationHub,
  emit,
  on,
  track,
  record,
  onResult,
  getResult,
  listResults,
  clearResults,
};
