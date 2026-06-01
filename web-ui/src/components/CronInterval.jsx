import { useState, useCallback, useEffect } from "react";

// ── MultiTimeInput ──────────────────────────────────────────────────────────

function MultiTimeInput({ value = "", onChange }) {
  const times = value
    ? value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : ["09:00"];

  const handleChange = (idx, t) => {
    const next = [...times];
    next[idx] = t;
    if (onChange) onChange(next.join(","));
  };

  const handleAdd = () => {
    if (times.length >= 5) return;
    // Auto-increment by 1h from the last time
    const last = times[times.length - 1] || "09:00";
    const [h, m] = last.split(":").map(Number);
    const nextH = (h + 1) % 24;
    const nextTime = `${pad(nextH)}:${pad(m)}`;
    const next = [...times, nextTime];
    if (onChange) onChange(next.join(","));
  };

  const handleRemove = (idx) => {
    const next = times.filter((_, i) => i !== idx);
    if (next.length === 0) next.push("09:00");
    if (onChange) onChange(next.join(","));
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      {times.map((t, i) => (
        <div key={i} style={{ display: "flex", gap: 2, alignItems: "center" }}>
          <input
            type="time"
            value={t}
            onChange={(e) => handleChange(i, e.target.value)}
            style={{ width: 90, fontSize: 12 }}
          />
          {times.length > 1 && (
            <button
              className="secondary-button"
              style={{ padding: "2px 5px", fontSize: 10, minWidth: 20 }}
              onClick={() => handleRemove(i)}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {times.length < 5 && (
        <button
          className="secondary-button"
          style={{ padding: "3px 8px", fontSize: 11 }}
          onClick={handleAdd}
        >
          + Add
        </button>
      )}
    </div>
  );
}

// ── Constants ───────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const INTERVAL_OPTIONS = [
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "30m", seconds: 1800 },
  { label: "1h", seconds: 3600 },
  { label: "2h", seconds: 7200 },
  { label: "3h", seconds: 10800 },
  { label: "4h", seconds: 14400 },
  { label: "6h", seconds: 21600 },
  { label: "8h", seconds: 28800 },
  { label: "12h", seconds: 43200 },
  { label: "1d", seconds: 86400 },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * Parse a cron-style schedule string into structured data.
 * Supports formats:
 *   - "every Ns" / "every Nm" / "every Nh" → interval in seconds
 *   - "at HH:MM on Mon,Wed,Fri" → specific days + time
 */
export function parseCronSchedule(scheduleStr = "") {
  const s = String(scheduleStr || "")
    .trim()
    .toLowerCase();
  if (!s) return { mode: "interval", days: [], time: "", intervalSeconds: 60 };

  // "at HH:MM on Day1,Day2,..." format
  const atMatch = s.match(/^at (\d{1,2}):(\d{2})\s+on\s+(.+)$/);
  if (atMatch) {
    const hour = parseInt(atMatch[1], 10);
    const min = parseInt(atMatch[2], 10);
    const days = atMatch[3]
      .split(",")
      .map((d) => d.trim())
      .map((d) => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase())
      .filter((d) => DAYS.includes(d));
    return {
      mode: "daily",
      days,
      time: `${pad(hour)}:${pad(min)}`,
      intervalSeconds: null,
    };
  }

  // "every Xs/m/h/d" format
  const everyMatch = s.match(/^every\s+(\d+)(s|m|h|d)$/);
  if (everyMatch) {
    const val = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2];
    let seconds = val;
    if (unit === "m") seconds = val * 60;
    else if (unit === "h") seconds = val * 3600;
    else if (unit === "d") seconds = val * 86400;
    return { mode: "interval", days: [], time: "", intervalSeconds: seconds };
  }

  // Fallback: try to match a simple number (assume seconds)
  const numMatch = s.match(/^(\d+)$/);
  if (numMatch) {
    return {
      mode: "interval",
      days: [],
      time: "",
      intervalSeconds: parseInt(numMatch[1], 10),
    };
  }

  return { mode: "interval", days: [], time: "", intervalSeconds: 60 };
}

/**
 * Serialize a schedule object back to a string.
 */
export function formatCronSchedule({ mode, days, time, intervalSeconds }) {
  if (mode === "daily" && time) {
    const dayList =
      days.length > 0 ? days.join(",") : "Mon,Tue,Wed,Thu,Fri,Sat,Sun";
    return `at ${time} on ${dayList}`;
  }
  if (mode === "interval" && intervalSeconds) {
    if (intervalSeconds < 60) return `every ${intervalSeconds}s`;
    if (intervalSeconds < 3600) return `every ${intervalSeconds / 60}m`;
    if (intervalSeconds < 86400) return `every ${intervalSeconds / 3600}h`;
    return `every ${intervalSeconds / 86400}d`;
  }
  return "every 1m";
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * CronInterval — a schedule picker with two modes:
 *   1. Interval: pick from preset cadence options
 *   2. Daily: pick specific days of week + time (HH:MM)
 */
export default function CronInterval({ value = "", onChange }) {
  const parsed = parseCronSchedule(value);
  const [mode, setMode] = useState(parsed.mode);
  const [days, setDays] = useState(
    parsed.mode === "daily" && parsed.days.length === 0
      ? [...DAYS]
      : parsed.days,
  );
  const [time, setTime] = useState(parsed.time || "09:00");
  const [intervalSeconds, setIntervalSeconds] = useState(
    parsed.intervalSeconds || 60,
  );

  // Sync state when value prop changes (e.g. after save/load)
  useEffect(() => {
    const p = parseCronSchedule(value);
    setMode(p.mode);
    setDays(p.mode === "daily" && p.days.length === 0 ? [...DAYS] : p.days);
    setTime(p.time || "09:00");
    setIntervalSeconds(p.intervalSeconds || 60);
  }, [value]);

  const emit = useCallback(
    (m, d, t, is) => {
      const schedule = formatCronSchedule({
        mode: m,
        days: d,
        time: t,
        intervalSeconds: is,
      });
      if (onChange) onChange(schedule);
    },
    [onChange],
  );

  const handleModeChange = (newMode) => {
    setMode(newMode);
    emit(newMode, days, time, intervalSeconds);
  };

  const handleDayToggle = (day) => {
    const next = days.includes(day)
      ? days.filter((d) => d !== day)
      : [...days, day];
    setDays(next);
    emit(mode, next, time, intervalSeconds);
  };

  const handleTimeChange = (t) => {
    setTime(t);
    emit(mode, days, t, intervalSeconds);
  };

  const handleIntervalChange = (label) => {
    const opt = INTERVAL_OPTIONS.find((o) => o.label === label);
    const sec = opt ? opt.seconds : 60;
    setIntervalSeconds(sec);
    emit(mode, days, time, sec);
  };

  // Find matching label for current interval
  const currentLabel =
    INTERVAL_OPTIONS.find((o) => o.seconds === intervalSeconds)?.label || "1m";

  return (
    <div className="stack-layout" style={{ gap: 10 }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 4 }}>
        <button
          className={`secondary-button${mode === "interval" ? " active" : ""}`}
          style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={() => handleModeChange("interval")}
        >
          Interval
        </button>
        <button
          className={`secondary-button${mode === "daily" ? " active" : ""}`}
          style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={() => handleModeChange("daily")}
        >
          Event
        </button>
      </div>

      {mode === "interval" ? (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {INTERVAL_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              className={`secondary-button${intervalSeconds === opt.seconds ? " active" : ""}`}
              style={{ padding: "4px 8px", fontSize: 11, minWidth: 36 }}
              onClick={() => handleIntervalChange(opt.label)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="stack-layout" style={{ gap: 8 }}>
          {/* Days of week */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {DAYS.map((day) => (
              <button
                key={day}
                className={`secondary-button${days.includes(day) || days.length === 0 ? " active" : ""}`}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  minWidth: 36,
                }}
                onClick={() => handleDayToggle(day)}
              >
                {day}
              </button>
            ))}
          </div>
          <span className="minor-text" style={{ fontSize: 10 }}>
            {days.length === 0 || days.length === 7
              ? "Every day"
              : `${days.length} day${days.length > 1 ? "s" : ""} selected`}
          </span>
          {/* Multiple time inputs */}
          <MultiTimeInput value={time} onChange={handleTimeChange} />
        </div>
      )}
    </div>
  );
}
