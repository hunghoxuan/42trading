import InputComboSelect from "../../../shared/components/InputComboSelect";
import DateTimePicker from "../../../shared/components/DateTimePicker";

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

const TEMPLATE_OPTIONS = [
  { value: "", label: "Templates" },
  { value: "24x7", label: "24/7" },
  { value: "weekdays", label: "Weekdays" },
  { value: "london", label: "London" },
  { value: "newyork", label: "New York" },
];

let windowSeed = 0;

function nextWindowId() {
  windowSeed += 1;
  return `w${windowSeed}`;
}

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

function normalizeExactTimes(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,;]+/)
        .map((item) => item.trim());
  return [...new Set(raw.map((item) => normalizeTime(item, "")).filter(Boolean))];
}

function createDefaultWindow(intervalSeconds = 60, overrides = {}) {
  const base = {
    id: nextWindowId(),
    mode: "interval",
    from: "00:00",
    to: "23:59",
    interval_seconds: normalizeIntervalSeconds(intervalSeconds, 60),
    exact_times: [],
  };
  return normalizeWindow({ ...base, ...overrides }, intervalSeconds, base.id);
}

function normalizeWindow(window = {}, fallbackInterval = 60, fallbackId = "") {
  const mode = String(window?.mode || "interval").trim().toLowerCase();
  const normalizedMode = mode === "exact" ? "exact" : "interval";
  const exactTimes = normalizeExactTimes(window?.exact_times);
  const derivedFrom = exactTimes[0] || normalizeTime(window?.from, "00:00");
  const derivedTo =
    exactTimes[exactTimes.length - 1] ||
    normalizeTime(window?.to, normalizedMode === "exact" ? addMinutes(derivedFrom, 1) : "23:59");
  return {
    id: String(window?.id || fallbackId || nextWindowId()),
    mode: normalizedMode,
    from: normalizeTime(window?.from, derivedFrom),
    to: normalizeTime(window?.to, derivedTo),
    interval_seconds: normalizeIntervalSeconds(
      window?.interval_seconds,
      fallbackInterval,
    ),
    exact_times: exactTimes,
  };
}

function windowsFromLegacyRow(row = {}, fallbackInterval = 60, day = "") {
  const from = normalizeTime(row?.from, "00:00");
  const to = normalizeTime(row?.to, "23:59");
  return [
    createDefaultWindow(fallbackInterval, {
      id: `${day || "day"}-0`,
      mode:
        Array.isArray(row?.exact_times) && row.exact_times.length > 0
          ? "exact"
          : String(row?.mode || "interval").trim().toLowerCase() === "exact"
            ? "exact"
            : "interval",
      from,
      to,
      interval_seconds: normalizeIntervalSeconds(
        row?.interval_seconds,
        fallbackInterval,
      ),
      exact_times: normalizeExactTimes(row?.exact_times),
    }),
  ];
}

function normalizeWindows(windows = [], fallbackInterval = 60, row = {}, day = "") {
  const rawWindows =
    Array.isArray(windows) && windows.length
      ? windows
      : windowsFromLegacyRow(row, fallbackInterval, day);
  return rawWindows.map((window, index) =>
    normalizeWindow(window, fallbackInterval, `${day || "day"}-${index}`),
  );
}

