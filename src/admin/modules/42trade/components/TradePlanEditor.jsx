import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TradeDraftUpload } from "./TradeDraftUpload";
import {
  normalizeOrderTypeValue,
  formatNum3,
} from "../../../shared/utils/tradeDetailUtils";
import { ORDER_SIDES } from "../pages/ai/AiPromptBuilder";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import GroupButtons from "../../../shared/components/GroupButtons";

const numericInlineRowDesktopStyle = {
  display: "grid",
  gridTemplateColumns: "42px minmax(0, 1fr)",
  alignItems: "center",
  columnGap: 8,
  rowGap: 4,
  width: "100%",
  justifySelf: "stretch",
  minWidth: 0,
};
const numericInlineRowMobileStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  width: "100%",
  minWidth: 0,
};
const numericNoSliderRowStyle = {
  display: "grid",
  gridTemplateColumns: "42px minmax(126px, 1fr)",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};
const row2Style = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 8,
  minWidth: 0,
};
const labelStyle = {
  fontWeight: "700",
  fontSize: "8px",
  textTransform: "uppercase",
  color: "var(--muted-bright)",
};
const numericInputStyle = {
  fontSize: "10px",
  width: "100%",
  minWidth: 0,
};
const compactNumericInputStyle = {
  fontSize: "10px",
  width: "50%",
  minWidth: 0,
};
const stepButtonStyle = {
  width: 28,
  height: 20,
  minWidth: 28,
  minHeight: 20,
  padding: 0,
  fontSize: 10,
  lineHeight: 1,
};
const sliderWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: 0,
  minWidth: 0,
  paddingRight: 0,
  width: "100%",
  justifyContent: "stretch",
};
const sliderStyle = {
  accentColor: "var(--muted)",
  height: "8px",
  margin: 0,
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
};
const numericControlsDesktopStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 64px minmax(72px, 0.9fr)",
  gap: 6,
  alignItems: "center",
  width: "100%",
  justifySelf: "stretch",
  minWidth: 0,
};
const numericControlsMobileStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  alignItems: "center",
  width: "100%",
  minWidth: 0,
};
const stepGroupStyle = {
  alignSelf: "stretch",
  display: "inline-flex",
  flexWrap: "nowrap",
  width: 64,
  minWidth: 64,
};
const compactStepGroupStyle = {
  alignSelf: "stretch",
  display: "inline-flex",
  flexWrap: "nowrap",
  width: 64,
  minWidth: 64,
};
const selectInlineRowStyle = {
  display: "grid",
  gridTemplateColumns: "42px auto minmax(96px, 1fr) auto auto",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};
const sideSelectRowStyle = {
  display: "grid",
  gridTemplateColumns: "42px minmax(0, 1fr) minmax(0, 1fr)",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};
const ENTRY_PLAN_COLOR = "#38bdf8";
const TP_PLAN_COLOR = "#26a69a";
const SL_PLAN_COLOR = "#ef5350";
const labelColorByKey = (k) => {
  const key = String(k || "").toLowerCase();
  if (key === "entry") return ENTRY_PLAN_COLOR;
  if (key === "sl") return SL_PLAN_COLOR;
  if (["tp1", "tp2", "tp3"].includes(key)) return TP_PLAN_COLOR;
  return "var(--muted-bright)";
};
const sliderAccentByKey = (k) => {
  const key = String(k || "").toLowerCase();
  if (key === "entry") return ENTRY_PLAN_COLOR;
  if (key === "sl") return SL_PLAN_COLOR;
  if (["tp1", "tp2", "tp3"].includes(key)) return TP_PLAN_COLOR;
  return "var(--muted)";
};

