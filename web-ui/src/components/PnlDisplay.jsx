import React from "react";
import { asNum } from "../utils/numberFormat";

export default function PnlDisplay({
  value,
  empty = <span className="minor-text">-</span>,
  strong = true,
}) {
  const n = asNum(value);
  if (n == null) return empty;
  const cls = n < 0 ? "money-neg" : "money-pos";
  return (
    <span className={cls} style={strong ? { fontWeight: 800 } : undefined}>
      ${n.toFixed(2)}
    </span>
  );
}
