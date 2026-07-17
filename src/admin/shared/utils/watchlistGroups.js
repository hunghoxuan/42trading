import { normalizeSymbolGroupsData } from "../../../config/symbolGroups.js";

function normalizeWatchSymbol(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function mergeWatchlistIntoSymbolGroups(
  currentData = {},
  nextList = [],
  fallbackData = {},
) {
  const normalizedNextList = [
    ...new Set(
      (Array.isArray(nextList) ? nextList : [])
        .map(normalizeWatchSymbol)
        .filter(Boolean),
    ),
  ];
  const latestSymbolGroups = normalizeSymbolGroupsData(fallbackData || {});
  const baseGroups = Array.isArray(latestSymbolGroups?.groups)
    ? latestSymbolGroups.groups
    : [];
  const hasWatchlistGroup = baseGroups.some((group) => group?.id === "watchlist");
  const merged = normalizeSymbolGroupsData({
    ...latestSymbolGroups,
    ...currentData,
    groups: [
      ...baseGroups.map((group) =>
        group?.id === "watchlist"
          ? { ...group, symbols: normalizedNextList }
          : group,
      ),
      ...(!hasWatchlistGroup
        ? [
            {
              id: "watchlist",
              name: "Watchlist",
              symbols: normalizedNextList,
            },
          ]
        : []),
    ],
  });
  return {
    data: merged,
    watchlist: [
      ...new Set(
        ((merged.groups || []).find((group) => group?.id === "watchlist")
          ?.symbols || [])
          .map(normalizeWatchSymbol)
          .filter(Boolean),
      ),
    ],
  };
}
