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

function getSafeTimezoneConfig() {
  const normalized = getEffectiveDisplayTimezone();
  if (normalized === "Local") {
    return { storageValue: "Local", intlTimeZone: getBrowserTimezone() || "UTC" };
  }
  if (normalized === "UTC" || normalized === "America/New_York") {
    return { storageValue: normalized, intlTimeZone: normalized };
  }
  return { storageValue: "Local", intlTimeZone: getBrowserTimezone() || "UTC" };
}

export function showDateTime(val) {
  if (!val) return "-";
  const date = new Date(val);
  if (isNaN(date.getTime())) return String(val);
  const nowMs = Date.now();
  const diffMs = nowMs - date.getTime();
  if (diffMs >= 0 && diffMs < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.floor(diffMs / (60 * 1000)));
    return `${mins} mins ago`;
  }

  const tzConfig = getSafeTimezoneConfig();

  try {
    // Use Intl.DateTimeFormat to convert the date to the desired timezone
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tzConfig.intlTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = fmt.formatToParts(date);
    const getPart = (type) => parts.find(p => p.type === type)?.value;

    const d = getPart('day');
    const m = getPart('month');
    const y = getPart('year');
    const hh = getPart('hour');
    const mm = getPart('minute');

    // For relative date comparison (Today/Yesterday), we also need to get "now" in that same timezone
    const now = new Date();
    const fmtShort = new Intl.DateTimeFormat('en-GB', {
      timeZone: tzConfig.intlTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    const nowParts = fmtShort.formatToParts(now);
    const todayStr = `${nowParts.find(p => p.type === 'day').value}.${nowParts.find(p => p.type === 'month').value}.${nowParts.find(p => p.type === 'year').value}`;
    
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yestParts = fmtShort.formatToParts(yesterday);
    const yesterdayStr = `${yestParts.find(p => p.type === 'day').value}.${yestParts.find(p => p.type === 'month').value}.${yestParts.find(p => p.type === 'year').value}`;

    const targetStr = `${d}.${m}.${y}`;

    let datePart = "";
    if (targetStr === todayStr) {
      datePart = "Today";
    } else if (targetStr === yesterdayStr) {
      datePart = "Yesterday";
    } else if (y === nowParts.find(p => p.type === 'year').value) {
      datePart = `${d}.${m}`;
    } else {
      datePart = `${d}.${m}.${y}`;
    }

    return `${datePart} ${hh}:${mm}`;
  } catch (err) {
    console.error("Format error with timezone:", tzConfig.storageValue, err);
    // Final fallback to basic UTC if formatting still fails.
    return date.toISOString().replace('T', ' ').substring(0, 16);
  }
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

export function asNum(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export function formatNumber(val, decimals = 2) {
  const n = asNum(val);
  if (n === null) return "-";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
