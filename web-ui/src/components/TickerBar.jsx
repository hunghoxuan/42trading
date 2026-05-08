import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./TickerBar.css";

/**
 * Split ticker:
 * - Left: one message at a time, rotates, clickable route.
 * - Right: realtime FILLED trades (symbol + pnl) from broker sync.
 */
export default function TickerBar() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [filledTrades, setFilledTrades] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const handler = () => {
      const ticker = window.__tickerEvents || [];
      const trades = window.__tickerFilledTrades || [];
      setMessages([...ticker].slice(-12).reverse());
      setFilledTrades([...trades]);
    };
    window.addEventListener("ticker-update", handler);
    handler();
    return () => window.removeEventListener("ticker-update", handler);
  }, []);

  useEffect(() => {
    if (activeIndex >= messages.length) {
      setActiveIndex(0);
    }
  }, [messages, activeIndex]);

  useEffect(() => {
    if (messages.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((idx) => (idx + 1) % messages.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  if (!messages.length && !filledTrades.length) return null;

  const active = messages.length ? messages[activeIndex] : null;
  const onMessageClick = () => {
    const route = String(active?.route || "").trim();
    if (route && route !== window.location.pathname) {
      navigate(route);
    }
  };
  const formatPnl = (v) => {
    const n = Number(v || 0);
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  };

  return (
    <div className="ticker-bar">
      <button
        type="button"
        className={`ticker-left ${active?.route ? "clickable" : ""}`}
        onClick={active?.route ? onMessageClick : undefined}
        title={active?.route ? "Open related page" : ""}
      >
        {active ? (
          <>
            <span className="ticker-event">
              [{String(active.event || "").replace(/_/g, " ").toUpperCase()}]
            </span>
            <span className="ticker-message">{active.message}</span>
          </>
        ) : (
          <span className="ticker-message">No message</span>
        )}
      </button>
      <div className="ticker-right">
        <div className="ticker-filled-list">
          {filledTrades.length ? (
            filledTrades.map((t) => (
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
            ))
          ) : (
            <span className="ticker-empty">No filled trades</span>
          )}
        </div>
      </div>
    </div>
  );
}
