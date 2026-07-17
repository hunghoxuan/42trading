"use strict";

const symbolGroupsConfig = require("./symbolGroups.json");

const SYSTEM_SYMBOL_GROUP_MAP = Object.freeze(
  Object.fromEntries(
    (symbolGroupsConfig.groups || []).map((group) => [group.id, [...new Set(group.symbols || [])]]),
  ),
);

const SYSTEM_SYMBOL_GROUP_LABELS = Object.freeze({
  "system:watchlist": "Watchlist",
  "system:all": "All",
  ...Object.fromEntries(
    (symbolGroupsConfig.groups || []).map((group) => [`system:${group.id}`, group.name || group.id]),
  ),
});

const SYSTEM_SYMBOL_GROUP_ORDER = Object.freeze([
  "system:watchlist",
  "system:all",
  ...(symbolGroupsConfig.groups || []).map((group) => `system:${group.id}`),
]);

const RESERVED_GROUP_IDS = new Set(["watchlist"]);
const RESERVED_GROUP_NAMES = new Map([["watchlist", "Watchlist"]]);
const LEGACY_SYSTEM_GROUP_ALIASES = Object.freeze({
  precious_metals: "metals",
  agricultural: "grains",
  agriculture: "grains",
});

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeSymbolList(values) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map(normalizeSymbol).filter(Boolean))];
}

function makeSymbolGroupId(name, fallback) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback || "group";
}

function normalizeSymbolGroupsData(data) {
  const rawGroups = Array.isArray(data?.groups) ? data.groups : [];
  const groups = [];
  const usedIds = new Set();
  const migratedWatchlistSymbols = [];

  for (let i = 0; i < rawGroups.length; i += 1) {
    const entry = rawGroups[i] || {};
    const rawName = String(entry.name || "").trim();
    const rawId = String(entry.id || "").trim().toLowerCase();
    if (rawId === "newslist" || rawName.toLowerCase() === "newslist") {
      migratedWatchlistSymbols.push(...normalizeSymbolList(entry.symbols));
      continue;
    }
    const reservedId =
      RESERVED_GROUP_IDS.has(rawId)
        ? rawId
        : [...RESERVED_GROUP_NAMES.entries()].find(
            ([, label]) => label.toLowerCase() === rawName.toLowerCase(),
          )?.[0] || "";
    let id = reservedId || makeSymbolGroupId(entry.id || rawName, `group-${i + 1}`);
    while (usedIds.has(id)) id = `${id}-2`;
    usedIds.add(id);
    groups.push({
      id,
      name: RESERVED_GROUP_NAMES.get(id) || rawName || `Group ${i + 1}`,
      symbols: normalizeSymbolList(entry.symbols),
    });
  }

  const requiredGroups = [{ id: "watchlist", name: "Watchlist" }];
  for (let i = requiredGroups.length - 1; i >= 0; i -= 1) {
    const required = requiredGroups[i];
    if (!groups.some((group) => group.id === required.id)) {
      groups.unshift({ ...required, symbols: [] });
    } else {
      const existing = groups.find((group) => group.id === required.id);
      existing.name = required.name;
      existing.symbols = normalizeSymbolList(existing.symbols);
    }
  }

  const watchlist = groups.find((group) => group.id === "watchlist");
  if (watchlist && migratedWatchlistSymbols.length) {
    watchlist.symbols = normalizeSymbolList([
      ...watchlist.symbols,
      ...migratedWatchlistSymbols,
    ]);
  }

  return {
    version: 2,
    groups,
  };
}

function normalizeCronSymbolGroupValue(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "custom") return "";
  if (raw === "watchlist") return "system:watchlist";
  if (raw === "newslist") return "system:watchlist";
  if (raw === "all") return "system:all";
  const alias = LEGACY_SYSTEM_GROUP_ALIASES[raw] || raw;
  if (Object.prototype.hasOwnProperty.call(SYSTEM_SYMBOL_GROUP_MAP, alias)) {
    return `system:${alias}`;
  }
  if (raw.startsWith("system:") || raw.startsWith("custom:")) return raw;
  return `custom:${raw}`;
}

function getCustomGroupIdFromValue(value) {
  const normalized = normalizeCronSymbolGroupValue(value);
  return normalized.startsWith("custom:") ? normalized.slice(7) : "";
}

function resolveSymbolsGroupSymbols(symbolGroupsData, groupValue, allSymbols = []) {
  const normalized = normalizeCronSymbolGroupValue(groupValue);
  const data = normalizeSymbolGroupsData(symbolGroupsData);
  if (!normalized) return [];
  if (normalized === "system:all") return normalizeSymbolList(allSymbols);
  if (normalized === "system:watchlist") {
    const watchlist = data.groups.find((group) => group.id === "watchlist");
    return normalizeSymbolList(watchlist?.symbols || []);
  }
  if (normalized.startsWith("system:")) {
    return normalizeSymbolList(
      SYSTEM_SYMBOL_GROUP_MAP[
        LEGACY_SYSTEM_GROUP_ALIASES[normalized.slice(7)] || normalized.slice(7)
      ] || [],
    );
  }
  const customId = getCustomGroupIdFromValue(normalized);
  const group = data.groups.find((item) => item.id === customId);
  return normalizeSymbolList(group?.symbols || []);
}

function getSymbolCatalogEntry(key) {
  return symbolGroupsConfig?.symbols?.[String(key || "").trim().toUpperCase()] || null;
}

module.exports = {
  SYMBOL_GROUPS_CONFIG: symbolGroupsConfig,
  SYSTEM_SYMBOL_GROUP_MAP,
  SYSTEM_SYMBOL_GROUP_LABELS,
  SYSTEM_SYMBOL_GROUP_ORDER,
  normalizeSymbol,
  normalizeSymbolList,
  makeSymbolGroupId,
  RESERVED_GROUP_IDS,
  normalizeSymbolGroupsData,
  normalizeCronSymbolGroupValue,
  resolveSymbolsGroupSymbols,
  getSymbolCatalogEntry,
};
