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
      // Only preserve draft value if it is a valid non-empty entry.
      // If the draft is empty/zero but the base has a valid value, keep the base.
      const isNumeric = [
        "entry",
        "sl",
        "tp",
        "tp1",
        "tp2",
        "tp3",
        "rr",
      ].includes(key);
      if (isNumeric) {
        const baseVal = parseNumLoose(next[key]);
        const draftVal = parseNumLoose(value);
        if (draftVal != null && draftVal > 0) {
          next[key] = value;
        } else if (!(baseVal != null && baseVal > 0)) {
          next[key] = value;
        }
        // else: keep base value (it's valid, draft is empty)
      } else {
        next[key] = value;
      }
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
