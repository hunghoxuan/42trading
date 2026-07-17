import { useMemo, useState } from "react";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import {
  SYSTEM_SYMBOL_GROUP_LABELS,
  SYSTEM_SYMBOL_GROUP_ORDER,
  SYSTEM_SYMBOL_GROUP_PRESETS,
  encodeCustomSymbolGroupValue,
  decodeCustomSymbolGroupValue,
  normalizeSymbol,
  normalizeSymbolList,
  normalizeCronSymbolGroupValue,
} from "../../../../config/symbolGroups.js";

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
  searchPlaceholder = "Search symbols",
  useResponsivePanel = true,
}) {
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
    const query = normalizeSymbol(search);
    if (!query) return sourceSymbols;
    return sourceSymbols.filter((symbol) =>
      String(symbol || "").toUpperCase().includes(query),
    );
  }, [search, sourceSymbols]);

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
    const normalized = normalizeSymbol(search);
    if (!normalized) return;
    setNext([...selectedSymbols, normalized]);
    setSearch("");
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

  const controlsNode = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: compact
          ? "160px minmax(140px, 1fr) auto auto auto"
          : "180px minmax(180px, 1fr) auto auto auto",
        gap: 8,
        alignItems: "end",
        width: "100%",
      }}
    >
      <label className="stack-layout" style={{ gap: 4 }}>
        <InputComboSelect value={sourceGroup} onChange={(e) => setSourceGroup(e.target.value)}>
          {sourceOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </InputComboSelect>
      </label>
      <label className="stack-layout" style={{ gap: 4 }}>
        <input
          type="text"
          value={search}
          placeholder={searchPlaceholder}
          onChange={(event) => setSearch(normalizeSymbol(event.target.value))}
          title="Filter and pick a symbol"
          style={{ width: "100%" }}
        />
      </label>
      <button
        className="secondary-button"
        onClick={handleAdd}
      >
        Add
      </button>
      <button
        className="secondary-button"
        onClick={handleSelectAll}
      >
        Select All
      </button>
      <button
        className="secondary-button"
        onClick={handleClear}
      >
        Clear
      </button>
    </div>
  );
  const bodyNode = (
    <div
      className="stack-layout"
      data-component="SymbolTogglePicker"
      style={{ gap: compact ? 8 : 10 }}
    >
      {!useResponsivePanel ? controlsNode : null}
      <div
        data-component="SymbolTogglePicker.Grid"
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

  if (!useResponsivePanel) return bodyNode;

  return (
    <ResponsivePanel
      headerContent={controlsNode}
      collapseDirection="top-down"
      border="always"
      className="symbol-toggle-picker-panel"
      style={{ width: "100%" }}
      bodyClassName="stack-layout"
    >
      {bodyNode}
    </ResponsivePanel>
  );
}
