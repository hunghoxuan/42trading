import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { showDateTime } from "../utils/format";
import {
  asMoney,
  asMoneySigned,
  asPct,
  asRR,
  moneyClass,
} from "../utils/numberFormat";
import MobileCollapseSection from "../components/MobileCollapseSection";

const RANGE_OPTIONS = [
  { val: "all", lab: "All times" },
  { val: "today", lab: "Today" },
  { val: "yesterday", lab: "Yesterday" },
  { val: "last_week", lab: "Last week" },
  { val: "last_month", lab: "Last month" },
  { val: "week", lab: "This Week" },
  { val: "month", lab: "This Month" },
  { val: "year", lab: "This Year" },
];
const AUTO_REFRESH_MS = Number(
  localStorage.getItem("tvbridge_refresh_ms") || 10000,
);

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

function TableBlock({
  title,
  rows,
  noun = "ITEMS",
  nameFormatter = null,
  onRowClick = null,
}) {
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
    <div className="panel fadeIn">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <div className="panel-label" style={{ margin: 0 }}>
          {rows.length} {noun.toUpperCase()}
        </div>
      </div>
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
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState("");
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    new Date().getMonth(),
  );
  const [calendarYear, setCalendarYear] = useState(() =>
    new Date().getFullYear(),
  );
  const [calendarData, setCalendarData] = useState(null);
  const [filters, setFilters] = useState({
    account_id: "",
    symbol: "",
    source: "",
    entry_model: "",
    direction: "",
    chart_tf: "",
    signal_tf: "",
    range: "all",
  });
  const inFlightRef = useRef(false);
  const calendarMasterRef = useRef(loadCalendarCache());

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
    load();
  }, [
    filters.account_id,
    filters.symbol,
    filters.source,
    filters.entry_model,
    filters.direction,
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
    filters.chart_tf,
    filters.signal_tf,
    filters.range,
  ]);

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
  // Last ~2 months PnL points
  const today = new Date();
  const dayPoints = [];
  for (let i = 59; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const item = calendarData ? calendarData[dateStr] : null;
    const pnl = item ? Number(item.pnl || 0) : 0;
    dayPoints.push({
      date: dateStr,
      pnl: Number.isFinite(pnl) ? pnl : 0,
      hasPnl: item != null && Number.isFinite(pnl) && pnl !== 0,
    });
  }
  const dailyPnlTotal = dayPoints.reduce((acc, x) => acc + x.pnl, 0);
  const maxPnl = dayPoints.reduce(
    (m, x) => Math.max(m, Number(x?.pnl || 0)),
    0,
  );
  const minPnl = dayPoints.reduce(
    (m, x) => Math.min(m, Number(x?.pnl || 0)),
    0,
  );
  const roundUpNiceUnit = (v) => {
    const n = Math.max(1, Number(v) || 1);
    const p = 10 ** Math.floor(Math.log10(n));
    const m = n / p;
    const base = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return base * p;
  };
  const posStep = roundUpNiceUnit(Math.max(1, maxPnl / 5));
  const negStep = roundUpNiceUnit(Math.max(1, Math.abs(minPnl) / 5));
  const yAxisPosMax = maxPnl > 0 ? posStep * 5 : 0;
  const yAxisNegMin = minPnl < 0 ? -(negStep * 5) : 0;
  const yAxisPosScale = yAxisPosMax > 0 ? yAxisPosMax : 1;
  const yAxisNegScale = yAxisNegMin < 0 ? Math.abs(yAxisNegMin) : 1;
  const yAxisPosSteps = Array.from({ length: 5 }, (_, i) =>
    Math.round(posStep * (i + 1)),
  ).filter((v) => v > 0);
  const yAxisNegSteps = Array.from({ length: 5 }, (_, i) =>
    Math.round(negStep * (i + 1)),
  ).filter((v) => v > 0);

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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h2 className="page-title" style={{ margin: 0 }}>
          Dashboard
        </h2>
        <span
          className="minor-text"
          style={{ textAlign: "right", whiteSpace: "nowrap" }}
        >
          Last refreshed: {lastRefreshAt ? showDateTime(lastRefreshAt) : "-"}{" "}
          (auto {Math.round(AUTO_REFRESH_MS / 1000)}s)
        </span>
      </div>
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

          <div
            className="toolbar-panel"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 16px",
              gap: 16,
              flexWrap: "nowrap",
            }}
          >
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
                onClick={() => goTrades({ status: "closed", time: "all" })}
                style={{ cursor: "pointer" }}
                title="Open all closed trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  TOTAL
                </span>
                <div style={{ fontSize: "16px" }}>
                  {(m.count_pending || 0) +
                    (m.count_filled || 0) +
                    (m.count_closed || 0)}
                </div>
              </div>
              <div
                className="summary-item"
                onClick={() => goTrades({ status: "pending", time: undefined })}
                style={{ cursor: "pointer" }}
                title="Open pending trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  PENDING
                </span>
                <div style={{ fontSize: "16px" }}>{m.count_pending || 0}</div>
              </div>
              <div
                className="summary-item"
                onClick={() => goTrades({ status: "filled", time: undefined })}
                style={{ cursor: "pointer" }}
                title="Open filled trades"
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  FILLED
                </span>
                <div style={{ fontSize: "16px" }}>{m.count_filled || 0}</div>
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

            <MobileCollapseSection
              title="Filters"
              className="toolbar-group toolbar-filters"
            >
              <div
                className="dashboard-filter-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, minmax(150px, 170px))",
                  gap: "12px",
                  width: "fit-content",
                  justifyContent: "end",
                  marginLeft: "auto",
                  alignItems: "end",
                  minWidth: 0,
                  flex: "0 0 auto",
                }}
              >
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    ACCOUNT
                  </span>
                  <select
                    id="db-filter-account"
                    value={filters.account_id}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        account_id: e.target.value,
                      }))
                    }
                    style={{
                      fontSize: 10,
                      padding: "4px 8px",
                      width: "100%",
                      minWidth: 0,
                    }}
                  >
                    <option value="">All</option>
                    {(f.accounts || []).map((v) => (
                      <option key={v} value={v}>
                        {accountNameById.get(String(v)) || v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    SYMBOL
                  </span>
                  <select
                    id="db-filter-symbol"
                    value={filters.symbol}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        symbol: e.target.value,
                      }))
                    }
                    style={{
                      fontSize: 10,
                      padding: "4px 8px",
                      width: "100%",
                      minWidth: 0,
                    }}
                  >
                    <option value="">All</option>
                    {(f.symbols || []).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    SOURCE
                  </span>
                  <select
                    id="db-filter-source"
                    value={filters.source}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        source: e.target.value,
                      }))
                    }
                    style={{
                      fontSize: 10,
                      padding: "4px 8px",
                      width: "100%",
                      minWidth: 0,
                    }}
                  >
                    <option value="">All</option>
                    {(f.sources || []).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    MODEL
                  </span>
                  <select
                    id="db-filter-model"
                    value={filters.entry_model}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        entry_model: e.target.value,
                      }))
                    }
                    style={{
                      fontSize: 10,
                      padding: "4px 8px",
                      width: "100%",
                      minWidth: 0,
                    }}
                  >
                    <option value="">All</option>
                    {(f.entry_models || []).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="dashboard-filter-field">
                  <span
                    className="minor-text"
                    style={{ fontSize: 9, opacity: 0.7 }}
                  >
                    RANGE
                  </span>
                  <select
                    id="db-filter-range"
                    value={filters.range}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, range: e.target.value }))
                    }
                    style={{
                      fontSize: 10,
                      padding: "4px 8px",
                      width: "100%",
                      minWidth: 0,
                    }}
                  >
                    {RANGE_OPTIONS.map((r) => (
                      <option key={r.val} value={r.val}>
                        {r.lab}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </MobileCollapseSection>
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
                    <span className="money-pos">
                      {asMoneySigned(v.win_sum_pnl || 0)}
                    </span>
                    <span>|</span>
                    <span className="money-neg">
                      {asMoneySigned(v.lose_sum_pnl || 0)}
                    </span>
                    <span>|</span>
                    <span>{asPct(winrate)}</span>
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
              <div className="panel-label" style={{ marginBottom: 8 }}>
                PnL Calendar
              </div>
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
                  style={{ fontSize: 10, padding: "2px 6px" }}
                  onClick={() => {
                    if (calendarMonth === 0) {
                      setCalendarMonth(11);
                      setCalendarYear((y) => y - 1);
                    } else setCalendarMonth((m) => m - 1);
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
                  style={{ fontSize: 10, padding: "2px 6px" }}
                  onClick={() => {
                    if (calendarMonth === 11) {
                      setCalendarMonth(0);
                      setCalendarYear((y) => y + 1);
                    } else setCalendarMonth((m) => m + 1);
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
                  alignItems: "baseline",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <div className="panel-label" style={{ margin: 0 }}>
                  Last 2 Months
                </div>
                <div
                  className={moneyClass(dailyPnlTotal)}
                  style={{ fontSize: 18 }}
                >
                  {dailyPnlTotal > 0 ? "+" : ""}
                  {asMoney(dailyPnlTotal)}
                </div>
              </div>
              <div
                className="dashboard-chart-canvas"
                style={{
                  position: "relative",
                  height: 180,
                  border: "1px solid var(--border)",
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
                    gridTemplateColumns: `repeat(${Math.max(dayPoints.length, 1)}, 1fr)`,
                    gap: 1,
                    alignItems: "stretch",
                  }}
                >
                  {dayPoints.map((p, idx) => {
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
                    const shortLabel = p.date ? p.date.slice(8) : ""; // DD
                    const pDate = p.date
                      ? new Date(`${p.date}T00:00:00`)
                      : null;
                    const isPrevMonth =
                      pDate != null &&
                      (pDate.getFullYear() !== today.getFullYear() ||
                        pDate.getMonth() !== today.getMonth());
                    const isCurrMonthFirstDay =
                      pDate != null &&
                      pDate.getFullYear() === today.getFullYear() &&
                      pDate.getMonth() === today.getMonth() &&
                      pDate.getDate() === 1;
                    return (
                      <div
                        key={p.date}
                        style={{
                          position: "relative",
                          display: "flex",
                          justifyContent: "center",
                        }}
                        title={
                          p.hasPnl
                            ? `${p.date}: $${pnlNum.toFixed(2)}`
                            : `${p.date}: no trades`
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
                            color: isPrevMonth
                              ? "rgba(148,163,184,0.40)"
                              : "rgba(148,163,184,0.88)",
                            fontWeight: isCurrMonthFirstDay ? 800 : 600,
                            letterSpacing: 0,
                          }}
                        >
                          {shortLabel}
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
