import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./TickerBar.css";

/**
 * Right ticker: realtime FILLED trades (symbol + colored pnl) from broker sync.
 * Clickable — navigates to trade detail.
 */
export default function TickerBar() {
  const navigate = useNavigate();
  const [filledTrades, setFilledTrades] = useState([]);

  useEffect(() => {
    const handler = () => {
      const trades = window.__tickerFilledTrades || [];
      setFilledTrades([...trades]);
    };
    window.addEventListener("ticker-update", handler);
    handler();
    return () => window.removeEventListener("ticker-update", handler);
  }, []);

  const formatPnl = (v) => {
    const n = Number(v || 0);
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  };

  if (!filledTrades.length) return null;

  return (
    <div
      className="ticker-bar"
      style={{ display: "flex", justifyContent: "flex-end" }}
    >
      <div className="ticker-right">
        <div className="ticker-filled-list">
          {filledTrades.map((t) => (
            <button
              key={t.sid}
              type="button"
              className="ticker-filled-item ticker-filled-clickable"
              onClick={() => navigate(`/trades/${t.sid}`)}
              title={`Open trade ${t.sid}`}
            >
              <span className="sym">{t.symbol || "-"}</span>
              <span className={Number(t.pnl || 0) >= 0 ? "pnl pos" : "pnl neg"}>
                {formatPnl(t.pnl)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
