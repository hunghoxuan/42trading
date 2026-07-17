import symbolGroupsConfig from "./symbolGroups.json";

export const SYMBOL_GROUPS_CONFIG = symbolGroupsConfig;

export const SYSTEM_SYMBOL_GROUP_PRESETS = Object.freeze(
  Object.fromEntries(
    (symbolGroupsConfig.groups || []).map((group) => [group.id, [...new Set(group.symbols || [])]]),
  ),
);

export const SYSTEM_SYMBOL_GROUP_LABELS = Object.freeze({
  "system:watchlist": "Watchlist",
  "system:all": "All",
  ...Object.fromEntries(
    (symbolGroupsConfig.groups || []).map((group) => [`system:${group.id}`, group.name || group.id]),
  ),
});

export const SYSTEM_SYMBOL_GROUP_ORDER = Object.freeze([
  "system:watchlist",
  "system:all",
  ...(symbolGroupsConfig.groups || []).map((group) => `system:${group.id}`),
]);

export const RESERVED_SYMBOL_GROUP_IDS = new Set(["watchlist"]);

const LEGACY_SYSTEM_GROUP_ALIASES = Object.freeze({
  precious_metals: "metals",
  agricultural: "grains",
  agriculture: "grains",
});

export function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function normalizeSymbolList(values) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map(normalizeSymbol).filter(Boolean))];
}

export function makeSymbolGroupId(name, fallback = "group") {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeGroupEntry(entry, index = 0) {
  const rawName = String(entry?.name || "").trim();
  const rawId = String(entry?.id || "").trim().toLowerCase();
  const reservedId =
    RESERVED_SYMBOL_GROUP_IDS.has(rawId)
      ? rawId
      : rawName.toLowerCase() === "watchlist"
        ? "watchlist"
        : "";
  const name =
    reservedId === "watchlist"
      ? "Watchlist"
      : rawName || `Group ${index + 1}`;
  const id = reservedId || makeSymbolGroupId(entry?.id || name, `group-${index + 1}`);
  return {
    id,
    name,
    symbols: normalizeSymbolList(entry?.symbols),
  };
}

export function normalizeSymbolGroupsData(data) {
  const rawGroups = Array.isArray(data?.groups) ? data.groups : [];
  const normalized = [];
  const usedIds = new Set();
  const migratedWatchlistSymbols = [];

  for (let i = 0; i < rawGroups.length; i += 1) {
    const rawEntry = rawGroups[i] || {};
    const rawName = String(rawEntry?.name || "").trim().toLowerCase();
    const rawId = String(rawEntry?.id || "").trim().toLowerCase();
    if (rawId === "newslist" || rawName === "newslist") {
      migratedWatchlistSymbols.push(...normalizeSymbolList(rawEntry?.symbols));
      continue;
    }
    const next = normalizeGroupEntry(rawGroups[i], i);
    if (usedIds.has(next.id)) {
      let suffix = 2;
      let candidate = `${next.id}-${suffix}`;
      while (usedIds.has(candidate)) {
        suffix += 1;
        candidate = `${next.id}-${suffix}`;
      }
      next.id = candidate;
    }
    usedIds.add(next.id);
    normalized.push(next);
  }

  const requiredGroups = [{ id: "watchlist", name: "Watchlist" }];
  for (let i = requiredGroups.length - 1; i >= 0; i -= 1) {
    const required = requiredGroups[i];
    if (!normalized.some((group) => group.id === required.id)) {
      normalized.unshift({ ...required, symbols: [] });
    } else {
      const existing = normalized.find((group) => group.id === required.id);
      existing.name = required.name;
      existing.symbols = normalizeSymbolList(existing.symbols);
    }
  }

  const watchlist = normalized.find((group) => group.id === "watchlist");
  if (watchlist && migratedWatchlistSymbols.length) {
    watchlist.symbols = normalizeSymbolList([
      ...watchlist.symbols,
      ...migratedWatchlistSymbols,
    ]);
  }

  return {
    version: 2,
    groups: normalized,
  };
}

export function getSymbolGroupsDataFromSettings(settings = []) {
  const row = (Array.isArray(settings) ? settings : []).find(
    (item) => item?.type === "symbol_groups" && item?.name === "default",
  );
  return normalizeSymbolGroupsData(row?.data || {});
}

export function getWatchlistGroup(data) {
  return normalizeSymbolGroupsData(data).groups.find((group) => group.id === "watchlist");
}

export function getCustomSymbolGroups(data) {
  return normalizeSymbolGroupsData(data).groups.filter(
    (group) => !RESERVED_SYMBOL_GROUP_IDS.has(group.id),
  );
}

export function encodeCustomSymbolGroupValue(groupId) {
  return `custom:${String(groupId || "").trim()}`;
}

export function decodeCustomSymbolGroupValue(value) {
  const raw = String(value || "").trim();
  return raw.startsWith("custom:") ? raw.slice(7) : "";
}

export function normalizeCronSymbolGroupValue(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "custom") return "";
  if (raw === "watchlist") return "system:watchlist";
  if (raw === "newslist") return "system:watchlist";
  if (raw === "all") return "system:all";
  const alias = LEGACY_SYSTEM_GROUP_ALIASES[raw] || raw;
  if (Object.prototype.hasOwnProperty.call(SYSTEM_SYMBOL_GROUP_PRESETS, alias)) {
    return `system:${alias}`;
  }
  if (raw.startsWith("system:") || raw.startsWith("custom:")) return raw;
  return encodeCustomSymbolGroupValue(raw);
}

export function getSymbolGroupSymbols(data, value, allSymbols = []) {
  const normalized = normalizeCronSymbolGroupValue(value);
  if (!normalized) return [];
  if (normalized === "system:all") return normalizeSymbolList(allSymbols);
  if (normalized === "system:watchlist") {
    return getWatchlistGroup(data)?.symbols || [];
  }
  if (normalized.startsWith("system:")) {
    const presetKey = LEGACY_SYSTEM_GROUP_ALIASES[normalized.slice(7)] || normalized.slice(7);
    return normalizeSymbolList(SYSTEM_SYMBOL_GROUP_PRESETS[presetKey] || []);
  }
  const customId = decodeCustomSymbolGroupValue(normalized);
  const group = normalizeSymbolGroupsData(data).groups.find((item) => item.id === customId);
  return normalizeSymbolList(group?.symbols || []);
}

export function getSymbolCatalogEntry(key) {
  return SYMBOL_GROUPS_CONFIG?.symbols?.[String(key || "").trim().toUpperCase()] || null;
}