export function createDefaultScheduleRows(intervalSeconds = 60) {
  return DAY_ROWS.map((day) => {
    const windows = [createDefaultWindow(intervalSeconds, { id: `${day.value}-0` })];
    return {
      day: day.value,
      enabled: true,
      from: windows[0].from,
      to: windows[0].to,
      interval_seconds: windows[0].interval_seconds,
      mode: windows[0].mode,
      exact_times: windows[0].exact_times,
      windows,
    };
  });
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
    const exactTime = normalizeTime(`${atMatch[1]}:${atMatch[2]}`, "09:00");
    const enabledDays = new Set(
      String(atMatch[3] || "")
        .split(",")
        .map((item) => normalizeDay(item))
        .filter(Boolean),
    );
    return DAY_ROWS.map((day) => {
      const windows = [
        createDefaultWindow(86400, {
          id: `${day.value}-0`,
          mode: "exact",
          from: exactTime,
          to: addMinutes(exactTime, 1),
          interval_seconds: 86400,
          exact_times: [exactTime],
        }),
      ];
      return {
        day: day.value,
        enabled: enabledDays.size === 0 ? true : enabledDays.has(day.value),
        from: windows[0].from,
        to: windows[0].to,
        interval_seconds: windows[0].interval_seconds,
        mode: windows[0].mode,
        exact_times: windows[0].exact_times,
        windows,
      };
    });
  }

  return createDefaultScheduleRows(fallbackInterval);
}

export function normalizeScheduleRows(rows = [], fallbackInterval = 60) {
  const byDay = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const day = normalizeDay(row?.day);
    if (!day) continue;
    const windows = normalizeWindows(
      row?.windows,
      fallbackInterval,
      row,
      day,
    );
    const primaryWindow = windows[0] || createDefaultWindow(fallbackInterval);
    byDay.set(day, {
      day,
      enabled: row?.enabled !== false,
      from: primaryWindow.from,
      to: primaryWindow.to,
      interval_seconds: primaryWindow.interval_seconds,
      mode: primaryWindow.mode,
      exact_times: primaryWindow.exact_times,
      windows,
    });
  }
  return DAY_ROWS.map((day) => {
    const existing = byDay.get(day.value);
    if (existing) return existing;
    const windows = [createDefaultWindow(fallbackInterval, { id: `${day.value}-0` })];
    return {
      day: day.value,
      enabled: false,
      from: windows[0].from,
      to: windows[0].to,
      interval_seconds: windows[0].interval_seconds,
      mode: windows[0].mode,
      exact_times: windows[0].exact_times,
      windows,
    };
  });
}

function formatWindowSummary(window = {}) {
  if (window?.mode === "exact") {
    const exactTimes = normalizeExactTimes(window?.exact_times);
    return exactTimes.length ? `@ ${exactTimes.join(", ")}` : "@ --";
  }
  const intervalLabel =
    INTERVAL_OPTIONS.find(
      (option) => option.seconds === Number(window?.interval_seconds),
    )?.label || `${Number(window?.interval_seconds || 60)}s`;
  return `${normalizeTime(window?.from, "00:00")}-${normalizeTime(window?.to, "23:59")} / ${intervalLabel}`;
}

export function summarizeScheduleRows(rows = []) {
  const enabledRows = normalizeScheduleRows(rows).filter((row) => row.enabled);
  if (!enabledRows.length) return "";
  return enabledRows
    .map((row) => {
      const windowSummary = (row.windows || []).map(formatWindowSummary).join(" | ");
      return `${row.day} ${windowSummary}`;
    })
    .join("; ");
}

export function resolveScheduleCadenceSeconds(rows = [], fallback = 60) {
  const normalizedRows = normalizeScheduleRows(rows, fallback);
  for (const row of normalizedRows) {
    if (!row.enabled) continue;
    const intervalWindow = (row.windows || []).find(
      (window) => window.mode !== "exact",
    );
    if (intervalWindow) {
      return normalizeIntervalSeconds(intervalWindow.interval_seconds, fallback);
    }
  }
  return normalizeIntervalSeconds(fallback, 60);
}

function getWallClockParts(dateMs, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "UTC",
    weekday: "short",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(dateMs));
  const weekday = parts.find((part) => part.type === "weekday")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || NaN);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value || NaN,
  );
  return {
    dayName: DAY_ROWS.find(
      (item) => item.value.toLowerCase() === weekday.slice(0, 3).toLowerCase(),
    )?.value,
    label: `${day} ${month} ${String(parts.find((part) => part.type === "hour")?.value || "").padStart(2, "0")}:${String(parts.find((part) => part.type === "minute")?.value || "").padStart(2, "0")}`,
    minutes:
      Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : NaN,
  };
}

