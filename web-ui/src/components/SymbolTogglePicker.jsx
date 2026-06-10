import { useMemo, useState } from "react";
import {
  SYSTEM_SYMBOL_GROUP_LABELS,
  SYSTEM_SYMBOL_GROUP_ORDER,
  SYSTEM_SYMBOL_GROUP_PRESETS,
  encodeCustomSymbolGroupValue,
  decodeCustomSymbolGroupValue,
  normalizeSymbol,
  normalizeSymbolList,
  normalizeCronSymbolGroupValue,
} from "../utils/symbolGroups";

function groupLabel(value, customGroups) {
  if (value === "ALL") return "All";
  const normalized = normalizeCronSymbolGroupValue(value);
  if (SYSTEM_SYMBOL_GROUP_LABELS[normalized]) return SYSTEM_SYMBOL_GROUP_LABELS[normalized];
  const customId = decodeCustomSymbolGroupValue(normalized);
  return customGroups.find((group) => group.id === customId)?.name || customId || "All";
}

export default function SymbolTogglePicker({
  value = [],
  onChange,
  symbolGroups = [],
  compact = false,
  addPlaceholder = "Add symbol, e.g. EURUSD",
  searchPlaceholder = "Search symbols",
}) {
  const [quickAdd, setQuickAdd] = useState("");
  const [search, setSearch] = useState("");
  const [sourceGroup, setSourceGroup] = useState("ALL");

  const selectedSymbols = useMemo(
    () => normalizeSymbolList(value),
    [value],
  );

  const watchlistGroup = useMemo(
    () => (Array.isArray(symbolGroups) ? symbolGroups : []).find((group) => group.id === "watchlist") || null,
    [symbolGroups],
  );

  const customGroups = useMemo(
    () =>
      (Array.isArray(symbolGroups) ? symbolGroups : []).filter(
        (group) => group.id !== "watchlist",
      ),
    [symbolGroups],
  );

  const sourceOptions = useMemo(() => {
    const systemOptions = SYSTEM_SYMBOL_GROUP_ORDER.map((key) => ({
      value: key === "system:all" ? "ALL" : key,
      label: SYSTEM_SYMBOL_GROUP_LABELS[key] || key,
    }));
    const customOptions = customGroups.map((group) => ({
      value: encodeCustomSymbolGroupValue(group.id),
      label: group.name,
    }));
    return [...systemOptions, ...customOptions];
  }, [customGroups]);

  const allKnownSymbols = useMemo(() => {
    const all = new Set(selectedSymbols);
    for (const preset of Object.values(SYSTEM_SYMBOL_GROUP_PRESETS)) {
      for (const symbol of preset || []) all.add(normalizeSymbol(symbol));
    }
    for (const symbol of watchlistGroup?.symbols || []) all.add(normalizeSymbol(symbol));
    for (const group of customGroups) {
      for (const symbol of group.symbols || []) all.add(normalizeSymbol(symbol));
    }
    return Array.from(all).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [selectedSymbols, watchlistGroup, customGroups]);

  const sourceSymbols = useMemo(() => {
    if (sourceGroup === "ALL") return allKnownSymbols;
    const normalized = normalizeCronSymbolGroupValue(sourceGroup);
    if (normalized === "system:watchlist") {
      return normalizeSymbolList(watchlistGroup?.symbols || []);
    }
    if (normalized.startsWith("system:")) {
      return normalizeSymbolList(
        SYSTEM_SYMBOL_GROUP_PRESETS[normalized.slice(7)] || [],
      );
    }
    const customId = decodeCustomSymbolGroupValue(normalized);
    return normalizeSymbolList(
      customGroups.find((group) => group.id === customId)?.symbols || [],
    );
  }, [sourceGroup, allKnownSymbols, watchlistGroup, customGroups]);

  const visibleSymbols = useMemo(() => {
    const query = String(search || "").trim().toUpperCase();
    return sourceSymbols.filter((symbol) => !query || symbol.includes(query));
  }, [sourceSymbols, search]);

  const setNext = (next) => {
    if (typeof onChange === "function") {
      onChange(normalizeSymbolList(next).sort((a, b) => a.localeCompare(b)));
    }
  };

  const handleToggle = (symbol) => {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return;
    const next = selectedSymbols.includes(normalized)
      ? selectedSymbols.filter((item) => item !== normalized)
      : [...selectedSymbols, normalized];
    setNext(next);
  };

  const handleAdd = () => {
    const normalized = normalizeSymbol(quickAdd);
    if (!normalized) return;
    setNext([...selectedSymbols, normalized]);
    setQuickAdd("");
  };

  const handleSelectAll = () => {
    setNext([...selectedSymbols, ...visibleSymbols]);
  };

  const handleClear = () => {
    if (sourceGroup === "ALL") {
      setNext([]);
      return;
    }
    const clearSet = new Set(visibleSymbols);
    setNext(selectedSymbols.filter((symbol) => !clearSet.has(symbol)));
  };

  const controlFont = compact ? 10 : 11;
  const buttonPadding = compact ? "4px 8px" : "6px 10px";

  return (
    <div className="stack-layout" style={{ gap: compact ? 8 : 10 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact
            ? "minmax(120px, 1fr) auto minmax(120px, 1fr) 160px auto auto"
            : "minmax(140px, 1fr) auto minmax(140px, 1fr) 180px auto auto",
          gap: 8,
          alignItems: "end",
        }}
      >
        <label className="stack-layout" style={{ gap: 4 }}>
          <span className="minor-text" style={{ fontSize: 10 }}>
            Add Symbol
          </span>
          <input
            placeholder={addPlaceholder}
            value={quickAdd}
            onChange={(e) => setQuickAdd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
        </label>
        <button
          className="secondary-button"
          style={{ padding: buttonPadding, fontSize: controlFont }}
          onClick={handleAdd}
        >
          Add
        </button>
        <label className="stack-layout" style={{ gap: 4 }}>
          <span className="minor-text" style={{ fontSize: 10 }}>
            Search Symbols
          </span>
          <input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="stack-layout" style={{ gap: 4 }}>
          <span className="minor-text" style={{ fontSize: 10 }}>
            Symbol Group
          </span>
          <select value={sourceGroup} onChange={(e) => setSourceGroup(e.target.value)}>
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          style={{ padding: buttonPadding, fontSize: controlFont }}
          onClick={handleSelectAll}
        >
          Select All
        </button>
        <button
          className="secondary-button"
          style={{ padding: buttonPadding, fontSize: controlFont }}
          onClick={handleClear}
        >
          Clear
        </button>
      </div>

      <div className="minor-text" style={{ fontSize: 11 }}>
        {groupLabel(sourceGroup, customGroups)} — {selectedSymbols.length} selected, {visibleSymbols.length} visible
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact
            ? "repeat(auto-fill, minmax(82px, 1fr))"
            : "repeat(auto-fill, minmax(88px, 1fr))",
          gap: 6,
          maxHeight: compact ? 220 : 360,
          overflowY: "auto",
        }}
      >
        {visibleSymbols.map((symbol) => {
          const active = selectedSymbols.includes(symbol);
          return (
            <button
              key={symbol}
              className={`secondary-button${active ? " active" : ""}`}
              style={{
                padding: compact ? "5px 7px" : "6px 8px",
                fontSize: compact ? 10 : 11,
                opacity: active ? 1 : 0.5,
                borderColor: active ? "var(--accent)" : undefined,
              }}
              onClick={() => handleToggle(symbol)}
            >
              {symbol}
            </button>
          );
        })}
      </div>
    </div>
  );
}
