import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { showToast } from "../../shared/components/ToastContainer";
import { showDateTime } from "../utils/format";
import {
  asMoney,
  asMoneySigned,
  asPct,
  asRR,
  moneyClass,
} from "../utils/numberFormat";
import CronRunLauncher from "../components/CronRunLauncher";
import ComboButtonMenu from "../../shared/components/ComboButtonMenu";
import GroupButtons from "../../shared/components/GroupButtons";
import PageHeader from "../../shared/components/PageHeader";
import ResponsivePanel from "../../shared/components/ResponsivePanel";

const RANGE_OPTIONS = [
  { val: "all", lab: "ALL TIMES" },
  { val: "today", lab: "Today" },
  { val: "yesterday", lab: "Yesterday" },
  { val: "last_week", lab: "Last week" },
  { val: "last_month", lab: "Last month" },
  { val: "week", lab: "This Week" },
  { val: "month", lab: "This Month" },
  { val: "year", lab: "This Year" },
];
const SIDE_OPTIONS = [
  { val: "", lab: "ALL SIDES" },
  { val: "BUY", lab: "BUY" },
  { val: "SELL", lab: "SELL" },
];
const PNL_STATE_OPTIONS = [
  { val: "", lab: "WIN / LOSE" },
  { val: "win", lab: "PNL > 0" },
  { val: "lose", lab: "PNL < 0" },
];
function getDashboardAutoRefreshMs() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return 10000;
    const raw = Number(
      window.localStorage.getItem("tvbridge_refresh_ms") || 10000,
    );
    return Number.isFinite(raw) && raw > 0 ? raw : 10000;
  } catch {
    return 10000;
  }
}

const AUTO_REFRESH_MS = getDashboardAutoRefreshMs();

const PERIOD_DISPLAY = [
  { key: "filled_open", lab: "Now" },
  { key: "today", lab: "Today" },
  { key: "week", lab: "This Week" },
  { key: "month", lab: "This Month" },
  { key: "year", lab: "This Year" },
  { key: "all", lab: "All times" },
];

const DASHBOARD_CALENDAR_CACHE_KEY = "tvbridge_dashboard_calendar_master_v1";

function normalizeDateKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.slice(0, 10);
}

function buildDailyPnlMap(points = []) {
  const map = {};
  for (const item of Array.isArray(points) ? points : []) {
    const d = normalizeDateKey(item?.x || item?.date || item?.day);
    if (!d) continue;
    const pnl = Number(item?.y ?? item?.pnl ?? item?.pnl_money ?? 0);
    if (!Number.isFinite(pnl)) continue;
    map[d] = { date: d, pnl };
  }
  return map;
}

function mergeDailyPnlMap(base = {}, incoming = {}) {
  const incomingKeys = Object.keys(incoming || {});
  // If incoming is empty, discard stale cache.
  if (!incomingKeys.length) return {};
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(incoming || {})) {
    const d = normalizeDateKey(k);
    if (!d) continue;
    const pnl = Number(v?.pnl ?? v?.pnl_money ?? 0);
    if (!Number.isFinite(pnl)) continue;
    out[d] = { date: d, pnl };
  }
  return out;
}

