import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { showDateTime, sortTimeframes } from "../utils/format";

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
  { key: "all", lab: "All times" },
  { key: "today", lab: "Today" },
  { key: "week", lab: "This Week" },
  { key: "month", lab: "This Month" },
  { key: "year", lab: "This Year" },
];

function asMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function asMoneySigned(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "$0.00";
  if (n < 0) return `-$${asMoney(Math.abs(n))}`;
  return `$${asMoney(n)}`;
}

function asPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0%";
  return `${Math.ceil(n)}%`;
}

function asRR(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return (n > 0 ? "+" : "") + n.toFixed(2);
}

function moneyClass(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "money-neutral";
  return n > 0 ? "money-pos" : "money-neg";
}

function formatTimeframe(min) {
  if (!min) return "-";
  const n = Number(min);
  if (isNaN(n) || n <= 0) return min;
  if (n < 60) return `${n}m`;
  if (n < 1440) return `${n / 60}h`;
  if (n < 10080) return `${n / 1440}d`;
  if (n < 43200) return `${n / 10080}W`;
  if (n === 43200) return "1M";
  return `${n / 43200}M`;
}

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

function TableBlock({ title, rows, noun = "ITEMS", nameFormatter = null }) {
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
                fontWeight: 800,
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
                fontWeight: 800,
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
                fontWeight: 800,
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
                fontWeight: 800,
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
              style={{
                padding: "6px 0",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                gap: "12px",
                alignItems: "center",
              }}
            >
              <span
                className="mini-name"
                style={{
                  flex: "2.5",
                  fontWeight: 700,
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
                <span style={{ fontWeight: 700 }}>{asPct(r.win_rate)}</span>
                <span
                  className="minor-text"
                  style={{ fontSize: "10px", marginLeft: "4px" }}
                >
                  {r.wins}/{r.losses}
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
                  fontWeight: 700,
                }}
                className={moneyClass(r.rr_total)}
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
    entry_models: [],
    accounts: [],
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
  const monthKeyPrefix = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-`;
  const monthPoints = Object.values(calendarData || {})
    .filter(
      (x) =>
        x &&
        typeof x === "object" &&
        String(x.date || "").startsWith(monthKeyPrefix),
    )
    .map((x) => ({
      date: String(x.date || ""),
      pnl: Number(x.pnl || 0),
      day: Number(String(x.date || "").slice(8, 10)),
    }))
    .filter((x) => Number.isFinite(x.pnl) && Number.isFinite(x.day))
    .sort((a, b) => a.day - b.day);
  const dailyPnlTotal = monthPoints.reduce((acc, x) => acc + x.pnl, 0);
  const monthMaxAbsPnl = Math.max(
    1,
    ...monthPoints.map((x) => Math.abs(Number(x.pnl || 0))),
  );

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
            }}
          >
            <div
              className="toolbar-group dashboard-summary-highlights"
              style={{ display: "flex", gap: "20px", alignItems: "center" }}
            >
              <div className="summary-item">
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  TOTAL
                </span>
                <div style={{ fontWeight: 800, fontSize: "16px" }}>
                  {m.total_trades || 0}
                </div>
              </div>
              <div className="summary-item">
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  PENDING
                </span>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "16px",
                    color: "var(--accent)",
                  }}
                >
                  {m.count_pending || 0}
                </div>
              </div>
              <div className="summary-item">
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  FILLED
                </span>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "16px",
                    color: "var(--success)",
                  }}
                >
                  {m.count_filled || 0}
                </div>
              </div>
              <div className="summary-item">
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  WINS
                </span>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "16px",
                    color: "var(--success)",
                  }}
                >
                  {m.wins || 0}
                </div>
              </div>
              <div className="summary-item">
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  LOSSES
                </span>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "16px",
                    color: "var(--error)",
                  }}
                >
                  {m.losses || 0}
                </div>
              </div>
            </div>

            <div
              className="toolbar-group toolbar-filters"
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                justifyContent: "flex-end",
                flex: 1,
              }}
            >
              <select
                value={filters.account_id}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    account_id: e.target.value,
                  }))
                }
              >
                <option value="">All accounts</option>
                {(f.accounts || []).map((v) => (
                  <option key={v} value={v}>
                    {accountNameById.get(String(v)) || v}
                  </option>
                ))}
              </select>
              <select
                value={filters.symbol}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, symbol: e.target.value }))
                }
              >
                <option value="">All symbols</option>
                {(f.symbols || []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                value={filters.source}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, source: e.target.value }))
                }
              >
                <option value="">All Sources</option>
                {(f.sources || []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                value={filters.entry_model}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    entry_model: e.target.value,
                  }))
                }
              >
                <option value="">All Models</option>
                {(f.entry_models || []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>

              
              <select
                value={filters.signal_tf}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, signal_tf: e.target.value }))
                }
              >
                <option value="">Signal TF</option>
                {sortTimeframes(f.signal_tfs || [], "desc").map((v) => (
                  <option key={v} value={v}>
                    {formatTimeframe(v)}
                  </option>
                ))}
              </select>
              <select
                value={filters.range}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, range: e.target.value }))
                }
              >
                {RANGE_OPTIONS.map((r) => (
                  <option key={r.val} value={r.val}>
                    {r.lab}
                  </option>
                ))}
              </select>
            </div>
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
              const v = periodTotals[conf.key] || {};
              const winrate =
                v.total_wins + v.total_losses > 0
                  ? (v.total_wins / (v.total_wins + v.total_losses)) * 100
                  : 0;

              return (
                <article className="kpi-card" key={conf.key}>
                  <div className="panel-label">{conf.lab.toUpperCase()}</div>
                  <div
                    className="minor-text"
                    style={{
                      marginTop: "4px",
                      fontSize: "10px",
                      whiteSpace: "nowrap",
                      opacity: 0.9,
                    }}
                  >
                    t: {v.total_trades || 0} | w: {v.total_wins || 0} | l:{" "}
                    {v.total_losses || 0}
                  </div>
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
                      fontWeight: 400,
                    }}
                  >
                    pnl+:{" "}
                    <span className="money-pos">
                      {asMoneySigned(v.win_sum_pnl || 0)}
                    </span>{" "}
                    | pnl-:{" "}
                    <span className="money-neg">
                      {asMoneySigned(v.lose_sum_pnl || 0)}
                    </span>{" "}
                    | wr: {asPct(winrate)} | rr: {asRR(v.total_rr || 0)}
                  </div>
                </article>
              );
            })}
          </div>

          {/* Calendar + Daily PnL chart */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(420px, 1.2fr) minmax(320px, 1fr)",
              gap: 16,
              alignItems: "start",
            }}
          >
            {/* Monthly PnL Calendar */}
            <div className="panel fadeIn" style={{ padding: 12 }}>
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
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  {new Date(calendarYear, calendarMonth).toLocaleString(
                    "default",
                    { month: "long", year: "numeric" },
                  )}
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
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: 3,
                  textAlign: "center",
                  fontSize: 11,
                }}
              >
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <span
                    key={d}
                    style={{
                      fontWeight: 700,
                      color: "var(--muted)",
                      padding: "2px 0",
                    }}
                  >
                    {d}
                  </span>
                ))}
                {(() => {
                  const firstDay = new Date(
                    calendarYear,
                    calendarMonth,
                    1,
                  ).getDay();
                  const daysInMonth = new Date(
                    calendarYear,
                    calendarMonth + 1,
                    0,
                  ).getDate();
                  const cells = [];
                  for (let i = 0; i < firstDay; i++)
                    cells.push(<span key={"e" + i} />);
                  for (let d = 1; d <= daysInMonth; d++) {
                    const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                    const item = calendarData ? calendarData[dateStr] : null;
                    const pnl = item
                      ? Number(item.pnl || item.pnl_money || 0)
                      : null;
                    cells.push(
                      <div
                        key={d}
                        style={{
                          padding: "8px 4px 10px",
                          borderRadius: 8,
                          fontSize: 11,
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
                          minHeight: 52,
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
                          style={{
                            fontWeight: 700,
                            fontSize: 12,
                            color:
                              pnl != null ? "var(--text)" : "var(--muted)",
                          }}
                        >
                          {d}
                        </div>
                        {pnl != null && (
                          <div
                            style={{
                              color:
                                pnl > 0 ? "var(--success)" : "var(--error)",
                              fontSize: 12,
                              fontWeight: 800,
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
                  return cells;
                })()}
              </div>
            </div>

            {/* Daily PnL bar chart */}
            <div className="panel fadeIn" style={{ padding: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <div className="panel-label" style={{ margin: 0 }}>
                  Daily PnL
                </div>
                <div
                  className={moneyClass(dailyPnlTotal)}
                  style={{ fontWeight: 700, fontSize: 18 }}
                >
                  {dailyPnlTotal > 0 ? "+" : ""}
                  {asMoney(dailyPnlTotal)}
                </div>
              </div>
              <div
                style={{
                  position: "relative",
                  height: 180,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background:
                    "linear-gradient(180deg, rgba(148,163,184,0.05), rgba(15,23,42,0.08))",
                  overflow: "hidden",
                  padding: "10px 8px 22px",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "50%",
                    borderTop: "1px dashed rgba(148,163,184,0.35)",
                  }}
                />
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.max(monthPoints.length, 1)}, 1fr)`,
                    gap: 4,
                    alignItems: "stretch",
                  }}
                >
                  {(monthPoints.length ? monthPoints : [{ day: "", pnl: 0 }]).map(
                    (p, idx) => {
                      const hPct = Math.min(
                        48,
                        (Math.abs(Number(p.pnl || 0)) / monthMaxAbsPnl) * 48,
                      );
                      const isPos = Number(p.pnl || 0) >= 0;
                      return (
                        <div
                          key={`${p.day}_${idx}`}
                          style={{
                            position: "relative",
                            display: "flex",
                            alignItems: isPos ? "flex-start" : "flex-end",
                            justifyContent: "center",
                          }}
                          title={
                            p.day
                              ? `${monthKeyPrefix}${String(p.day).padStart(2, "0")}: $${Number(p.pnl || 0).toFixed(2)}`
                              : "No data"
                          }
                        >
                          {p.day ? (
                            <div
                              style={{
                                width: "80%",
                                height: `${hPct}%`,
                                marginTop: isPos ? "2%" : "50%",
                                marginBottom: isPos ? "50%" : "2%",
                                borderRadius: 3,
                                background: isPos
                                  ? "rgba(16,185,129,0.9)"
                                  : "rgba(239,68,68,0.9)",
                              }}
                            />
                          ) : null}
                          {p.day ? (
                            <div
                              style={{
                                position: "absolute",
                                bottom: -18,
                                fontSize: 10,
                                color: "var(--muted)",
                              }}
                            >
                              {String(p.day).padStart(2, "0")}
                            </div>
                          ) : null}
                        </div>
                      );
                    },
                  )}
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
            />
            <TableBlock
              title="Entry Model"
              noun="Models"
              rows={Array.isArray(top.entry_models) ? top.entry_models : []}
            />
            <TableBlock
              title="Sources"
              noun="Sources"
              rows={Array.isArray(top.sources) ? top.sources : []}
            />
            <TableBlock
              title="Order Type"
              noun="Order Type"
              rows={Array.isArray(top.directional) ? top.directional : []}
            />
            <TableBlock
              title="Accounts"
              noun="Accounts"
              rows={Array.isArray(top.accounts) ? top.accounts : []}
              nameFormatter={(id) => {
                const acc = accounts.find((a) => a.account_id === id);
                if (!acc) return id;
                const lastSync = acc.updated_at || acc.created_at;
                const lastSyncDate = lastSync ? new Date(lastSync) : null;
                const diffMin = lastSyncDate
                  ? (new Date() - lastSyncDate) / 60000
                  : 999;
                const isOnline = diffMin < 5;
                const isIdle = diffMin >= 5 && diffMin < 60;
                const statusCls = isOnline
                  ? "online"
                  : isIdle
                    ? "idle"
                    : "offline";
                return (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      className={`status-dot ${statusCls}`}
                      style={{
                        width: 7,
                        height: 7,
                        flexShrink: 0,
                        borderRadius: "50%",
                      }}
                      title={`Last synced: ${lastSyncDate ? showDateTime(lastSyncDate) : "Never"}`}
                    />
                    <span
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontWeight: 600,
                      }}
                    >
                      {acc.name || id}
                    </span>
                  </div>
                );
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
