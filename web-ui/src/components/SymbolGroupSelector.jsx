import { useMemo } from "react";
import { parseTextList } from "../utils/textList";
import {
  SYSTEM_SYMBOL_GROUP_PRESETS,
  SYSTEM_SYMBOL_GROUP_LABELS,
  SYSTEM_SYMBOL_GROUP_ORDER,
  normalizeSymbol,
  normalizeSymbolGroupsData,
  normalizeCronSymbolGroupValue,
  encodeCustomSymbolGroupValue,
  decodeCustomSymbolGroupValue,
} from "../utils/symbolGroups";

function groupLabel(value, customGroups) {
  const normalized = normalizeCronSymbolGroupValue(value);
  if (!normalized) return "Custom";
  if (SYSTEM_SYMBOL_GROUP_LABELS[normalized]) {
    return SYSTEM_SYMBOL_GROUP_LABELS[normalized];
  }
  const customId = decodeCustomSymbolGroupValue(normalized);
  const group = customGroups.find((item) => item.id === customId);
  return group?.name || customId || normalized;
}

export default function SymbolGroupSelector({
  value = "",
  onChange,
  group = "",
  onGroupChange,
  symbolGroups = [],
  compact = false,
}) {
  const normalizedGroup = normalizeCronSymbolGroupValue(group);
  const currentSymbols = useMemo(
    () => parseTextList(value, true).map(normalizeSymbol).filter(Boolean),
    [value],
  );

  const normalizedSymbolGroups = useMemo(
    () => normalizeSymbolGroupsData({ groups: symbolGroups }).groups,
    [symbolGroups],
  );

  const watchlistGroup = useMemo(
    () =>
      normalizedSymbolGroups.find((item) => item.id === "watchlist") || null,
    [normalizedSymbolGroups],
  );

  const customGroups = useMemo(
    () =>
      normalizedSymbolGroups.filter(
        (item) => item.id !== "watchlist",
      ),
    [normalizedSymbolGroups],
  );

  const groupedSymbols = useMemo(() => {
    const groups = {
      "system:watchlist": watchlistGroup?.symbols || [],
      "system:all": [],
    };
    for (const key of Object.keys(SYSTEM_SYMBOL_GROUP_PRESETS)) {
      groups[`system:${key}`] = (SYSTEM_SYMBOL_GROUP_PRESETS[key] || [])
        .map(normalizeSymbol)
        .filter(Boolean);
    }
    for (const item of customGroups) {
      groups[encodeCustomSymbolGroupValue(item.id)] = (item.symbols || [])
        .map(normalizeSymbol)
        .filter(Boolean);
    }
    return groups;
  }, [watchlistGroup, customGroups]);

  const displaySymbols = useMemo(() => {
    const all = new Set(currentSymbols);
    for (const symbols of Object.values(groupedSymbols)) {
      for (const symbol of symbols || []) all.add(symbol);
    }
    return Array.from(all).sort();
  }, [groupedSymbols, currentSymbols]);

  const currentGroupSymbols = useMemo(() => {
    if (!normalizedGroup) return [];
    if (normalizedGroup === "system:all") return displaySymbols;
    return groupedSymbols[normalizedGroup] || [];
  }, [normalizedGroup, groupedSymbols, displaySymbols]);

  const groupTabs = useMemo(() => {
    const systemTabs = SYSTEM_SYMBOL_GROUP_ORDER.map((key) => ({
      key,
      label: SYSTEM_SYMBOL_GROUP_LABELS[key] || key,
    }));
    const customTabs = customGroups.map((item) => ({
      key: encodeCustomSymbolGroupValue(item.id),
      label: item.name,
    }));
    return [...systemTabs, ...customTabs];
  }, [watchlistGroup, customGroups]);

  const handleGroupChange = (nextGroup) => {
    if (onGroupChange) onGroupChange(normalizeCronSymbolGroupValue(nextGroup));
  };

  const handleToggleSymbol = (symbol) => {
    const norm = normalizeSymbol(symbol);
    const next = currentSymbols.includes(norm)
      ? currentSymbols.filter((item) => item !== norm)
      : [...currentSymbols, norm];
    onChange(next.join("\n"));
  };

  const handleSelectAll = () => {
    onChange(displaySymbols.join("\n"));
  };

  const handleClearAll = () => {
    onChange("");
  };

  const isGroupMode = Boolean(normalizedGroup);

  if (compact) {
    return (
      <div className="stack-layout" style={{ gap: 8 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button
            className={`secondary-button${!isGroupMode ? " active" : ""}`}
            style={{ padding: "3px 8px", fontSize: 11 }}
            onClick={() => handleGroupChange("")}
          >
            Custom
          </button>
          {groupTabs.map((tab) => (
            <button
              key={tab.key}
              className={`secondary-button${normalizedGroup === tab.key ? " active" : ""}`}
              style={{ padding: "3px 8px", fontSize: 11 }}
              onClick={() => handleGroupChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {isGroupMode ? (
          <>
            <div className="minor-text" style={{ fontSize: 10 }}>
              {groupLabel(normalizedGroup, customGroups)} —{" "}
              {currentGroupSymbols.length} symbols auto-applied
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {currentGroupSymbols.map((symbol) => (
                <span
                  key={symbol}
                  className="badge"
                  style={{ fontSize: 9, opacity: 0.7, padding: "1px 5px" }}
                >
                  {symbol}
                </span>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {displaySymbols.map((symbol) => {
                const active = currentSymbols.includes(symbol);
                return (
                  <button
                    key={symbol}
                    className={`secondary-button${active ? " active" : ""}`}
                    style={{
                      padding: "2px 7px",
                      fontSize: 10,
                      opacity: active ? 1 : 0.5,
                      borderColor: active ? "var(--accent)" : undefined,
                    }}
                    onClick={() => handleToggleSymbol(symbol)}
                  >
                    {symbol}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span className="minor-text" style={{ fontSize: 10 }}>
                {currentSymbols.length} selected
              </span>
              <button
                className="secondary-button"
                style={{ padding: "2px 8px", fontSize: 10 }}
                onClick={handleSelectAll}
              >
                All
              </button>
              <button
                className="secondary-button"
                style={{ padding: "2px 8px", fontSize: 10 }}
                onClick={handleClearAll}
              >
                Clear
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="stack-layout" style={{ gap: 10 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button
          className={`secondary-button${!isGroupMode ? " active" : ""}`}
          style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={() => handleGroupChange("")}
        >
          Custom
        </button>
        {groupTabs.map((tab) => (
          <button
            key={tab.key}
            className={`secondary-button${normalizedGroup === tab.key ? " active" : ""}`}
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => handleGroupChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isGroupMode ? (
        <div className="stack-layout" style={{ gap: 6 }}>
          <div className="minor-text" style={{ fontSize: 11 }}>
            {groupLabel(normalizedGroup, customGroups)} —{" "}
            {currentGroupSymbols.length} symbols auto-applied
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {currentGroupSymbols.map((symbol) => (
              <span
                key={symbol}
                className="badge"
                style={{ fontSize: 10, opacity: 0.7 }}
              >
                {symbol}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
              gap: 4,
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {displaySymbols.map((symbol) => {
              const active = currentSymbols.includes(symbol);
              return (
                <button
                  key={symbol}
                  className={`secondary-button${active ? " active" : ""}`}
                  style={{
                    padding: "4px 8px",
                    fontSize: 11,
                    opacity: active ? 1 : 0.45,
                    borderColor: active ? "var(--accent)" : undefined,
                    textAlign: "center",
                  }}
                  onClick={() => handleToggleSymbol(symbol)}
                >
                  {symbol}
                </button>
              );
            })}
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span className="minor-text" style={{ fontSize: 11 }}>
              {currentSymbols.length} symbol
              {currentSymbols.length !== 1 ? "s" : ""} selected
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="secondary-button"
                style={{ padding: "3px 10px", fontSize: 11 }}
                onClick={handleSelectAll}
              >
                Select All
              </button>
              <button
                className="secondary-button"
                style={{ padding: "3px 10px", fontSize: 11 }}
                onClick={handleClearAll}
              >
                Clear
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
