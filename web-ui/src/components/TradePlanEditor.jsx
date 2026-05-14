import { useEffect, useMemo, useState } from "react";
import { SmartContent } from "./SmartContent";
import { TradeFileUpload } from "./TradeFileUpload";

function parseNum(v) {
  if (v == null) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatNum3(v) {
  if (!Number.isFinite(v)) return "";
  return String(Number(v.toFixed(3)));
}
function cleanFieldValue(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s === "null" || s === "undefined" || s === "nan") return "";
  return String(v);
}

function calcSliderMeta(rawValue) {
  const n = parseNum(rawValue);
  if (!Number.isFinite(n)) {
    return { min: 0, max: 1, step: 0.001, value: 0, enabled: false };
  }
  const magnitude = Math.max(Math.abs(n), 1);
  const span = magnitude * 0.25;
  const min = n - span;
  const max = n + span;
  const step = Math.max(0.001, (max - min) / 100); // 1% of total range
  return { min, max, step, value: n, enabled: true };
}

export function TradePlanEditor({
  signalId = null,
  tradeId = null,
  value = {},
  onChange,
  onSave,
  onAddSignal,
  onAddTrade,
  onReset,
  onCancel,
  onClose,
  showSaveButton,
  showAddSignalButton,
  showAddTradeButton,
  showResetButton = true,
  resetLabel = "Reset",
  saveLabel,
  addSignalLabel = "+ Signal",
  addTradeLabel = "+ Trade",
  busy = {},
  disabled = false,
  viewOnly = false,
  lockTradeFields = false,
  showActionsInView = false,
  error = "",
  className = "",
}) {
  const [mode, setMode] = useState("view");
  const effectiveShowSave =
    typeof showSaveButton === "boolean"
      ? showSaveButton
      : Boolean(signalId || tradeId);
  const effectiveShowAddSignal =
    typeof showAddSignalButton === "boolean"
      ? showAddSignalButton
      : !signalId && !tradeId;
  const effectiveShowAddTrade =
    typeof showAddTradeButton === "boolean"
      ? showAddTradeButton
      : Boolean(signalId || (!signalId && !tradeId));
  const resolvedSaveLabel =
    saveLabel || (tradeId ? "Save Trade" : "Save Signal");

  const tradeFieldsDisabled = disabled || Boolean(lockTradeFields);
  const controlsDisabled =
    disabled || Boolean(busy?.save || busy?.signal || busy?.trade);
  const directionOptions = useMemo(() => ["BUY", "SELL"], []);

  const update = (key, val) => {
    if (typeof onChange === "function") onChange(key, val);
  };
  const lockedView = Boolean(viewOnly);
  useEffect(() => {
    if (lockedView) setMode("view");
  }, [lockedView]);
  const isEditMode = !lockedView && mode === "edit";

  const summaryRows = [
    { label: "Note", value: value.note || "-" },
    { label: "BE", value: value.be_trigger || value.be || "-" },
    { label: "Invalidation", value: value.invalidation || "-" },
    {
      label: "Confidence",
      value:
        value.confidence_pct === null || value.confidence_pct === undefined
          ? "-"
          : `${Number(value.confidence_pct).toFixed(1)}%`,
    },
    { label: "Estimated Bars", value: value.estimated_bars ?? "-" },
    {
      label: "Entry Model",
      value: value.entry_model || value.entryModel || "-",
    },
    { label: "Strategy", value: value.strategy || "-" },
  ];

  const NumericInline = ({
    label,
    k,
    step = "0.001",
    min,
    max,
    sliderOverride = null,
    disabled: fieldDisabled = false,
  }) => {
    const sliderMeta = sliderOverride || calcSliderMeta(value[k]);
    const isDisabled = fieldDisabled || controlsDisabled;
    const adjustByStep = (dir) => {
      if (isDisabled) return;
      if (!sliderMeta.enabled) return;
      const base = parseNum(value[k]) ?? sliderMeta.value ?? 0;
      const nextRaw = base + dir * Number(sliderMeta.step || 0);
      const next = Math.max(
        Number(sliderMeta.min),
        Math.min(Number(sliderMeta.max), nextRaw),
      );
      update(k, formatNum3(next));
    };
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "20% minmax(140px, 1fr) 40%",
          alignItems: "center",
          gap: 8,
        }}
      >
        <label
          className="minor-text"
          style={{
            fontWeight: "700",
            fontSize: "9px",
            textTransform: "uppercase",
            color: "var(--muted-bright)",
            opacity: fieldDisabled ? 0.4 : 0.8,
          }}
        >
          {label}
        </label>
        <input
          style={{
            height: "22px",
            fontSize: "11px",
            padding: "0 6px",
            width: "100%",
          }}
          type="number"
          step={step}
          inputMode="decimal"
          min={min}
          max={max}
          value={cleanFieldValue(value[k])}
          onChange={(e) => update(k, e.target.value)}
          disabled={isDisabled}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            className="secondary-button"
            onClick={() => adjustByStep(-1)}
            disabled={
              fieldDisabled
                ? true
                : sliderOverride
                  ? controlsDisabled
                  : !sliderMeta.enabled || controlsDisabled
            }
            style={{ width: 18, height: 18, padding: 0, fontSize: 10, lineHeight: 1 }}
            title="-1 step"
          >
            -
          </button>
          <input
            className="snapshot-number-slider-v4"
            type="range"
            min={sliderMeta.min}
            max={sliderMeta.max}
            step={sliderMeta.step}
            value={sliderOverride ? Number(value[k]) || 2 : sliderMeta.value}
            style={{ accentColor: "var(--muted)", height: "8px", margin: 0, flex: 1 }}
            disabled={
              fieldDisabled
                ? true
                : sliderOverride
                  ? controlsDisabled
                  : !sliderMeta.enabled || controlsDisabled
            }
            onChange={(e) => update(k, formatNum3(Number(e.target.value)))}
          />
          <button
            type="button"
            className="secondary-button"
            onClick={() => adjustByStep(1)}
            disabled={
              fieldDisabled
                ? true
                : sliderOverride
                  ? controlsDisabled
                  : !sliderMeta.enabled || controlsDisabled
            }
            style={{ width: 18, height: 18, padding: 0, fontSize: 10, lineHeight: 1 }}
            title="+1 step"
          >
            +
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`trade-plan-editor-v5 ${className}`}
      style={{
        display: "grid",
        gridTemplateColumns: isEditMode ? "1.2fr 1fr" : "1fr",
        gap: "12px",
        marginTop: "10px",
        paddingTop: "0",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {!isEditMode ? (
        <div
          style={{ position: "relative", minHeight: 40 }}
          onClick={() => {
            if (!lockedView) setMode("edit");
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 8,
              borderLeft: "2px solid var(--accent-soft)",
              fontSize: "12px",
              color: "var(--foreground)",
              lineHeight: 1.5,
              opacity: 0.9,
              cursor: !lockedView ? "pointer" : "default",
              minHeight: "36px",
            }}
          >
            {value.note ? (
              <div
                dangerouslySetInnerHTML={{
                  __html: value.note.replace(/\n/g, "<br/>"),
                }}
              />
            ) : (
              <span className="minor-text">
                No strategic note available. Click to add...
              </span>
            )}
          </div>

          {!lockedView && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 8,
              }}
            >
              <button
                className="secondary-button"
                type="button"
                style={{ height: "22px", fontSize: "10px", padding: "0 8px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setMode("edit");
                }}
              >
                Edit
              </button>
            </div>
          )}

          <TradeFileUpload tradeId={tradeId} disabled={lockedView} />
          {showActionsInView && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 6,
                marginTop: 10,
              }}
            >
              {effectiveShowAddSignal && (
                <button
                  className={`secondary-button ${busy?.signal ? "btn-busy" : ""}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddSignal?.(value);
                  }}
                  disabled={
                    controlsDisabled || typeof onAddSignal !== "function"
                  }
                  style={{
                    height: "24px",
                    fontSize: "11px",
                    padding: "0 10px",
                  }}
                >
                  {busy?.signal ? (
                    <div
                      className="spinner"
                      style={{ width: 12, height: 12 }}
                    />
                  ) : (
                    addSignalLabel
                  )}
                </button>
              )}
              {effectiveShowAddTrade && (
                <button
                  className={`primary-button ${busy?.trade ? "btn-busy" : ""}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddTrade?.(value);
                  }}
                  disabled={
                    controlsDisabled || typeof onAddTrade !== "function"
                  }
                  style={{
                    height: "24px",
                    fontSize: "11px",
                    padding: "0 10px",
                  }}
                >
                  {busy?.trade ? (
                    <div
                      className="spinner"
                      style={{ width: 12, height: 12 }}
                    />
                  ) : (
                    addTradeLabel
                  )}
                </button>
              )}
            </div>
          )}
          {/* Cancel/Close buttons always visible in view mode if provided */}
          {(typeof onCancel === "function" ||
            typeof onClose === "function") && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 6,
                marginTop: 10,
              }}
            >
              {typeof onCancel === "function" && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel();
                  }}
                  disabled={controlsDisabled}
                  style={{
                    height: "24px",
                    fontSize: "11px",
                    padding: "0 10px",
                    color: "#ef5350",
                    borderColor: "#ef5350",
                  }}
                >
                  Cancel
                </button>
              )}
              {typeof onClose === "function" && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  disabled={controlsDisabled}
                  style={{
                    height: "24px",
                    fontSize: "11px",
                    padding: "0 10px",
                    color: "#ff9800",
                    borderColor: "#ff9800",
                  }}
                >
                  Close
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "8px",
            }}
          >
            <div
              className="snapshot-field-mini"
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}
            >
              <label
                className="minor-text"
                style={{
                  fontWeight: "700",
                  fontSize: "9px",
                  textTransform: "uppercase",
                  color: "var(--muted-bright)",
                  opacity: 0.8,
                }}
              >
                Order Type
              </label>
              <div style={{ display: "flex", gap: "4px" }}>
                <select
                  style={{
                    flex: 1,
                    height: "24px",
                    fontSize: "11px",
                    padding: "0 2px",
                    background: "rgba(255,255,255,0.05)",
                  }}
                  value={value.direction || "BUY"}
                  onChange={(e) =>
                    update("direction", String(e.target.value || ""))
                  }
                  disabled={tradeFieldsDisabled || controlsDisabled}
                >
                  {directionOptions.map((x) => (
                    <option key={x} value={x}>
                      {x === "BUY" ? "Buy" : "Sell"}
                    </option>
                  ))}
                </select>
                <select
                  style={{
                    flex: 1,
                    height: "24px",
                    fontSize: "11px",
                    padding: "0 2px",
                    background: "rgba(255,255,255,0.05)",
                  }}
                  value={value.trade_type || "limit"}
                  onChange={(e) =>
                    update("trade_type", String(e.target.value || "limit"))
                  }
                  disabled={tradeFieldsDisabled || controlsDisabled}
                >
                  <option value="limit">limit</option>
                  <option value="market">market</option>
                  <option value="stop">stop</option>
                </select>
              </div>
            </div>

            <NumericInline
              label="Entry"
              k="entry"
              disabled={tradeFieldsDisabled}
            />

            <NumericInline
              label="Take Profit"
              k="tp"
              disabled={tradeFieldsDisabled}
            />

            <NumericInline
              label="Risk / Reward"
              k="rr"
              step="0.1"
              min="0.3"
              max="10"
              sliderOverride={{ min: 0.5, max: 8, step: (8 - 0.5) / 100 }}
              disabled={tradeFieldsDisabled}
            />

            <NumericInline
              label="Stop Loss"
              k="sl"
              disabled={tradeFieldsDisabled}
            />
          </div>

          {/* Right Column: Note & Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <label
                className="minor-text"
                style={{
                  fontWeight: "700",
                  fontSize: "9px",
                  textTransform: "uppercase",
                  color: "var(--muted-bright)",
                  opacity: 0.8,
                }}
              >
                Strategic Note
              </label>
              <SmartContent
                content={value.note || ""}
                mode="editable"
                onChange={(v) => update("note", v)}
              />
              <TradeFileUpload tradeId={tradeId} disabled={controlsDisabled} />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "6px",
                alignItems: "center",
                marginTop: "4px",
              }}
            >
              {showResetButton ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onReset}
                  disabled={controlsDisabled || typeof onReset !== "function"}
                  style={{
                    height: "26px",
                    fontSize: "11px",
                    padding: "0 10px",
                    borderRadius: "4px",
                  }}
                >
                  {resetLabel}
                </button>
              ) : null}
              {effectiveShowSave ? (
                <button
                  className={`secondary-button ${busy?.save ? "btn-busy" : ""}`}
                  type="button"
                  onClick={onSave}
                  disabled={controlsDisabled || typeof onSave !== "function"}
                  style={{
                    height: "26px",
                    fontSize: "11px",
                    padding: "0 10px",
                    borderRadius: "4px",
                  }}
                >
                  {busy?.save ? (
                    <div
                      className="spinner"
                      style={{ width: 12, height: 12 }}
                    />
                  ) : (
                    resolvedSaveLabel
                  )}
                </button>
              ) : null}
              {typeof onCancel === "function" ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onCancel}
                  disabled={controlsDisabled}
                  style={{
                    height: "26px",
                    fontSize: "11px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    color: "#ef5350",
                    borderColor: "#ef5350",
                  }}
                >
                  Cancel
                </button>
              ) : null}
              {typeof onClose === "function" ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onClose}
                  disabled={controlsDisabled}
                  style={{
                    height: "26px",
                    fontSize: "11px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    color: "#ff9800",
                    borderColor: "#ff9800",
                  }}
                >
                  Close
                </button>
              ) : null}
              {effectiveShowAddSignal ? (
                <button
                  className={`secondary-button ${busy?.signal ? "btn-busy" : ""}`}
                  type="button"
                  onClick={() => onAddSignal?.(value)}
                  disabled={
                    controlsDisabled || typeof onAddSignal !== "function"
                  }
                  style={{
                    height: "26px",
                    fontSize: "11px",
                    padding: "0 10px",
                    borderRadius: "4px",
                  }}
                >
                  {busy?.signal ? (
                    <div
                      className="spinner"
                      style={{ width: 12, height: 12 }}
                    />
                  ) : (
                    addSignalLabel
                  )}
                </button>
              ) : null}
              {effectiveShowAddTrade ? (
                <button
                  className={`primary-button ${busy?.trade ? "btn-busy" : ""}`}
                  type="button"
                  onClick={() => onAddTrade?.(value)}
                  disabled={
                    controlsDisabled || typeof onAddTrade !== "function"
                  }
                  style={{
                    height: "26px",
                    fontSize: "11px",
                    padding: "0 10px",
                    borderRadius: "4px",
                  }}
                >
                  {busy?.trade ? (
                    <div
                      className="spinner"
                      style={{ width: 12, height: 12 }}
                    />
                  ) : (
                    addTradeLabel
                  )}
                </button>
              ) : null}
            </div>
            {error ? (
              <span
                className="minor-text msg-error"
                style={{ fontSize: "10px", textAlign: "right" }}
              >
                {error}
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
