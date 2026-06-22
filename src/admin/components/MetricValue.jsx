import React from "react";
import { asNum, moneyClass } from "../utils/numberFormat";

function countPriceDecimals(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const normalized = n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  const idx = normalized.indexOf(".");
  return idx >= 0 ? normalized.length - idx - 1 : 0;
}

function inferSymbolPricePrecision(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return null;
  if (/^[A-Z]{6}$/.test(sym)) return sym.endsWith("JPY") ? 3 : 5;
  if (sym.startsWith("XAU") || sym.startsWith("XAG")) return 2;
  if (sym.endsWith("USD") || sym.endsWith("USDT")) return 2;
  return null;
}

export function inferPricePrecision(symbol, values = []) {
  const explicit = inferSymbolPricePrecision(symbol);
  if (explicit != null) return explicit;
  let precision = 0;
  for (const value of values) {
    precision = Math.max(precision, countPriceDecimals(value));
  }
  return Math.min(Math.max(precision || 2, 0), 8);
}

export function formatPriceValue(value, { symbol = "", precision, values = [] } = {}) {
  const n = asNum(value);
  if (n == null) return "-";
  const resolvedPrecision =
    Number.isFinite(Number(precision))
      ? Math.min(Math.max(Number(precision), 0), 8)
      : inferPricePrecision(symbol, values);
  return n.toFixed(resolvedPrecision);
}

export function formatPercentValue(value, digits = 2) {
  const n = asNum(value);
  if (n == null) return "-";
  return `${n.toFixed(digits)}%`;
}

export function formatPnlValue(value, digits = 2) {
  const n = asNum(value);
  if (n == null) return "-";
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(digits)}`;
}

export default function MetricValue({
  type = "text",
  value,
  symbol = "",
  precision,
  values = [],
  digits = 2,
  strong = true,
  className = "",
}) {
  if (type === "price") {
    return (
      <span className={className} style={strong ? { fontWeight: 800 } : undefined}>
        {formatPriceValue(value, { symbol, precision, values })}
      </span>
    );
  }

  if (type === "pnl") {
    const n = asNum(value);
    if (n == null) return <span className={`minor-text ${className}`.trim()}>-</span>;
    const cls = [moneyClass(n), className].filter(Boolean).join(" ");
    return (
      <span className={cls} style={strong ? { fontWeight: 800 } : undefined}>
        {formatPnlValue(n, digits)}
      </span>
    );
  }

  if (type === "percent") {
    const n = asNum(value);
    if (n == null) return <span className={`minor-text ${className}`.trim()}>-</span>;
    const cls = [n > 0 ? "money-pos" : n < 0 ? "money-neg" : "money-neutral", className]
      .filter(Boolean)
      .join(" ");
    return (
      <span className={cls} style={strong ? { fontWeight: 800 } : undefined}>
        {formatPercentValue(n, digits)}
      </span>
    );
  }

  return (
    <span className={className} style={strong ? { fontWeight: 800 } : undefined}>
      {value ?? "-"}
    </span>
  );
}
