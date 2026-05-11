// NotificationHub — Unified event & API call tracking
var HUB = "hub:results",
  MAX = 50,
  TTL = 3600000,
  BC_NAME = "notification-hub";
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
  try {
    var r = localStorage.getItem(HUB);
    return r ? JSON.parse(r) : [];
  } catch (e) {
    return [];
  }
}

function save(list) {
  var f = list
    .filter(function (r) {
      return Date.now() - r.createdAt < TTL;
    })
    .slice(-MAX);
  localStorage.setItem(HUB, JSON.stringify(f));
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
  create_trade: "📈",
  create_signal: "📡",
};

function track(type, pay, fetchFn) {
  var id =
    type + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  var sym = (pay && pay.symbol) || (pay && pay.signal_id) || "";
  var key = type + ":" + sym;
  if (pending.has(key)) return { requestId: id, promise: pending.get(key) };

  var entry = {
    requestId: id,
    type: type,
    symbol: sym,
    status: "running",
    createdAt: Date.now(),
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
      entry.status = "ok";
      entry.data = d;
      save(
        load().map(function (r) {
          return r.requestId === id ? entry : r;
        }),
      );
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
      save(
        load().map(function (r) {
          return r.requestId === id ? entry : r;
        }),
      );
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
  var msg =
    entry.status === "ok"
      ? icon + " " + entry.type + ": " + (entry.symbol || "done")
      : icon + " " + entry.type + " failed: " + (entry.error || "error");
  emit("SYSTEM_EVENT", "api_complete", {
    message: msg,
    requestId: entry.requestId,
    type: "info",
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
  localStorage.removeItem(HUB);
}

var NotificationHub = {
  emit: emit,
  on: on,
  track: track,
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
  onResult,
  getResult,
  listResults,
  clearResults,
};
