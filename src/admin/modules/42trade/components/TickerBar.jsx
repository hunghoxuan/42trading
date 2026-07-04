import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./TickerBar.css";
import Tooltip from "../../../shared/components/Tooltip";

/**
 * Right ticker: realtime FILLED trades (symbol + colored pnl) from broker sync.
 * Clickable — navigates to trade detail.
 */
export default function TickerBar() {
  const navigate = useNavigate();
  const [filledTrades, setFilledTrades] = useState([]);
  const [tickerMessages, setTickerMessages] = useState([]);

  useEffect(() => {
    const handler = () => {
      setFilledTrades([...(window.__tickerFilledTrades || [])]);
      setTickerMessages([...(window.__tickerMessages || [])]);
    };
    window.addEventListener("ticker-update", handler);
    handler();
    return () => window.removeEventListener("ticker-update", handler);
  }, []);

  const formatPnl = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return "";
    return `${n > 0 ? "+" : ""}${n.toFixed(2)}`;
  };

  const hasData = filledTrades.length > 0 || tickerMessages.length > 0;
  if (!hasData) return null;

  return (
    <div className="ticker-bar">
      <div className="ticker-left">
        <div className="ticker-scroll">
          {tickerMessages.map((m, index) => (
            <span
              key={`${m.id || "ticker"}:${m.ts || index}:${index}`}
              className={`ticker-msg ${m.type || ""}`}
            >
              {m.message}
            </span>
          ))}
        </div>
      </div>

      <div className="ticker-right">
        <div className="ticker-filled-list">
          {filledTrades.map((t) => (
            <Tooltip
              key={t.sid}
              content={`${t.symbol || "-"} — PnL: ${formatPnl(t.pnl) || "0.00"}`}
            >
              <button
                type="button"
                className="ticker-filled-item ticker-filled-clickable"
                onClick={() => navigate(`/trades/${t.sid}`)}
                title={`Open trade ${t.sid}`}
              >
                <span className="sym">{t.symbol || "-"}</span>
                {Number.isFinite(Number(t.pnl)) && Number(t.pnl) !== 0 ? (
                  <span className={Number(t.pnl) >= 0 ? "pnl pos" : "pnl neg"}>
                    {formatPnl(t.pnl)}
                  </span>
                ) : (
                  <span className="pnl" />
                )}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  );
}