function previewMatchesWindow(window, currentMinutes) {
  if (window?.mode === "exact") {
    return normalizeExactTimes(window?.exact_times).some(
      (exactTime) => {
        const [hour, minute] = exactTime.split(":").map(Number);
        return hour * 60 + minute === currentMinutes;
      },
    );
  }
  const fromMinutes = Number(window?.from?.slice(0, 2) || 0) * 60 + Number(window?.from?.slice(3, 5) || 0);
  const toMinutes = Number(window?.to?.slice(0, 2) || 0) * 60 + Number(window?.to?.slice(3, 5) || 0);
  if (currentMinutes < fromMinutes || currentMinutes > toMinutes) return false;
  const intervalMinutes = Math.max(
    1,
    Math.round(Number(window?.interval_seconds || 60) / 60),
  );
  return (currentMinutes - fromMinutes) % intervalMinutes === 0;
}

function buildSchedulePreview(rows, timezone, limit = 5) {
  const normalizedRows = normalizeScheduleRows(rows);
  const results = [];
  const startMs = Date.now();
  for (let cursor = startMs; cursor < startMs + 14 * 24 * 60 * 60 * 1000; cursor += 60000) {
    const wallClock = getWallClockParts(cursor, timezone);
    const dayRow = normalizedRows.find(
      (row) => row.enabled && row.day === wallClock.dayName,
    );
    if (!dayRow || !Number.isFinite(wallClock.minutes)) continue;
    const match = (dayRow.windows || []).some((window) =>
      previewMatchesWindow(window, wallClock.minutes),
    );
    if (!match) continue;
    results.push(wallClock.label);
    if (results.length >= limit) break;
  }
  return results;
}

function intervalLabelForSeconds(seconds) {
  return (
    INTERVAL_OPTIONS.find((option) => option.seconds === Number(seconds))
      ?.label || `${Number(seconds || 60)}s`
  );
}

function scheduleTypeValue(window = {}) {
  if (window?.mode === "exact") return "exact";
  return `interval:${Number(window?.interval_seconds || 60)}`;
}

function buildTemplateRows(template, fallbackInterval = 60) {
  const createRows = () => createDefaultScheduleRows(fallbackInterval);
  if (template === "weekdays") {
    return createRows().map((row) => ({
      ...row,
      enabled: row.day !== "Sat" && row.day !== "Sun",
    }));
  }
  if (template === "london") {
    return createRows().map((row) => {
      const enabled = row.day !== "Sat" && row.day !== "Sun";
      const windows = [
        createDefaultWindow(900, {
          id: `${row.day}-0`,
          from: "07:00",
          to: "11:00",
          interval_seconds: 900,
        }),
        createDefaultWindow(900, {
          id: `${row.day}-1`,
          from: "13:00",
          to: "16:00",
          interval_seconds: 900,
        }),
      ];
      return {
        ...row,
        enabled,
        from: windows[0].from,
        to: windows[0].to,
        interval_seconds: windows[0].interval_seconds,
        mode: windows[0].mode,
        exact_times: windows[0].exact_times,
        windows,
      };
    });
  }
  if (template === "newyork") {
    return createRows().map((row) => {
      const enabled = row.day !== "Sat" && row.day !== "Sun";
      const windows = [
        createDefaultWindow(900, {
          id: `${row.day}-0`,
          from: "09:30",
          to: "12:00",
          interval_seconds: 900,
        }),
        createDefaultWindow(900, {
          id: `${row.day}-1`,
          from: "13:00",
          to: "16:00",
          interval_seconds: 900,
        }),
      ];
      return {
        ...row,
        enabled,
        from: windows[0].from,
        to: windows[0].to,
        interval_seconds: windows[0].interval_seconds,
        mode: windows[0].mode,
        exact_times: windows[0].exact_times,
        windows,
      };
    });
  }
  return createRows();
}

