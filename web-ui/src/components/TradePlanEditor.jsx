import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { SmartContent } from "./SmartContent";
import { TradeFileUpload } from "./TradeFileUpload";

const numericInlineRowStyle = {
  display: "grid",
  gridTemplateColumns: "42px minmax(84px, 0.75fr) minmax(132px, 1.25fr)",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};
const numericNoSliderRowStyle = {
  display: "grid",
  gridTemplateColumns: "42px minmax(84px, 1fr)",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};
const row2Style = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(286px, 1fr))",
  gap: 8,
  minWidth: 0,
};
const labelStyle = {
  fontWeight: "700",
  fontSize: "9px",
  textTransform: "uppercase",
  color: "var(--muted-bright)",
};
const numericInputStyle = {
  height: "22px",
  fontSize: "11px",
  padding: "0 6px",
  width: "100%",
  minWidth: 0,
};
const stepButtonStyle = {
  width: 18,
  height: 18,
  padding: 0,
  fontSize: 10,
  lineHeight: 1,
};
const sliderWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
  paddingRight: 2,
};
const sliderStyle = {
  accentColor: "var(--muted)",
  height: "8px",
  margin: 0,
  flex: 1,
  minWidth: 0,
};

function parseNum(v) {
  if (v == null) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatNum3(v) {
  if (!Number.isFinite(v)) return "";
  return String(Number(v.toFixed(8)));
}
function cleanFieldValue(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
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

function priceSliderMeta(rawValue) {
  const n = parseNum(rawValue);
  const clamped = Number.isFinite(n) ? Math.max(0, Math.min(200000, n)) : 0;
  // Dynamic step: ~0.02% of price, smooth for slider
  const step = Number.isFinite(n) && n > 0 ? Math.max(0.00001, n * 0.0002) : 1;
  return { min: 0, max: 200000, step, value: clamped, enabled: true };
}

function calcRrByTarget(entryRaw, slRaw, targetRaw, directionRaw = "") {
  const entry = parseNum(entryRaw);
  const sl = parseNum(slRaw);
  const target = parseNum(targetRaw);
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(sl) ||
    !Number.isFinite(target)
  )
    return "";
  const direction = String(directionRaw || "").toUpperCase();
  if (direction === "BUY" && !(sl < entry && target > entry)) return "";
  if (direction === "SELL" && !(sl > entry && target < entry)) return "";
  const risk = Math.abs(entry - sl);
  if (!(risk > 0)) return "";
  // Guard against near-zero denominator noise from runtime sync drift.
  if (risk < Math.max(0.01, Math.abs(entry) * 0.000001)) return "";
  const reward = Math.abs(target - entry);
  return String(Number((reward / risk).toFixed(2)));
}

function calcTpFromRr(entryRaw, slRaw, rrRaw, directionRaw = "") {
  const entry = parseNum(entryRaw);
  const sl = parseNum(slRaw);
  const rr = parseNum(rrRaw);
  if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(rr))
    return null;
  const direction = String(directionRaw || "").toUpperCase();
  const risk = Math.abs(entry - sl);
  if (!(risk > 0)) return null;
  const sign = direction === "SELL" ? -1 : 1;
  return entry + sign * (risk * rr);
}

const Row2 = memo(function Row2({ left, right }) {
  return (
    <div style={row2Style}>
      {left}
      {right}
    </div>
  );
});

