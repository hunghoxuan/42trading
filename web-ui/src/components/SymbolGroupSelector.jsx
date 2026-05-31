import { useState, useMemo, useCallback } from "react";
import { parseTextList } from "../utils/textList";

// ── Constants ───────────────────────────────────────────────────────────────

const SYMBOLS_GROUP_PRESETS = {
  watchlist: [],
  all: [],
  crypto: [
    "BTCUSD",
    "ETHUSD",
    "XRPUSD",
    "SOLUSD",
    "ADAUSD",
    "DOGEUSD",
    "LTCUSD",
    "DOTUSD",
    "BCHUSD",
    "LINKUSD",
    "AVAXUSD",
    "MATICUSD",
  ],
  forex: [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "AUDUSD",
    "NZDUSD",
    "USDCAD",
    "USDCHF",
    "EURGBP",
    "EURJPY",
    "GBPJPY",
    "AUDJPY",
    "CADJPY",
    "AUDNZD",
    "AUDCAD",
    "GBPCAD",
    "EURAUD",
    "EURCHF",
    "GBPCHF",
  ],
  indices: ["US30", "US100", "US500", "DE40", "UK100", "FR40", "JP225", "HK50"],
  metals: ["XAUUSD", "XAGUSD", "XPTUSD", "XPDUSD", "XAUAUD", "XAGAUD"],
};

const SYMBOLS_GROUP_LABELS = {
  crypto: "Crypto",
  forex: "Forex",
  indices: "Indices",
  metals: "Metals",
};

const SYMBOLS_GROUP_ORDER = ["forex", "indices", "metals", "crypto"];

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeSymbol(s) {
  return String(s || "")
    .trim()
    .toUpperCase();
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * SymbolGroupSelector — reusable symbol picker.
 *
 * Modes:
 *   - Group selected (watchlist/forex/crypto/etc): shows readonly list,
 *     stores group name only. Cron auto-applies all group symbols.
 *   - Custom: toggle symbols on/off. Selections persist when switching
 *     groups and coming back.
 *
 * Props:
 *   value          — current custom symbol list (newline-separated)
 *   onChange       — called with new symbol string (custom mode)
 *   group          — currently selected group ("" = custom)
 *   onGroupChange  — called when group changes
 *   watchlist      — array of watchlist symbols
 *   compact        — if true, render compact
 */
export default function SymbolGroupSelector({
  value = "",
  onChange,
  group = "",
  onGroupChange,
  watchlist = [],
  compact = false,
}) {
  const currentSymbols = useMemo(
    () => parseTextList(value, true).map(normalizeSymbol).filter(Boolean),
    [value],
  );

  // Build grouped symbol map
  const groupedSymbols = useMemo(() => {
    const groups = {};
    for (const key of SYMBOLS_GROUP_ORDER) {
      groups[key] = (SYMBOLS_GROUP_PRESETS[key] || [])
        .map(normalizeSymbol)
        .filter(Boolean);
    }
    groups.watchlist = (watchlist || []).map(normalizeSymbol).filter(Boolean);
    return groups;
  }, [watchlist]);

  const handleGroupChange = (g) => {
    if (onGroupChange) onGroupChange(g);
  };

  const handleToggleSymbol = useCallback(
    (sym) => {
      const norm = normalizeSymbol(sym);
      const next = currentSymbols.includes(norm)
        ? currentSymbols.filter((s) => s !== norm)
        : [...currentSymbols, norm];
      onChange(next.join("\n"));
    },
    [currentSymbols, onChange],
  );

  const handleSelectAll = () => {
    const all = new Set(currentSymbols);
    for (const g of SYMBOLS_GROUP_ORDER) {
      for (const s of groupedSymbols[g] || []) all.add(s);
    }
    if (watchlist.length > 0) {
      for (const s of watchlist.map(normalizeSymbol)) all.add(s);
    }
    onChange(Array.from(all).join("\n"));
  };

  const handleClearAll = () => {
    onChange("");
  };

  // Symbols to display in the toggle grid (when Custom mode)
  const displaySymbols = useMemo(() => {
    const all = new Set(currentSymbols);
    for (const g of SYMBOLS_GROUP_ORDER) {
      for (const s of groupedSymbols[g] || []) all.add(s);
    }
    if (watchlist.length > 0) {
      for (const s of watchlist.map(normalizeSymbol)) all.add(s);
    }
    return Array.from(all).sort();
  }, [groupedSymbols, currentSymbols, watchlist]);

  const groupTabs = [
    { key: "watchlist", label: "Watchlist", show: watchlist.length > 0 },
    ...SYMBOLS_GROUP_ORDER.map((key) => ({
      key,
      label: SYMBOLS_GROUP_LABELS[key] || key,
      show: true,
    })),
  ].filter((t) => t.show);

  const isGroupMode = group !== "";

  if (compact) {
    return (
      <div className="stack-layout" style={{ gap: 8 }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button
            className={`secondary-button${!isGroupMode ? " active" : ""}`}
            style={{ padding: "3px 8px", fontSize: 11 }}
            onClick={() => handleGroupChange("")}
          >
            Custom
          </button>
          {groupTabs.map((t) => (
            <button
              key={t.key}
              className={`secondary-button${group === t.key ? " active" : ""}`}
              style={{ padding: "3px 8px", fontSize: 11 }}
              onClick={() => handleGroupChange(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {isGroupMode ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {(groupedSymbols[group] || []).map((sym) => (
              <span
                key={sym}
                className="badge"
                style={{ fontSize: 9, opacity: 0.7, padding: "1px 5px" }}
              >
                {sym}
              </span>
            ))}
          </div>
        ) : (
          <>
            {/* Symbol pills */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {displaySymbols.map((sym) => {
                const active = currentSymbols.includes(sym);
                return (
                  <button
                    key={sym}
                    className={`secondary-button${active ? " active" : ""}`}
                    style={{
                      padding: "2px 7px",
                      fontSize: 10,
                      opacity: active ? 1 : 0.5,
                      borderColor: active ? "var(--accent)" : undefined,
                    }}
                    onClick={() => handleToggleSymbol(sym)}
                  >
                    {sym}
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
      {/* Group tabs */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button
          className={`secondary-button${!isGroupMode ? " active" : ""}`}
          style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={() => handleGroupChange("")}
        >
          Custom
        </button>
        {groupTabs.map((t) => (
          <button
            key={t.key}
            className={`secondary-button${group === t.key ? " active" : ""}`}
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => handleGroupChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isGroupMode ? (
        <div className="stack-layout" style={{ gap: 6 }}>
          <div className="minor-text" style={{ fontSize: 11 }}>
            {group === "watchlist"
              ? "Watchlist"
              : SYMBOLS_GROUP_LABELS[group] || group}{" "}
            — {(groupedSymbols[group] || []).length} symbols auto-applied
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(groupedSymbols[group] || []).map((sym) => (
              <span
                key={sym}
                className="badge"
                style={{ fontSize: 10, opacity: 0.7 }}
              >
                {sym}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Symbol toggle grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
              gap: 4,
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {displaySymbols.map((sym) => {
              const active = currentSymbols.includes(sym);
              return (
                <button
                  key={sym}
                  className={`secondary-button${active ? " active" : ""}`}
                  style={{
                    padding: "4px 8px",
                    fontSize: 11,
                    opacity: active ? 1 : 0.45,
                    borderColor: active ? "var(--accent)" : undefined,
                    textAlign: "center",
                  }}
                  onClick={() => handleToggleSymbol(sym)}
                >
                  {sym}
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
