import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { showDateTime, sortTimeframes } from "../utils/format";
import { SizeCalculator } from "../components/SizeCalculator";

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
const AUTO_REFRESH_MS = Number(localStorage.getItem("tvbridge_refresh_ms") || 10000);

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
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function TableBlock({ title, rows, noun = "ITEMS", nameFormatter = null }) {
  const [sortKey, setSortKey] = useState("WR");
  const [sortDir, setSortDir] = useState("DESC");

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir(prev => prev === "ASC" ? "DESC" : "ASC");
    } else {
      setSortKey(key);
      setSortDir("DESC");
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    let va, vb;
    if (sortKey === "Name") { va = String(a.key); vb = String(b.key); }
    else if (sortKey === "WR") { va = a.win_rate; vb = b.win_rate; }
    else if (sortKey === "PnL") { va = a.pnl_total; vb = b.pnl_total; }
    else return 0;

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div className="panel-label" style={{ margin: 0 }}>{rows.length} {noun.toUpperCase()}</div>
      </div>
      {rows.length === 0 ? (
        <div className="minor-text">No data.</div>
      ) : (
        <div className="mini-table">
          <div className="mini-table-head wide" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '8px', background: 'transparent', display: 'flex', gap: '12px' }}>
            <span onClick={() => toggleSort("Name")} style={{ flex: '2.5', fontSize: '10px', fontWeight: 800, color: 'var(--muted)', cursor: 'pointer' }}>NAME{sortMarker("Name")}</span>
            <span onClick={() => toggleSort("WR")} style={{ flex: '1.8', textAlign: 'right', fontSize: '10px', fontWeight: 800, color: 'var(--muted)', cursor: 'pointer' }}>WR% (W/L){sortMarker("WR")}</span>
            <span onClick={() => toggleSort("PnL")} style={{ flex: '1.5', textAlign: 'right', fontSize: '10px', fontWeight: 800, color: 'var(--muted)', cursor: 'pointer' }}>PNL{sortMarker("PnL")}</span>
            <span onClick={() => toggleSort("RR")} style={{ flex: '1', textAlign: 'right', fontSize: '10px', fontWeight: 800, color: 'var(--muted)', cursor: 'pointer' }}>RR{sortMarker("RR")}</span>
          </div>
          {sortedRows.map((r) => (
            <div className="mini-table-row wide" key={r.key} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span className="mini-name" style={{ flex: '2.5', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.key}>
                {nameFormatter ? nameFormatter(r.key, r) : r.key}
              </span>
              <span style={{ flex: '1.8', textAlign: 'right', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 700 }}>{asPct(r.win_rate)}</span>
                <span className="minor-text" style={{ fontSize: '10px', marginLeft: '4px' }}>{r.wins}/{r.losses}</span>
              </span>
              <span style={{ flex: '1.5', textAlign: 'right' }} className={moneyClass(r.pnl_total)}>{asMoneySigned(r.pnl_total)}</span>
              <span style={{ flex: '1', textAlign: 'right', fontSize: '10px', fontWeight: 700 }} className={moneyClass(r.rr_total)}>{asRR(r.rr_total)}</span>
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

  async function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [resp, accs] = await Promise.all([
        api.dashboardAdvanced(filters),
        api.v2Accounts()
      ]);
      setData(resp);
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
  }, [filters.account_id, filters.symbol, filters.source, filters.entry_model, filters.direction, filters.chart_tf, filters.signal_tf, filters.range]);

  useEffect(() => {
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      load();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [filters.account_id, filters.symbol, filters.source, filters.entry_model, filters.direction, filters.chart_tf, filters.signal_tf, filters.range]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Loading dashboard...</div>;

  const m = data.metrics || {};
  const periodTotals = data.period_totals || {};
  const top = data.top_winrate || { symbols: [], entry_models: [], accounts: [] };
  const f = data.filters || {};
  const accountRows = Array.isArray(data.accounts_summary) ? data.accounts_summary : [];
  const accountNameById = new Map(accountRows.map((a) => [String(a.account_id || ""), String(a.name || a.account_id || "")]));

  return (
    <section className="stack-layout fadeIn">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 className="page-title" style={{ margin: 0 }}>Dashboard</h2>
        <span className="minor-text" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          Last refreshed: {lastRefreshAt ? showDateTime(lastRefreshAt) : "-"} (auto {Math.round(AUTO_REFRESH_MS/1000)}s)
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 18, alignItems: 'start' }}>
        <div className="stack-layout" style={{ gap: 18 }}>
      {/* Heartbeat cards removed per request, info moved to Accounts table */}

      <div className="toolbar-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px' }}>
        <div className="toolbar-group dashboard-summary-highlights" style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div className="summary-item">
            <span className="minor-text" style={{ fontSize: '10px' }}>TOTAL</span>
            <div style={{ fontWeight: 800, fontSize: '16px' }}>{m.total_trades || 0}</div>
          </div>
          <div className="summary-item">
            <span className="minor-text" style={{ fontSize: '10px' }}>PENDING</span>
            <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--accent)' }}>{m.count_pending || 0}</div>
          </div>
          <div className="summary-item">
            <span className="minor-text" style={{ fontSize: '10px' }}>FILLED</span>
            <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--success)' }}>{m.count_filled || 0}</div>
          </div>
          <div className="summary-item">
            <span className="minor-text" style={{ fontSize: '10px' }}>WINS</span>
            <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--success)' }}>{m.wins || 0}</div>
          </div>
          <div className="summary-item">
            <span className="minor-text" style={{ fontSize: '10px' }}>LOSSES</span>
            <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--error)' }}>{m.losses || 0}</div>
          </div>
        </div>

        <div className="toolbar-group toolbar-filters" style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end", flex: 1 }}>
          <select value={filters.account_id} onChange={(e) => setFilters((prev) => ({ ...prev, account_id: e.target.value }))}>
            <option value="">All accounts</option>
            {(f.accounts || []).map((v) => <option key={v} value={v}>{accountNameById.get(String(v)) || v}</option>)}
          </select>
          <select value={filters.symbol} onChange={(e) => setFilters((prev) => ({ ...prev, symbol: e.target.value }))}>
            <option value="">All symbols</option>
            {(f.symbols || []).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.source} onChange={(e) => setFilters((prev) => ({ ...prev, source: e.target.value }))}>
            <option value="">All Sources</option>
            {(f.sources || []).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.entry_model} onChange={(e) => setFilters((prev) => ({ ...prev, entry_model: e.target.value }))}>
            <option value="">All Models</option>
            {(f.entry_models || []).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.direction} onChange={(e) => setFilters((prev) => ({ ...prev, direction: e.target.value }))}>
            <option value="">All Direction</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
          <select value={filters.chart_tf} onChange={(e) => setFilters((prev) => ({ ...prev, chart_tf: e.target.value }))}>
            <option value="">Chart TF</option>
            {(sortTimeframes(f.chart_tfs || [], "desc")).map(v => <option key={v} value={v}>{formatTimeframe(v)}</option>)}
          </select>
          <select value={filters.signal_tf} onChange={(e) => setFilters((prev) => ({ ...prev, signal_tf: e.target.value }))}>
            <option value="">Signal TF</option>
            {(sortTimeframes(f.signal_tfs || [], "desc")).map(v => <option key={v} value={v}>{formatTimeframe(v)}</option>)}
          </select>
          <select value={filters.range} onChange={(e) => setFilters((prev) => ({ ...prev, range: e.target.value }))}>
            {RANGE_OPTIONS.map((r) => <option key={r.val} value={r.val}>{r.lab}</option>)}
          </select>
        </div>
      </div>

      <div className="period-box-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: '16px' }}>
        {PERIOD_DISPLAY.map((conf) => {
          const v = periodTotals[conf.key] || {};
          const winrate = v.total_wins + v.total_losses > 0 
            ? (v.total_wins / (v.total_wins + v.total_losses)) * 100 
            : 0;

          return (
            <article className="kpi-card" key={conf.key}>
              <div className="panel-label">{conf.lab.toUpperCase()}</div>
              <div className="period-big-line">
                <span className={`kpi-value ${moneyClass(v.total_pnl)}`} style={{ fontSize: '24px' }}>
                  {asMoneySigned(v.total_pnl || 0)}
                </span>
              </div>
              <div className="minor-text" style={{ marginTop: '8px', fontSize: '10px', whiteSpace: 'nowrap', opacity: 0.9 }}>
                T: {v.total_trades || 0} | 
                W: {v.total_wins} <span className="money-pos">{asMoneySigned(v.win_sum_pnl || 0)}</span> | 
                L: {v.total_losses} <span className="money-neg">{asMoneySigned(v.lose_sum_pnl || 0)}</span> | 
                WR: {asPct(winrate)} | 
                RR: {asRR(v.total_rr || 0)}
              </div>
            </article>
          );
        })}
      </div>

      <div className="dashboard-grid tables" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: '16px' }}>
        <TableBlock title="Symbols" noun="Symbols" rows={Array.isArray(top.symbols) ? top.symbols : []} />
        <TableBlock title="Entry Model" noun="Models" rows={Array.isArray(top.entry_models) ? top.entry_models : []} />
        <TableBlock title="Sources" noun="Sources" rows={Array.isArray(top.sources) ? top.sources : []} />
        <TableBlock title="Order Type" noun="Order Type" rows={Array.isArray(top.directional) ? top.directional : []} />
        <TableBlock title="Accounts" noun="Accounts" rows={Array.isArray(top.accounts) ? top.accounts : []} nameFormatter={(id) => {
          const acc = accounts.find(a => a.account_id === id);
          if (!acc) return id;
          const lastSync = acc.updated_at || acc.created_at;
          const lastSyncDate = lastSync ? new Date(lastSync) : null;
          const diffMin = lastSyncDate ? (new Date() - lastSyncDate) / 60000 : 999;
          const isOnline = diffMin < 5;
          const isIdle = diffMin >= 5 && diffMin < 60;
          const statusCls = isOnline ? 'online' : isIdle ? 'idle' : 'offline';
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span 
                className={`status-dot ${statusCls}`} 
                style={{ width: 7, height: 7, flexShrink: 0, borderRadius: '50%' }} 
                title={`Last synced: ${lastSyncDate ? showDateTime(lastSyncDate) : 'Never'}`}
              />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{acc.name || id}</span>
            </div>
          );
        }} />
        </div>
      </div>
      <SizeCalculator accountId={filters.account_id} initialSymbol={filters.symbol} />
    </div>
  </section>
);
}
