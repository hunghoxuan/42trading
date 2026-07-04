export const BACKTEST_TIME_RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "two_weeks", label: "2 weeks" },
  { value: "one_month", label: "1 month" },
  { value: "two_months", label: "2 months" },
  { value: "one_year", label: "1 year" },
  { value: "custom", label: "Custom" },
];

function parseDateInput(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function parseNow(value) {
  if (value instanceof Date) return new Date(value.getTime());
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatDateInput(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeframeMinutes(tfRaw) {
  const normalized = String(tfRaw || "").trim().toLowerCase();
  if (normalized === "1m" || normalized === "1") return 1;
  if (normalized === "5m" || normalized === "5") return 5;
  if (normalized === "15m" || normalized === "15") return 15;
  if (normalized === "1h" || normalized === "60") return 60;
  if (normalized === "4h" || normalized === "240") return 240;
  if (normalized === "1d" || normalized === "1440") return 1440;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 15;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function addUtcYears(date, years) {
  return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
}

export function calculateBarsForDateRange({
  timeframe = "15",
  startDate = "",
  endDate = "",
}) {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);
  if (!start || !end || end < start) return 0;
  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  const totalMinutes = dayCount * 24 * 60;
  return Math.max(1, Math.ceil(totalMinutes / timeframeMinutes(timeframe)));
}

export function resolveTimeRangePreset(preset = "today", now = new Date()) {
  const today = startOfUtcDay(parseNow(now));
  const end = today;
  if (preset === "today") return { startDate: formatDateInput(today), endDate: formatDateInput(end) };
  if (preset === "this_week") {
    const weekday = today.getUTCDay();
    const offset = weekday === 0 ? 6 : weekday - 1;
    return {
      startDate: formatDateInput(addUtcDays(today, -offset)),
      endDate: formatDateInput(end),
    };
  }
  if (preset === "two_weeks") {
    return { startDate: formatDateInput(addUtcDays(today, -13)), endDate: formatDateInput(end) };
  }
  if (preset === "one_month") {
    return { startDate: formatDateInput(addUtcMonths(today, -1)), endDate: formatDateInput(end) };
  }
  if (preset === "two_months") {
    return { startDate: formatDateInput(addUtcMonths(today, -2)), endDate: formatDateInput(end) };
  }
  if (preset === "one_year") {
    return { startDate: formatDateInput(addUtcYears(today, -1)), endDate: formatDateInput(end) };
  }
  return { startDate: "", endDate: "" };
}

export function resolveTimeRangeSelection({
  mode = "bars",
  timeframe = "15",
  preset = "today",
  startDate = "",
  endDate = "",
  now = new Date(),
}) {
  if (String(mode || "bars") !== "time_range") {
    return {
      mode: "bars",
      preset,
      startDate,
      endDate,
      limit: "",
    };
  }

  const normalizedPreset = String(preset || "today").trim() || "today";
  const presetRange =
    normalizedPreset === "custom"
      ? { startDate: String(startDate || "").trim(), endDate: String(endDate || "").trim() }
      : resolveTimeRangePreset(normalizedPreset, now);
  const bars = calculateBarsForDateRange({
    timeframe,
    startDate: presetRange.startDate,
    endDate: presetRange.endDate,
  });

  return {
    mode: "time_range",
    preset: normalizedPreset,
    startDate: presetRange.startDate,
    endDate: presetRange.endDate,
    limit: bars > 0 ? String(bars) : "",
  };
}
