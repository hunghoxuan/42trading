import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { formatRelativeDateTime, showDateTime } from "../utils/format";
import {
  buildNotificationDisplay,
  eventTypeToHubType,
  isMeaningfulEntry,
  normalizeServerEntry,
} from "../utils/notificationDisplay";

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

function saveResults(list) {
  try {
    localStorage.setItem(HUB_KEY, JSON.stringify(list || []));
  } catch (_) {
    // ignore storage issues
  }
}

function mergeEntries(localEntries, serverEntries) {
  var byId = new Map();
  (Array.isArray(serverEntries) ? serverEntries : []).forEach(function (entry) {
    byId.set(entry.requestId, entry);
  });
  (Array.isArray(localEntries) ? localEntries : []).forEach(function (entry) {
    var existing = byId.get(entry.requestId) || {};
    byId.set(entry.requestId, { ...existing, ...entry });
  });
  return Array.from(byId.values())
    .filter(function (r) {
      return Date.now() - Number(r.createdAt || 0) < TTL;
    })
    .filter(isMeaningfulEntry)
    .sort(function (a, b) {
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    })
    .slice(0, MAX_VISIBLE);
}

var TYPE_META = {
  analyze: {
    label: "Analysis",
    nav: function (r) {
      return "/ai/result?result=" + (r.requestId || "");
    },
  },
  snapshot: {
    label: "Snapshot",
    nav: function (r) {
      return "/system/files?result=" + (r.requestId || "");
    },
  },
  cron_snapshot: {
    label: "Snapshot Cron",
    nav: function () {
      return "/system/files";
    },
  },
  twelve_data: {
    label: "Twelve Data",
    nav: function (r) {
      return "/ai/analyze";
    },
  },
  news_alert: {
    label: "News Alert",
    nav: function () {
      return "/ai/news";
    },
  },
  cancel_trade: {
    label: "Cancel Trade",
    nav: function (r) {
      var sid = (r.data && r.data.sid) || "";
      return sid ? "/trades/" + sid : "/trades";
    },
  },
  close_trade: {
    label: "Close Trade",
    nav: function (r) {
      var sid = (r.data && r.data.sid) || "";
      return sid ? "/trades/" + sid : "/trades";
    },
  },
  create_trade: {
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
  system_event: {
    label: "Notification",
    nav: function () {
      return "/settings/notification";
    },
  },
};

export default function NotificationDot() {
  var navigate = useNavigate();
  var [results, setResults] = useState([]);
  var [open, setOpen] = useState(false);

  var refresh = useCallback(async function () {
    var localEntries = loadResults().filter(function (r) {
      return Date.now() - r.createdAt < TTL;
    });
    try {
      var response = await api.notificationList(MAX_VISIBLE);
      var serverEntries = Array.isArray(response && response.items)
        ? response.items.map(normalizeServerEntry)
        : [];
      var merged = mergeEntries(localEntries, serverEntries);
      saveResults(merged);
      setResults(merged);
      return;
    } catch (_) {
      // fall back to browser-local hub entries only
    }
    setResults(
      localEntries
        .slice()
        .sort(function (a, b) {
          return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        })
        .slice(0, MAX_VISIBLE),
    );
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
  var unread = results.filter(function (r) {
    return !r._seen;
  });
  var badgeCount = unread.length || pending.length;

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
    api.notificationClear().catch(function () {});
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
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("mobile-nav-close"));
          }
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
              var display = buildNotificationDisplay(entry);
              return (
                <div
                  key={entry.requestId}
                  onClick={function () {
                    handleClick(entry);
                  }}
                  style={{
                    padding: "8px 12px",
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
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={
                        display.detail
                          ? display.title + ": " + display.detail
                          : display.title
                      }
                    >
                      <span style={{ fontWeight: 500 }}>{display.title}:</span>
                      {display.detail ? (
                        <span style={{ color: "#9aa0aa", marginLeft: 6 }}>
                          {display.detail}
                        </span>
                      ) : null}
                    </div>
                    <span
                      style={{ color: "#666", fontSize: "9px", flexShrink: 0 }}
                      title={showDateTime(entry.createdAt)}
                    >
                      {formatRelativeDateTime(entry.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