export default function CronInterval({
  rows = [],
  avoidNews = false,
  timezone = "UTC",
  headerControls = null,
  onChange,
}) {
  const normalizedRows = normalizeScheduleRows(rows);
  const previewItems = buildSchedulePreview(normalizedRows, timezone, 5);
  const leftColumnRows = normalizedRows.slice(0, 4);
  const rightColumnRows = normalizedRows.slice(4);

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

  function updateWindow(day, windowId, updates) {
    const nextRows = normalizedRows.map((row) => {
      if (row.day !== day) return row;
      const windows = (row.windows || []).map((window) =>
        window.id === windowId
          ? normalizeWindow({ ...window, ...updates }, row.interval_seconds, window.id)
          : window,
      );
      const primaryWindow = windows[0] || createDefaultWindow(row.interval_seconds);
      return {
        ...row,
        from: primaryWindow.from,
        to: primaryWindow.to,
        interval_seconds: primaryWindow.interval_seconds,
        mode: primaryWindow.mode,
        exact_times: primaryWindow.exact_times,
        windows,
      };
    });
    emit(nextRows);
  }

  function addWindow(day) {
    const nextRows = normalizedRows.map((row) => {
      if (row.day !== day) return row;
      const intervalSeconds = resolveScheduleCadenceSeconds([row], row.interval_seconds);
      const windows = [
        ...(row.windows || []),
        createDefaultWindow(intervalSeconds, {
          id: `${day}-${(row.windows || []).length}`,
          from: "09:00",
          to: "17:00",
        }),
      ];
      return { ...row, windows };
    });
    emit(nextRows);
  }

  function removeWindow(day, windowId) {
    const nextRows = normalizedRows.map((row) => {
      if (row.day !== day) return row;
      const remaining = (row.windows || []).filter((window) => window.id !== windowId);
      const windows = remaining.length
        ? remaining
        : [createDefaultWindow(row.interval_seconds, { id: `${day}-0` })];
      const primaryWindow = windows[0];
      return {
        ...row,
        from: primaryWindow.from,
        to: primaryWindow.to,
        interval_seconds: primaryWindow.interval_seconds,
        mode: primaryWindow.mode,
        exact_times: primaryWindow.exact_times,
        windows,
      };
    });
    emit(nextRows);
  }

  function applyTemplate(template) {
    emit(buildTemplateRows(template, resolveScheduleCadenceSeconds(normalizedRows, 60)));
  }

  return (
    <div
      className="stack-layout"
      style={{ gap: 12 }}
      data-component="CronScheduleTable"
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "end",
          flexWrap: "wrap",
        }}
      >
        <label className="stack-layout" style={{ gap: 6, minWidth: 150 }}>
          <span className="minor-text">Templates</span>
          <InputComboSelect
            value=""
            onChange={(event) => {
              const nextTemplate = String(event?.target?.value || "").trim();
              if (nextTemplate) applyTemplate(nextTemplate);
            }}
          >
            {TEMPLATE_OPTIONS.map((option) => (
              <option key={option.value || "blank"} value={option.value}>
                {option.label}
              </option>
            ))}
          </InputComboSelect>
        </label>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>{headerControls}</div>
      </div>

      <div className="stack-layout" style={{ gap: 6 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            padding: "0 0 4px 0",
          }}
        >
          <div className="minor-text" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Day | Interval | From | To | Repeat
          </div>
          <div className="minor-text" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Day | Interval | From | To | Repeat
          </div>
        </div>
        {Array.from({ length: Math.max(leftColumnRows.length, rightColumnRows.length) }, (_, pairIndex) => {
          const pair = [leftColumnRows[pairIndex], rightColumnRows[pairIndex]].filter(Boolean);
          return (
            <div
              key={`pair-${pairIndex}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                padding: "8px 0",
                borderBottom: "1px solid rgba(148,163,184,0.12)",
                alignItems: "start",
              }}
            >
              {pair.map((row) => (
                <div key={row.day} className="stack-layout" style={{ gap: 6 }}>
                  {row.enabled ? (
                    <div className="stack-layout" style={{ gap: 4 }}>
                      {(row.windows || []).map((window, index) => (
                        <div
                          key={window.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "92px 118px 92px 92px 34px 34px",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {index === 0 ? (
                              <>
                                <input
                                  type="checkbox"
                                  checked={row.enabled}
                                  onChange={(event) =>
                                    updateRow(row.day, { enabled: event.target.checked })
                                  }
                                />
                                <span>{row.day}</span>
                              </>
                            ) : (
                              <div />
                            )}
                          </div>
                          <InputComboSelect
                            value={scheduleTypeValue(window)}
                            onChange={(event) => {
                              const nextValue = String(event?.target?.value || "exact");
                              if (nextValue === "exact") {
                                updateWindow(row.day, window.id, {
                                  mode: "exact",
                                });
                                return;
                              }
                              const nextInterval = Number(
                                nextValue.replace(/^interval:/, ""),
                              );
                              updateWindow(row.day, window.id, {
                                mode: "interval",
                                interval_seconds:
                                  Number.isFinite(nextInterval) && nextInterval > 0
                                    ? nextInterval
                                    : 60,
                              });
                            }}
                          >
                            <option value="exact">Exact time</option>
                            {INTERVAL_OPTIONS.map((option) => (
                              <option
                                key={option.label}
                                value={`interval:${option.seconds}`}
                              >
                                {option.label}
                              </option>
                            ))}
                          </InputComboSelect>

                          {window.mode === "exact" ? (
                            <>
                              <input
                                type="text"
                                value={(window.exact_times || []).join(", ")}
                                placeholder="09:00, 12:30"
                                onChange={(event) =>
                                  updateWindow(row.day, window.id, {
                                    exact_times: normalizeExactTimes(event.target.value),
                                  })
                                }
                                style={{ gridColumn: "3 / span 2" }}
                              />
                            </>
                          ) : (
                            <>
                              <DateTimePicker
                                mode="time"
                                value={window.from}
                                onChange={(event) =>
                                  updateWindow(row.day, window.id, {
                                    from: event.target.value,
                                  })
                                }
                              />
                              <DateTimePicker
                                mode="time"
                                value={window.to}
                                onChange={(event) =>
                                  updateWindow(row.day, window.id, {
                                    to: event.target.value,
                                  })
                                }
                              />
                            </>
                          )}
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => removeWindow(row.day, window.id)}
                            disabled={(row.windows || []).length <= 1}
                            title={`Remove window ${index + 1}`}
                            style={{ minWidth: 0, padding: "4px 0", gridColumn: "5" }}
                          >
                            X
                          </button>
                          {index === (row.windows || []).length - 1 ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => addWindow(row.day)}
                              style={{ minWidth: 0, padding: "4px 8px", gridColumn: "6" }}
                              title={`Add window for ${row.day}`}
                            >
                              +
                            </button>
                          ) : (
                            <div style={{ gridColumn: "6" }} />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "92px 118px 92px 92px 34px 34px",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={(event) =>
                            updateRow(row.day, { enabled: event.target.checked })
                          }
                        />
                        <span>{row.day}</span>
                      </label>
                      <div className="minor-text">Disabled</div>
                    </div>
                  )}
                </div>
              ))}
              {pair.length === 1 ? <div /> : null}
            </div>
          );
        })}
      </div>

      <label className="cron-schedule-avoid-news">
        <input
          type="checkbox"
          checked={Boolean(avoidNews)}
          onChange={(event) => emit(normalizedRows, event.target.checked)}
        />
        <span>Avoid News</span>
      </label>

      <div className="stack-layout" style={{ gap: 4 }}>
        <span className="minor-text">Next Runs ({timezone})</span>
        <div className="minor-text">
          {previewItems.length ? previewItems.join(" • ") : "No upcoming runs in the next 14 days"}
        </div>
      </div>
    </div>
  );
}
