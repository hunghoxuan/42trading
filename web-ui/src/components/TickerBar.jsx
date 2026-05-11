import { useEffect, useState } from "react";
import "./TickerBar.css";

/**
 * Minimal ticker — right side only: realtime FILLED trades (symbol + pnl) from broker sync.
 */
export default function TickerBar() {
  const [filledTrades, setFilledTrades] = useState([]);

  useEffect(() => {
    window.__tickerFilledTrades = window.__tickerFilledTrades || [];
    const handler = () => {
      const trades = window.__tickerFilledTrades || [];
      setFilledTrades([...trades]);
    };
    window.addEventListener("ticker-update", handler);
    handler();
    return () => window.removeEventListener("ticker-update", handler);
  }, []);

  if (!filledTrades.length) return null;

  return (
    <div className="ticker-bar" style={{
      display: "flex",
      justifyContent: "flex-end",
      gap: 12,
      padding: "2px 16px",
      fontSize: "11px",
      borderBottom: "1px solid var(--border)",
      background: "rgba(255,255,255,0.02)",
      overflow: "hidden",
    }}>
      {filledTrades.map((t) => (
        <span
          key={t.sid}
          style={{
            whiteSpace: "nowrap",
            color: Number(t.pnl) >= 0 ? "var(--success)" : "var(--error)",
            fontWeight: 600,
          }}
        >
          {t.symbol} {Number(t.pnl) >= 0 ? "+" : ""}{Number(t.pnl).toFixed(0)}
        </span>
      ))}
    </div>
  );
}
