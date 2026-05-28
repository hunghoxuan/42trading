import { useState, useEffect } from "react";
import { api } from "../../api";

function StatusDot({ ok }) {
  return (
    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: ok ? "#22c55e" : "#666", flexShrink: 0, marginRight: 8 }} />
  );
}

function cronItemOk(detail) {
  if (!detail) return false;
  return detail.startsWith("ok") || detail.includes("done");
}

export default function HealthPage() {
  const [health, setHealth] = useState(null);
  const [activity, setActivity] = useState([]);
  const [symbolActivity, setSymbolActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchHealth = async () => {
    setLoading(true);
    try { const d = await api.health(); setHealth(d); setError(""); }
    catch (e) { setError(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  const fetchActivity = async () => {
    try {
      const d = await api.healthActivity({ limit: 200 });
      setActivity(Array.isArray(d?.items) ? d.items : []);
    } catch {}
  };

  const fetchSymbolActivity = async () => {
    try {
      const d = await api.healthSymbolActivity({ limit: 300 });
      setSymbolActivity(Array.isArray(d?.items) ? d.items : []);
    } catch {}
  };

  useEffect(() => { fetchHealth(); fetchActivity(); fetchSymbolActivity(); }, []);
  useEffect(() => {
    const t = setInterval(() => {
      fetchHealth();
      fetchActivity();
      fetchSymbolActivity();
    }, 30000);
    return () => clearInterval(t);
  }, []);

  if (loading && !health) return <div className="panel minor-text" style={{ padding: 24 }}>Loading health...</div>;
  if (error && !health) return <div className="panel msg-error" style={{ padding: 24 }}>{error}</div>;

  const timeAgo = (iso) => {
    if (!iso) return "-";
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return Math.round(d) + "s ago";
    if (d < 3600) return Math.round(d / 60) + "m ago";
    if (d < 86400) return Math.round(d / 3600) + "h ago";
    return Math.round(d / 86400) + "d ago";
  };

  const sources = health?.sources || {};
  const cronCfg = health?.diagnostics?.cron?.configs || {};
  const cronDet = health?.cronDetails || {};
  const cronEvt = health?.cronEvents || [];
  const redisActivityEnabled = Boolean(health?.redisEnabled);

  const cronItems = [
    { label: "Market Data", ok: cronItemOk(cronDet.marketData), right: cronDet.marketData || "inactive" },
    { label: "AI Analysis", ok: cronItemOk(cronDet.aiAnalysis), right: cronDet.aiAnalysis || "inactive" },
    { label: "Snapshots",  ok: cronItemOk(cronDet.snapshots),  right: cronDet.snapshots || "inactive" },
  ];

  const sourceItems = [
    { label: "Ctrader",  ok: sources.ctrader?.connected,  right: `${sources.ctrader?.enabled ? "Enabled" : "Disabled"} · ${timeAgo(sources.ctrader?.lastActivity)}` },
    { label: "MT5",      ok: sources.mt5?.connected,      right: `${sources.mt5?.enabled ? "Enabled" : "Disabled"} · ${timeAgo(sources.mt5?.lastActivity)}` },
    { label: "Binance",  ok: sources.binance?.connected,  right: `${sources.binance?.enabled ? "Enabled" : "Disabled"} · ${timeAgo(sources.binance?.lastActivity)}` },
  ];

  const Row = ({ ok, label, right }) => (
    <div style={{ display: "flex", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <StatusDot ok={ok} />
      <span style={{ fontWeight: 600, fontSize: 12 }}>{label}</span>
      <span className="minor-text" style={{ marginLeft: "auto", fontSize: 11 }}>{right}</span>
    </div>
  );

  const activityIcon = (type) => {
    const t = String(type || "").toUpperCase();
    if (t === "SNAPSHOT") return "▣";
    if (t === "CRON") return "◷";
    if (t === "TRADE") return "◆";
    return "•";
  };

  return (
    <div className="stack-layout fadeIn" style={{ maxWidth: 760 }}>
      <div className="topbar" style={{ marginBottom: 4 }}>
        <h2 className="page-title">System Health</h2>
        <button className="secondary-button" onClick={fetchHealth} disabled={loading} style={{ height: 30, fontSize: 11, padding: "0 12px" }}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="panel" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>STATUS</div>
        <Row ok={health?.ok} label="Server" right={health?.ok ? "Online" : "Offline"} />
        <Row ok={health?.postgres === "ok"} label="PostgreSQL" right={health?.postgres || "-"} />
        <Row ok={health?.redis === "ok" || health?.redis === "disabled"} label="Redis" right={health?.redis || "-"} />
        <Row ok={cronItems.some((c) => c.ok)} label="Cron Jobs" right={health?.cron || "-"} />
      </div>

      <div className="panel" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>SOURCES</div>
        {sourceItems.map((s, i) => <Row key={i} {...s} />)}
      </div>

      <div className="panel" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>CRON JOBS</div>
        {cronItems.map((c, i) => <Row key={i} {...c} />)}
        {cronEvt.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="minor-text" style={{ marginBottom: 6 }}>Recent Runs</div>
            {cronEvt.slice(0, 10).map((ev, i) => (
              <div key={i} className="minor-text" style={{ padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
                <StatusDot ok={ev.status === "ok"} />
                {ev.events?.join(", ") || "-"}
                <span style={{ marginLeft: "auto", opacity: 0.5 }}>{new Date(ev.time).toLocaleTimeString()} · {ev.elapsed}s</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>HEALTH ACTIVITY</div>
        {!redisActivityEnabled && (
          <div className="minor-text" style={{ marginBottom: 8 }}>
            Redis activity tracking is disabled (`redisEnabled=false`).
          </div>
        )}
        {activity.length === 0 ? (
          <div className="minor-text">No activity entries yet.</div>
        ) : (
          activity.slice(0, 120).map((item, i) => {
            const key = item?.key || `${item?.object_type || "OBJECT"}:${item?.object_id || "unknown"}`;
            const status = String(item?.status || "").toLowerCase();
            const ok = status ? status !== "error" : true;
            return (
              <div key={`${key}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border)", fontSize: 11 }}>
                <span style={{ width: 14, textAlign: "center", opacity: 0.9 }}>{activityIcon(item?.object_type)}</span>
                <StatusDot ok={ok} />
                <span style={{ fontWeight: 700 }}>{key}</span>
                <span className="minor-text" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 380 }}>
                  {item?.message || item?.timeframe || item?.file_name || "-"}
                </span>
                <span className="minor-text" style={{ marginLeft: "auto" }}>
                  {timeAgo(item?.updated_at)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="panel" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>SYMBOL ACTIVITY</div>
        {!redisActivityEnabled && (
          <div className="minor-text" style={{ marginBottom: 8 }}>
            Redis symbol tracking is disabled (`redisEnabled=false`).
          </div>
        )}
        {symbolActivity.length === 0 ? (
          <div className="minor-text">No symbol activity entries yet.</div>
        ) : (
          symbolActivity.slice(0, 200).map((item, i) => {
            const symbol = item?.symbol || "-";
            const snapTime = item?.snapshot?.last_time ? timeAgo(item.snapshot.last_time) : "-";
            const barsTime = item?.bars?.last_time ? timeAgo(item.bars.last_time) : "-";
            return (
              <div key={`${symbol}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border)", fontSize: 11 }}>
                <span style={{ width: 14, textAlign: "center", opacity: 0.9 }}>◎</span>
                <span style={{ fontWeight: 700, minWidth: 72 }}>{symbol}</span>
                <span className="minor-text">snapshot: {snapTime}</span>
                <span className="minor-text">bars: {barsTime}</span>
                <span className="minor-text" style={{ marginLeft: "auto" }}>
                  {timeAgo(item?.updated_at)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
