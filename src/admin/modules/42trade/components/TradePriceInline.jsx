import React from "react";
import {
  formatTradePriceField,
  resolveTradePricePrecision,
} from "../utils/tradePriceFormat";

function tradePriceText(value, precision) {
  const text = formatTradePriceField(value, precision);
  return String(text || "").trim() || null;
}

export default function TradePriceInline({
  entry = null,
  tp = null,
  sl = null,
  symbol = "",
  className = "",
}) {
  const precision = resolveTradePricePrecision(symbol, [entry, tp, sl]);
  const entryText = tradePriceText(entry, precision);
  const tpText = tradePriceText(tp, precision);
  const slText = tradePriceText(sl, precision);

  if (!entryText && !tpText && !slText) {
    return <span className={`trade-price-inline ${className}`.trim()}>-</span>;
  }

  return (
    <span className={`trade-price-inline ${className}`.trim()}>
      {entryText ? (
        <span className="trade-price-inline__entry">{entryText}</span>
      ) : null}
      <span className="trade-price-inline__sep">{" -> "}</span>
      {tpText ? <span className="trade-price-inline__tp">{tpText}</span> : null}
      <span className="trade-price-inline__sep">{" / "}</span>
      {slText ? <span className="trade-price-inline__sl">{slText}</span> : null}
    </span>
  );
}
