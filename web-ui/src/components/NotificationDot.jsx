import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

var HUB_KEY = "hub:results",
  TTL = 3600000,
  MAX_VISIBLE = 50;

function loadResults() {
  try {
    var raw = localStorage.getItem(HUB_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

var TYPE_META = {
  analyze: {
    icon: "🧠",
    label: "Analysis",
    nav: function (r) {
      return "/ai/result?result=" + (r.requestId || "");
    },
  },
  snapshot: {
    icon: "📷",
    label: "Snapshot",
    nav: function (r) {
      return "/system/files?result=" + (r.requestId || "");
    },
  },
  twelve_data: {
    icon: "📡",
    label: "Twelve Data",
    nav: function (r) {
      return "/ai/analyze";
    },
  },
  cancel_trade: {
    icon: "🚫",
    label: "Cancel Trade",
    nav: function (r) {
      var sid = (r.data && r.data.sid) || "";
      return sid ? "/trades/" + sid : "/trades";
    },
  },
  close_trade: {
    icon: "✅",
    label: "Close Trade",
    nav: function (r) {
      var sid = (r.data && r.data.sid) || "";
      return sid ? "/trades/" + sid : "/trades";
    },
  },
  create_trade: {
    icon: "📈",
    label: "Trade",
    nav: function (r) {
      var sid =
        (r.data && r.data.trade && r.data.trade.sid) ||
        (r.data && r.data.sid) ||
        "";
      return sid ? "/trades/" + sid : "/trades";
    },
  },
  create_signal: {
    icon: "📡",
    label: "Signal",
    nav: function (r) {
      var sid =
        (r.data && r.data.signal && r.data.signal.sid) ||
        (r.data && r.data.signal && r.data.signal.signal_id) ||
        (r.data && r.data.signal && r.data.signal.id) ||
        (r.data && r.data.signal_id) ||
        (r.data && r.data.id) ||
        (r.data && r.data.sid) ||
        "";
      return sid ? "/signals/" + sid : "/signals";
    },
  },
};

function statusIcon(s) {
  if (s === "running") return "⏳";
  if (s === "ok") return "✅";
  if (s === "no_data") return "⚠️";
  return "❌";
}

export default function NotificationDot() {
  var navigate = useNavigate();
  var [results, setResults] = useState([]);
  var [open, setOpen] = useState(false);

  var refresh = useCallback(function () {
    var all = loadResults().filter(function (r) {
      return Date.now() - r.createdAt < TTL;
    });
    setResults(all.slice(-MAX_VISIBLE).reverse());
  }, []);

  useEffect(
    function () {
      refresh();
      var onHub = function () {
        refresh();
      };
      window.addEventListener("hub-status", onHub);
      window.addEventListener("hub-result", onHub);
      // Cross-tab sync
      var bc;
      try {
        bc = new BroadcastChannel("notification-hub");
        bc.onmessage = function () {
          refresh();
        };
      } catch (_) {
        /* not supported */
      }
      return function () {
        window.removeEventListener("hub-status", onHub);
        window.removeEventListener("hub-result", onHub);
        if (bc) bc.close();
      };
    },
    [refresh],
  );

  var pending = results.filter(function (r) {
    return r.status === "running";
  });
  var badgeCount = pending.length;

  var handleClick = function (entry) {
    var meta = TYPE_META[entry.type] || {};
    var path = meta.nav ? meta.nav(entry) : "/";
    // Mark as seen
    var all = loadResults();
    var updated = all.map(function (r) {
      return r.requestId === entry.requestId ? { ...r, _seen: true } : r;
    });
    localStorage.setItem(HUB_KEY, JSON.stringify(updated));
    setOpen(false);
    navigate(path);
  };

  var handleClear = function () {
    localStorage.removeItem(HUB_KEY);
    setResults([]);
    setOpen(false);
  };

  var formatTime = function (ts) {
    var d = new Date(ts);
    var h = String(d.getHours()).padStart(2, "0");
    var m = String(d.getMinutes()).padStart(2, "0");
    var s = String(d.getSeconds()).padStart(2, "0");
    return h + ":" + m + ":" + s;
  };

  var formatDurationMs = function (startTs, endTs) {
    var s = Number(startTs || 0);
    if (!Number.isFinite(s) || s <= 0) return "0ms";
    var e = Number(endTs || Date.now());
    if (!Number.isFinite(e) || e < s) e = s;
    return String(Math.max(0, Math.round(e - s))) + "ms";
  };

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <button
        type="button"
        className="secondary-button"
        onClick={function () {
          if (!open) {
            // Mark all as read when opening
            var all = loadResults();
            var updated = all.map(function (r) {
              return { ...r, _seen: true };
            });
            localStorage.setItem(HUB_KEY, JSON.stringify(updated));
          }
          setOpen(!open);
          refresh();
        }}
        style={{
          padding: "4px 10px",
          fontSize: "11px",
          marginLeft: "10px",
          minWidth: "40px",
          position: "relative",
        }}
        title="Notifications"
      >
        🔔
        {badgeCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "#ff4d4f",
              color: "#fff",
              borderRadius: "50%",
              width: 16,
              height: 16,
              fontSize: "9px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
          >
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9998 }}
            onClick={function () {
              setOpen(false);
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              zIndex: 9999,
              background: "var(--bg-secondary, #1a1a2e)",
              border: "1px solid var(--border-color, #333)",
              borderRadius: 8,
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              minWidth: 320,
              maxWidth: 420,
              maxHeight: 400,
              overflow: "auto",
            }}
          >
            <div
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid var(--border-color, #333)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "11px",
                fontWeight: 600,
              }}
            >
              <span>Notifications</span>
              <button
                type="button"
                onClick={handleClear}
                style={{
                  background: "none",
                  border: "none",
                  color: "#ff4d4f",
                  cursor: "pointer",
                  fontSize: "10px",
                }}
              >
                Clear all
              </button>
            </div>
            {results.length === 0 && (
              <div
                style={{
                  padding: "16px 12px",
                  fontSize: "11px",
                  color: "#888",
                  textAlign: "center",
                }}
              >
                No recent notifications
              </div>
            )}
            {results.map(function (entry) {
              var meta = TYPE_META[entry.type] || {
                icon: "🔔",
                label: entry.type,
              };
              return (
                <div
                  key={entry.requestId}
                  onClick={function () {
                    handleClick(entry);
                  }}
                  style={{
                    padding: "5px 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    fontSize: "11px",
                    transition: "background 0.15s",
                    lineHeight: 1.4,
                  }}
                  onMouseEnter={function (e) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  }}
                  onMouseLeave={function (e) {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span style={{ fontSize: "14px", flexShrink: 0 }}>
                      {statusIcon(entry.status)}
                    </span>
                    <span
                      style={{
                        fontWeight: 500,
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {meta.icon} {meta.label}
                      {entry.symbol ? ": " + entry.symbol : ""}
                      {entry.status === "running" ? " - In progress..." : ""}
                      {entry.status === "error"
                        ? " - " + String(entry.error || "Failed")
                        : ""}
                    </span>
                    <span
                      style={{ color: "#666", fontSize: "9px", flexShrink: 0 }}
                    >
                      {formatTime(entry.createdAt)} +{formatDurationMs(entry.createdAt, entry.completedAt)}
                    </span>
                  </div>
                  {entry.extra &&
                  entry.status !== "running" &&
                  entry.status !== "error" ? (
                    <div
                      style={{
                        color: "#888",
                        fontSize: "10px",
                        paddingLeft: 20,
                      }}
                    >
                      {entry.extra}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
