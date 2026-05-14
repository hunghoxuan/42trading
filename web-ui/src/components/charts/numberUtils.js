export function toNumLoose(v) {
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export function resolveAdjusterValue(value, fallbackValue = null) {
  // null/undefined = user cleared the field, keep 0 for slider (don't use fallback)
  if (value === null || value === undefined) return 0;
  const numVal = toNumLoose(value);
  if (Number.isFinite(numVal)) return numVal;
  // Empty string or invalid text → use fallback if available
  const fallbackNum = toNumLoose(fallbackValue);
  return Number.isFinite(fallbackNum) ? fallbackNum : 0;
}
