export function asNum(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function asFiniteOrNull(v) {
  const n = asNum(v);
  return Number.isFinite(n) ? n : null;
}

export function formatNum3(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return parseFloat(n.toFixed(8)).toString();
}

export function asMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function asMoneySigned(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "$0.00";
  if (n < 0) return `-$${asMoney(Math.abs(n))}`;
  return `$${asMoney(n)}`;
}

export function asPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0%";
  return `${Math.ceil(n)}%`;
}

export function asRR(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return (n > 0 ? "+" : "") + n.toFixed(2);
}

export function moneyClass(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "money-neutral";
  return n > 0 ? "money-pos" : "money-neg";
}
