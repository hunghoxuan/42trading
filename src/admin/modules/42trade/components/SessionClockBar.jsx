import React, { useEffect, useState, useMemo, useRef } from "react";
import "./SessionClockBar.css";
import { playSound, SoundEvents } from "../../../shared/utils/SoundManager";
import Tooltip from "../../../shared/components/Tooltip";
import { api } from "../../../app/api";
import { realtimeClient } from "../realtime/realtimeClientSingleton";
import {
  formatWeekdayDateLabel,
  formatRelativeDurationMs,
  showDateTime,
  getDisplayTimezoneMode,
  normalizeDisplayTimezone,
  setDisplayTimezoneMode,
} from "../../../shared/utils/format";
import {
  KILL_ZONE_WINDOWS_UTC,
  SESSION_WINDOWS_UTC,
} from "./sessionTimeWindows";

const SESSIONS = SESSION_WINDOWS_UTC.map((item) => {
  if (item.id === "asia") {
    return {
      ...item,
      color: "rgba(59, 130, 246, 0.15)",
      borderColor: "rgba(59, 130, 246, 0.4)",
    };
  }
  if (item.id === "london") {
    return {
      ...item,
      color: "rgba(16, 185, 129, 0.15)",
      borderColor: "rgba(16, 185, 129, 0.4)",
    };
  }
  return {
    ...item,
    color: "rgba(249, 115, 22, 0.15)",
    borderColor: "rgba(249, 115, 22, 0.4)",
  };
});

const KILL_ZONES = KILL_ZONE_WINDOWS_UTC.map((item) => {
  if (item.id === "asia_kz") {
    return { ...item, color: "rgba(59, 130, 246, 0.3)" };
  }
  if (item.id === "london_kz") {
    return { ...item, color: "rgba(16, 185, 129, 0.3)" };
  }
  if (item.id === "london_close_kz") {
    return { ...item, color: "rgba(239, 68, 68, 0.3)" };
  }
  return { ...item, color: "rgba(249, 115, 22, 0.3)" };
});

const DISPLAY_TIMEZONE_CYCLE = [
  "Local",
  "America/New_York",
  "UTC",
  "Asia/Ho_Chi_Minh",
];

function shouldLogRealtimeWarnings() {
  try {
    return (
      window.localStorage.getItem("realtime_debug") === "1" ||
      window.localStorage.getItem("chart_debug") === "1"
    );
  } catch {
    return false;
  }
}