const NumericInline = memo(function NumericInline({
  idPrefix,
  label,
  k,
  valueRaw,
  step = "0.001",
  min,
  max,
  sliderOverride = null,
  disabled = false,
  controlsDisabled = false,
  onUpdate,
}) {
  const fieldId = `${idPrefix}-${k}`;
  const sliderMeta = useMemo(
    () =>
      sliderOverride ||
      (["entry", "tp", "tp1", "tp2", "tp3", "sl"].includes(k)
        ? priceSliderMeta(valueRaw)
        : calcSliderMeta(valueRaw)),
    [k, sliderOverride, valueRaw],
  );
  const isDisabled = disabled || controlsDisabled;
  const sliderDisabled = disabled
    ? true
    : sliderOverride
      ? controlsDisabled
      : !sliderMeta.enabled || controlsDisabled;
  const adjustByStep = useCallback(
    (dir) => {
      if (isDisabled || !sliderMeta.enabled) return;
      const base = parseNum(valueRaw) ?? sliderMeta.value ?? 0;
      const nextRaw = base + dir * Number(sliderMeta.step || 0);
      const next = Math.max(
        Number(sliderMeta.min),
        Math.min(Number(sliderMeta.max), nextRaw),
      );
      onUpdate(k, formatNum3(next));
    },
    [isDisabled, k, onUpdate, sliderMeta, valueRaw],
  );
  return (
    <div style={numericInlineRowStyle}>
      <label
        htmlFor={fieldId}
        className="minor-text"
        style={{ ...labelStyle, opacity: disabled ? 0.4 : 0.8 }}
      >
        {label}
      </label>
      <input
        id={fieldId}
        name={k}
        style={numericInputStyle}
        type="number"
        step={step}
        inputMode="decimal"
        min={min}
        max={max}
        value={cleanFieldValue(valueRaw)}
        onChange={(e) => onUpdate(k, e.target.value)}
        disabled={isDisabled}
      />
      <div style={sliderWrapStyle}>
        <button
          type="button"
          className="secondary-button"
          onClick={() => adjustByStep(-1)}
          disabled={sliderDisabled}
          style={stepButtonStyle}
          title="-1 step"
        >
          -
        </button>
        <input
          id={`${fieldId}-range`}
          className="snapshot-number-slider-v4"
          type="range"
          min={sliderMeta.min}
          max={sliderMeta.max}
          step={sliderMeta.step}
          value={sliderOverride ? Number(valueRaw) || 2 : sliderMeta.value}
          style={sliderStyle}
          disabled={sliderDisabled}
          onChange={(e) => onUpdate(k, formatNum3(Number(e.target.value)))}
        />
        <button
          type="button"
          className="secondary-button"
          onClick={() => adjustByStep(1)}
          disabled={sliderDisabled}
          style={stepButtonStyle}
          title="+1 step"
        >
          +
        </button>
      </div>
    </div>
  );
});

const NumericNoSlider = memo(function NumericNoSlider({
  idPrefix,
  label,
  k,
  valueRaw,
  step = "0.01",
  min,
  max,
  disabled = false,
  controlsDisabled = false,
  readOnly = false,
  valueOverride = null,
  onUpdate,
}) {
  const fieldId = `${idPrefix}-${k}`;
  const isDisabled = disabled || controlsDisabled || readOnly;
  return (
    <div style={numericNoSliderRowStyle}>
      <label
        htmlFor={fieldId}
        className="minor-text"
        style={{ ...labelStyle, opacity: disabled ? 0.4 : 0.8 }}
      >
        {label}
      </label>
      <input
        id={fieldId}
        name={k}
        style={{ ...numericInputStyle, opacity: readOnly ? 0.85 : 1 }}
        type="number"
        step={step}
        inputMode="decimal"
        min={min}
        max={max}
        value={cleanFieldValue(
          valueOverride == null ? valueRaw : valueOverride,
        )}
        onChange={(e) => onUpdate(k, e.target.value)}
        disabled={isDisabled}
      />
    </div>
  );
});

