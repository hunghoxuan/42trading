import React, { useEffect, useState, useMemo, useRef } from "react";
import "./SessionClockBar.css";
import { playSound, SoundEvents } from "../utils/SoundManager";
import {
  getDisplayTimezoneMode,
  setDisplayTimezoneMode,
} from "../utils/format";

/**
 * Sessions and Kill Zones defined in UTC hours (0-24)
 */
const SESSIONS = [
  {
    id: "asia",
    label: "Asian Session",
    start: 0,
    end: 9,
    color: "rgba(59, 130, 246, 0.15)",
    borderColor: "rgba(59, 130, 246, 0.4)",
  },
  {
    id: "london",
    label: "London Session",
    start: 8,
    end: 17,
    color: "rgba(16, 185, 129, 0.15)",
    borderColor: "rgba(16, 185, 129, 0.4)",
  },
  {
    id: "ny",
    label: "NY Session",
    start: 13,
    end: 22,
    color: "rgba(249, 115, 22, 0.15)",
    borderColor: "rgba(249, 115, 22, 0.4)",
  },
];

const KILL_ZONES = [
  {
    id: "asia_kz",
    label: "Asian Kill Zone",
    start: 1,
    end: 5,
    color: "rgba(59, 130, 246, 0.3)",
  },
  {
    id: "london_kz",
    label: "London Kill Zone",
    start: 7,
    end: 10,
    color: "rgba(16, 185, 129, 0.3)",
  },
  {
    id: "ny_kz",
    label: "New York Kill Zone",
    start: 12,
    end: 15,
    color: "rgba(249, 115, 22, 0.3)",
  },
  {
    id: "london_close_kz",
    label: "London Close KZ",
    start: 15,
    end: 17,
    color: "rgba(239, 68, 68, 0.3)",
  },
];

export default function SessionClockBar({ displayTimezone }) {
  const [now, setNow] = useState(new Date());
  const [tz, setTz] = useState(
    () =>
      displayTimezone || localStorage.getItem("ui_display_timezone") || "Local",
  );
  const [tzMode, setTzMode] = useState(() => getDisplayTimezoneMode());
  const [news, setNews] = useState([]);

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

    // Fetch News Today
    const fetchNews = async () => {
      try {
        const res = await fetch("/v2/calendar/today");
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          // ignore HTML responses or other non-JSON
          return;
        }
        if (data.ok) setNews(data.events || []);
      } catch (e) {
        // ignore network errors
      }
    };
    fetchNews();
    const newsTimer = setInterval(fetchNews, 300000); // Every 5m

    return () => {
      clearInterval(timer);
      clearInterval(newsTimer);
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

      const dateFmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: currentTz,
        day: "numeric",
        month: "numeric",
      });
      const dateParts = dateFmt.formatToParts(now);
      const d = dateParts.find((p) => p.type === "day")?.value || "";
      const mo = dateParts.find((p) => p.type === "month")?.value || "";
      const dateLabel = d && mo ? `${d}.${mo}` : "";

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
    return { text: `${future.label.toUpperCase()} : ${mins}'`, mins };
  }, [currentHour, currentTz]);

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
                className="session-label"
                style={{ fontSize: 8, opacity: 0.7 }}
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
    const nextMode = tzMode === "local" ? "selected" : "local";
    setTzMode(setDisplayTimezoneMode(nextMode));
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
          // Parse time like "10:00am"
          const timeMatch = ev.time.match(/(\d+):(\d+)(am|pm)/i);
          if (!timeMatch) return null;
          let h = parseInt(timeMatch[1]);
          const m = parseInt(timeMatch[2]);
          const isPm = timeMatch[3].toLowerCase() === "pm";
          if (isPm && h < 12) h += 12;
          if (!isPm && h === 12) h = 0;
          // FF feed is in EST
          const posPct = (getEstToTzHour(h, m) / 24) * 100;
          return (
            <div
              key={`news-${idx}`}
              className="news-marker"
              style={{ left: `${posPct}%` }}
            >
              <div className="news-icon">!</div>
              <div className="news-tooltip">
                <strong>{ev.title}</strong>
                <br />
                Impact: {ev.impact} · {ev.time} EST
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
        <div
          className="digital-clock-embedded"
          onClick={toggleTz}
          style={{ cursor: "pointer" }}
        >
          {countdown && <div className="countdown-text">{countdown.text}</div>}
          <div className="time-value-small">{timeStr}</div>
          <div className="tz-label-small">
            {dateStr ? `${dateStr} ` : ""}
            {tzMode === "local"
              ? "LOCAL"
              : currentTz.split("/").pop().replace("_", " ")}
          </div>
        </div>
      </div>
    </div>
  );
}
