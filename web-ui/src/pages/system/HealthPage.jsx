import { useState, useEffect } from "react";
import { api } from "../../api";

function StatusDot({ ok }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: ok ? "#26a69a" : "#ef5350",
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

export default function HealthPage() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const data = await api.health();
      setHealth(data);
      setError("");
    } catch (e) {
      setError(e?.message || "Failed to fetch health");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);
  useEffect(() => {
    const t = setInterval(fetchHealth, 30000);
    return () => clearInterval(t);
  }, []);

  if (loading && !health)
    return <div className="loading-card">Loading health...</div>;
  if (error && !health) return <div className="msg-error">{error}</div>;

  const timeAgo = (iso) => {
    if (!iso) return "-";
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return Math.round(diff) + "s ago";
    if (diff < 3600) return Math.round(diff / 60) + "m ago";
    if (diff < 86400) return Math.round(diff / 3600) + "h ago";
    return Math.round(diff / 86400) + "d ago";
  };

  const sourceDefaults = {
    ctrader: {
      id: "Ctrader",
      connected: false,
      enabled: false,
      lastActivity: null,
    },
    mt5: { id: "MT5", connected: false, enabled: false, lastActivity: null },
    binance: {
      id: "Binance",
      connected: false,
      enabled: false,
      lastActivity: null,
    },
  };
  const sources = health?.sources || sourceDefaults;

  const items = [
    {
      label: "Server",
      value: health?.ok ? "Online" : "Offline",
      ok: health?.ok,
    },
    { label: "Version", value: health?.version || "-", ok: true },
    {
      label: "Postgres",
      value: health?.postgres || "-",
      ok: health?.postgres === "ok",
    },
    {
      label: "Redis",
      value: health?.redis || "-",
      ok: health?.redis === "ok" || health?.redis === "disabled",
    },
    {
      label: "Cron Jobs",
      value: health?.cron || "-",
      ok: health?.cron?.startsWith?.("ok"),
    },
  ];

  const sourceItems = [
    {
      label: sources.ctrader.id,
      dot: sources.ctrader.connected,
      status: sources.ctrader.enabled ? "Enabled" : "Disabled",
      last: timeAgo(sources.ctrader.lastActivity),
    },
    {
      label: sources.mt5.id,
      dot: sources.mt5.connected,
      status: sources.mt5.enabled ? "Enabled" : "Disabled",
      last: timeAgo(sources.mt5.lastActivity),
    },
    {
      label: sources.binance.id,
      dot: sources.binance.connected,
      status: sources.binance.enabled ? "Enabled" : "Disabled",
      last: timeAgo(sources.binance.lastActivity),
    },
  ];

  return (
    <div className="stack-layout fadeIn" style={{ maxWidth: 500 }}>
      <h2 style={{ fontSize: 16, marginBottom: 16 }}>System Health</h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px 24px",
          background: "rgba(255,255,255,0.02)",
          borderRadius: 8,
          padding: 16,
          border: "1px solid var(--border)",
        }}
      >
        {items.map((item) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 12,
              padding: "4px 0",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <StatusDot ok={item.ok} />
            <span className="minor-text" style={{ marginRight: 8 }}>
              {item.label}
            </span>
            <span style={{ marginLeft: "auto", fontWeight: 500 }}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="minor-text" style={{ fontSize: 10, textTransform: "uppercase", marginBottom: 8 }}>
          Sources
        </div>
        {sourceItems.map((s) => (
          <div
            key={s.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 11,
              padding: "5px 0",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <span style={{ color: s.dot ? "#22c55e" : "#555", fontSize: 14 }}>●</span>
            <span style={{ flex: 1, fontWeight: 600 }}>{s.label}</span>
            <span style={{ color: s.status === "Enabled" ? "#22c55e" : "#666", fontSize: 10 }}>
              {s.status}
            </span>
            <span className="minor-text" style={{ fontSize: 9, minWidth: 50, textAlign: "right" }}>
              {s.last}
            </span>
          </div>
        ))}
      </div>

      {health?.cronEvents?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <div className="summary-item">
              <span className="minor-text" style={{ fontSize: 9 }}>
                MARKET DATA
              </span>
              <div
                style={{
                  fontSize: 12,
                  color: (health.cronDetails?.marketData || "").includes(
                    "error",
                  )
                    ? "#ef4444"
                    : "var(--success)",
                }}
              >
                {health.cronDetails?.marketData || "-"}
              </div>
            </div>
            <div className="summary-item">
              <span className="minor-text" style={{ fontSize: 9 }}>
                AI ANALYSIS
              </span>
              <div
                style={{
                  fontSize: 12,
                  color: (health.cronDetails?.aiAnalysis || "").includes(
                    "error",
                  )
                    ? "#ef4444"
                    : "var(--muted)",
                }}
              >
                {health.cronDetails?.aiAnalysis || "-"}
              </div>
            </div>
            <div className="summary-item">
              <span className="minor-text" style={{ fontSize: 9 }}>
                SNAPSHOTS
              </span>
              <div
                style={{
                  fontSize: 12,
                  color: (health.cronDetails?.snapshots || "").includes("error")
                    ? "#ef4444"
                    : "var(--muted)",
                }}
              >
                {health.cronDetails?.snapshots || "-"}
              </div>
            </div>
          </div>

          <div
            className="minor-text"
            style={{
              marginBottom: 8,
              fontSize: 10,
              textTransform: "uppercase",
            }}
          >
            Recent Cron Runs
          </div>
          {health.cronEvents.map((ev, i) => (
            <div
              key={i}
              style={{
                fontSize: 10,
                color: "var(--muted)",
                padding: "4px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>
                  <StatusDot ok={ev.status === "ok"} />
                  {ev.events?.join(", ") || "-"}
                </span>
                <span style={{ fontSize: 9, opacity: 0.7 }}>
                  {new Date(ev.time).toLocaleTimeString()} - {ev.elapsed}s
                </span>
              </div>
              {ev.events?.map((evt, j) => {
                const isError = /error/i.test(evt);
                if (!isError && ev.status === "ok") return null;
                return (
                  <div
                    key={j}
                    style={{
                      fontSize: 9,
                      opacity: 0.65,
                      marginTop: 1,
                      marginLeft: 14,
                      color: isError
                        ? "var(--danger, #ef4444)"
                        : "var(--muted)",
                      fontWeight: isError ? 600 : 300,
                    }}
                  >
                    {evt}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="secondary-button"
        onClick={fetchHealth}
        style={{ marginTop: 12, fontSize: 11 }}
      >
        Refresh
      </button>
    </div>
  );
}