export function TradePlanEditor({
  signalId = null,
  tradeId = null,
  value = {},
  onChange,
  onSave,
  onSaveDraft,
  onAddTrade,
  onReset,
  onCancel,
  onClose,
  showSaveButton,
  showSaveDraftButton,
  showAddTradeButton,
  showResetButton = true,
  resetLabel = "Reset",
  saveLabel,
  saveDraftLabel = "Save Draft",
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
  const effectiveShowSaveDraft =
    typeof showSaveDraftButton === "boolean"
      ? showSaveDraftButton
      : !signalId && !tradeId;
  const effectiveShowAddTrade =
    typeof showAddTradeButton === "boolean"
      ? showAddTradeButton
      : Boolean(signalId || (!signalId && !tradeId));
  const resolvedSaveLabel =
    saveLabel || (tradeId ? "Save Trade" : "Save Draft");

  const tradeFieldsDisabled = disabled || Boolean(lockTradeFields);
  const controlsDisabled =
    disabled || Boolean(busy?.save || busy?.draft || busy?.trade);
  const directionOptions = useMemo(() => ["BUY", "SELL"], []);

  const update = useCallback(
    (key, val) => {
      if (typeof onChange === "function") onChange(key, val);
    },
    [onChange],
  );
  const lockedView = Boolean(viewOnly);
  useEffect(() => {
    if (lockedView) setMode("view");
    else setMode("edit");
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
  const rr2 = useMemo(
    () => calcRrByTarget(value.entry, value.sl, value.tp2, value.direction),
    [value.entry, value.sl, value.tp2, value.direction],
  );
  const rr3 = useMemo(
    () => calcRrByTarget(value.entry, value.sl, value.tp3, value.direction),
    [value.entry, value.sl, value.tp3, value.direction],
  );

  const handleRrChange = useCallback(
    (key, rrVal) => {
      const tpKey = key === "rr" ? "tp" : key === "rr2" ? "tp2" : "tp3";
      const tp = calcTpFromRr(value.entry, value.sl, rrVal, value.direction);
      if (tp != null && Number.isFinite(tp)) {
        update(key, rrVal);
        update(tpKey, formatNum3(tp));
      } else {
        update(key, rrVal);
      }
    },
    [update, value.entry, value.sl, value.direction],
  );

  const idPrefix = signalId || tradeId || "tp-editor";

  return (
    <div
      className={`trade-plan-editor-v5 ${className}`}
      style={{
        display: "grid",
        gridTemplateColumns: isEditMode
          ? "minmax(320px, 1.2fr) minmax(260px, 1fr)"
          : "1fr",
        gap: "12px",
        marginTop: "10px",
        paddingTop: "0",
        minWidth: 0,
        overflow: "visible",
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

          <TradeFileUpload
            tradeId={tradeId}
            disabled={lockedView}
            showList={false}
            showLabel={false}
          />
          {showActionsInView && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 6,
                marginTop: 10,
              }}
            >
              {effectiveShowSaveDraft && (
                <button
                  className={`secondary-button ${busy?.draft ? "btn-busy" : ""}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSaveDraft?.(value);
                  }}
                  disabled={
                    controlsDisabled || typeof onSaveDraft !== "function"
                  }
                  style={{
                    height: "24px",
                    fontSize: "11px",
                    padding: "0 10px",
                  }}
                >
                  {busy?.draft ? (
                    <div
                      className="spinner"
                      style={{ width: 12, height: 12 }}
                    />
                  ) : (
                    saveDraftLabel
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
              minWidth: 0,
              overflow: "visible",
            }}
          >
            <Row2
              left={
                <select
                  id={`${signalId || tradeId || "tp-editor"}-direction`}
                  name="direction"
                  style={{
                    height: "24px",
                    fontSize: "11px",
                    padding: "0 2px",
                    background: "rgba(255,255,255,0.05)",
                  }}
                  value={value.direction || "BUY"}
                  onChange={(e) => {
                    const nextDir = String(e.target.value || "");
                    const oldDir = String(
                      value.direction || "BUY",
                    ).toUpperCase();
                    if (nextDir.toUpperCase() !== oldDir) {
                      const oldTp = cleanFieldValue(value.tp);
                      const oldSl = cleanFieldValue(value.sl);
                      update("tp", oldSl);
                      update("sl", oldTp);
                    }
                    update("direction", nextDir);
                  }}
                  disabled={tradeFieldsDisabled || controlsDisabled}
                >
                  {directionOptions.map((x) => (
                    <option key={x} value={x}>
                      {x === "BUY" ? "Buy" : "Sell"}
                    </option>
                  ))}
                </select>
              }
              right={
                <select
                  id={`${signalId || tradeId || "tp-editor"}-trade_type`}
                  name="trade_type"
                  style={{
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
              }
            />

            <Row2
              left={
                <NumericInline
                  idPrefix={idPrefix}
                  label="Entry"
                  k="entry"
                  valueRaw={value.entry}
                  controlsDisabled={controlsDisabled}
                  onUpdate={update}
                  disabled={tradeFieldsDisabled}
                />
              }
              right={
                <NumericInline
                  idPrefix={idPrefix}
                  label="SL"
                  k="sl"
                  valueRaw={value.sl}
                  controlsDisabled={controlsDisabled}
                  onUpdate={update}
                  disabled={tradeFieldsDisabled}
                />
              }
            />
            <Row2
              left={
                <NumericInline
                  idPrefix={idPrefix}
                  label="TP"
                  k="tp"
                  valueRaw={value.tp}
                  controlsDisabled={controlsDisabled}
                  onUpdate={update}
                  disabled={tradeFieldsDisabled}
                />
              }
              right={
                <NumericInline
                  idPrefix={idPrefix}
                  label="RR"
                  k="rr"
                  valueRaw={value.rr}
                  controlsDisabled={controlsDisabled}
                  onUpdate={handleRrChange}
                  disabled={tradeFieldsDisabled}
                />
              }
            />
            <Row2
              left={
                <NumericInline
                  idPrefix={idPrefix}
                  label="TP2"
                  k="tp2"
                  valueRaw={value.tp2}
                  controlsDisabled={controlsDisabled}
                  onUpdate={update}
                  disabled={tradeFieldsDisabled}
                />
              }
              right={
                <NumericInline
                  idPrefix={idPrefix}
                  label="RR2"
                  k="rr2"
                  valueRaw={value.rr2 != null ? value.rr2 : rr2}
                  controlsDisabled={controlsDisabled}
                  onUpdate={handleRrChange}
                  disabled={tradeFieldsDisabled}
                />
              }
            />
            <Row2
              left={
                <NumericInline
                  idPrefix={idPrefix}
                  label="TP3"
                  k="tp3"
                  valueRaw={value.tp3}
                  controlsDisabled={controlsDisabled}
                  onUpdate={update}
                  disabled={tradeFieldsDisabled}
                />
              }
              right={
                <NumericInline
                  idPrefix={idPrefix}
                  label="RR3"
                  k="rr3"
                  valueRaw={value.rr3 != null ? value.rr3 : rr3}
                  controlsDisabled={controlsDisabled}
                  onUpdate={handleRrChange}
                  disabled={tradeFieldsDisabled}
                />
              }
            />
          </div>

          {/* Right Column: Note & Actions */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              minWidth: 0,
            }}
          >
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <SmartContent
                content={value.note || ""}
                mode="editable"
                onChange={(v) => update("note", v)}
              />
              <TradeFileUpload
                tradeId={tradeId}
                disabled={controlsDisabled}
                showList={false}
                showLabel={false}
              />
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
              {effectiveShowSaveDraft ? (
                <button
                  className={`secondary-button ${busy?.draft ? "btn-busy" : ""}`}
                  type="button"
                  onClick={() => onSaveDraft?.(value)}
                  disabled={
                    controlsDisabled || typeof onSaveDraft !== "function"
                  }
                  style={{
                    height: "26px",
                    fontSize: "11px",
                    padding: "0 10px",
                    borderRadius: "4px",
                  }}
                >
                  {busy?.draft ? (
                    <div
                      className="spinner"
                      style={{ width: 12, height: 12 }}
                    />
                  ) : (
                    saveDraftLabel
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
