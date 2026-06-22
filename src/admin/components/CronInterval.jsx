import FormComboSelect from "../../shared/components/FormComboSelect";

const DAY_ROWS = [
  { value: "Mon", label: "Monday" },
  { value: "Tue", label: "Tuesday" },
  { value: "Wed", label: "Wednesday" },
  { value: "Thu", label: "Thursday" },
  { value: "Fri", label: "Friday" },
  { value: "Sat", label: "Saturday" },
  { value: "Sun", label: "Sunday" },
];

export const INTERVAL_OPTIONS = [
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

function pad(value) {
  return String(value).padStart(2, "0");
}

function normalizeDay(value = "") {
  const raw = String(value || "")
    .trim()
    .slice(0, 3)
    .toLowerCase();
  const match = DAY_ROWS.find((item) => item.value.toLowerCase() === raw);
  return match?.value || "";
}

function normalizeTime(value = "", fallback = "00:00") {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return `${pad(hour)}:${pad(minute)}`;
}

function addMinutes(value = "00:00", minutes = 1) {
  const [hour, minute] = normalizeTime(value).split(":").map(Number);
  const total =
    (((hour * 60 + minute + minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function normalizeIntervalSeconds(value, fallback = 60) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(15, Math.round(numeric));
}

export function createDefaultScheduleRows(intervalSeconds = 60) {
  return DAY_ROWS.map((day) => ({
    day: day.value,
    enabled: true,
    from: "00:00",
    to: "23:59",
    interval_seconds: normalizeIntervalSeconds(intervalSeconds, 60),
  }));
}

export function parseLegacyScheduleRows(schedule = "", cadenceSeconds = 60) {
  const raw = String(schedule || "").trim();
  const fallbackInterval = normalizeIntervalSeconds(cadenceSeconds, 60);
  if (!raw) return createDefaultScheduleRows(fallbackInterval);

  const everyMatch = raw.match(/^every\s+(\d+)(s|m|h|d)$/i);
  if (everyMatch) {
    const value = Number(everyMatch[1]);
    const unit = String(everyMatch[2] || "").toLowerCase();
    let seconds = value;
    if (unit === "m") seconds = value * 60;
    else if (unit === "h") seconds = value * 3600;
    else if (unit === "d") seconds = value * 86400;
    return createDefaultScheduleRows(
      normalizeIntervalSeconds(seconds, fallbackInterval),
    );
  }

  const atMatch = raw.match(/^at (\d{1,2}):(\d{2})\s+on\s+(.+)$/i);
  if (atMatch) {
    const from = normalizeTime(`${atMatch[1]}:${atMatch[2]}`, "09:00");
    const enabledDays = new Set(
      String(atMatch[3] || "")
        .split(",")
        .map((item) => normalizeDay(item))
        .filter(Boolean),
    );
    return DAY_ROWS.map((day) => ({
      day: day.value,
      enabled: enabledDays.size === 0 ? true : enabledDays.has(day.value),
      from,
      to: addMinutes(from, 1),
      interval_seconds: 86400,
    }));
  }

  return createDefaultScheduleRows(fallbackInterval);
}

export function normalizeScheduleRows(rows = [], fallbackInterval = 60) {
  const byDay = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const day = normalizeDay(row?.day);
    if (!day) continue;
    byDay.set(day, {
      day,
      enabled: row?.enabled !== false,
      from: normalizeTime(row?.from, "00:00"),
      to: normalizeTime(row?.to, "23:59"),
      interval_seconds: normalizeIntervalSeconds(
        row?.interval_seconds,
        fallbackInterval,
      ),
    });
  }
  return DAY_ROWS.map((day) => {
    const existing = byDay.get(day.value);
    return (
      existing || {
        day: day.value,
        enabled: false,
        from: "00:00",
        to: "23:59",
        interval_seconds: normalizeIntervalSeconds(fallbackInterval, 60),
      }
    );
  });
}

export function summarizeScheduleRows(rows = []) {
  const enabledRows = normalizeScheduleRows(rows).filter((row) => row.enabled);
  if (!enabledRows.length) return "";
  return enabledRows
    .map((row) => {
      const intervalLabel =
        INTERVAL_OPTIONS.find(
          (option) => option.seconds === row.interval_seconds,
        )?.label || `${row.interval_seconds}s`;
      return `${row.day} ${row.from}-${row.to} / ${intervalLabel}`;
    })
    .join("; ");
}

function intervalLabelForSeconds(seconds) {
  return (
    INTERVAL_OPTIONS.find((option) => option.seconds === Number(seconds))
      ?.label || `${Number(seconds || 60)}s`
  );
}

export default function CronInterval({
  rows = [],
  avoidNews = false,
  onChange,
}) {
  const normalizedRows = normalizeScheduleRows(rows);

  function emit(nextRows, nextAvoidNews = avoidNews) {
    onChange?.({
      rows: normalizeScheduleRows(nextRows),
      avoid_news: Boolean(nextAvoidNews),
    });
  }

  function updateRow(day, updates) {
    const nextRows = normalizedRows.map((row) =>
      row.day === day ? { ...row, ...updates } : row,
    );
    emit(nextRows);
  }

  return (
    <div
      className="stack-layout"
      style={{ gap: 12 }}
      data-component="CronScheduleTable"
    >
      <div style={{ overflowX: "auto" }}>
        <table className="cron-schedule-table">
          <thead>
            <tr>
              <th>Days</th>
              <th>From - To</th>
              <th>Repeat (Interval)</th>
            </tr>
          </thead>
          <tbody>
            {normalizedRows.map((row) => (
              <tr key={row.day}>
                <td>
                  <label className="cron-schedule-day">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(event) =>
                        updateRow(row.day, { enabled: event.target.checked })
                      }
                    />
                    <span>
                      {DAY_ROWS.find((item) => item.value === row.day)?.label ||
                        row.day}
                    </span>
                  </label>
                </td>
                <td>
                  <div className="cron-schedule-time-range">
                    <input
                      type="time"
                      value={row.from}
                      disabled={!row.enabled}
                      onChange={(event) =>
                        updateRow(row.day, { from: event.target.value })
                      }
                    />
                    <span className="minor-text">-</span>
                    <input
                      type="time"
                      value={row.to}
                      disabled={!row.enabled}
                      onChange={(event) =>
                        updateRow(row.day, { to: event.target.value })
                      }
                    />
                  </div>
                </td>
                <td>
                  <FormComboSelect
                    value={intervalLabelForSeconds(row.interval_seconds)}
                    onChange={(event) => {
                      const nextLabel = event?.target?.value || "1m";
                      const nextInterval =
                        INTERVAL_OPTIONS.find(
                          (option) => option.label === nextLabel,
                        )?.seconds || 60;
                      updateRow(row.day, { interval_seconds: nextInterval });
                    }}
                    disabled={!row.enabled}
                    aria-label={`Repeat interval for ${row.day}`}
                    className="cron-schedule-interval"
                  >
                    {INTERVAL_OPTIONS.map((option) => (
                      <option key={option.label} value={option.label}>
                        {option.label}
                      </option>
                    ))}
                  </FormComboSelect>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <label className="cron-schedule-avoid-news">
        <input
          type="checkbox"
          checked={Boolean(avoidNews)}
          onChange={(event) => emit(normalizedRows, event.target.checked)}
        />
        <span>Avoid News</span>
      </label>
    </div>
  );
}
