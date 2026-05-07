import { useState, useEffect } from "react";
import { api } from "../api";

export default function ApiUsageTicker() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/webhook/api/system/stats");
        const data = await res.json();
        if (data.ok) {
          setStats(data.stats);
        }
      } catch (e) {
        console.error("Failed to fetch API stats", e);
      }
    };

    fetchStats();
    const timer = setInterval(fetchStats, 5000);
    return () => clearInterval(timer);
  }, []);

  if (!stats) return null;

  const lastUpdate = stats.last_updates?.[0];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 12px",
        height: 24,
        background: "rgba(0,0,0,0.3)",
        borderLeft: "1px solid rgba(255,255,255,0.1)",
        fontSize: "10px",
        fontFamily: "monospace",
        color: "var(--muted-bright)",
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        {Object.entries(stats.counters || {}).map(([name, count]) => (
          <div key={name} style={{ opacity: count > 0 ? 1 : 0.4 }}>
            <span style={{ color: "var(--muted)" }}>{name.toUpperCase()}:</span>
            <span style={{ marginLeft: 4, fontWeight: "bold", color: count > 0 ? "#f59e0b" : "inherit" }}>
              {count}
            </span>
          </div>
        ))}
      </div>

      {lastUpdate && (
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 4,
            animation: "pulse 2s infinite",
          }}
        >
          <span style={{ color: "#10b981" }}>●</span>
          <span>LAST: {lastUpdate.api.toUpperCase()}</span>
          <span style={{ opacity: 0.5 }}>
            ({new Date(lastUpdate.time).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })})
          </span>
        </div>
      )}

      <style>
        {`
          @keyframes pulse {
            0% { opacity: 0.7; }
            50% { opacity: 1; }
            100% { opacity: 0.7; }
          }
        `}
      </style>
    </div>
  );
}
