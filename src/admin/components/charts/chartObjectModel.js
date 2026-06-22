export function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function toNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildAnchorFieldsFromContext(ctxMenu) {
  const anchorTimeMs = toNumOrNull(ctxMenu?.time);
  const anchorPrice = toNumOrNull(ctxMenu?.price);
  return {
    anchorTimeMs,
    anchorPrice,
  };
}

export function createLineObject({ id, type, color, yRatio, ctxMenu }) {
  return {
    id,
    kind: "line",
    type,
    color,
    yRatio: clamp01(yRatio),
    ...buildAnchorFieldsFromContext(ctxMenu),
  };
}

export function createPointObject({ id, type, color, xRatio, yRatio, ctxMenu }) {
  return {
    id,
    kind: "point",
    type,
    color,
    xRatio: clamp01(xRatio),
    yRatio: clamp01(yRatio),
    ...buildAnchorFieldsFromContext(ctxMenu),
  };
}
