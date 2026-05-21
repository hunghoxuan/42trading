import { useState, useEffect } from "react";
import TradeSignalChart from "./TradeSignalChart";
import { api } from "../api";

export default function InfoTabChart({
  symbol,
  interval = "1h",
  entryPrice,
  slPrice,
  tpPrice,
  tp1Price = null,
  tp2Price = null,
  tp3Price = null,
}) {
  const [bars, setBars] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError("");
    api.chartTwelveCandles(symbol, interval, 200)
      .then((data) => {
        if (data?.snapshot?.bars?.length) setBars(data.snapshot.bars);
        else setError("No bars returned");
      })
      .catch((e) => setError(e?.message || "Failed"))
      .finally(() => setLoading(false));
  }, [symbol, interval]);

  if (!symbol) return null;

  return (
    <div style={{ marginBottom: 16, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
      {loading && <div className="minor-text" style={{ padding: 40, textAlign: "center" }}>Loading chart...</div>}
      {bars && bars.length > 0 && (
        <TradeSignalChart
          key={`info-chart-${symbol}-${interval}`}
          chartId={`info-${symbol}-${interval}`}
          symbol={symbol}
          interval={interval}
          historicalData={bars}
          height={300}
          entryPrice={entryPrice}
          slPrice={slPrice}
          tpPrice={tpPrice}
          tp1Price={tp1Price ?? tpPrice}
          tp2Price={tp2Price}
          tp3Price={tp3Price}
          showPrimaryPlan={true}
          showExtraPlans={false}
          showPdArrays={false}
          showKeyLevels={false}
        />
      )}
    </div>
  );
}
