/**
 * Formats a date value into a human-readable string, respecting the user's selected timezone.
 * Uses localStorage "ui_display_timezone" as the source of truth.
 */
const DISPLAY_TIMEZONE_OPTIONS = new Set(["UTC", "America/New_York", "Local"]);
const DISPLAY_TIMEZONE_MODE_OPTIONS = new Set(["selected", "local"]);

function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function isValidIanaTimezone(value) {
  const tz = String(value || "").trim();
  if (!tz) return false;
  try {
    // Throws RangeError for invalid timezone names.
    new Intl.DateTimeFormat("en-GB", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function asNumValue(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export function formatNumValue(val, decimals = 2) {
  const n = asNumValue(val);
  if (n === null) return "-";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function normalizeDisplayTimezone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Local";
  if (raw === "UTC") return "UTC";
  if (raw === "America/New_York" || raw === "NewYork" || raw === "New York") return "America/New_York";
  if (raw.toLowerCase() === "local") return "Local";
  if (DISPLAY_TIMEZONE_OPTIONS.has(raw)) return raw;
  if (isValidIanaTimezone(raw)) return raw;
  return "Local";
}

export function normalizeDisplayTimezoneMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (DISPLAY_TIMEZONE_MODE_OPTIONS.has(raw)) return raw;
  return "selected";
}

export function getDisplayTimezoneMode() {
  try {
    return normalizeDisplayTimezoneMode(
      localStorage.getItem("ui_display_timezone_mode"),
    );
  } catch {
    return "selected";
  }
}

export function setDisplayTimezoneMode(mode) {
  const next = normalizeDisplayTimezoneMode(mode);
  try {
    localStorage.setItem("ui_display_timezone_mode", next);
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(
      new CustomEvent("ui-timezone-changed", { detail: { mode: next } }),
    );
  } catch {
    // ignore
  }
  return next;
}

export function getEffectiveDisplayTimezone() {
  const selected = normalizeDisplayTimezone(
    localStorage.getItem("ui_display_timezone"),
  );
  const mode = getDisplayTimezoneMode();
  if (mode === "local") return "Local";
  return selected;
}

export function resolveDisplayTimezone(timezone) {
  const normalized = normalizeDisplayTimezone(
    timezone || getEffectiveDisplayTimezone(),
  );
  if (normalized === "Local") {
    return { storageValue: "Local", intlTimeZone: getBrowserTimezone() || "UTC" };
  }
  if (normalized === "UTC" || normalized === "America/New_York") {
    return { storageValue: normalized, intlTimeZone: normalized };
  }
  return { storageValue: "Local", intlTimeZone: getBrowserTimezone() || "UTC" };
}

function getSafeTimezoneConfig(timezone) {
  return resolveDisplayTimezone(timezone);
}

const DURATION_UNITS = [
  { label: "M", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "D", ms: 24 * 60 * 60 * 1000 },
  { label: "h", ms: 60 * 60 * 1000 },
  { label: "m", ms: 60 * 1000 },
  { label: "s", ms: 1000 },
];

export function formatCompactDuration(valueMs, maxParts = 2, minUnitMs = 1000) {
  const totalMs = Math.max(0, Math.floor(Math.abs(Number(valueMs) || 0)));
  if (!Number.isFinite(totalMs) || totalMs <= 0) return "0s";

  let remaining = totalMs;
  const parts = [];
  for (const unit of DURATION_UNITS) {
    if (unit.ms < minUnitMs) continue;
    if (parts.length >= maxParts) break;
    const amount = Math.floor(remaining / unit.ms);
    if (amount <= 0) continue;
    parts.push(`${amount}${unit.label}`);
    remaining -= amount * unit.ms;
  }

  if (!parts.length) {
    if (minUnitMs >= 60 * 1000) return "1m";
    const secs = Math.max(1, Math.round(totalMs / 1000));
    return `${secs}s`;
  }
  return parts.join(" ");
}

export function formatRelativeDurationMs(diffMs, maxParts = 2) {
  const numericDiff = Number(diffMs);
  if (!Number.isFinite(numericDiff)) return "";
  const absMs = Math.abs(numericDiff);
  const roundedMs = Math.max(absMs, 60 * 1000);
  const body = formatCompactDuration(roundedMs, maxParts, 60 * 1000);
  return numericDiff > 0 ? `~ ${body}` : `${body} ago`;
}

export function formatRelativeDateTime(val, maxParts = 2) {
  if (!val) return "-";
  const date = new Date(val);
  if (Number.isNaN(date.getTime())) return String(val);
  return formatRelativeDurationMs(date.getTime() - Date.now(), maxParts);
}

function formatDateParts(date, timezone) {
  const tzConfig = getSafeTimezoneConfig(timezone);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tzConfig.intlTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const getPart = (type) => parts.find((p) => p.type === type)?.value;
  const d = getPart("day");
  const m = getPart("month");
  const y = getPart("year");
  const hh = getPart("hour");
  const mm = getPart("minute");
  return { tzConfig, d, m, y, hh, mm };
}

export function formatWeekdayDateLabel(val, timezone) {
  if (!val) return "";
  const date = new Date(val);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const tzConfig = getSafeTimezoneConfig(timezone);
    const weekday = new Intl.DateTimeFormat("en-GB", {
      timeZone: tzConfig.intlTimeZone,
      weekday: "short",
    }).format(date);
    const { d, m } = formatDateParts(date, timezone);
    if (!weekday || !d || !m) return "";
    return `${weekday} ${d}.${m}`;
  } catch {
    return "";
  }
}

export function formatChartDateTime(val, timezone) {
  if (!val) return "-";
  const date = new Date(val);
  if (Number.isNaN(date.getTime())) return String(val);
  try {
    const { tzConfig, d, m, y, hh, mm } = formatDateParts(date, timezone);
    const now = new Date();
    const fmtShort = new Intl.DateTimeFormat("en-GB", {
      timeZone: tzConfig.intlTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const nowParts = fmtShort.formatToParts(now);
    const todayDay = nowParts.find((p) => p.type === "day")?.value;
    const todayMonth = nowParts.find((p) => p.type === "month")?.value;
    const todayYear = nowParts.find((p) => p.type === "year")?.value;
    if (d === todayDay && m === todayMonth && y === todayYear) {
      return `${hh}:${mm}`;
    }
    if (y === todayYear) {
      return `${d}.${m} ${hh}:${mm}`;
    }
    return `${d}.${m}.${y} ${hh}:${mm}`;
  } catch (err) {
    console.error("Format error with timezone:", timezone, err);
    return date.toISOString().replace("T", " ").substring(0, 16);
  }
}

export function showDateTime(val, timezone) {
  if (!val) return "-";
  const date = new Date(val);
  if (isNaN(date.getTime())) return String(val);
  const diffMs = date.getTime() - Date.now();
  if (Math.abs(diffMs) < 24 * 60 * 60 * 1000) {
    return formatRelativeDurationMs(diffMs);
  }

  const tzConfig = getSafeTimezoneConfig(timezone);

  try {
    const { d, m, y, hh, mm } = formatDateParts(date, timezone);

    const now = new Date();
    const fmtShort = new Intl.DateTimeFormat("en-GB", {
      timeZone: tzConfig.intlTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const nowParts = fmtShort.formatToParts(now);
    const todayDay = nowParts.find((p) => p.type === "day").value;
    const todayMonth = nowParts.find((p) => p.type === "month").value;
    const todayYear = nowParts.find((p) => p.type === "year").value;

    const isToday = d === todayDay && m === todayMonth && y === todayYear;

    if (isToday) {
      return `${hh}:${mm}`;
    } else if (y === todayYear) {
      return `${d}.${m} ${hh}:${mm}`;
    } else {
      return `${d}.${m}.${y} ${hh}:${mm}`;
    }
  } catch (err) {
    console.error("Format error with timezone:", tzConfig.storageValue, err);
    return date.toISOString().replace("T", " ").substring(0, 16);
  }
}

export function formatDurationLabel(startVal, endVal) {
  if (!startVal || !endVal) return "";
  const start = new Date(startVal);
  const end = new Date(endVal);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return "";
  return formatCompactDuration(diffMs, 2, 60 * 1000);
}

export function formatDateTimeWithDuration(value, fromValue, timezone) {
  if (!value) return "-";
  const label = showDateTime(value, timezone);
  const duration = formatDurationLabel(fromValue, value);
  return duration ? `${label} (${duration})` : label;
}

/**
 * Compares two dates to see if they fall on the same day in the user's selected timezone.
 */
export function isSameDay(aMs, bMs) {
  const tzConfig = getSafeTimezoneConfig();
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tzConfig.intlTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return fmt.format(new Date(aMs)) === fmt.format(new Date(bMs));
  } catch (e) {
    const a = new Date(aMs);
    const b = new Date(bMs);
    return a.getUTCDate() === b.getUTCDate() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  }
}

export const TF_WEIGHTS = {
  "m1": 1,
  "1m": 1,
  "m5": 5,
  "5m": 5,
  "m15": 15,
  "15m": 15,
  "m30": 30,
  "30m": 30,
  "h1": 60,
  "1h": 60,
  "h4": 240,
  "4h": 240,
  "d1": 1440,
  "1d": 1440,
  "d": 1440,
  "w1": 10080,
  "1w": 10080,
  "w": 10080,
  "mn1": 43200,
  "1mn": 43200,
  "mn": 43200,
  "manual": 0,
};

export function sortTimeframes(tfs, order = "desc") {
  if (!Array.isArray(tfs)) return [];
  return [...tfs].sort((a, b) => {
    const wa = TF_WEIGHTS[String(a).toLowerCase()] ?? 0;
    const wb = TF_WEIGHTS[String(b).toLowerCase()] ?? 0;
    return order === "desc" ? wb - wa : wa - wb;
  });
}
