import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../app/api";
import EdgeSlidePanel from "./EdgeSlidePanel";
import {
  formatCompactDuration,
  formatRelativeDateTime,
  showDateTime,
} from "../utils/format";
import {
  buildNotificationHubMeta,
  buildNotificationChannels,
} from "../utils/notificationDisplay";
import { HUB_MAX_VISIBLE } from "../../modules/42trade/services/NotificationManager";
import { NotificationFacade } from "../../modules/42trade/services/NotificationFacade";

function formatEntryDuration(entry) {
  var durationMs = Number(entry && entry.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "";
  return formatCompactDuration(durationMs, 2, 1000);
}

function sourceToneStyle(tone) {
  switch (String(tone || "").trim().toLowerCase()) {
    case "trade":
      return {
        color: "#38bdf8",
        border: "rgba(56,189,248,0.28)",
        background: "rgba(56,189,248,0.12)",
      };
    case "symbol":
      return {
        color: "#f59e0b",
        border: "rgba(245,158,11,0.28)",
        background: "rgba(245,158,11,0.12)",
      };
    case "cron":
      return {
        color: "#a78bfa",
        border: "rgba(167,139,250,0.28)",
        background: "rgba(167,139,250,0.12)",
      };
    case "api":
      return {
        color: "#22c55e",
        border: "rgba(34,197,94,0.28)",
        background: "rgba(34,197,94,0.12)",
      };
    case "channel":
      return {
        color: "#f472b6",
        border: "rgba(244,114,182,0.28)",
        background: "rgba(244,114,182,0.12)",
      };
    default:
      return {
        color: "#94a3b8",
        border: "rgba(148,163,184,0.24)",
        background: "rgba(148,163,184,0.1)",
      };
  }
}

function statusToneStyle(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "FAIL":
      return {
        color: "#f87171",
        border: "rgba(239,68,68,0.35)",
        background: "rgba(239,68,68,0.12)",
      };
    case "WARNING":
      return {
        color: "#fbbf24",
        border: "rgba(251,191,36,0.34)",
        background: "rgba(251,191,36,0.12)",
      };
    default:
      return {
        color: "#34d399",
        border: "rgba(16,185,129,0.28)",
        background: "rgba(16,185,129,0.12)",
      };
  }
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
    label: "Trade Draft",
    nav: function (r) {
      var sid =
        (r.data && r.data.signal && r.data.signal.sid) ||
        (r.data &&
          r.data.signal &&
          (r.data.signal.trade_id || r.data.signal.signal_id)) ||
        (r.data && r.data.signal && r.data.signal.id) ||
        (r.data && (r.data.trade_id || r.data.signal_id)) ||
        (r.data && r.data.id) ||
        (r.data && r.data.sid) ||
        "";
      return sid ? "/trades/" + sid : "/trades";
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
    var merged = await NotificationFacade.listMerged(
      api.notificationList,
      HUB_MAX_VISIBLE,
    );
    setResults(merged);
  }, []);

  useEffect(
    function () {
      refresh();
      return NotificationFacade.subscribe(refresh);
    },
    [refresh],
  );

  useEffect(
    function () {
      function refreshIfVisible() {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        refresh().catch(function () {});
      }
      var timer = window.setInterval(refreshIfVisible, 30000);
      window.addEventListener("focus", refreshIfVisible);
      document.addEventListener("visibilitychange", refreshIfVisible);
      return function () {
        window.clearInterval(timer);
        window.removeEventListener("focus", refreshIfVisible);
        document.removeEventListener("visibilitychange", refreshIfVisible);
      };
    },
    [refresh],
  );

  var badgeCount = NotificationFacade.getBadgeCount(results);

  function buildEntryPath(entry) {
    var channels = buildNotificationChannels(entry);
    var tradeChannel = channels.find(function (item) {
      return String(item || "").startsWith("TRADE_");
    });
    if (tradeChannel) {
      return "/trades/" + encodeURIComponent(tradeChannel.slice("TRADE_".length));
    }
    var chartChannel = channels.find(function (item) {
      return String(item || "").startsWith("CHART_");
    });
    if (chartChannel) {
      return "/ai/trade/" + encodeURIComponent(chartChannel.slice("CHART_".length));
    }
    var meta = TYPE_META[entry.type] || {};
    return meta.nav ? meta.nav(entry) : "/";
  }

  var handleClick = function (entry) {
    var path = buildEntryPath(entry);
    // Mark as seen
    NotificationFacade.markSeen(entry.requestId);
    setOpen(false);
    navigate(path);
  };

  var handleClear = function () {
    setResults([]);
    setOpen(false);
    NotificationFacade.clearAllRemote(api.notificationClear);
  };

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <EdgeSlidePanel
        open={open}
        onOpenChange={function (nextOpen) {
          if (typeof window !== "undefined" && nextOpen) {
            window.dispatchEvent(new Event("mobile-nav-close"));
          }
          if (nextOpen) {
            NotificationFacade.markAllSeen();
            refresh();
          }
          setOpen(nextOpen);
        }}
        side="right"
        panelSize="420px"
        mobilePanelSize="66.666vw"
        title="Notification Hub"
        contentClassName="notification-popover"
        headerActions={
          <button
            type="button"
            onClick={handleClear}
            style={{
              background: "none",
              border: "none",
              color: "#ff4d4f",
              cursor: "pointer",
            }}
          >
            Clear all
          </button>
        }
        trigger={
          <button
            type="button"
            className="secondary-button"
            style={{
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
        }
      >
        {results.length === 0 && (
          <div
            className="notification-popover__empty"
            style={{
              padding: "16px 12px",
              fontSize: "11px",
              textAlign: "center",
            }}
          >
            No recent notifications
          </div>
        )}
        {results.map(function (entry) {
          var hubMeta = buildNotificationHubMeta(entry);
          var channels = buildNotificationChannels(entry);
          var duration = formatEntryDuration(entry);
          var toneStyle = sourceToneStyle(hubMeta.tone);
          var statusStyle = statusToneStyle(hubMeta.status);
          return (
            <div
              className="notification-popover__item"
              key={entry.requestId}
              onClick={function () {
                handleClick(entry);
              }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: "11px",
                transition: "background 0.15s",
                lineHeight: 1.35,
              }}
              onMouseEnter={function (e) {
                e.currentTarget.style.background = "var(--hover-soft)";
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
                  }}
                  title={`${hubMeta.sourceType} ${hubMeta.sourceId} ${hubMeta.status} ${hubMeta.message}`}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "9px",
                        lineHeight: 1.2,
                        padding: "2px 6px",
                        borderRadius: 999,
                        border: `1px solid ${toneStyle.border}`,
                        color: toneStyle.color,
                        background: toneStyle.background,
                        flexShrink: 0,
                        textTransform: "uppercase",
                      }}
                    >
                      {hubMeta.sourceType}
                    </span>
                    <span
                      style={{
                        fontSize: "9px",
                        color: "var(--muted)",
                        opacity: 0.9,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {hubMeta.sourceId}
                    </span>
                    <span
                      style={{
                        fontSize: "9px",
                        lineHeight: 1.2,
                        padding: "2px 6px",
                        borderRadius: 999,
                        border: `1px solid ${statusStyle.border}`,
                        color: statusStyle.color,
                        background: statusStyle.background,
                      }}
                    >
                      {hubMeta.status}
                    </span>
                  </div>
                  <div
                    className="notification-popover__detail"
                    style={{
                      marginTop: 3,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {hubMeta.message}
                  </div>
                </div>
                <span
                  className="notification-popover__time"
                  style={{
                    fontSize: "9px",
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  title={showDateTime(entry.createdAt)}
                >
                  <span>{formatRelativeDateTime(entry.createdAt)}</span>
                  {duration ? (
                    <span style={{ opacity: 0.8 }}>
                      · {duration}
                    </span>
                  ) : null}
                </span>
              </div>
              {channels.length ? null : null}
            </div>
          );
        })}
      </EdgeSlidePanel>
    </div>
  );
}