function loadCalendarCache() {
  try {
    const raw = sessionStorage.getItem(DASHBOARD_CALENDAR_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveCalendarCache(cache = {}) {
  try {
    sessionStorage.setItem(
      DASHBOARD_CALENDAR_CACHE_KEY,
      JSON.stringify(cache || {}),
    );
  } catch {
    // ignore storage quota/runtime issues
  }
}

function calendarScopeKey(filters = {}, userId = "") {
  return JSON.stringify({
    user_id: String(userId || ""),
    account_id: String(filters?.account_id || ""),
    symbol: String(filters?.symbol || "").toUpperCase(),
    source: String(filters?.source || ""),
    entry_model: String(filters?.entry_model || ""),
    direction: String(filters?.direction || "").toUpperCase(),
    pnl_state: String(filters?.pnl_state || "").toLowerCase(),
    chart_tf: String(filters?.chart_tf || ""),
    signal_tf: String(filters?.signal_tf || ""),
  });
}

function toDateKeyLocal(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sumCalendarPnlInRange(calendarData, startDate, endDate) {
  if (!calendarData || !startDate || !endDate) return 0;
  let sum = 0;
  const cur = new Date(startDate);
  while (cur <= endDate) {
    const key = toDateKeyLocal(cur);
    const pnl = Number(calendarData[key]?.pnl || 0);
    if (Number.isFinite(pnl)) sum += pnl;
    cur.setDate(cur.getDate() + 1);
  }
  return sum;
}

function shiftMonthCursor(year, month, delta) {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

function compareMonthCursor(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function monthCursorFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return { year: date.getFullYear(), month: date.getMonth() };
}

function clampMonthCursor(cursor, minCursor, maxCursor) {
  let next = cursor;
  if (minCursor && compareMonthCursor(next, minCursor) < 0) next = minCursor;
  if (maxCursor && compareMonthCursor(next, maxCursor) > 0) next = maxCursor;
  return next;
}

function getCalendarDataBounds(calendarData) {
  const keys = Object.keys(calendarData || {}).sort();
  if (!keys.length) return null;
  const first = new Date(`${keys[0]}T00:00:00`);
  const last = new Date(`${keys[keys.length - 1]}T00:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()))
    return null;
  return {
    minDate: first,
    maxDate: last,
    minCursor: monthCursorFromDate(first),
    maxCursor: monthCursorFromDate(last),
  };
}

function getDashboardChartWindow(unit, endYear, endMonth) {
  const safeUnit = String(unit || "day").toLowerCase();
  if (safeUnit === "week") {
    return {
      start: new Date(endYear, 0, 1),
      end: new Date(endYear, 11, 31),
      stepMonths: 12,
    };
  }
  if (safeUnit === "month") {
    return {
      start: new Date(endYear - 3, 0, 1),
      end: new Date(endYear, 11, 31),
      stepMonths: 12,
    };
  }
  if (safeUnit === "year") {
    return {
      start: new Date(endYear - 20, 0, 1),
      end: new Date(endYear, 11, 31),
      stepMonths: 240,
    };
  }
  return {
    start: new Date(endYear, endMonth - 1, 1),
    end: new Date(endYear, endMonth + 1, 0),
    stepMonths: 2,
  };
}

function formatDashboardChartWindowLabel(unit, start, end) {
  const safeUnit = String(unit || "day").toLowerCase();
  if (safeUnit === "week") {
    return `${start.getFullYear()} — ${end.getFullYear()}`;
  }
  if (safeUnit === "month") {
    return `${start.getFullYear()} — ${end.getFullYear()}`;
  }
  if (safeUnit === "year") {
    return `${start.getFullYear()} — ${end.getFullYear()}`;
  }
  return `${formatMonthShort(start)} ${start.getFullYear()} — ${formatMonthShort(new Date(end.getFullYear(), end.getMonth(), 1))} ${end.getFullYear()}`;
}

function startOfWeekLocal(date) {
  const next = new Date(date);
  const offset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - offset);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatMonthShort(date) {
  return date.toLocaleString("default", { month: "short" });
}

function formatMonthYearShort(date) {
  return `${formatMonthShort(date)} ${String(date.getFullYear()).slice(-2)}`;
}

function buildDashboardPnlBuckets(calendarData, unit, endYear, endMonth) {
  const { start, end } = getDashboardChartWindow(unit, endYear, endMonth);
  const buckets = [];
  const sumRange = (rangeStart, rangeEnd) =>
    sumCalendarPnlInRange(calendarData, rangeStart, rangeEnd);
  const spansMultipleYears = start.getFullYear() !== end.getFullYear();

  if (unit === "week") {
    let cursor = startOfWeekLocal(start);
    while (cursor <= end) {
      const bucketStart = new Date(cursor);
      const bucketEnd = new Date(cursor);
      bucketEnd.setDate(bucketEnd.getDate() + 6);
      const clampedStart = bucketStart < start ? new Date(start) : bucketStart;
      const clampedEnd = bucketEnd > end ? new Date(end) : bucketEnd;
      const pnl = sumRange(clampedStart, clampedEnd);
      buckets.push({
        key: `${toDateKeyLocal(bucketStart)}_week`,
        label: spansMultipleYears
          ? `${String(clampedStart.getDate()).padStart(2, "0")} ${formatMonthYearShort(clampedStart)}`
          : `${String(clampedStart.getDate()).padStart(2, "0")} ${formatMonthShort(clampedStart)}`,
        title: `${toDateKeyLocal(clampedStart)} → ${toDateKeyLocal(clampedEnd)}`,
        pnl,
        hasPnl: pnl !== 0,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
    return buckets;
  }

  if (unit === "month") {
    let bucketStart = new Date(start.getFullYear(), start.getMonth(), 1);
    while (bucketStart <= end) {
      const bucketEnd = new Date(
        bucketStart.getFullYear(),
        bucketStart.getMonth() + 1,
        0,
      );
      const clampedStart = bucketStart < start ? new Date(start) : bucketStart;
      const clampedEnd = bucketEnd > end ? new Date(end) : bucketEnd;
      const pnl = sumRange(clampedStart, clampedEnd);
      buckets.push({
        key: `${bucketStart.getFullYear()}-${bucketStart.getMonth()}_month`,
        label: spansMultipleYears
          ? formatMonthYearShort(bucketStart)
          : formatMonthShort(bucketStart),
        title: `${formatMonthShort(bucketStart)} ${bucketStart.getFullYear()}`,
        pnl,
        hasPnl: pnl !== 0,
      });
      bucketStart = new Date(
        bucketStart.getFullYear(),
        bucketStart.getMonth() + 1,
        1,
      );
    }
    return buckets;
  }

  if (unit === "year") {
    for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
      const bucketStart = new Date(year, 0, 1);
      const bucketEnd = new Date(year, 11, 31);
      const clampedStart = bucketStart < start ? new Date(start) : bucketStart;
      const clampedEnd = bucketEnd > end ? new Date(end) : bucketEnd;
      const pnl = sumRange(clampedStart, clampedEnd);
      buckets.push({
        key: `${year}_year`,
        label: String(year),
        title: String(year),
        pnl,
        hasPnl: pnl !== 0,
      });
    }
    return buckets;
  }

  const cursor = new Date(start);
  while (cursor <= end) {
    const dateStr = toDateKeyLocal(cursor);
    const item = calendarData ? calendarData[dateStr] : null;
    const pnl = item ? Number(item.pnl || item.pnl_money || 0) : 0;
    buckets.push({
      key: dateStr,
      label: String(cursor.getDate()).padStart(2, "0"),
      title: dateStr,
      date: dateStr,
      pnl: Number.isFinite(pnl) ? pnl : 0,
      hasPnl: item != null && Number.isFinite(pnl) && pnl !== 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}

function TableBlock({
  title,
  rows,
  noun = "ITEMS",
  nameFormatter = null,
  onRowClick = null,
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [sortKey, setSortKey] = useState("WR");
  const [sortDir, setSortDir] = useState("DESC");

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortKey(key);
      setSortDir("DESC");
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    let va, vb;
    if (sortKey === "Name") {
      va = String(a.key);
      vb = String(b.key);
    } else if (sortKey === "WR") {
      va = a.win_rate;
      vb = b.win_rate;
    } else if (sortKey === "PnL") {
      va = a.pnl_total;
      vb = b.pnl_total;
    } else return 0;

    if (va === vb) return 0;
    const res = va > vb ? 1 : -1;
    return sortDir === "DESC" ? -res : res;
  });

  const sortMarker = (key) => {
    if (sortKey !== key) return null;
    return sortDir === "ASC" ? " ↑" : " ↓";
  };

  return (
    <ResponsivePanel
      title={`${rows.length} ${String(noun || "items").toLowerCase()}`}
      className="fadeIn"
      open={isOpen}
      onOpenChange={setIsOpen}
      collapseDirection="top-down"
      bodyClassName="stack-layout"
      border="always"
    >
      {rows.length === 0 ? (
        <div className="minor-text">No data.</div>
      ) : (
        <div className="mini-table">
          <div
            className="mini-table-head wide"
            style={{
              borderBottom: "1px solid var(--border)",
              paddingBottom: "8px",
              marginBottom: "8px",
              background: "transparent",
              display: "flex",
              gap: "12px",
            }}
          >
            <span
              onClick={() => toggleSort("Name")}
              style={{
                flex: "2.5",
                fontSize: "10px",
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              NAME{sortMarker("Name")}
            </span>
            <span
              onClick={() => toggleSort("WR")}
              style={{
                flex: "1.8",
                textAlign: "right",
                fontSize: "10px",
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              WR% (W/L){sortMarker("WR")}
            </span>
            <span
              onClick={() => toggleSort("PnL")}
              style={{
                flex: "1.5",
                textAlign: "right",
                fontSize: "10px",
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              PNL{sortMarker("PnL")}
            </span>
            <span
              onClick={() => toggleSort("RR")}
              style={{
                flex: "1",
                textAlign: "right",
                fontSize: "10px",
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              RR{sortMarker("RR")}
            </span>
          </div>
          {sortedRows.map((r) => (
            <div
              className="mini-table-row wide"
              key={r.key}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                gap: "12px",
                alignItems: "center",
                cursor: onRowClick ? "pointer" : "default",
              }}
            >
              <span
                className="mini-name"
                style={{
                  flex: "2.5",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={r.key}
              >
                {nameFormatter ? nameFormatter(r.key, r) : r.key}
              </span>
              <span
                style={{
                  flex: "1.8",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                <span>{asPct(r.win_rate)}</span>
                <span
                  className="minor-text"
                  style={{ fontSize: "10px", marginLeft: "4px" }}
                >
                  <span>{r.wins}</span>
                  <span className="minor-text">/</span>
                  <span>{r.losses}</span>
                </span>
              </span>
              <span
                style={{ flex: "1.5", textAlign: "right" }}
                className={moneyClass(r.pnl_total)}
              >
                {asMoneySigned(r.pnl_total)}
              </span>
              <span
                style={{
                  flex: "1",
                  textAlign: "right",
                  fontSize: "10px",
                }}
              >
                {asRR(r.rr_total)}
              </span>
            </div>
          ))}
        </div>
      )}
    </ResponsivePanel>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [settings, setSettings] = useState([]);
  const [error, setError] = useState("");
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [selectedCronName, setSelectedCronName] = useState("");
  const [runCronLoading, setRunCronLoading] = useState(false);
  const [isFiltersPanelOpen, setIsFiltersPanelOpen] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    new Date().getMonth(),
  );
  const [calendarYear, setCalendarYear] = useState(() =>
    new Date().getFullYear(),
  );
  const [chartUnit, setChartUnit] = useState("day");
  const [chartEndMonth, setChartEndMonth] = useState(() =>
    new Date().getMonth(),
  );
  const [chartEndYear, setChartEndYear] = useState(() =>
    new Date().getFullYear(),
  );
  const [calendarData, setCalendarData] = useState(null);
  const [filters, setFilters] = useState({
    account_id: "",
    symbol: "",
    source: "",
    entry_model: "",
    direction: "",
    pnl_state: "",
    chart_tf: "",
    signal_tf: "",
    range: "all",
  });
  const inFlightRef = useRef(false);
  const calendarMasterRef = useRef(loadCalendarCache());
  const initialLoadKeyRef = useRef("");
  const settingsLoadStartedRef = useRef(false);

  async function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [resp, accs] = await Promise.all([
        api.dashboardAdvanced(filters),
        api.v2Accounts(),
      ]);
      setData(resp);
      const userKey = calendarScopeKey(filters, resp?.filters?.user_id || "");
      const dailyMap = buildDailyPnlMap(resp?.pnl_series || []);
      const merged = mergeDailyPnlMap(
        calendarMasterRef.current?.[userKey] || {},
        dailyMap,
      );
      calendarMasterRef.current = {
        ...(calendarMasterRef.current || {}),
        [userKey]: merged,
      };
      saveCalendarCache(calendarMasterRef.current);
      setCalendarData(merged);
      setAccounts(Array.isArray(accs?.items) ? accs.items : []);
      setError("");
      setLastRefreshAt(new Date());
    } catch (e) {
      setError(e?.message || "Failed to load dashboard");
    } finally {
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    const nextKey = JSON.stringify(filters);
    if (initialLoadKeyRef.current === nextKey) return;
    initialLoadKeyRef.current = nextKey;
    load();
  }, [
    filters.account_id,
    filters.symbol,
    filters.source,
    filters.entry_model,
    filters.direction,
    filters.pnl_state,
    filters.chart_tf,
    filters.signal_tf,
    filters.range,
  ]);

  useEffect(() => {
    const t = setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      )
        return;
      load();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [
    filters.account_id,
    filters.symbol,
    filters.source,
    filters.entry_model,
    filters.direction,
    filters.pnl_state,
    filters.chart_tf,
    filters.signal_tf,
    filters.range,
  ]);

  useEffect(() => {
    if (settingsLoadStartedRef.current) return;
    settingsLoadStartedRef.current = true;
    let cancelled = false;
    async function loadSettings() {
      try {
        const res = await api.getSettings();
        if (cancelled) return;
        setSettings(Array.isArray(res?.settings) ? res.settings : []);
      } catch {}
    }
    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const cronSettings = useMemo(
    () => settings.filter((s) => s?.type === "cron"),
    [settings],
  );

  useEffect(() => {
    if (!selectedCronName && cronSettings.length > 0) {
      setSelectedCronName(cronSettings[0].name || "");
    }
  }, [cronSettings, selectedCronName]);

  const calendarBounds = getCalendarDataBounds(calendarData);
  const calendarMinCurrentCursor = calendarBounds?.minCursor
    ? shiftMonthCursor(
        calendarBounds.minCursor.year,
        calendarBounds.minCursor.month,
        1,
      )
    : null;
  const chartMinEndCursor = calendarBounds?.minCursor
    ? shiftMonthCursor(
        calendarBounds.minCursor.year,
        calendarBounds.minCursor.month,
        Math.max(
          getDashboardChartWindow(chartUnit, chartEndYear, chartEndMonth)
            .stepMonths - 1,
          0,
        ),
      )
    : null;
  const chartMaxEndCursor = calendarBounds?.maxCursor || null;

  useEffect(() => {
    if (!calendarBounds?.maxCursor) return;
    const nextCalendar = clampMonthCursor(
      { year: calendarYear, month: calendarMonth },
      calendarMinCurrentCursor || calendarBounds.maxCursor,
      calendarBounds.maxCursor,
    );
    if (
      nextCalendar.year !== calendarYear ||
      nextCalendar.month !== calendarMonth
    ) {
      setCalendarYear(nextCalendar.year);
      setCalendarMonth(nextCalendar.month);
    }
  }, [
    calendarBounds?.maxCursor?.year,
    calendarBounds?.maxCursor?.month,
    calendarMinCurrentCursor?.year,
    calendarMinCurrentCursor?.month,
    calendarYear,
    calendarMonth,
  ]);

  useEffect(() => {
    if (!calendarBounds?.maxCursor) return;
    const nextChart = clampMonthCursor(
      { year: chartEndYear, month: chartEndMonth },
      chartMinEndCursor || calendarBounds.maxCursor,
      chartMaxEndCursor || calendarBounds.maxCursor,
    );
    if (nextChart.year !== chartEndYear || nextChart.month !== chartEndMonth) {
      setChartEndYear(nextChart.year);
      setChartEndMonth(nextChart.month);
    }
  }, [
    calendarBounds?.maxCursor?.year,
    calendarBounds?.maxCursor?.month,
    chartMinEndCursor?.year,
    chartMinEndCursor?.month,
    chartMaxEndCursor?.year,
    chartMaxEndCursor?.month,
    chartEndYear,
    chartEndMonth,
  ]);

  async function handleRunCron() {
    if (!selectedCronName) return;
    setRunCronLoading(true);
    try {
      const res = await api.runCron(selectedCronName);
      const result = res?.result || {};
      const summaryText =
        result?.started === true
          ? "Started in background"
          : typeof result?.captured === "number"
            ? `${result.captured} captured${Array.isArray(result.errors) && result.errors.length ? `, ${result.errors.length} failed` : ""}`
            : typeof result?.queued === "number"
              ? `${result.queued} queued`
              : typeof result?.triggered === "number"
                ? `${result.triggered} triggered`
                : "Completed";
      showToast({
        message: `Cron "${selectedCronName}" executed. ${summaryText}`,
        type: "success",
      });
      await load();
    } catch (e) {
      setError(e?.message || "Failed to execute cron");
    } finally {
      setRunCronLoading(false);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Loading dashboard...</div>;

  const m = data.metrics || {};
  const periodTotals = data.period_totals || {};
  const top = data.top_winrate || {
    symbols: [],
    directional: [],
    sources: [],
    entry_models: [],
    strategies: [],
  };
  const f = data.filters || {};
  const accountRows = Array.isArray(data.accounts_summary)
    ? data.accounts_summary
    : [];
  const accountNameById = new Map(
    accountRows.map((a) => [
      String(a.account_id || ""),
      String(a.name || a.account_id || ""),
    ]),
  );
  const chartBuckets = buildDashboardPnlBuckets(
    calendarData,
    chartUnit,
    chartEndYear,
    chartEndMonth,
  );
  const calendarCurrentCursor = { year: calendarYear, month: calendarMonth };
  const canCalendarGoPrev = calendarMinCurrentCursor
    ? compareMonthCursor(calendarCurrentCursor, calendarMinCurrentCursor) > 0
    : false;
  const canCalendarGoNext = calendarBounds?.maxCursor
    ? compareMonthCursor(calendarCurrentCursor, calendarBounds.maxCursor) < 0
    : false;
  const {
    start: chartWindowStart,
    end: chartWindowEnd,
    stepMonths,
  } = getDashboardChartWindow(chartUnit, chartEndYear, chartEndMonth);
  const chartWindowLabel = formatDashboardChartWindowLabel(
    chartUnit,
    chartWindowStart,
    chartWindowEnd,
  );
  const chartMaxPnl = chartBuckets.reduce(
    (m, x) => Math.max(m, Number(x?.pnl || 0)),
    0,
  );
  const chartMinPnl = chartBuckets.reduce(
    (m, x) => Math.min(m, Number(x?.pnl || 0)),
    0,
  );
  const chartAveragePnl =
    chartBuckets.length > 0
      ? chartBuckets.reduce((acc, x) => acc + Number(x?.pnl || 0), 0) /
        chartBuckets.length
      : 0;
  const chartTotalPnl = chartBuckets.reduce(
    (acc, x) => acc + Number(x?.pnl || 0),
    0,
  );
  const roundUpNiceUnit = (v) => {
    const n = Math.max(1, Number(v) || 1);
    const p = 10 ** Math.floor(Math.log10(n));
    const m = n / p;
    const base = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return base * p;
  };
  const yAxisStep = roundUpNiceUnit(
    Math.max(1, Math.max(chartMaxPnl, Math.abs(chartMinPnl)) / 5),
  );
  const yAxisPosMax = chartMaxPnl > 0 ? yAxisStep * 5 : 0;
  const yAxisNegMin = chartMinPnl < 0 ? -(yAxisStep * 5) : 0;
  const yAxisPosScale = yAxisPosMax > 0 ? yAxisPosMax : 1;
  const yAxisNegScale = yAxisNegMin < 0 ? Math.abs(yAxisNegMin) : 1;
  const yAxisPosSteps = Array.from({ length: 5 }, (_, i) =>
    Math.round(yAxisStep * (i + 1)),
  ).filter((v) => v > 0);
  const yAxisNegSteps = Array.from({ length: 5 }, (_, i) =>
    Math.round(yAxisStep * (i + 1)),
  ).filter((v) => v > 0);
  const chartSummaryItems = [
    {
      label: "High",
      value: chartMaxPnl,
    },
    {
      label: "Low",
      value: chartMinPnl,
    },
    {
      label: "Average",
      value: chartAveragePnl,
    },
    {
      label: "Total",
      value: chartTotalPnl,
    },
  ];
  const chartEndCursor = { year: chartEndYear, month: chartEndMonth };
  const canChartGoPrev = chartMinEndCursor
    ? compareMonthCursor(chartEndCursor, chartMinEndCursor) > 0
    : false;
  const canChartGoNext = chartMaxEndCursor
    ? compareMonthCursor(chartEndCursor, chartMaxEndCursor) < 0
    : false;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - ((todayStart.getDay() + 6) % 7));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const displayPeriodTotals = {
    ...periodTotals,
    today: {
      ...(periodTotals.today || {}),
      total_pnl: sumCalendarPnlInRange(calendarData, todayStart, todayStart),
    },
    week: {
      ...(periodTotals.week || {}),
      total_pnl: sumCalendarPnlInRange(calendarData, weekStart, todayStart),
    },
    month: {
      ...(periodTotals.month || {}),
      total_pnl: sumCalendarPnlInRange(calendarData, monthStart, todayStart),
    },
  };

  const buildTradeSearch = (extra = {}) => {
    const params = new URLSearchParams();
    const merged = {
      account_id: filters.account_id || "",
      symbol: filters.symbol || "",
      source: filters.source || "",
      entry_model: filters.entry_model || "",
      direction: filters.direction || "",
      pnl_state: filters.pnl_state || "",
      chart_tf: filters.chart_tf || "",
      range: filters.range || "",
      ...extra,
    };
    Object.entries(merged).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const safe = String(value).trim();
      if (!safe || safe.toLowerCase() === "all") return;
      params.set(key, safe);
    });
    return params.toString();
  };

  const goTrades = ({ status = "closed", ...extra } = {}) => {
    const qs = buildTradeSearch(extra);
    navigate(`/trades/${String(status).toLowerCase()}${qs ? `?${qs}` : ""}`);
  };

  const periodCardClick = (key) => {
    if (key === "filled_open") {
      goTrades({ status: "filled", range: undefined, time: undefined });
      return;
    }
    goTrades({ status: "closed", time: key, range: undefined });
  };

  return (
    <section className="stack-layout fadeIn">
      <PageHeader
        title="Dashboard"
        actions={
          <CronRunLauncher
            value={selectedCronName}
            onChange={setSelectedCronName}
            onRun={handleRunCron}
            options={cronSettings.map((cron) => ({
              value: cron.name,
              label: cron.name,
            }))}
            disabled={cronSettings.length === 0}
            loading={runCronLoading}
            selectAriaLabel="Dashboard cron selector"
            getConfirmOptions={(cronName) => ({
              title: "Run cron?",
              message: `Run cron "${cronName}" now?`,
              confirmLabel: "Run",
              tone: "danger",
            })}
          />
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 18,
          alignItems: "start",
        }}
        className="dashboard-main-grid"
      >
        <div className="stack-layout" style={{ gap: 18 }}>
          {/* Heartbeat cards removed per request, info moved to Accounts table */}

          <div className="toolbar-panel dashboard-overview-toolbar">
            <div
              className="toolbar-group dashboard-summary-highlights"
              style={{
                display: "flex",
                gap: "20px",
                alignItems: "center",
                flexWrap: "nowrap",
                minWidth: 0,
                flex: "0 0 auto",
              }}
            >
              <div
                className="summary-item"
                onClick={() => goTrades({ status: "filled", time: undefined })}
                style={{ cursor: "pointer" }}
                title="Open filled trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  POSITIONS
                </span>
                <div style={{ fontSize: "16px" }}>{m.count_filled || 0}</div>
              </div>
              <div
                className="summary-item"
                onClick={() => goTrades({ status: "pending", time: undefined })}
                style={{ cursor: "pointer" }}
                title="Open pending trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  ORDERS
                </span>
                <div style={{ fontSize: "16px" }}>{m.count_pending || 0}</div>
              </div>
              <div
                className="summary-item"
                onClick={() =>
                  goTrades({ status: "closed", time: filters.range || "all" })
                }
                style={{ cursor: "pointer" }}
                title="Open closed trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  CLOSED
                </span>
                <div style={{ fontSize: "16px" }}>{m.count_closed || 0}</div>
              </div>
              <div
                className="summary-item"
                onClick={() =>
                  goTrades({ status: "closed", time: filters.range || "all" })
                }
                style={{ cursor: "pointer" }}
                title="Open closed trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  W/L
                </span>
                <div style={{ fontSize: "16px" }}>
                  {m.wins || 0} <span className="minor-text"> / </span>{" "}
                  {m.losses || 0}
                </div>
              </div>
            </div>

            <ResponsivePanel
              title="Filters"
              className="dashboard-filters-panel"
              headerMode="mobile"
              border="mobile"
              showToggle
              open={isFiltersPanelOpen}
              onOpenChange={setIsFiltersPanelOpen}
              style={{ flex: "1 1 0", minWidth: 0 }}
            >
              <div
                className="dashboard-filter-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                  gap: "12px",
                  width: "100%",
                  justifyContent: "stretch",
                  marginLeft: 0,
                  alignItems: "end",
                  minWidth: 0,
                  flex: "1 1 auto",
                }}
              >
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    ACCOUNT
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-account"
                    value={filters.account_id}
                    buttonText={
                      filters.account_id
                        ? accountNameById.get(String(filters.account_id)) ||
                          String(filters.account_id)
                        : "ALL ACCOUNTS"
                    }
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        account_id: nextValue,
                      }))
                    }
                    items={[
                      { value: "", label: "ALL ACCOUNTS" },
                      ...(f.accounts || []).map((v) => ({
                        value: String(v),
                        label: accountNameById.get(String(v)) || String(v),
                      })),
                    ]}
                    ariaLabel="Filter by account"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    SYMBOL
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-symbol"
                    value={filters.symbol}
                    buttonText={filters.symbol || "ALL SYMBOLS"}
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        symbol: nextValue,
                      }))
                    }
                    items={[
                      { value: "", label: "ALL SYMBOLS" },
                      ...(f.symbols || []).map((v) => ({
                        value: String(v),
                        label: String(v),
                      })),
                    ]}
                    ariaLabel="Filter by symbol"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    SOURCE
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-source"
                    value={filters.source}
                    buttonText={filters.source || "ALL SOURCES"}
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        source: nextValue,
                      }))
                    }
                    items={[
                      { value: "", label: "ALL SOURCES" },
                      ...(f.sources || []).map((v) => ({
                        value: String(v),
                        label: String(v),
                      })),
                    ]}
                    ariaLabel="Filter by source"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    MODEL
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-model"
                    value={filters.entry_model}
                    buttonText={filters.entry_model || "ALL MODELS"}
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        entry_model: nextValue,
                      }))
                    }
                    items={[
                      { value: "", label: "ALL MODELS" },
                      ...(f.entry_models || []).map((v) => ({
                        value: String(v),
                        label: String(v),
                      })),
                    ]}
                    ariaLabel="Filter by model"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    SIDE
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-side"
                    value={filters.direction}
                    buttonText={
                      SIDE_OPTIONS.find(
                        (option) => option.val === filters.direction,
                      )?.lab || "ALL SIDES"
                    }
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        direction: nextValue,
                      }))
                    }
                    items={SIDE_OPTIONS.map((option) => ({
                      value: String(option.val ?? ""),
                      label: option.lab,
                    }))}
                    ariaLabel="Filter by side"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    WIN / LOSE
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-pnl-state"
                    value={filters.pnl_state}
                    buttonText={
                      PNL_STATE_OPTIONS.find(
                        (option) => option.val === filters.pnl_state,
                      )?.lab || "WIN / LOSE"
                    }
                    onChange={(nextValue) =>
                      setFilters((prev) => ({
                        ...prev,
                        pnl_state: String(nextValue || "").toLowerCase(),
                      }))
                    }
                    items={PNL_STATE_OPTIONS.map((option) => ({
                      value: String(option.val ?? ""),
                      label: option.lab,
                    }))}
                    ariaLabel="Filter by win or lose"
                    fullWidth
                  />
                </div>
                <div className="dashboard-filter-field dashboard-filter-field--wide-mobile">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    RANGE
                  </span>
                  <ComboButtonMenu
                    selectId="db-filter-range"
                    value={filters.range}
                    buttonText={
                      RANGE_OPTIONS.find(
                        (option) => option.val === filters.range,
                      )?.lab || "ALL TIMES"
                    }
                    onChange={(nextValue) =>
                      setFilters((prev) => ({ ...prev, range: nextValue }))
                    }
                    items={RANGE_OPTIONS.map((option) => ({
                      value: String(option.val ?? ""),
                      label: option.lab,
                    }))}
                    ariaLabel="Filter by range"
                    fullWidth
                  />
                </div>
              </div>
            </ResponsivePanel>
          </div>

          <div
            className="period-box-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "16px",
            }}
          >
            {PERIOD_DISPLAY.map((conf) => {
              const isFilledOpen = conf.key === "filled_open";
              const v = isFilledOpen
                ? {
                    total_pnl: m.filled_open_pnl || 0,
                    total_trades: m.count_filled || 0,
                    total_wins: m.filled_open_wins || 0,
                    total_losses: m.filled_open_losses || 0,
                    win_sum_pnl: m.filled_open_win_sum_pnl || 0,
                    lose_sum_pnl: m.filled_open_lose_sum_pnl || 0,
                    planned_tp_pnl: m.filled_open_planned_tp_pnl || 0,
                    planned_sl_pnl: m.filled_open_planned_sl_pnl || 0,
                  }
                : displayPeriodTotals[conf.key] || {};
              const winrate =
                v.total_wins + v.total_losses > 0
                  ? (v.total_wins / (v.total_wins + v.total_losses)) * 100
                  : 0;
              return (
                <article
                  className="kpi-card"
                  key={conf.key}
                  onClick={() => periodCardClick(conf.key)}
                  style={{ cursor: "pointer" }}
                  title={`Open ${conf.lab} trades`}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: "8px",
                    }}
                  >
                    <div className="panel-label" style={{ marginBottom: 0 }}>
                      {conf.lab.toUpperCase()}
                    </div>
                    <div
                      className="minor-text"
                      style={{
                        fontSize: "10px",
                        whiteSpace: "nowrap",
                        opacity: 0.9,
                        textAlign: "right",
                      }}
                    >
                      t: {v.total_trades || 0} | {v.total_wins || 0}{" "}
                      <span className="minor-text"> / </span>{" "}
                      {v.total_losses || 0}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: "4px",
                      height: 1,
                    }}
                  />
                  <div className="period-big-line">
                    <span
                      className={`kpi-value ${moneyClass(v.total_pnl)}`}
                      style={{ fontSize: "24px" }}
                    >
                      {asMoneySigned(v.total_pnl || 0)}
                    </span>
                  </div>
                  <div
                    className="minor-text"
                    style={{
                      marginTop: "2px",
                      fontSize: "10px",
                      whiteSpace: "nowrap",
                      opacity: 0.78,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {isFilledOpen ? (
                      <>
                        <span className="money-pos">
                          {asMoneySigned(v.planned_tp_pnl || 0)}
                        </span>
                        <span>|</span>
                        <span className="money-neg">
                          {asMoneySigned(v.planned_sl_pnl || 0)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="money-pos">
                          {asMoneySigned(v.win_sum_pnl || 0)}
                        </span>
                        <span>|</span>
                        <span className="money-neg">
                          {asMoneySigned(v.lose_sum_pnl || 0)}
                        </span>
                        <span>|</span>
                        <span>{asPct(winrate)}</span>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {/* Calendar + Daily PnL chart */}
          <div
            className="dashboard-calendar-layout"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(420px, 1.2fr) minmax(320px, 1fr)",
              gap: 16,
              alignItems: "stretch",
            }}
          >
            {/* Monthly PnL Calendar */}
            <div
              className="panel fadeIn dashboard-calendar-panel"
              style={{ padding: 12 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!canCalendarGoPrev}
                  onClick={() => {
                    if (!canCalendarGoPrev) return;
                    const next = shiftMonthCursor(
                      calendarYear,
                      calendarMonth,
                      -1,
                    );
                    setCalendarMonth(next.month);
                    setCalendarYear(next.year);
                  }}
                >
                  ◀
                </button>
                <span style={{ fontSize: 12 }}>
                  {(() => {
                    const pm = calendarMonth === 0 ? 11 : calendarMonth - 1;
                    const py =
                      calendarMonth === 0 ? calendarYear - 1 : calendarYear;
                    return `${new Date(py, pm).toLocaleString("default", { month: "short" })} — ${new Date(calendarYear, calendarMonth).toLocaleString("default", { month: "short", year: "numeric" })}`;
                  })()}
                </span>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!canCalendarGoNext}
                  onClick={() => {
                    if (!canCalendarGoNext) return;
                    const next = shiftMonthCursor(
                      calendarYear,
                      calendarMonth,
                      1,
                    );
                    setCalendarMonth(next.month);
                    setCalendarYear(next.year);
                  }}
                >
                  ▶
                </button>
              </div>
              {(() => {
                const prevMonth = calendarMonth === 0 ? 11 : calendarMonth - 1;
                const prevYear =
                  calendarMonth === 0 ? calendarYear - 1 : calendarYear;
                const renderGrid = (month, year, label) => {
                  const todayLocal = new Date();
                  todayLocal.setHours(0, 0, 0, 0);
                  const firstDay = new Date(year, month, 1).getDay();
                  const dim = new Date(year, month + 1, 0).getDate();
                  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
                  const cells = [];
                  for (let i = 0; i < firstDay; i++)
                    cells.push(<span key={"e" + i} />);
                  for (let d = 1; d <= dim; d++) {
                    const dateStr = `${prefix}${String(d).padStart(2, "0")}`;
                    const cellDate = new Date(`${dateStr}T00:00:00`);
                    const isPastDay = cellDate < todayLocal;
                    const item = calendarData ? calendarData[dateStr] : null;
                    const pnl = item
                      ? Number(item.pnl || item.pnl_money || 0)
                      : null;
                    cells.push(
                      <div
                        key={d}
                        onClick={
                          pnl != null
                            ? () =>
                                goTrades({
                                  status: "closed",
                                  time: dateStr,
                                  range: undefined,
                                })
                            : undefined
                        }
                        style={{
                          padding: "4px 2px 6px",
                          borderRadius: 5,
                          fontSize: 9,
                          border:
                            pnl != null
                              ? pnl > 0
                                ? "1px solid rgba(16,185,129,0.35)"
                                : pnl < 0
                                  ? "1px solid rgba(239,68,68,0.35)"
                                  : "1px solid rgba(148,163,184,0.25)"
                              : "1px solid transparent",
                          background:
                            pnl != null
                              ? pnl > 0
                                ? "linear-gradient(180deg, rgba(16,185,129,0.16), rgba(16,185,129,0.09))"
                                : pnl < 0
                                  ? "linear-gradient(180deg, rgba(239,68,68,0.16), rgba(239,68,68,0.09))"
                                  : "rgba(148,163,184,0.10)"
                              : "transparent",
                          minHeight: 34,
                          cursor: pnl != null ? "pointer" : "default",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                        title={
                          pnl != null
                            ? `${dateStr}: $${pnl.toFixed(2)}`
                            : dateStr
                        }
                      >
                        <div
                          className={isPastDay ? "time-past" : "time-current"}
                          style={{
                            fontSize: 9,
                            color: isPastDay
                              ? "rgba(148,163,184,0.62)"
                              : pnl != null
                                ? "var(--text)"
                                : "var(--muted)",
                          }}
                        >
                          {d}
                        </div>
                        {pnl != null && (
                          <div
                            className={`${pnl > 0 ? "money-pos" : "money-neg"} ${isPastDay ? "time-past" : "time-current"}`}
                            style={{
                              fontSize: 9,
                              letterSpacing: "0.1px",
                            }}
                          >
                            {pnl > 0 ? "+" : ""}
                            {pnl.toFixed(2)}
                          </div>
                        )}
                      </div>,
                    );
                  }
                  return (
                    <div key={label}>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--muted)",
                          marginBottom: 3,
                          fontWeight: 600,
                        }}
                      >
                        {new Date(year, month).toLocaleString("default", {
                          month: "long",
                          year: "numeric",
                        })}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(7, 1fr)",
                          gap: 1,
                          textAlign: "center",
                          fontSize: 9,
                        }}
                      >
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(
                          (day) => (
                            <span
                              key={day}
                              style={{
                                color: "var(--muted)",
                                padding: "1px 0",
                              }}
                            >
                              {day}
                            </span>
                          ),
                        )}
                        {cells}
                      </div>
                    </div>
                  );
                };
                return (
                  <div
                    className="dashboard-calendar-months"
                    style={{ display: "flex", gap: 16 }}
                  >
                    <div style={{ flex: 1 }}>
                      {renderGrid(prevMonth, prevYear, "prev")}
                    </div>
                    <div style={{ flex: 1 }}>
                      {renderGrid(calendarMonth, calendarYear, "curr")}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Last ~2 months PnL bar chart */}
            <div
              className="panel fadeIn dashboard-chart-panel"
              style={{ padding: 12 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  marginBottom: 10,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                    flex: "1 1 360px",
                  }}
                >
                  {chartSummaryItems.map((item) => (
                    <div
                      key={item.label}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <div
                        className="panel-label"
                        style={{ margin: 0, fontSize: 10 }}
                      >
                        {item.label}
                      </div>
                      <div
                        className={moneyClass(item.value)}
                        style={{ fontSize: 12, lineHeight: 1.2 }}
                      >
                        {item.value > 0 ? "+" : ""}
                        {asMoney(item.value)}
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  }}
                >
                  <GroupButtons
                    items={[
                      {
                        label: "Day",
                        value: "day",
                        selected: chartUnit === "day",
                      },
                      {
                        label: "Week",
                        value: "week",
                        selected: chartUnit === "week",
                      },
                      {
                        label: "Month",
                        value: "month",
                        selected: chartUnit === "month",
                      },
                      {
                        label: "Year",
                        value: "year",
                        selected: chartUnit === "year",
                      },
                    ]}
                    selectedItems={[chartUnit]}
                    onChange={(next) => setChartUnit(next?.[0] || "day")}
                    selectionMode="single"
                    border_type="multiple"
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!canChartGoPrev}
                    onClick={() => {
                      if (!canChartGoPrev) return;
                      const next = shiftMonthCursor(
                        chartEndYear,
                        chartEndMonth,
                        -stepMonths,
                      );
                      setChartEndYear(next.year);
                      setChartEndMonth(next.month);
                    }}
                  >
                    ◀
                  </button>
                  <div className="minor-text" style={{ minWidth: 150 }}>
                    {chartWindowLabel}
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!canChartGoNext}
                    onClick={() => {
                      if (!canChartGoNext) return;
                      const next = shiftMonthCursor(
                        chartEndYear,
                        chartEndMonth,
                        stepMonths,
                      );
                      setChartEndYear(next.year);
                      setChartEndMonth(next.month);
                    }}
                  >
                    ▶
                  </button>
                </div>
              </div>
              <div
                className="dashboard-chart-canvas"
                style={{
                  position: "relative",
                  height: 180,
                  borderRadius: 8,
                  background:
                    "linear-gradient(180deg, rgba(148,163,184,0.05), rgba(15,23,42,0.08))",
                  overflow: "hidden",
                  padding: "10px 8px 22px 48px",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 8,
                    top: 8,
                    bottom: 22,
                    width: 40,
                    pointerEvents: "none",
                  }}
                >
                  {yAxisPosSteps.map((v) => (
                    <span
                      key={`pos_${v}`}
                      style={{
                        position: "absolute",
                        right: 0,
                        top: `${50 - (v / yAxisPosScale) * 50}%`,
                        transform: "translateY(-50%)",
                        fontSize: 9,
                        color: "rgba(16,185,129,0.85)",
                        opacity: 0.45,
                      }}
                    >
                      {v}
                    </span>
                  ))}
                  <span
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "50%",
                      transform: "translateY(-50%)",
                      fontSize: 9,
                      color: "var(--muted)",
                      opacity: 0.9,
                    }}
                  >
                    0
                  </span>
                  {yAxisNegSteps.map((v) => (
                    <span
                      key={`neg_${v}`}
                      style={{
                        position: "absolute",
                        right: 0,
                        top: `${50 + (v / yAxisNegScale) * 50}%`,
                        transform: "translateY(-50%)",
                        fontSize: 9,
                        color: "rgba(239,68,68,0.85)",
                        opacity: 0.45,
                      }}
                    >
                      -{v}
                    </span>
                  ))}
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 48,
                    right: 8,
                    top: "47%",
                    border: "2px solid rgba(148, 163, 184, 0.45)",
                    zIndex: 3,
                  }}
                />
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.max(chartBuckets.length, 1)}, 1fr)`,
                    gap: 1,
                    alignItems: "stretch",
                  }}
                >
                  {chartBuckets.map((p) => {
                    const pnlNum = Number(p.pnl || 0);
                    const absRatio = p.hasPnl
                      ? Math.min(
                          1,
                          Math.abs(pnlNum) /
                            (pnlNum >= 0 ? yAxisPosScale : yAxisNegScale),
                        )
                      : 0;
                    const hPct = absRatio * 49;
                    const isPos = pnlNum >= 0;
                    const barTop = isPos ? 50 - hPct : 50;
                    return (
                      <div
                        key={p.key}
                        style={{
                          position: "relative",
                          display: "flex",
                          justifyContent: "center",
                        }}
                        title={
                          p.hasPnl
                            ? `${p.title}: $${pnlNum.toFixed(2)}`
                            : `${p.title}: no trades`
                        }
                      >
                        {p.hasPnl ? (
                          <div
                            style={{
                              position: "absolute",
                              width: "92%",
                              height: `${hPct}%`,
                              top: `${barTop}%`,
                              borderRadius: isPos
                                ? "2px 2px 0 0"
                                : "0 0 2px 2px",
                              background: isPos
                                ? "rgba(16,185,129,0.9)"
                                : "rgba(239,68,68,0.9)",
                              zIndex: 2,
                            }}
                          />
                        ) : null}
                        <div
                          style={{
                            position: "absolute",
                            bottom: -18,
                            fontSize: 8,
                            color: "rgba(148,163,184,0.88)",
                            fontWeight: 600,
                            letterSpacing: 0,
                          }}
                        >
                          {p.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div
            className="dashboard-grid tables"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
            }}
          >
            <TableBlock
              title="Symbols"
              noun="Symbols"
              rows={Array.isArray(top.symbols) ? top.symbols : []}
              onRowClick={(row) =>
                goTrades({
                  status: "closed",
                  time: filters.range || "all",
                  symbol: row?.key || "",
                })
              }
            />
            <TableBlock
              title="Strategy"
              noun="Strategies"
              rows={Array.isArray(top.strategies) ? top.strategies : []}
            />
            <TableBlock
              title="Entry Model"
              noun="Models"
              rows={Array.isArray(top.entry_models) ? top.entry_models : []}
              onRowClick={(row) =>
                goTrades({
                  status: "closed",
                  time: filters.range || "all",
                  entry_model: row?.key || "",
                })
              }
            />
            <TableBlock
              title="Source ID"
              noun="Sources"
              rows={Array.isArray(top.sources) ? top.sources : []}
              onRowClick={(row) =>
                goTrades({
                  status: "closed",
                  time: filters.range || "all",
                  source: row?.key || "",
                })
              }
            />
            <TableBlock
              title="Order Type"
              noun="Order Type"
              rows={Array.isArray(top.directional) ? top.directional : []}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
