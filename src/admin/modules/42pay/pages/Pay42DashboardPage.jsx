import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../app/api";
import { showDateTime } from "../../../shared/utils/format";
import DataTable from "../../../shared/components/DataTable";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import Pay42MediaThumb from "./Pay42MediaThumb";
import { formatMetric, formatMoney, roleLabel, statusTone } from "./pay42Ui";

const PERIOD_DISPLAY = [
  { key: "open", lab: "Now" },
  { key: "today", lab: "Today" },
  { key: "week", lab: "This Week" },
  { key: "month", lab: "This Month" },
  { key: "year", lab: "This Year" },
  { key: "all", lab: "All Times" },
];

const CHART_UNIT_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

function amountForOrder(order = {}, role = "buyer") {
  const total = Number(order?.total_amount || 0);
  return role === "buyer" ? -total : total;
}

function normalizeDateKey(raw) {
  const s = String(raw || "").trim();
  return s ? s.slice(0, 10) : "";
}

function toDateKeyLocal(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function moneyClass(value) {
  if (Number(value) > 0) return "money-pos";
  if (Number(value) < 0) return "money-neg";
  return "money-neutral";
}

function asMoneySigned(value) {
  const amount = Number(value || 0);
  const formatted = formatMoney(Math.abs(amount));
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return formatMoney(0);
}

function amountBreakdown(orders = []) {
  return (Array.isArray(orders) ? orders : []).reduce(
    (acc, order) => {
      const amount = Number(order?.signed_amount || 0);
      if (amount > 0) acc.earned += amount;
      if (amount < 0) acc.spent += Math.abs(amount);
      return acc;
    },
    { earned: 0, spent: 0 },
  );
}

function buildDailyMap(orders = [], role = "buyer") {
  const map = {};
  for (const order of Array.isArray(orders) ? orders : []) {
    const key = normalizeDateKey(order?.create_at || order?.created_at || order?.start_at);
    if (!key) continue;
    if (!map[key]) {
      map[key] = { date: key, pnl: 0, total_trades: 0, total_wins: 0, total_losses: 0 };
    }
    const amount = amountForOrder(order, role);
    map[key].pnl += amount;
    map[key].total_trades += 1;
    if (amount > 0) map[key].total_wins += 1;
    if (amount < 0) map[key].total_losses += 1;
  }
  return map;
}

function sumCalendarPnlInRange(calendarData, startDate, endDate) {
  if (!calendarData || !startDate || !endDate) return 0;
  let sum = 0;
  let totalTrades = 0;
  let totalWins = 0;
  let totalLosses = 0;
  const cur = new Date(startDate);
  while (cur <= endDate) {
    const key = toDateKeyLocal(cur);
    const row = calendarData[key] || null;
    if (row) {
      sum += Number(row.pnl || 0);
      totalTrades += Number(row.total_trades || 0);
      totalWins += Number(row.total_wins || 0);
      totalLosses += Number(row.total_losses || 0);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return {
    total_pnl: Number(sum.toFixed(2)),
    total_trades: totalTrades,
    total_wins: totalWins,
    total_losses: totalLosses,
  };
}

function shiftMonthCursor(year, month, delta) {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

function compareMonthCursor(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function monthCursorFromDate(date) {
  return { year: date.getFullYear(), month: date.getMonth() };
}

function getCalendarBounds(calendarData) {
  const keys = Object.keys(calendarData || {}).sort();
  if (!keys.length) return null;
  const first = new Date(`${keys[0]}T00:00:00`);
  const last = new Date(`${keys[keys.length - 1]}T00:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null;
  return {
    minCursor: monthCursorFromDate(first),
    maxCursor: monthCursorFromDate(last),
  };
}

function startOfWeek(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function buildChartBuckets(calendarData, unit, endYear, endMonth) {
  const safeUnit = String(unit || "day").toLowerCase();
  const buckets = [];
  if (safeUnit === "week") {
    for (let month = 0; month < 12; month += 1) {
      const start = new Date(endYear, month, 1);
      const end = new Date(endYear, month + 1, 0);
      const totals = sumCalendarPnlInRange(calendarData, start, end);
      buckets.push({
        key: `${endYear}_${month}`,
        label: new Date(endYear, month, 1).toLocaleString("default", { month: "short" }),
        title: new Date(endYear, month, 1).toLocaleString("default", { month: "long", year: "numeric" }),
        pnl: totals.total_pnl,
        hasPnl: totals.total_trades > 0,
      });
    }
    return buckets;
  }
  if (safeUnit === "month") {
    for (let year = endYear - 3; year <= endYear; year += 1) {
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31);
      const totals = sumCalendarPnlInRange(calendarData, start, end);
      buckets.push({
        key: String(year),
        label: String(year),
        title: String(year),
        pnl: totals.total_pnl,
        hasPnl: totals.total_trades > 0,
      });
    }
    return buckets;
  }
  if (safeUnit === "year") {
    for (let year = Math.max(2020, endYear - 7); year <= endYear; year += 1) {
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31);
      const totals = sumCalendarPnlInRange(calendarData, start, end);
      buckets.push({
        key: String(year),
        label: String(year).slice(-2),
        title: String(year),
        pnl: totals.total_pnl,
        hasPnl: totals.total_trades > 0,
      });
    }
    return buckets;
  }
  const start = new Date(endYear, endMonth - 1, 1);
  const end = new Date(endYear, endMonth + 1, 0);
  const cur = new Date(start);
  while (cur <= end) {
    const key = toDateKeyLocal(cur);
    const row = calendarData[key] || null;
    const pnl = Number(row?.pnl || 0);
    buckets.push({
      key,
      label: String(cur.getDate()).padStart(2, "0"),
      title: key,
      pnl,
      hasPnl: Boolean(row && row.total_trades > 0),
    });
    cur.setDate(cur.getDate() + 1);
  }
  return buckets;
}

function formatChartWindowLabel(unit, endYear, endMonth) {
  if (unit === "week") return String(endYear);
  if (unit === "month") return `${endYear - 3} — ${endYear}`;
  if (unit === "year") return `${Math.max(2020, endYear - 7)} — ${endYear}`;
  const start = new Date(endYear, endMonth - 1, 1);
  const end = new Date(endYear, endMonth + 1, 0);
  return `${start.toLocaleString("default", { month: "short", year: "numeric" })} — ${end.toLocaleString("default", { month: "short", year: "numeric" })}`;
}

function clampMonthCursor(cursor, minCursor, maxCursor) {
  let next = cursor;
  if (minCursor && compareMonthCursor(next, minCursor) < 0) next = minCursor;
  if (maxCursor && compareMonthCursor(next, maxCursor) > 0) next = maxCursor;
  return next;
}

export default function Pay42DashboardPage({ authUser }) {
  const [summary, setSummary] = useState({
    cards: [],
    recent_orders: [],
    role: "",
  });
  const [orders, setOrders] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const currentRole = roleLabel(authUser);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [chartUnit, setChartUnit] = useState("day");
  const [chartEndYear, setChartEndYear] = useState(new Date().getFullYear());
  const [chartEndMonth, setChartEndMonth] = useState(new Date().getMonth());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const isBuyerView = currentRole === "buyer";
        const [summaryOut, ordersOut, walletOut] = await Promise.all([
          api.pay42Dashboard(),
          api.pay42Orders(),
          isBuyerView ? api.pay42Wallet() : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setSummary(summaryOut || { cards: [], recent_orders: [], role: "" });
          setOrders(Array.isArray(ordersOut?.items) ? ordersOut.items : []);
          setWallet(walletOut?.wallet || null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError?.message || "Failed to load 42Pay dashboard");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentRole]);

  const dashboardRole = String(summary.role || currentRole || "buyer").toLowerCase();
  const signedOrders = useMemo(
    () =>
      orders.map((order) => ({
        ...order,
        signed_amount: amountForOrder(order, dashboardRole),
      })),
    [orders, dashboardRole],
  );

  const calendarData = useMemo(
    () => buildDailyMap(signedOrders, dashboardRole),
    [signedOrders, dashboardRole],
  );

  const calendarBounds = useMemo(() => getCalendarBounds(calendarData), [calendarData]);

  useEffect(() => {
    if (!calendarBounds?.maxCursor) return;
    setCalendarYear((prevYear) => {
      const current = clampMonthCursor(
        { year: prevYear, month: calendarMonth },
        calendarBounds.minCursor,
        calendarBounds.maxCursor,
      );
      return current.year;
    });
    setCalendarMonth((prevMonth) => {
      const current = clampMonthCursor(
        { year: calendarYear, month: prevMonth },
        calendarBounds.minCursor,
        calendarBounds.maxCursor,
      );
      return current.month;
    });
    setChartEndYear(calendarBounds.maxCursor.year);
    setChartEndMonth(calendarBounds.maxCursor.month);
  }, [calendarBounds?.maxCursor?.month, calendarBounds?.maxCursor?.year]);

  const cards = summary.cards || [];
  const recentOrders = summary.recent_orders || [];

  const columns = useMemo(
    () => [
      {
        accessorKey: "sid",
        header: "ORDER",
        cell: ({ row }) => (
          <div className="cell-wrap">
            <strong>{row.original.sid}</strong>
            <span className="minor-text">
              {row.original.offer_name || row.original.product_offer_id || "-"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "product_name",
        header: "PRODUCT",
        cell: ({ row }) => (
          <div className="pay42-cell-media">
            <Pay42MediaThumb
              src={row.original.product_image}
              alt={row.original.product_name || row.original.sid}
              label={row.original.product_name || row.original.sid}
              className="pay42-thumb"
            />
            <div className="cell-wrap">
              <strong>{row.original.product_name || "-"}</strong>
              <span className="minor-text">{row.original.seller_id || "-"}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "buyer_id",
        header: "BUYER",
        cell: ({ row }) => row.original.buyer_id || "-",
      },
      {
        accessorKey: "status",
        header: "STATUS",
        cell: ({ row }) => (
          <span
            className="minor-text"
            style={{
              color: statusTone(row.original.status),
              fontWeight: 700,
              letterSpacing: "0.08em",
            }}
          >
            {String(row.original.status || "-").toUpperCase()}
          </span>
        ),
      },
      {
        accessorKey: "total_amount",
        header: dashboardRole === "buyer" ? "SPEND" : "TOTAL",
        cell: ({ row }) => (
          <span className={moneyClass(amountForOrder(row.original, dashboardRole))}>
            {asMoneySigned(amountForOrder(row.original, dashboardRole))}
          </span>
        ),
      },
      {
        accessorKey: "create_at",
        header: "CREATED",
        cell: ({ row }) => showDateTime(row.original.create_at),
      },
    ],
    [dashboardRole],
  );

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = startOfWeek(todayStart);
  const monthStart = startOfMonth(todayStart);
  const yearStart = startOfYear(todayStart);
  const openRows = signedOrders.filter((order) => !["PAID", "COMPLETED"].includes(String(order.status || "").toUpperCase()));
  const openPnl = openRows.reduce((sum, order) => sum + Number(order.signed_amount || 0), 0);
  const openWins = openRows.filter((order) => Number(order.signed_amount || 0) > 0).length;
  const openLosses = openRows.filter((order) => Number(order.signed_amount || 0) < 0).length;

  const displayPeriodTotals = {
    open: {
      total_pnl: Number(openPnl.toFixed(2)),
      total_trades: openRows.length,
      total_wins: openWins,
      total_losses: openLosses,
    },
    today: sumCalendarPnlInRange(calendarData, todayStart, todayStart),
    week: sumCalendarPnlInRange(calendarData, weekStart, todayStart),
    month: sumCalendarPnlInRange(calendarData, monthStart, todayStart),
    year: sumCalendarPnlInRange(calendarData, yearStart, todayStart),
    all: sumCalendarPnlInRange(
      calendarData,
      Object.keys(calendarData).length
        ? new Date(`${Object.keys(calendarData).sort()[0]}T00:00:00`)
        : todayStart,
      todayStart,
    ),
  };
  const periodBreakdowns = {
    open: amountBreakdown(openRows),
    today: amountBreakdown(
      signedOrders.filter((order) => normalizeDateKey(order?.create_at) === toDateKeyLocal(todayStart)),
    ),
    week: amountBreakdown(
      signedOrders.filter((order) => {
        const raw = normalizeDateKey(order?.create_at);
        if (!raw) return false;
        const at = new Date(`${raw}T00:00:00`);
        return at >= weekStart && at <= todayStart;
      }),
    ),
    month: amountBreakdown(
      signedOrders.filter((order) => {
        const raw = normalizeDateKey(order?.create_at);
        if (!raw) return false;
        const at = new Date(`${raw}T00:00:00`);
        return at >= monthStart && at <= todayStart;
      }),
    ),
    year: amountBreakdown(
      signedOrders.filter((order) => {
        const raw = normalizeDateKey(order?.create_at);
        if (!raw) return false;
        const at = new Date(`${raw}T00:00:00`);
        return at >= yearStart && at <= todayStart;
      }),
    ),
    all: amountBreakdown(signedOrders),
  };
  const chartBuckets = useMemo(
    () => buildChartBuckets(calendarData, chartUnit, chartEndYear, chartEndMonth),
    [calendarData, chartEndMonth, chartEndYear, chartUnit],
  );
  const chartMaxPnl = chartBuckets.reduce((m, x) => Math.max(m, Number(x?.pnl || 0)), 0);
  const chartMinPnl = chartBuckets.reduce((m, x) => Math.min(m, Number(x?.pnl || 0)), 0);
  const chartAveragePnl =
    chartBuckets.length > 0
      ? chartBuckets.reduce((acc, x) => acc + Number(x?.pnl || 0), 0) / chartBuckets.length
      : 0;
  const chartTotalPnl = chartBuckets.reduce((acc, x) => acc + Number(x?.pnl || 0), 0);
  const chartSummaryItems = [
    { label: "High", value: chartMaxPnl },
    { label: "Low", value: chartMinPnl },
    { label: "Average", value: chartAveragePnl },
    { label: "Total", value: chartTotalPnl },
  ];
  const roundUpNiceUnit = (v) => {
    const n = Math.max(1, Number(v) || 1);
    const p = 10 ** Math.floor(Math.log10(n));
    const m = n / p;
    const base = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return base * p;
  };
  const yAxisStep = roundUpNiceUnit(Math.max(1, Math.max(chartMaxPnl, Math.abs(chartMinPnl)) / 5));
  const yAxisPosMax = chartMaxPnl > 0 ? yAxisStep * 5 : 0;
  const yAxisNegMin = chartMinPnl < 0 ? -(yAxisStep * 5) : 0;
  const yAxisPosScale = yAxisPosMax > 0 ? yAxisPosMax : 1;
  const yAxisNegScale = yAxisNegMin < 0 ? Math.abs(yAxisNegMin) : 1;
  const yAxisPosSteps = Array.from({ length: 5 }, (_, i) => Math.round(yAxisStep * (i + 1))).filter((v) => v > 0);
  const yAxisNegSteps = Array.from({ length: 5 }, (_, i) => Math.round(yAxisStep * (i + 1))).filter((v) => v > 0);

  const currentCalendarCursor = { year: calendarYear, month: calendarMonth };
  const canCalendarGoPrev = calendarBounds?.minCursor
    ? compareMonthCursor(currentCalendarCursor, calendarBounds.minCursor) > 0
    : false;
  const canCalendarGoNext = calendarBounds?.maxCursor
    ? compareMonthCursor(currentCalendarCursor, calendarBounds.maxCursor) < 0
    : false;

  if (error) return <div className="error">{error}</div>;

  return (
    <section className="logs-page-container trades-page-container pay42-page-container stack-layout fadeIn">
      <PageHeader
        className="trades-page-header"
        title={dashboardRole === "buyer" ? "42Pay Wallet" : "42Pay Dashboard"}
        actions={
          <div className="pay42-inline-actions">
            {dashboardRole === "buyer" ? (
              <>
                <Link className="secondary-button" to="/admin/42pay/scan">
                  Scan to Pay
                </Link>
                <Link className="secondary-button" to="/admin/42pay/topup">
                  Top Up
                </Link>
                <Link className="secondary-button" to="/admin/42pay/orders">
                  My Purchases
                </Link>
              </>
            ) : (
              <>
                <Link className="secondary-button" to="/admin/42pay/products">
                  Products
                </Link>
                <Link className="secondary-button" to="/admin/42pay/offers">
                  Offers
                </Link>
                <Link className="secondary-button" to="/admin/42pay/orders">
                  Orders
                </Link>
              </>
            )}
          </div>
        }
      />

      {dashboardRole !== "buyer" ? (
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
            {cards.map((card) => (
              <div key={card.key} className="summary-item" title={String(card.label || "")}>
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  {String(card.label || "").toUpperCase()}
                </span>
                <div style={{ fontSize: "16px" }}>{formatMetric(card.value)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div
        className="period-box-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "16px",
        }}
      >
        {PERIOD_DISPLAY.map((conf) => {
          const v = displayPeriodTotals[conf.key] || {};
          const breakdown = periodBreakdowns[conf.key] || { earned: 0, spent: 0 };
          return (
            <article className="kpi-card" key={conf.key}>
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
                  t: {v.total_trades || 0} | {v.total_wins || 0}
                  <span className="minor-text"> / </span>
                  {v.total_losses || 0}
                </div>
              </div>
              <div style={{ marginTop: "4px", height: 1 }} />
              <div className="period-big-line">
                <span className={`kpi-value ${moneyClass(v.total_pnl)}`} style={{ fontSize: "24px" }}>
                  {asMoneySigned(v.total_pnl || 0)}
                </span>
              </div>
              <div
                className="minor-text"
                style={{
                  marginTop: "2px",
                  fontSize: "10px",
                  opacity: 0.78,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 6,
                }}
              >
                <span className={moneyClass(v.total_pnl)}>
                  {dashboardRole === "buyer" ? "Buyer spend" : "Sales flow"}
                </span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span className="money-pos">Earn {formatMoney(breakdown.earned || 0)}</span>
                  <span className="money-neg">Spent {formatMoney(breakdown.spent || 0)}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div
        className="dashboard-calendar-layout"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(420px, 1.2fr) minmax(320px, 1fr)",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        <div className="panel fadeIn dashboard-calendar-panel" style={{ padding: 12 }}>
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
                const next = shiftMonthCursor(calendarYear, calendarMonth, -1);
                setCalendarYear(next.year);
                setCalendarMonth(next.month);
              }}
            >
              ◀
            </button>
            <span style={{ fontSize: 12 }}>
              {(() => {
                const pm = calendarMonth === 0 ? 11 : calendarMonth - 1;
                const py = calendarMonth === 0 ? calendarYear - 1 : calendarYear;
                return `${new Date(py, pm).toLocaleString("default", { month: "short" })} — ${new Date(calendarYear, calendarMonth).toLocaleString("default", { month: "short", year: "numeric" })}`;
              })()}
            </span>
            <button
              className="secondary-button"
              type="button"
              disabled={!canCalendarGoNext}
              onClick={() => {
                if (!canCalendarGoNext) return;
                const next = shiftMonthCursor(calendarYear, calendarMonth, 1);
                setCalendarYear(next.year);
                setCalendarMonth(next.month);
              }}
            >
              ▶
            </button>
          </div>
          {(() => {
            const prevMonth = calendarMonth === 0 ? 11 : calendarMonth - 1;
            const prevYear = calendarMonth === 0 ? calendarYear - 1 : calendarYear;
            const renderGrid = (month, year, label) => {
              const todayLocal = new Date();
              todayLocal.setHours(0, 0, 0, 0);
              const firstDay = new Date(year, month, 1).getDay();
              const dim = new Date(year, month + 1, 0).getDate();
              const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
              const cells = [];
              for (let i = 0; i < firstDay; i += 1) cells.push(<span key={`e_${label}_${i}`} />);
              for (let d = 1; d <= dim; d += 1) {
                const dateStr = `${prefix}${String(d).padStart(2, "0")}`;
                const cellDate = new Date(`${dateStr}T00:00:00`);
                const isPastDay = cellDate < todayLocal;
                const item = calendarData[dateStr] || null;
                const pnl = item ? Number(item.pnl || 0) : null;
                cells.push(
                  <div
                    key={`${label}_${d}`}
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
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                    title={pnl != null ? `${dateStr}: ${asMoneySigned(pnl)}` : dateStr}
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
                    {pnl != null ? (
                      <div className={`${moneyClass(pnl)} ${isPastDay ? "time-past" : "time-current"}`} style={{ fontSize: 9 }}>
                        {pnl > 0 ? "+" : ""}
                        {Math.abs(pnl).toFixed(2)}
                      </div>
                    ) : null}
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
                    {new Date(year, month).toLocaleString("default", { month: "long", year: "numeric" })}
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
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                      <span key={`${label}_${day}`} style={{ color: "var(--muted)", padding: "1px 0" }}>
                        {day}
                      </span>
                    ))}
                    {cells}
                  </div>
                </div>
              );
            };
            return (
              <div className="dashboard-calendar-months" style={{ display: "flex", gap: 16 }}>
                <div style={{ flex: 1 }}>{renderGrid(prevMonth, prevYear, "prev")}</div>
                <div style={{ flex: 1 }}>{renderGrid(calendarMonth, calendarYear, "curr")}</div>
              </div>
            );
          })()}
        </div>

        <div className="panel fadeIn dashboard-chart-panel" style={{ padding: 12 }}>
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
                <div key={item.label} style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                  <div className="panel-label" style={{ margin: 0, fontSize: 10 }}>
                    {item.label}
                  </div>
                  <div className={moneyClass(item.value)} style={{ fontSize: 12, lineHeight: 1.2 }}>
                    {asMoneySigned(item.value)}
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
              {CHART_UNIT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`secondary-button${chartUnit === option.value ? " active" : ""}`}
                  onClick={() => setChartUnit(option.value)}
                >
                  {option.label}
                </button>
              ))}
              <div className="minor-text" style={{ minWidth: 150 }}>
                {formatChartWindowLabel(chartUnit, chartEndYear, chartEndMonth)}
              </div>
            </div>
          </div>
          <div
            className="dashboard-chart-canvas"
            style={{
              position: "relative",
              height: 180,
              borderRadius: 8,
              background: "linear-gradient(180deg, rgba(148,163,184,0.05), rgba(15,23,42,0.08))",
              overflow: "hidden",
              padding: "10px 8px 22px 48px",
            }}
          >
            <div style={{ position: "absolute", left: 8, top: 8, bottom: 22, width: 40, pointerEvents: "none" }}>
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
              {chartBuckets.map((bucket) => {
                const pnlNum = Number(bucket.pnl || 0);
                const absRatio = bucket.hasPnl
                  ? Math.min(1, Math.abs(pnlNum) / (pnlNum >= 0 ? yAxisPosScale : yAxisNegScale))
                  : 0;
                const hPct = absRatio * 49;
                const isPos = pnlNum >= 0;
                const barTop = isPos ? 50 - hPct : 50;
                return (
                  <div
                    key={bucket.key}
                    style={{ position: "relative", display: "flex", justifyContent: "center" }}
                    title={bucket.hasPnl ? `${bucket.title}: ${asMoneySigned(pnlNum)}` : `${bucket.title}: no orders`}
                  >
                    {bucket.hasPnl ? (
                      <div
                        style={{
                          position: "absolute",
                          width: "92%",
                          height: `${hPct}%`,
                          top: `${barTop}%`,
                          borderRadius: isPos ? "2px 2px 0 0" : "0 0 2px 2px",
                          background: isPos ? "rgba(16,185,129,0.9)" : "rgba(239,68,68,0.9)",
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
                      {bucket.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <ResponsivePanel
        title="Recent Activity"
        subtitle="Latest 42Pay orders and purchases"
        className="component-frozen-wrap"
        showToggle={false}
      >
        <DataTable
          columns={columns}
          data={recentOrders}
          loading={loading}
          emptyText="No 42Pay activity yet."
          className="events-table"
        />
      </ResponsivePanel>
    </section>
  );
}
