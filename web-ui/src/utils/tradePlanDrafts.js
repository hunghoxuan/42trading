function parseNumLoose(v) {
  if (v == null) return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function normalizePlanLinePrice(value) {
  const n = parseNumLoose(value);
  return n != null && n > 0 ? n : null;
}

export function mergePlanPreservingEdits(basePlan = {}, previousDraft = {}) {
  const next = { ...basePlan };
  const prev = previousDraft || {};
  const editableKeys = new Set([
    "direction",
    "trade_type",
    "order_type",
    "entry",
    "tp",
    "tp1",
    "tp2",
    "tp3",
    "sl",
    "rr",
    "rr2",
    "rr3",
    "multiple_exits",
  ]);

  Object.entries(prev).forEach(([key, value]) => {
    if (value === undefined) return;
    if (editableKeys.has(key)) {
      next[key] = value;
      return;
    }

    const freshVal = next[key];
    if (
      freshVal !== undefined &&
      freshVal !== null &&
      String(freshVal).trim() !== ""
    ) {
      return;
    }
    next[key] = value;
  });

  return next;
}