function isTransientRealtimeError(error) {
  const type = String(error?.type || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  return (
    type === "disconnect" ||
    type === "connect_error" ||
    message.includes("socket disconnected") ||
    message.includes("socket error") ||
    message.includes("subscribe timeout")
  );
}

export default function SessionClockBar({ displayTimezone }) {
  const [now, setNow] = useState(new Date());
  const [tz, setTz] = useState(
    () =>
      displayTimezone || localStorage.getItem("ui_display_timezone") || "Local",
  );
  const [tzMode, setTzMode] = useState(() => getDisplayTimezoneMode());
  const [news, setNews] = useState([]);
  const saveSeqRef = useRef(0);
  const newsUnsubscribeRef = useRef(null);

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const currentTz =
    tzMode === "local" || String(tz || "").toLowerCase() === "local"
      ? browserTz
      : tz;

  useEffect(() => {
    if (displayTimezone && displayTimezone !== tz) {
      setTz(displayTimezone);
    }
  }, [displayTimezone]);

  useEffect(() => {
    const onTimezoneUiChanged = () => {
      setTzMode(getDisplayTimezoneMode());
      setTz(
        displayTimezone ||
          localStorage.getItem("ui_display_timezone") ||
          "Local",
      );
    };
    window.addEventListener("ui-timezone-changed", onTimezoneUiChanged);
    return () =>
      window.removeEventListener("ui-timezone-changed", onTimezoneUiChanged);
  }, [displayTimezone]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    const fetchNews = async () => {
      try {
        const todayData = await api.calendarToday();
        if (todayData?.ok) setNews(todayData.events || []);
      } catch (e) {
        // ignore network errors
      }
    };
    fetchNews();
    newsUnsubscribeRef.current = realtimeClient.subscribe(
      "news:today",
      {},
      (envelope) => {
        if (envelope?.type !== "snapshot") return;
        const nextEvents = Array.isArray(envelope?.data?.events)
          ? envelope.data.events
          : [];
        setNews(nextEvents);
      },
      {
        onError: (error) => {
          if (!isTransientRealtimeError(error) || shouldLogRealtimeWarnings()) {
            console.warn("[SessionClockBar] realtime news error:", error);
          }
        },
      },
    );

    return () => {
      clearInterval(timer);
      if (typeof newsUnsubscribeRef.current === "function") {
        newsUnsubscribeRef.current();
      }
      newsUnsubscribeRef.current = null;
    };
  }, []);

  const { timeStr, dateStr, progressPct, currentHour } = useMemo(() => {
    try {
      const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: currentTz,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const h = parseInt(parts.find((p) => p.type === "hour").value);
      const m = parseInt(parts.find((p) => p.type === "minute").value);
      const s = parseInt(parts.find((p) => p.type === "second").value);

      const dateLabel = formatWeekdayDateLabel(now, currentTz);

      const totalSeconds = h * 3600 + m * 60 + s;
      const pct = (totalSeconds / (24 * 3600)) * 100;

      return {
        timeStr: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
        dateStr: dateLabel,
        progressPct: pct,
        currentHour: h + m / 60 + s / 3600,
      };
    } catch (e) {
      return {
        timeStr: "--:--:--",
        dateStr: "",
        progressPct: 0,
        currentHour: 0,
      };
    }
  }, [now, currentTz]);

  const timezoneLabel = useMemo(() => {
    const normalizedTz = normalizeDisplayTimezone(currentTz);
    if (tzMode === "local" || normalizedTz === "Local") return "LOCAL";
    if (normalizedTz === "America/New_York") return "NY";
    if (normalizedTz === "UTC") return "UTC";
    if (normalizedTz === "Asia/Ho_Chi_Minh") return "VN";
    return normalizedTz
      .split("/")
      .pop()
      ?.replace(/_/g, " ")
      .toUpperCase() || "TZ";
  }, [currentTz, tzMode]);

  /**
   * Helper to convert a UTC hour to the target timezone's hour-of-day (0-24)
   */
  const getTzHour = (utcHour, utcMin = 0) => {
    const date = new Date();
    date.setUTCHours(utcHour, utcMin, 0, 0);
    try {
      const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: currentTz,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });
      const parts = fmt.formatToParts(date);
      const h = parseInt(parts.find((p) => p.type === "hour").value);
      const m = parseInt(parts.find((p) => p.type === "minute").value);
      return h + m / 60;
    } catch (e) {
      return (utcHour + utcMin / 60) % 24;
    }
  };

  /**
   * Helper to convert EST time to TZ hour
   */
  const getEstToTzHour = (estH, estM = 0) => {
    const date = new Date();
    // Offset for EST (UTC-5) or EDT (UTC-4)
    // For simplicity, we use UTC-5
    const utcHour = (estH + 5) % 24;
    return getTzHour(utcHour, estM);
  };

  const lastZoneRef = useRef(null);

  const activeKillZone = useMemo(() => {
    return KILL_ZONES.find((kz) => {
      const s = getTzHour(kz.start);
      const e = getTzHour(kz.end);
      if (e < s) return currentHour >= s || currentHour < e;
      return currentHour >= s && currentHour < e;
    });
  }, [currentHour, currentTz]);

  useEffect(() => {
    if (activeKillZone && lastZoneRef.current !== activeKillZone.label) {
      playSound(SoundEvents.SESSION_START);
      lastZoneRef.current = activeKillZone.label;
    } else if (!activeKillZone) {
      lastZoneRef.current = null;
    }
  }, [activeKillZone]);

  const countdown = useMemo(() => {
    const allEvents = [];
    KILL_ZONES.forEach((kz) => {
      allEvents.push({ h: getTzHour(kz.start), label: kz.label });
      allEvents.push({ h: getTzHour(kz.end), label: kz.label });
    });

    const future = allEvents
      .map((ev) => ({ ...ev, diff: ev.h - currentHour }))
      .filter((ev) => ev.diff > 0)
      .sort((a, b) => a.diff - b.diff)[0];

    if (!future) return null;
    const mins = Math.floor(future.diff * 60);
    const diffMs = Math.max(0, future.diff * 60 * 60 * 1000);
    return {
      text: `${future.label.toUpperCase()} : ${formatRelativeDurationMs(diffMs)}`,
      mins,
    };
  }, [currentHour, currentTz]);

  const activeNews = useMemo(
    () =>
      (Array.isArray(news) ? news : []).filter(
        (event) => event.phase === "before" || event.phase === "during",
      ),
    [news],
  );

  const nextUpcomingNews = useMemo(() => {
    return (Array.isArray(news) ? news : [])
      .filter((event) => {
        const phase = String(event?.phase || "");
        return phase === "upcoming" || phase === "before";
      })
      .sort((a, b) => Number(a?.start_ts || 0) - Number(b?.start_ts || 0))
      .slice(0, 2);
  }, [news]);

  const newsBadgeTitle = useMemo(() => {
    if (activeNews.length) {
      return activeNews
        .slice(0, 6)
        .map((event) => {
          const phaseText =
            event.phase === "during"
              ? `ends ${formatRelativeDurationMs(
                  Math.max(0, Number(event.minutes_until_end) || 0) * 60 * 1000,
                )}`
              : `${formatRelativeDurationMs(
                  Math.max(0, Number(event.minutes_until_start) || 0) * 60 * 1000,
                )}`;
          return `${event.news_type || event.title}: ${phaseText}`;
        })
        .join("\n");
    }
    if (nextUpcomingNews.length) {
      return nextUpcomingNews
        .map((event) => {
          const diffMs =
            Math.max(0, Number(event.minutes_until_start) || 0) * 60 * 1000;
          return `${event.news_type || event.title}: ${formatRelativeDurationMs(diffMs)}`;
        })
        .join("\n");
    }
    return "";
  }, [activeNews, nextUpcomingNews]);

  const renderRuler = () => {
    const ticks = [];
    // 4 Hour: Major
    for (let i = 0; i <= 24; i += 4) {
      ticks.push(
        <div
          key={`4h-${i}`}
          className="ruler-tick major"
          style={{ left: `${(i / 24) * 100}%` }}
        >
          <span className="tick-label-4h">{String(i).padStart(2, "0")}:00</span>
        </div>,
      );
    }
    // 1 Hour: Sub-major
    for (let i = 0; i <= 24; i++) {
      if (i % 4 === 0) continue; // Skip if 4h already rendered
      ticks.push(
        <div
          key={`1h-${i}`}
          className="ruler-tick sub-major"
          style={{ left: `${(i / 24) * 100}%` }}
        >
          <span className="tick-label-1h">{String(i).padStart(2, "0")}:00</span>
        </div>,
      );
    }
    // 15 Minute: Minor
    for (let i = 0; i <= 24 * 4; i++) {
      const hours = i / 4;
      if (hours % 1 === 0) continue; // Skip if 1h/4h already rendered
      ticks.push(
        <div
          key={`15m-${i}`}
          className="ruler-tick minor"
          style={{ left: `${(hours / 24) * 100}%` }}
        />,
      );
    }
    return ticks;
  };

  const renderRegions = (data, isKillZone = false) => {
    return data.map((item) => {
      let startTz = getTzHour(item.start);
      let endTz = getTzHour(item.end);
      const regions = [];
      if (endTz < startTz) {
        regions.push({ s: startTz, e: 24 });
        regions.push({ s: 0, e: endTz });
      } else {
        regions.push({ s: startTz, e: endTz });
      }

      return regions.map((r, idx) => {
        // Determine if active
        const isActive = currentHour >= r.s && currentHour < r.e;

        return (
          <div
            key={`${item.id}-${idx}`}
            className={`session-region ${isKillZone ? "killzone" : ""} ${isActive ? "active" : "inactive"}`}
            style={{
              left: `${(r.s / 24) * 100}%`,
              width: `${((r.e - r.s) / 24) * 100}%`,
              backgroundColor: isActive
                ? item.color
                : "rgba(100, 100, 100, 0.05)",
              borderLeft:
                isActive && item.borderColor
                  ? `2px solid ${item.borderColor}`
                  : "none",
              borderRight:
                isActive && item.borderColor
                  ? `2px solid ${item.borderColor}`
                  : "none",
            }}
          >
            {!isKillZone ? (
              <span className="session-label">{item.label}</span>
            ) : (
              <span
                className="session-label time-minor"
                style={{ fontSize: 8 }}
              >
                {item.label.replace(/ Kill Zone| KZ/g, " KZ")}
              </span>
            )}
            <div className="tooltip">
              {item.label} ({item.start}:00 - {item.end}:00 UTC)
            </div>
          </div>
        );
      });
    });
  };

  const toggleTz = () => {
    const currentTzValue = normalizeDisplayTimezone(displayTimezone || tz);
    const currentIndex = DISPLAY_TIMEZONE_CYCLE.findIndex(
      (value) => value === currentTzValue,
    );
    const next =
      DISPLAY_TIMEZONE_CYCLE[
        currentIndex < 0
          ? 0
          : (currentIndex + 1) % DISPLAY_TIMEZONE_CYCLE.length
      ];
    // Write localStorage BEFORE dispatching so listeners see the new value
    localStorage.setItem("ui_display_timezone", next);
    const mode = next === "Local" ? "local" : "selected";
    setDisplayTimezoneMode(mode);
    setTz(next);
    setTzMode(mode);
    window.dispatchEvent(new Event("ui-timezone-changed"));
    const seq = ++saveSeqRef.current;
    api
      .updateMetadata({
        settings: {
          display_timezone: normalizeDisplayTimezone(next),
        },
      })
      .catch(() => {
        if (saveSeqRef.current !== seq) return;
      });
  };

  return (
    <div className="session-clock-bar-container">
      <div className="session-clock-bar">
        {/* Background Ruler */}
        <div className="ruler-layer">{renderRuler()}</div>

        {/* Sessions & Kill Zones */}
        <div className="regions-layer">
          {renderRegions(SESSIONS)}
          {renderRegions(KILL_ZONES, true)}
        </div>

        {/* Midnight & NY Open Markers */}
        <div
          className="opening-marker midnight"
          style={{ left: `${(getEstToTzHour(0) / 24) * 100}%` }}
        >
          <div className="marker-tag">MIDNIGHT</div>
        </div>
        <div
          className="opening-marker nyopen"
          style={{ left: `${(getEstToTzHour(8, 30) / 24) * 100}%` }}
        >
          <div className="marker-tag">NY OPEN</div>
        </div>

        {/* News Markers */}
        {news.map((ev, idx) => {
          let posPct = null;
          if (ev.start_at) {
            try {
              const eventDate = new Date(ev.start_at);
              const fmt = new Intl.DateTimeFormat("en-GB", {
                timeZone: currentTz,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });
              const parts = fmt.formatToParts(eventDate);
              const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
              const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
              posPct = ((h + m / 60) / 24) * 100;
            } catch {
              posPct = null;
            }
          }
          if (posPct == null) {
            const timeMatch = String(ev.time || "").match(/(\d+):(\d+)(am|pm)/i);
            if (!timeMatch) return null;
            let h = parseInt(timeMatch[1]);
            const m = parseInt(timeMatch[2]);
            const isPm = timeMatch[3].toLowerCase() === "pm";
            if (isPm && h < 12) h += 12;
            if (!isPm && h === 12) h = 0;
            posPct = (getEstToTzHour(h, m) / 24) * 100;
          }
          return (
            <div
              key={`news-${idx}`}
              className="news-marker"
              style={{ left: `${posPct}%` }}
            >
              <div
                className="news-icon"
                style={{
                  background: ev.phase === "during" ? "#f97316" : "#ef4444",
                  boxShadow:
                    ev.phase === "during"
                      ? "0 0 18px rgba(249, 115, 22, 0.75)"
                      : undefined,
                }}
              >
                {ev.phase === "during" ? "N" : "!"}
              </div>
              <div className="news-tooltip">
                <strong>{ev.news_type || ev.title}</strong>
                <br />
                {ev.title}
                <br />
                Impact: {ev.impact} · {ev.start_at
                  ? showDateTime(ev.start_at)
                  : `${ev.time} EST`}
                {ev.effective_symbols?.length ? (
                  <>
                    <br />
                    Symbols: {ev.effective_symbols.slice(0, 6).join(", ")}
                  </>
                ) : null}
              </div>
            </div>
          );
        })}

        {/* Progress Fill (at bottom) */}
        <div className="progress-fill" style={{ width: `${progressPct}%` }} />

        {/* Current Time Marker */}
        <div
          className="current-time-marker"
          style={{ left: `${progressPct}%` }}
        >
          <div className="marker-line" />
          <div className="marker-dot" />
        </div>

        {/* Digital Clock & Timezone (Inside Bar, Right Aligned) */}
        <Tooltip content="Current server time">
          <div
            className="digital-clock-embedded"
            onClick={toggleTz}
            style={{ cursor: "pointer" }}
          >
            {countdown && <div className="countdown-text">{countdown.text}</div>}
            {!activeNews.length && nextUpcomingNews.length ? (
              <div
                className="next-news-text"
                title={newsBadgeTitle || "Next upcoming tracked news"}
              >
                {nextUpcomingNews
                  .map((event) => {
                    const mins = Math.max(
                      0,
                      Number(event.minutes_until_start) || 0,
                    );
                    return `${event.news_type || "NEWS"} ${mins}m`;
                  })
                  .join(" • ")}
              </div>
            ) : null}
            <div
              title={
                activeNews.length
                  ? newsBadgeTitle
                  : nextUpcomingNews.length
                    ? newsBadgeTitle
                    : "NEWS 0 - no active tracked events right now"
              }
              style={{
                fontSize: 9,
                fontWeight: 900,
                color: activeNews.length ? "#fde68a" : "rgba(255,255,255,0.6)",
                letterSpacing: 0.8,
                textTransform: "uppercase",
                marginBottom: 2,
              }}
            >
              {activeNews.length ? "NEWS LIVE" : ""}
            </div>
            <div className="time-value-small">{timeStr}</div>
            <div className="tz-label-small">
              {dateStr ? (
                <span className="tz-date-small">{dateStr}</span>
              ) : null}
              <span className="tz-zone-small">{timezoneLabel}</span>
            </div>
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