function parseNum(v) {
  if (v == null) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatCompactPnl(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${n >= 0 ? "+" : "-"}$${abs}`;
}

function formatCompactPnlSigned(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.round(Math.abs(n)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${n >= 0 ? "+" : "-"}${abs}`;
}

function scalePnlByLots(basePnl, currentLots, basisLots) {
  const pnl = Number(basePnl);
  const lots = Number(currentLots);
  const baseLotsNum = Number(basisLots);
  if (!Number.isFinite(pnl)) return null;
  if (
    Number.isFinite(lots) &&
    lots > 0 &&
    Number.isFinite(baseLotsNum) &&
    baseLotsNum > 0
  ) {
    return Number(((pnl * lots) / baseLotsNum).toFixed(2));
  }
  return pnl;
}

function nextNonNegativeLots(currentValue, delta) {
  const next = (parseNum(currentValue) ?? 0) + delta;
  return formatNum3(Math.max(0, next));
}

function cleanFieldValue(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!s || s === "null" || s === "undefined" || s === "nan") return "";
  return String(v);
}

function cleanTargetFieldValue(v) {
  const n = parseNum(v);
  if (Number.isFinite(n) && n <= 0) return "";
  return cleanFieldValue(v);
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

function priceSliderMeta(rawValue, entryValue, slValue, frozenStep) {
  const n = parseNum(rawValue);
  if (!Number.isFinite(n)) {
    return { min: 0, max: 1, step: 0.001, value: 0, enabled: false };
  }
  const step =
    Number.isFinite(frozenStep) && frozenStep > 0
      ? frozenStep
      : (() => {
          const entry = parseNum(entryValue);
          const sl = parseNum(slValue);
          if (Number.isFinite(entry) && Number.isFinite(sl) && entry !== sl) {
            return Math.max(0.00001, Math.abs(entry - sl) / 20);
          }
          return Math.max(0.00001, (Math.max(Math.abs(n), 1) * 0.5) / 100);
        })();
  const range = (() => {
    const entry = parseNum(entryValue);
    const sl = parseNum(slValue);
    if (Number.isFinite(entry) && Number.isFinite(sl) && entry !== sl) {
      return Math.abs(entry - sl);
    }
    const magnitude = Math.max(Math.abs(n), 1);
    return magnitude * 0.25;
  })();
  const min = n - range;
  const max = n + range;
  return { min, max, step, value: n, enabled: true };
}

function calcRrByTarget(entryRaw, slRaw, targetRaw, directionRaw = "") {
  const entry = parseNum(entryRaw);
  const sl = parseNum(slRaw);
  const target = parseNum(targetRaw);
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(sl) ||
    !Number.isFinite(target) ||
    target <= 0
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

function useCompactNumericLayout() {
  const [isCompactLayout, setIsCompactLayout] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const media = window.matchMedia("(max-width: 960px)");
    const sync = () => setIsCompactLayout(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return isCompactLayout;
}

const Row2 = memo(function Row2({ left, right, stacked = false }) {
  return (
    <div
      style={{
        ...(stacked
          ? {
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 0,
            }
          : row2Style),
      }}
    >
      {left}
      {right}
    </div>
  );
});

const AdjusterRow = memo(function AdjusterRow({
  compactLayout = false,
  label,
  labelFor,
  labelColor,
  labelDimmed = false,
  input,
  actionItems,
  onActionClick,
  actionDisabled = false,
  actionReadOnly = false,
  trailing = null,
  trailingBelowOnCompact = false,
}) {
  return (
    <div
      className="trade-plan-numeric-row"
      style={
        compactLayout
          ? numericInlineRowMobileStyle
          : numericInlineRowDesktopStyle
      }
    >
      <label
        htmlFor={labelFor}
        className="minor-text"
        style={{
          ...labelStyle,
          flex: "0 0 42px",
          color: labelColor,
          opacity: labelDimmed ? 0.4 : 0.9,
        }}
      >
        {label}
      </label>
      <div
        className="trade-plan-numeric-controls"
        style={
          compactLayout ? numericControlsMobileStyle : numericControlsDesktopStyle
        }
      >
        {input}
        <GroupButtons
          items={actionItems}
          onClick={onActionClick}
          itemsLayout={compactLayout ? "row" : "column"}
          border_type="multiple"
          size="md"
          readOnly={actionReadOnly}
          disabled={actionDisabled}
          ariaLabel={`${label} quick adjustments`}
          style={compactLayout ? compactStepGroupStyle : stepGroupStyle}
          buttonStyle={stepButtonStyle}
          buttonClassName="trade-plan-step-group-button"
        />
        {trailing ? (
          <div
            style={
              compactLayout && trailingBelowOnCompact
                ? { flexBasis: "10%", width: "10%" }
                : null
            }
          >
            {trailing}
          </div>
        ) : null}
      </div>
    </div>
  );
});

const NumericInput = memo(function NumericInput({
  idPrefix,
  label,
  k,
  valueRaw,
  step = "0.001",
  min,
  max,
  sliderOverride = null,
  disabled = false,
  readOnly = false,
  controlsDisabled = false,
  onUpdate,
  entryValue,
  slValue,
  frozenStep,
}) {
  const isCompactLayout = useCompactNumericLayout();
  const fieldId = `${idPrefix}-${k}`;
  const sliderMeta = useMemo(() => {
    if (sliderOverride) return sliderOverride;
    if (["entry", "tp", "tp1", "tp2", "tp3", "sl"].includes(k)) {
      return priceSliderMeta(valueRaw, entryValue, slValue, frozenStep);
    }
    if (k === "rr" || k === "rr2" || k === "rr3") {
      const n = parseNum(valueRaw);
      if (!Number.isFinite(n))
        return { min: 0, max: 10, step: 0.1, value: 0, enabled: false };
      const span = Math.max(n * 0.5, 1);
      return {
        min: Math.max(0, n - span),
        max: n + span,
        step: 0.1,
        value: n,
        enabled: true,
      };
    }
    return calcSliderMeta(valueRaw);
  }, [k, sliderOverride, valueRaw, entryValue, slValue, frozenStep]);
  const isReadOnly = readOnly;
  const isDisabled = disabled || controlsDisabled;
  const toneColor = labelColorByKey(k);
  const sliderDisabled = disabled
    ? true
    : sliderOverride
      ? controlsDisabled
      : !sliderMeta.enabled || controlsDisabled;
  const adjustByStep = useCallback(
    (dir) => {
      if (isDisabled || isReadOnly || !sliderMeta.enabled) return;
      const base = parseNum(valueRaw) ?? sliderMeta.value ?? 0;
      const nextRaw = base + dir * Number(sliderMeta.step || 0);
      const next = Math.max(
        Number(sliderMeta.min),
        Math.min(Number(sliderMeta.max), nextRaw),
      );
      onUpdate(k, String(next));
    },
    [isDisabled, isReadOnly, k, onUpdate, sliderMeta, valueRaw],
  );
  const actionItems = useMemo(
    () => [
      { value: "dec", label: "-" },
      { value: "inc", label: "+" },
    ],
    [],
  );
  const handleActionClick = useCallback(
    (item) => {
      adjustByStep(item?.value === "inc" ? 1 : -1);
    },
    [adjustByStep],
  );
  return (
    <AdjusterRow
      compactLayout={isCompactLayout}
      label={label}
      labelFor={fieldId}
      labelColor={labelColorByKey(k)}
      labelDimmed={disabled}
      input={
        <input
          id={fieldId}
          name={k}
          className="trade-plan-numeric-input"
          type="text"
          inputMode="decimal"
          value={cleanFieldValue(valueRaw)}
          onChange={(e) => onUpdate(k, e.target.value)}
          readOnly={isReadOnly}
          disabled={isDisabled}
          style={{
            ...(isCompactLayout ? compactNumericInputStyle : numericInputStyle),
            color: toneColor,
            justifySelf: "stretch",
          }}
        />
      }
      actionItems={actionItems}
      onActionClick={handleActionClick}
      actionDisabled={sliderDisabled}
      actionReadOnly={isReadOnly}
      trailingBelowOnCompact={true}
      trailing={
        <div className="trade-plan-slider-wrap" style={sliderWrapStyle}>
          <input
            id={`${fieldId}-range`}
            className="snapshot-number-slider-v4"
            type="range"
            min={sliderMeta.min}
            max={sliderMeta.max}
            step={sliderMeta.step}
            value={sliderOverride ? Number(valueRaw) || 2 : sliderMeta.value}
            style={{ ...sliderStyle, accentColor: sliderAccentByKey(k) }}
            disabled={sliderDisabled || isReadOnly}
            onChange={(e) => onUpdate(k, String(Number(e.target.value)))}
          />
        </div>
      }
    />
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
    <div
      className="trade-plan-numeric-row trade-plan-numeric-row-no-slider"
      style={numericNoSliderRowStyle}
    >
      <label
        htmlFor={fieldId}
        className="minor-text"
        style={{ ...labelStyle, opacity: disabled ? 0.4 : 0.8 }}
      >
        {label}
      </label>
      <div
        className="trade-plan-numeric-controls"
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          gap: 4,
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <button
          type="button"
          className="secondary-button trade-plan-step-button"
          onClick={() =>
            onUpdate(k, String((parseNum(valueRaw) ?? 0) - Number(step || 0.01)))
          }
          disabled={isDisabled}
          style={stepButtonStyle}
          title="-1 step"
        >
          -
        </button>
        <input
          id={fieldId}
          name={k}
          className="trade-plan-numeric-input"
          style={{ ...numericInputStyle, opacity: readOnly ? 0.85 : 1 }}
          type="text"
          inputMode="decimal"
          value={cleanFieldValue(
            valueOverride == null ? valueRaw : valueOverride,
          )}
          onChange={(e) => onUpdate(k, e.target.value)}
          readOnly={readOnly}
          disabled={isDisabled}
        />
        <button
          type="button"
          className="secondary-button trade-plan-step-button"
          onClick={() =>
            onUpdate(k, String((parseNum(valueRaw) ?? 0) + Number(step || 0.01)))
          }
          disabled={isDisabled}
          style={stepButtonStyle}
          title="+1 step"
        >
          +
        </button>
      </div>
    </div>
  );
});

export function TradePlanEditor({
  tradeContextId = null,
  tradeId = null,
  apiScope = "",
  accountId: propAccountId = "",
  onAccountChange = null,
  value = {},
  onChange,
  onSave,
  onSaveDraft,
  onAddTrade,
  onReset,
  onGoTrade,
  onGoAnalyze,
  onCancel,
  onClose,
  onPromote,
  showSaveButton,
  showSaveDraftButton,
  showAddTradeButton,
  showResetButton = true,
  resetLabel = "Reset",
  saveLabel,
  saveDraftLabel = "Save Draft",
  addTradeLabel = "+ Trade",
  promoteLabel = "Promote → Pending",
  busy = {},
  disabled = false,
  viewOnly = false,
  lockTradeFields = false,
  lockMode = "none",
  showActionsInView = false,
  error = "",
  className = "",
  tradeStatus = "",
}) {
  // Freeze initial entry/SL for slider step (computed once, never changes while editing)
  const frozenStepRef = useRef(null);
  const entry = parseNum(value?.entry);
  const sl = parseNum(value?.sl);
  if (
    frozenStepRef.current == null &&
    Number.isFinite(entry) &&
    Number.isFinite(sl) &&
    entry !== sl
  ) {
    frozenStepRef.current = Math.abs(entry - sl) / 20;
  }
  const frozenStep = frozenStepRef.current;
  const [mode, setMode] = useState("view");
  const effectiveShowSave =
    typeof showSaveButton === "boolean"
      ? showSaveButton
      : Boolean(tradeContextId || tradeId);
  const effectiveShowSaveDraft =
    typeof showSaveDraftButton === "boolean"
      ? showSaveDraftButton
      : !tradeContextId && !tradeId;
  const effectiveShowAddTrade =
    typeof showAddTradeButton === "boolean"
      ? showAddTradeButton
      : Boolean(tradeContextId || (!tradeContextId && !tradeId));
  const resolvedSaveLabel = saveLabel || (tradeId ? "Save" : "Save Draft");
  const isTradeSaveAction =
    Boolean(tradeId) ||
    String(resolvedSaveLabel || "")
      .trim()
      .toLowerCase()
      .includes("save");
  const normalizedTradeStatus = String(
    tradeStatus || value?.execution_status || value?.status || "",
  )
    .trim()
    .toUpperCase();
  const plannedTpPnl =
    parseNum(value?.broker_tp_pnl) ??
    parseNum(value?.planned_tp_pnl) ??
    parseNum(value?.tp_pnl);
  const plannedSlPnl =
    parseNum(value?.broker_sl_pnl) ??
    parseNum(value?.planned_sl_pnl) ??
    parseNum(value?.sl_pnl);
  const currentLots = parseNum(value?.volume);
  const basisLots =
    parseNum(value?.broker_lots) ??
    parseNum(value?.volume_basis_lots) ??
    currentLots;
  const previewTpPnl = scalePnlByLots(plannedTpPnl, currentLots, basisLots);
  const previewSlPnl = scalePnlByLots(plannedSlPnl, currentLots, basisLots);
  const showCloseAction =
    typeof onClose === "function" && normalizedTradeStatus === "FILLED";
  const showCancelAction =
    typeof onCancel === "function" && normalizedTradeStatus !== "FILLED";
  const showReasonField = [
    "CLOSED",
    "CANCELLED",
    "CANCEL",
    "REJECTED",
  ].includes(normalizedTradeStatus);
  const reasonKey =
    normalizedTradeStatus === "REJECTED" ? "rejection_reason" : "close_reason";
  const reasonLabel =
    normalizedTradeStatus === "REJECTED"
      ? "Reject Reason"
      : "Close/Cancel Reason";
  const reasonValue = String(value?.[reasonKey] || "");

  const normalizedLockMode =
    lockMode === "core" ||
    lockMode === "entry" ||
    lockMode === "sideType" ||
    lockMode === "all"
      ? lockMode
      : lockTradeFields
        ? "all"
        : "none";
  const sideTypeFieldsDisabled =
    disabled ||
    normalizedLockMode === "core" ||
    normalizedLockMode === "sideType" ||
    normalizedLockMode === "all";
  const coreFieldsDisabled =
    disabled || normalizedLockMode === "core" || normalizedLockMode === "all";
  const entryFieldDisabled =
    disabled ||
    normalizedLockMode === "core" ||
    normalizedLockMode === "entry" ||
    normalizedLockMode === "all";
  const tradeFieldsDisabled = disabled || normalizedLockMode === "all";
  const controlsDisabled =
    disabled || Boolean(busy?.save || busy?.draft || busy?.trade);
  const directionOptions = useMemo(() => ["", ...ORDER_SIDES], []);
  const isCompactLayout = useCompactNumericLayout();

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
  const tp2HasPrice = (parseNum(value.tp2) ?? 0) > 0;
  const tp3HasPrice = (parseNum(value.tp3) ?? 0) > 0;

  const handleRrChange = useCallback(
    (key, rrVal) => {
      const tpKey = key === "rr" ? "tp1" : key === "rr2" ? "tp2" : "tp3";
      const tp = calcTpFromRr(value.entry, value.sl, rrVal, value.direction);
      if (tp != null && Number.isFinite(tp)) {
        update(key, rrVal);
        update(tpKey, String(tp));
        // Also sync tp to tp1 for backward compatibility
        if (key === "rr") update("tp", String(tp));
      } else {
        update(key, rrVal);
      }
    },
    [update, value.entry, value.sl, value.direction],
  );

  const idPrefix = tradeContextId || tradeId || "tp-editor";

  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d) =>
        setAccounts(
          (d?.items || []).filter(
            (a) => String(a?.status || "").toUpperCase() === "ACTIVE",
          ),
        ),
      )
      .catch(() => {});
  }, []);

  return (
    <div
      className={`trade-plan-editor-v5 ${className}`}
      style={{
        display: "grid",
        gridTemplateColumns: isEditMode
          ? "minmax(320px, 2fr) minmax(260px, 1fr)"
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
                onClick={(e) => {
                  e.stopPropagation();
                  setMode("edit");
                }}
              >
                Edit
              </button>
            </div>
          )}

          <TradeDraftUpload
            tradeId={tradeId}
            apiScope={apiScope}
            disabled={lockedView}
            showList={false}
            showLabel={false}
          />
          {accounts.length > 0 && (
            <InputComboSelect
              value={propAccountId}
              readOnly={lockedView}
              onChange={async (e) => {
                const newId = e.target.value;
                onAccountChange?.(newId);
                if (newId && tradeId) {
                  try {
                    await fetch(
                      `/api/trades/${encodeURIComponent(tradeId)}`,
                      {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ account_id: newId }),
                      },
                    );
                  } catch (_) {}
                }
              }}
              style={{
                width: "100%",
                marginTop: 4,
              }}
            >
              <option value="">Account: None</option>
              {accounts.map((a) => (
                <option key={a.account_id} value={a.account_id || ""}>
                  {a.name || a.account_id}
                </option>
              ))}
            </InputComboSelect>
          )}
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
                    lockedView ||
                    controlsDisabled ||
                    typeof onSaveDraft !== "function"
                  }
                  style={{



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
                    lockedView ||
                    controlsDisabled ||
                    typeof onAddTrade !== "function"
                  }
                  style={{



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
          {/* Cancel/Close/Promote buttons always visible in view mode if provided */}
          {(typeof onCancel === "function" ||
            typeof onClose === "function" ||
            typeof onPromote === "function") && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 6,
                marginTop: 10,
              }}
            >
              {typeof onPromote === "function" && (
                <button
                  className="primary-button"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPromote();
                  }}
                  disabled={lockedView || controlsDisabled}
                  style={{



                    background: "transparent",
                    borderColor: "#06b6d4",
                    color: "#06b6d4",
                  }}
                >
                  {promoteLabel}
                </button>
              )}
              {typeof onCancel === "function" && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel();
                  }}
                  disabled={lockedView || controlsDisabled}
                  style={{



                    color: "#b91c1c",
                    borderColor: "#b91c1c",
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
                  disabled={lockedView || controlsDisabled}
                  style={{



                    color: "#b91c1c",
                    borderColor: "#b91c1c",
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
              stacked={isCompactLayout}
              left={
                <div style={sideSelectRowStyle}>
                  <label
                    htmlFor={`${tradeContextId || tradeId || "tp-editor"}-direction`}
                    className="minor-text"
                    style={{
                      ...labelStyle,
                      opacity: coreFieldsDisabled ? 0.4 : 0.8,
                    }}
                  >
                    Side
                  </label>
                  <InputComboSelect
                    id={`${tradeContextId || tradeId || "tp-editor"}-direction`}
                    name="direction"
                    style={numericInputStyle}
                    value={value.direction || ""}
                    onChange={(e) => {
                      update("direction", String(e.target.value || ""));
                    }}
                    readOnly={lockedView}
                    disabled={sideTypeFieldsDisabled || controlsDisabled}
                  >
                    {directionOptions.map((x) => (
                      <option key={x || "_empty"} value={x}>
                        {x === "" ? "—" : x === "BUY" ? "Buy" : "Sell"}
                      </option>
                    ))}
                  </InputComboSelect>
                  <InputComboSelect
                    id={`${tradeContextId || tradeId || "tp-editor"}-trade_type`}
                    name="trade_type"
                    style={numericInputStyle}
                    value={normalizeOrderTypeValue(value.trade_type, "limit")}
                    onChange={(e) =>
                      update(
                        "trade_type",
                        normalizeOrderTypeValue(e.target.value, "limit"),
                      )
                    }
                    readOnly={lockedView}
                    disabled={sideTypeFieldsDisabled || controlsDisabled}
                  >
                    <option value="limit">limit</option>
                    <option value="market">market</option>
                    <option value="stop">stop</option>
                  </InputComboSelect>
                </div>
              }
              right={
                <AdjusterRow
                  compactLayout={isCompactLayout}
                  label="Lots"
                  labelFor={`${tradeContextId || tradeId || "tp-editor"}-volume`}
                  labelColor="var(--muted-bright)"
                  labelDimmed={tradeFieldsDisabled}
                  input={
                    <input
                      id={`${tradeContextId || tradeId || "tp-editor"}-volume`}
                      name="volume"
                      style={
                        isCompactLayout
                          ? compactNumericInputStyle
                          : numericInputStyle
                      }
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={cleanFieldValue(
                        value.volume ?? value.broker_lots ?? "",
                      )}
                      onChange={(e) => update("volume", e.target.value)}
                      readOnly={lockedView}
                      disabled={tradeFieldsDisabled || controlsDisabled}
                    />
                  }
                  actionItems={[
                    { value: "dec", label: "-" },
                    { value: "inc", label: "+" },
                  ]}
                  onActionClick={(item) =>
                    update(
                      "volume",
                      nextNonNegativeLots(
                        value.volume,
                        item?.value === "inc" ? 0.01 : -0.01,
                      ),
                    )
                  }
                  actionDisabled={tradeFieldsDisabled || controlsDisabled}
                  actionReadOnly={lockedView}
                  trailingBelowOnCompact={true}
                  trailing={
                    <div
                      style={{
                        minHeight: 18,
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 999,
                        opacity: tradeFieldsDisabled ? 0.55 : 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        padding: "0 10px",
                        fontSize: 11,
                        overflow: "hidden",
                        width: "fit-content",
                        minWidth: 78,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span
                        style={{
                          color: "#22c55e",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatCompactPnlSigned(previewTpPnl)}
                      </span>
                      <span
                        style={{
                          color: "#ef4444",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatCompactPnlSigned(previewSlPnl)}
                      </span>
                    </div>
                  }
                />
              }
            />

            <Row2
              stacked={isCompactLayout}
              left={
                <NumericInput
                  idPrefix={idPrefix}
                  label="Entry"
                  k="entry"
                  valueRaw={value.entry}
                  entryValue={value.entry}
                  slValue={value.sl}
                  frozenStep={frozenStep}
                  controlsDisabled={controlsDisabled}
                  onUpdate={update}
                  disabled={entryFieldDisabled}
                  readOnly={lockedView}
                />
              }
              right={
                <NumericInput
                  idPrefix={idPrefix}
                  label="SL"
                  k="sl"
                  valueRaw={value.sl}
                  entryValue={value.entry}
                  slValue={value.sl}
                  frozenStep={frozenStep}
                  controlsDisabled={controlsDisabled}
                  onUpdate={update}
                  disabled={tradeFieldsDisabled}
                  readOnly={lockedView}
                />
              }
            />
            <Row2
              stacked={isCompactLayout}
              left={
                <NumericInput
                  idPrefix={idPrefix}
                  label="TP1"
                  k="tp1"
                  valueRaw={value.tp1 ?? value.tp}
                  entryValue={value.entry}
                  slValue={value.sl}
                  frozenStep={frozenStep}
                  controlsDisabled={controlsDisabled}
                  onUpdate={update}
                  disabled={tradeFieldsDisabled}
                  readOnly={lockedView}
                />
              }
              right={
                <NumericInput
                  idPrefix={idPrefix}
                  label="RR"
                  k="rr"
                  valueRaw={value.rr}
                  controlsDisabled={controlsDisabled}
                  onUpdate={handleRrChange}
                  disabled={tradeFieldsDisabled}
                  readOnly={lockedView}
                />
              }
            />
            <Row2
              stacked={isCompactLayout}
              left={
                <NumericInput
                  idPrefix={idPrefix}
                  label="TP2"
                  k="tp2"
                  valueRaw={cleanTargetFieldValue(value.tp2)}
                  entryValue={value.entry}
                  slValue={value.sl}
                  frozenStep={frozenStep}
                  controlsDisabled={controlsDisabled}
                  onUpdate={update}
                  disabled={tradeFieldsDisabled}
                  readOnly={lockedView}
                />
              }
              right={
                <NumericInput
                  idPrefix={idPrefix}
                  label="RR2"
                  k="rr2"
                  valueRaw={tp2HasPrice ? (value.rr2 != null ? value.rr2 : rr2) : ""}
                  controlsDisabled={controlsDisabled}
                  onUpdate={handleRrChange}
                  disabled={tradeFieldsDisabled}
                  readOnly={lockedView}
                />
              }
            />
            <Row2
              stacked={isCompactLayout}
              left={
                <NumericInput
                  idPrefix={idPrefix}
                  label="TP3"
                  k="tp3"
                  valueRaw={cleanTargetFieldValue(value.tp3)}
                  entryValue={value.entry}
                  slValue={value.sl}
                  frozenStep={frozenStep}
                  controlsDisabled={controlsDisabled}
                  onUpdate={update}
                  disabled={tradeFieldsDisabled}
                  readOnly={lockedView}
                />
              }
              right={
                <NumericInput
                  idPrefix={idPrefix}
                  label="RR3"
                  k="rr3"
                  valueRaw={tp3HasPrice ? (value.rr3 != null ? value.rr3 : rr3) : ""}
                  controlsDisabled={controlsDisabled}
                  onUpdate={handleRrChange}
                  disabled={tradeFieldsDisabled}
                  readOnly={lockedView}
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
              {/* Meta fields moved to note area */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 6,
                  minWidth: 0,
                  marginBottom: 4,
                }}
              >
                <input
                  type="text"
                  placeholder="Strategy"
                  value={value.strategy || ""}
                  onChange={(e) => update("strategy", e.target.value)}
                  readOnly={lockedView}
                  disabled={tradeFieldsDisabled || controlsDisabled}
                />
                <input
                  type="text"
                  placeholder="Entry model"
                  value={value.entry_model || ""}
                  onChange={(e) => update("entry_model", e.target.value)}
                  readOnly={lockedView}
                  disabled={tradeFieldsDisabled || controlsDisabled}
                />
                <input
                  type="text"
                  placeholder="Source ID"
                  value={value.source_id || ""}
                  onChange={(e) => {
                    update("source_id", e.target.value);
                  }}
                  readOnly={lockedView}
                  disabled={tradeFieldsDisabled || controlsDisabled}
                />
              </div>
              <textarea
                className="text-input"
                value={value.note || ""}
                onChange={(e) => update("note", e.target.value)}
                readOnly={lockedView}
                disabled={tradeFieldsDisabled || controlsDisabled}
                placeholder="Click to edit..."
                style={{
                  width: "100%",
                  minHeight: 64,
                  maxHeight: 96,
                  resize: "vertical",
                }}
              />
              {showReasonField ? (
                <input
                  type="text"
                  className="text-input"
                  aria-label={reasonLabel}
                  placeholder={reasonLabel}
                  value={reasonValue}
                  onChange={(e) => update(reasonKey, e.target.value)}
                  disabled={controlsDisabled}
                  style={{
                    width: "100%",
                    marginTop: 6,
                  }}
                />
              ) : null}
            </div>

            <div
              className="trade-plan-actions-row"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "6px",
                alignItems: "center",
                marginTop: "4px",
              }}
            >
              <div
                className="trade-plan-action-buttons"
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "6px",
                  alignItems: "center",
                  marginLeft: "auto",
                }}
              >
              {showResetButton ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={onReset}
                    disabled={controlsDisabled || typeof onReset !== "function"}
                    style={{



                    }}
                  >
                    {resetLabel}
                  </button>
                ) : null}
                {effectiveShowSave ? (
                  <button
                    className={`${isTradeSaveAction ? "primary-button" : "secondary-button"} ${busy?.save ? "btn-busy" : ""}`}
                    type="button"
                    onClick={onSave}
                    disabled={controlsDisabled || typeof onSave !== "function"}
                    style={{



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
                {showCloseAction ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={onClose}
                    disabled={controlsDisabled}
                    style={{


                      color: "#b91c1c",
                      borderColor: "#b91c1c",
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
                {typeof onPromote === "function" ? (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => onPromote()}
                    disabled={controlsDisabled}
                    style={{




                      background: "transparent",
                      borderColor: "#06b6d4",
                      color: "#06b6d4",
                    }}
                  >
                    {promoteLabel}
                  </button>
                ) : null}
                {showCancelAction ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      if (typeof onCancel === "function") onCancel();
                    }}
                    disabled={controlsDisabled}
                    style={{




                      color: "#b91c1c",
                      borderColor: "#b91c1c",
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
            {error ? (
              <span
                className="minor-text msg-error"
                style={{ fontSize: "10px", textAlign: "right", color: "#ef4444" }}
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
