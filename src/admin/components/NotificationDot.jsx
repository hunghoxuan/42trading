import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import EdgeSlidePanel from "../../shared/components/EdgeSlidePanel";
import {
  formatCompactDuration,
  formatRelativeDateTime,
  showDateTime,
} from "../utils/format";
import {
  buildNotificationDisplay,
  isErrorEntry,
} from "../utils/notificationDisplay";
import { HUB_MAX_VISIBLE } from "../services/NotificationManager";
import { NotificationFacade } from "../services/NotificationFacade";

function formatEntryDuration(entry) {
  var durationMs = Number(entry && entry.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "";
  return formatCompactDuration(durationMs, 2, 1000);
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

  var badgeCount = NotificationFacade.getBadgeCount(results);

  var handleClick = function (entry) {
    var meta = TYPE_META[entry.type] || {};
    var path = meta.nav ? meta.nav(entry) : "/";
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
        title="Notifications"
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
          var display = buildNotificationDisplay(entry);
          var isError = isErrorEntry(entry);
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
                lineHeight: 1.4,
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
                  <span
                    className={isError ? "msg-error" : undefined}
                    style={{ fontWeight: 500 }}
                  >
                    {display.title}:
                  </span>
                  {display.detail ? (
                    <span
                      className="notification-popover__detail"
                      style={{ marginLeft: 6 }}
                    >
                      {display.detail}
                    </span>
                  ) : null}
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
                  {formatEntryDuration(entry) ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        opacity: 0.85,
                      }}
                      title={`Duration ${formatEntryDuration(entry)}`}
                    >
                      <span aria-hidden="true">⏱</span>
                      <span>{formatEntryDuration(entry)}</span>
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
          );
        })}
      </EdgeSlidePanel>
    </div>
  );
}
