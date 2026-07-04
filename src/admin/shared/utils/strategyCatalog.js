export function mergeStrategiesById(...collections) {
  const merged = new Map();
  for (const collection of collections) {
    for (const item of Array.isArray(collection) ? collection : []) {
      if (!item || typeof item !== "object") continue;
      const strategyId = String(item.key || item.id || "").trim();
      const mergeKey = strategyId || `__anonymous__${merged.size}`;
      const previous = merged.get(mergeKey);
      merged.set(mergeKey, previous ? { ...previous, ...item } : item);
    }
  }
  return Array.from(merged.values());
}

function strategyKindRank(item = {}) {
  const kind = String(item?.kind || "").trim().toLowerCase();
  const status = String(item?.status || "").trim().toLowerCase();
  if (kind === "preset") return 0;
  if (kind === "custom" && status === "draft") return 2;
  if (kind === "custom") return 1;
  return 3;
}

export function normalizeStrategyCatalog(items = []) {
  return mergeStrategiesById(items).sort((left, right) => {
    const kindCompare = strategyKindRank(left) - strategyKindRank(right);
    if (kindCompare !== 0) return kindCompare;
    return String(left?.name || left?.key || left?.id || "").localeCompare(
      String(right?.name || right?.key || right?.id || ""),
    );
  });
}
