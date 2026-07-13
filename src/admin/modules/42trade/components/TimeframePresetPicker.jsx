import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTimeframeSummaryLabel,
  findMatchingTimeframePreset,
  normalizeTimeframeSelection,
  SHARED_TIMEFRAME_PRESET_OPTIONS,
  TIMEFRAME_PICKER_TF_OPTIONS,
} from "./timeframePresetOptions";

export default function TimeframePresetPicker({
  selectedTfs = [],
  onChange,
  presetOptions = SHARED_TIMEFRAME_PRESET_OPTIONS,
  timeframeOptions = TIMEFRAME_PICKER_TF_OPTIONS,
  align = "left",
  buttonMinWidth = 120,
  buttonHeight = 30,
  title = "Chart timeframes",
  emptyLabel = "Select TFs",
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const normalizedSelectedTfs = useMemo(
    () => normalizeTimeframeSelection(selectedTfs, timeframeOptions),
    [selectedTfs, timeframeOptions],
  );
  const activePreset = useMemo(
    () =>
      findMatchingTimeframePreset(
        normalizedSelectedTfs,
        presetOptions,
        timeframeOptions,
      ),
    [normalizedSelectedTfs, presetOptions, timeframeOptions],
  );
  const summaryLabel = useMemo(
    () =>
      buildTimeframeSummaryLabel(
        normalizedSelectedTfs,
        presetOptions,
        timeframeOptions,
        emptyLabel,
      ),
    [normalizedSelectedTfs, presetOptions, timeframeOptions, emptyLabel],
  );

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="secondary-button"
        style={{
          minWidth: buttonMinWidth,
          height: buttonHeight,
          padding: "0 12px",
          fontSize: "12px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          borderColor: open ? "rgba(34,211,238,0.45)" : "var(--border)",
          color: open ? "#22d3ee" : "inherit",
          background: open ? "rgba(34,211,238,0.10)" : undefined,
        }}
        onClick={() => setOpen((current) => !current)}
        title={title}
      >
        <span>{summaryLabel}</span>
        <span style={{ fontSize: 10, opacity: 0.8 }}>▼</span>
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            [align === "right" ? "right" : "left"]: 0,
            width: 260,
            maxHeight: 420,
            overflowY: "auto",
            zIndex: 40,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(9,15,28,0.96)",
            boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
            padding: 12,
          }}
        >
          {Array.isArray(presetOptions) && presetOptions.length > 0 ? (
            <>
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.08,
                  color: "var(--muted)",
                  marginBottom: 8,
                }}
              >
                Templates
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {presetOptions.map((preset) => {
                  const active = activePreset?.value === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      className="secondary-button"
                      style={{
                        width: "100%",
                        justifyContent: "flex-start",
                        borderColor: active
                          ? "rgba(34,211,238,0.45)"
                          : "rgba(255,255,255,0.08)",
                        color: active ? "#22d3ee" : "inherit",
                        background: active
                          ? "rgba(34,211,238,0.10)"
                          : undefined,
                      }}
                      onClick={() => {
                        const next = normalizeTimeframeSelection(
                          Array.isArray(preset?.tfs) ? preset.tfs : [],
                          timeframeOptions,
                        );
                        if (!next.length) return;
                        onChange?.(next, { reason: "preset", preset });
                        setOpen(false);
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div
                style={{
                  height: 1,
                  background: "rgba(255,255,255,0.08)",
                  margin: "12px 0",
                }}
              />
            </>
          ) : null}
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.08,
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            Individual TFs
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {timeframeOptions.map((option) => {
              const optionValue = String(option?.value || "")
                .trim()
                .toLowerCase();
              const active = normalizedSelectedTfs.includes(optionValue);
              return (
                <button
                  key={optionValue}
                  type="button"
                  className="secondary-button"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 44,
                    height: 28,
                    padding: "0 10px",
                    borderRadius: 999,
                    borderColor: active
                      ? "rgba(34,211,238,0.55)"
                      : "rgba(255,255,255,0.12)",
                    background: active
                      ? "rgba(34,211,238,0.10)"
                      : "rgba(15,23,42,0.55)",
                    color: active ? "#22d3ee" : "inherit",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                  onClick={() => {
                    const nextSet = new Set(normalizedSelectedTfs);
                    if (nextSet.has(optionValue)) {
                      if (nextSet.size === 1) return;
                      nextSet.delete(optionValue);
                    } else {
                      nextSet.add(optionValue);
                    }
                    onChange?.(
                      normalizeTimeframeSelection([...nextSet], timeframeOptions),
                      { reason: "toggle", timeframe: optionValue },
                    );
                  }}
                >
                  {option?.label || optionValue}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
