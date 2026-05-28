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
