import { useState } from "react";
import TradeSignalChart from "./TradeSignalChart";

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
  if (!symbol) return null;

  return (
    <div style={{ marginBottom: 16, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
      <TradeSignalChart
        key={`info-chart-${symbol}-${interval}`}
        chartId={`info-${symbol}-${interval}`}
        symbol={symbol}
        interval={interval}
        historicalData={[]}
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
    </div>
  );
}
