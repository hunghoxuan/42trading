import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { api } from "../../api";
import { useSymbolChartData } from "../../hooks/useChartTileData";
import TradeSignalChart from "../TradeSignalChart";
import TradingViewLoginModal from "../modals/TradingViewLoginModal";
import ImageViewer from "../ImageViewer";
import { resolveAdjusterValue, toNumLoose } from "./numberUtils";
import { chartFetchManager } from "../../services/chartFetchManager";
import {
  createLineObject,
  createPointObject,
  clamp01,
} from "./chartObjectModel";
import {
  getEffectiveDisplayTimezone,
  showDateTime,
  sortTimeframes,
  asNumValue,
  formatNumValue,
} from "../../utils/format";

const MODES = [];
const MODE_LABELS = {};
const STATUS_COLORS = {
  IDLE: "var(--muted)",
  LOADING: "#f59e0b",
  READY: "#10b981",
  STALE: "#f59e0b",
  ERROR: "#ef4444",
};

function toHexColor(v) {
  if (!v) return "#60a5fa";
  const s = String(v).trim();
  if (s.startsWith("#")) {
    if (s.length === 4 || s.length === 7) return s;
    if (s.length === 9) return s.slice(0, 7);
    return "#60a5fa";
  }
  if (s.startsWith("rgb")) {
    const parts = s.match(/\d+/g);
    if (parts && parts.length >= 3) {
      const r = parseInt(parts[0]).toString(16).padStart(2, "0");
      const g = parseInt(parts[1]).toString(16).padStart(2, "0");
      const b = parseInt(parts[2]).toString(16).padStart(2, "0");
      return `#${r}${g}${b}`;
    }
  }
  return "#60a5fa";
}

function normSym(s) {
  return String(s || "")
    .toUpperCase()
    .replace("/", "")
    .replace(".", "");
}

function liveTfToTvInterval(tf) {
  const t = String(tf || "").toUpperCase();
  if (t === "1M") return "1";
  if (t === "5M") return "5";
  if (t === "15M") return "15";
  if (t === "1H") return "60";
  if (t === "4H") return "240";
  if (t === "D") return "D";
  if (t === "W") return "W";
  return "15";
}

function toTradingViewTimezone() {
  const mode = localStorage.getItem("ui_display_timezone") || "UTC";
  if (mode === "UTC") return "Etc/UTC";
  if (mode === "Local")
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  return mode;
}

function timeAgo(ts) {
  if (!ts) return "";
  const sec = Math.floor((Date.now() - Number(ts)) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

function toEpochMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 1e12) return n;
  if (n > 1e9) return Math.round(n * 1000);
  return null;
}

function barsRange(bars) {
  const arr = Array.isArray(bars) ? bars : [];
  if (!arr.length) return null;
  let minP = Infinity;
  let maxP = -Infinity;
  const times = [];
  for (const b of arr) {
    const t = toEpochMs(b?.time);
    if (t != null) times.push(t);
    const lo = Number(b?.low);
    const hi = Number(b?.high);
    if (Number.isFinite(lo)) minP = Math.min(minP, lo);
    if (Number.isFinite(hi)) maxP = Math.max(maxP, hi);
  }
  if (!times.length || !Number.isFinite(minP) || !Number.isFinite(maxP))
    return null;
  times.sort((a, b) => a - b);
  return {
    t0: times[0],
    t1: times[times.length - 1],
    pMin: minP,
    pMax: maxP,
  };
}

function ratioFromAnchorTime(anchorTimeMs, range) {
  if (!range || !Number.isFinite(anchorTimeMs)) return null;
  const span = Math.max(1, range.t1 - range.t0);
  return clamp01((anchorTimeMs - range.t0) / span);
}

function ratioFromAnchorPrice(anchorPrice, range) {
  if (!range || !Number.isFinite(anchorPrice)) return null;
  const span = Math.max(1e-9, range.pMax - range.pMin);
  return clamp01((range.pMax - anchorPrice) / span);
}
function ratioFromAnchorPriceUnclamped(anchorPrice, range) {
  if (!range || !Number.isFinite(anchorPrice)) return null;
  const span = Math.max(1e-9, range.pMax - range.pMin);
  return (range.pMax - anchorPrice) / span;
}

function anchorTimeFromRatio(r, range) {
  if (!range) return null;
  const rr = clamp01(r);
  return Math.round(range.t0 + rr * Math.max(1, range.t1 - range.t0));
}

function anchorPriceFromRatio(r, range) {
  if (!range) return null;
  const rr = clamp01(r);
  return range.pMax - rr * Math.max(1e-9, range.pMax - range.pMin);
}
function tfRankForLatest(tf) {
  const t = String(tf || "").toLowerCase();
  if (t === "1m") return 1;
  if (t === "5m") return 5;
  if (t === "15m") return 15;
  if (t === "1h") return 60;
  if (t === "4h") return 240;
  if (t === "d") return 1440;
  if (t === "w") return 10080;
  return Number.MAX_SAFE_INTEGER;
}
function defaultTpSlFromEntry(entry, direction) {
  const e = Number(entry);
  const isSell = String(direction || "BUY").toUpperCase() === "SELL";
  if (!Number.isFinite(e)) return { tp: null, sl: null };
  return {
    tp: isSell ? e * 0.98 : e * 1.02,
    sl: isSell ? e * 1.02 : e * 0.98,
  };
}

function formatObjectLabel(type, rawLabel) {
  const typeText = String(type || "").trim();
  const labelText = String(rawLabel || "").trim();
  if (!typeText && !labelText) return "";
  if (!typeText) return labelText;
  if (!labelText) return typeText;
  const lowerType = typeText.toLowerCase();
  const lowerLabel = labelText.toLowerCase();
  if (lowerLabel === lowerType) return typeText;
  if (lowerLabel.startsWith(`${lowerType} `)) return labelText;
  return `${typeText} ${labelText}`;
}

function NumberAdjuster({
  value,
  onChange,
  min = -1000000000,
  max = 1000000000,
  step = 1,
  fallbackValue = null,
  placeholder = "",
  disabled = false,
  id = undefined,
  name = undefined,
}) {
  const safeVal = resolveAdjusterValue(value, fallbackValue);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        id={id}
        name={name || id}
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ width: 120 }}
      />
      <button
        type="button"
        className="secondary-button"
        style={{
          fontSize: 10,
          width: 22,
          height: 22,
          padding: 0,
          minWidth: 22,
        }}
        onClick={() => onChange(String(Math.max(min, safeVal - step)))}
        disabled={disabled}
      >
        -
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, safeVal))}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{ flex: 1, minWidth: 84 }}
      />
      <button
        type="button"
        className="secondary-button"
        style={{
          fontSize: 10,
          width: 22,
          height: 22,
          padding: 0,
          minWidth: 22,
        }}
        onClick={() => onChange(String(Math.min(max, safeVal + step)))}
        disabled={disabled}
      >
        +
      </button>
    </div>
  );
}

function TfHeader({
  tf,
  context,
  master,
  mode,
  analysisSnapshot,
  barsStatus,
  snapshotStatus,
  onRefreshTf,
  forceRefresh,
}) {
  const snapInfo = master?.snapshots?.[tf.toLowerCase()] || null;
  const showSnapshotBadge = mode === "snapshots" && !!snapInfo?.file_name;

  const htfBias = useMemo(() => {
    const rawBias = context?.bias || analysisSnapshot?.htf_context?.bias;
    if (!rawBias) return null;
    const b = String(rawBias).toUpperCase();
    if (b === "LONG" || b === "BULLISH")
      return { label: "BULL", color: "#10b981" };
    if (b === "SHORT" || b === "BEARISH")
      return { label: "BEAR", color: "#ef4444" };
    return { label: "NEUT", color: "var(--muted)" };
  }, [context, analysisSnapshot]);

  const barStat = barsStatus?.[tf] || barsStatus?.[tf.toLowerCase()];
  const snapStat = snapshotStatus?.[tf] || snapshotStatus?.[tf.toLowerCase()];
  const cacheTimeText = context?.cached_at ? timeAgo(context.cached_at) : "";
  const cacheSourceLabel =
    context?.cache_source === "memory" || context?.cache_source === "redis"
      ? "Redis"
      : context?.cache_source === "db"
        ? "DB"
        : context?.cache_source === "binance"
          ? "Binance"
          : context?.cache_source || "API";

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}
    >
      <span style={{ fontWeight: 800, fontSize: 11, opacity: 0.8 }}>{tf}</span>
      {(() => {
        const bars = master?.bars?.[tf.toLowerCase()] || [];
        const count = bars.length;
        const firstBar = bars[0];
        const lastBar = bars[count - 1];
        const startTime =
          firstBar && Number.isFinite(Number(firstBar?.time))
            ? new Date(Number(firstBar.time) * 1000).toLocaleDateString(
                "en-GB",
                {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                },
              )
            : null;
        if (!count) return null;
        return (
          <span
            className="minor-text"
            style={{ fontSize: 8, opacity: 0.5 }}
            title={`${count} bars | start ${showDateTime(firstBar?.time ? new Date(Number(firstBar.time) * 1000).toISOString() : null)} | end ${showDateTime(lastBar?.time ? new Date(Number(lastBar.time) * 1000).toISOString() : null)} | updated ${showDateTime(context?.cached_at)}`}
          >
            {count}b {cacheTimeText ? `updated ${cacheTimeText}` : ""}
          </span>
        );
      })()}
      {typeof onRefreshTf === "function" && (
        <button
          type="button"
          onClick={() => onRefreshTf(tf)}
          className="secondary-button"
          style={{
            fontSize: 9,
            padding: "0 4px",
            lineHeight: 1.2,
            minHeight: 16,
            borderRadius: 3,
            color: forceRefresh ? "#60a5fa" : "var(--muted)",
            borderColor: forceRefresh ? "#60a5fa66" : "var(--border)",
          }}
          title={`Refresh ${tf} (force=true)`}
        >
          ⟳
        </button>
      )}
      {htfBias && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: htfBias.color,
            background: htfBias.color + "15",
            padding: "0 4px",
            borderRadius: 3,
            border: `1px solid ${htfBias.color}30`,
          }}
        >
          {htfBias.label}
        </span>
      )}
      {mode === "cache" && context?.cache_source && (
        <span
          style={{
            marginLeft: "auto",
            fontSize: 9,
            color:
              context.cache_source === "binance" ? "#10b981" : "var(--muted)",
            background: "rgba(0,0,0,0.2)",
            border: `1px solid ${
              context.cache_source === "binance"
                ? "#10b98140"
                : "rgba(148,163,184,0.25)"
            }`,
            padding: "0 4px",
            borderRadius: 3,
            maxWidth: 130,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            cursor: typeof onRefreshTf === "function" ? "pointer" : "default",
          }}
          title={`cached: ${showDateTime(context?.cached_at)} | source: ${cacheSourceLabel}`}
          onClick={() => onRefreshTf?.(tf)}
        >
          {cacheSourceLabel}
          {cacheTimeText ? ` ${cacheTimeText}` : ""}
        </span>
      )}
      {mode !== "cache" && barStat && barStat.status !== "none" && (
        <span
          style={{
            fontSize: 8,
            fontWeight: 600,
            color: barStat.status === "cached" ? "#10b981" : "#f59e0b",
            background: "rgba(0,0,0,0.2)",
            padding: "0 3px",
            borderRadius: 2,
            marginLeft: mode === "cache" ? 0 : undefined,
          }}
          title={
            barStat.status === "cached"
              ? `Cached ${barStat.time || ""}`
              : "Loading..."
          }
        >
          {barStat.status === "cached" ? `✅ ${barStat.time || ""}` : "⏳"}
        </span>
      )}
      {snapStat && snapStat.status !== "none" && (
        <span
          style={{
            fontSize: 8,
            fontWeight: 600,
            color: snapStat.status === "snapshot" ? "#10b981" : "#f59e0b",
            background: "rgba(0,0,0,0.2)",
            padding: "0 3px",
            borderRadius: 2,
          }}
          title={
            snapStat.status === "snapshot"
              ? `Snapshot ${snapStat.time || ""}`
              : "Loading..."
          }
        >
          {snapStat.status === "snapshot" ? `${snapStat.time || ""}` : "⏳"}
        </span>
      )}
      {showSnapshotBadge && (
        <span
          style={{
            marginLeft: "auto",
            color: snapInfo.is_new ? "#10b981" : "var(--muted)",
            fontSize: 9,
            background: "rgba(0,0,0,0.2)",
            border: `1px solid ${snapInfo.is_new ? "#10b98140" : "rgba(148,163,184,0.25)"}`,
            padding: "0 4px",
            borderRadius: 3,
            maxWidth: 130,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={`mtime: ${showDateTime(snapInfo.mtime_ms)} | revalidate: ${showDateTime(snapInfo.expires_at_ms)} | ${snapInfo.is_new ? "new" : "cached"}`}
        >
          {snapInfo.file_name || "snapshot"}
        </span>
      )}
    </div>
  );
}

export default function SymbolChart({
  symbol,
  timeframes = ["D", "4h", "15m", "5m"],
  defaultMode = "live",
  initialGridCols = null,
  initialBarsCount = 300,
  onAnalyze,
  onRemove,
  isInWatchlist = false,
  isInSelected = false,
  onToggleWatchlist = null,
  onRemoveSelected = null,
  entryPrice = null,
  tpPrice = null,
  slPrice = null,
  tp1Price = null,
  tp2Price = null,
  tp3Price = null,
  createdAt = null,
  openedAt = null,
  closedAt = null,
  onPlanLevelChange = null,
  analysisSnapshot = null,
  hasTradePlan = false,
  hasAnalysis = false,
  barsStatus = null,
  snapshotStatus = null,
  skipFetch = false,
  provider = "ICMARKETS",
  sessionPrefix = "",
  profile = "day",
  attachedSnapshotFiles = [],
  tradeSid = "",
  onQuickTradeIntent = null,
  onTrade = null,
  showAnalyzeButton = true,
  showTradeButton = true,
  showEditButton = true,
  analyzeLabel = "Analyze",
  showPerCardLayoutControls = true,
  selectedTradePlanGroup = null,
  onTradePlanGroupChange = null,
}) {
  const rootRef = useRef(null);
  const [mode, setMode] = useState(defaultMode);
  const [pendingMode, setPendingMode] = useState(null); // mode we're loading
  const [lastError, setLastError] = useState(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const cleanSym = useMemo(() => normSym(symbol), [symbol]);
  const defaultGridCols = useMemo(() => {
    const maxCols = Math.max(1, timeframes?.length || 4);
    if (
      Number.isFinite(Number(initialGridCols)) &&
      Number(initialGridCols) > 0
    ) {
      return Math.min(maxCols, Math.max(1, Number(initialGridCols)));
    }
    return maxCols;
  }, [initialGridCols, timeframes?.length]);
  const [gridCols, setGridCols] = useState(defaultGridCols);
  const [overlays, setOverlays] = useState({
    plan1: true,
    plan2: false,
    pdArrays: false,
    keyLevels: false,
  });
  const [syncedCrosshair, setSyncedCrosshair] = useState(null);
  const [localBarsCount, setLocalBarsCount] = useState(
    Number.isFinite(Number(initialBarsCount)) && Number(initialBarsCount) > 0
      ? Number(initialBarsCount)
      : 300,
  );
  const [annotations, setAnnotations] = useState([]);
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [editObjects, setEditObjects] = useState(false);


  // Load chart objects from trade metadata on mount
    useEffect(() => {
    if (!tradeSid) return;
    let cancelled = false;
    api.loadChartObjects(tradeSid).then((res) => {
      if (cancelled) return;
      const objs = Array.isArray(res?.chart_objects) ? res.chart_objects : Array.isArray(res?.objects) ? res.objects : [];
      if (objs.length) {
        setAnnotations(objs);
      } else {
        // Auto-generate tradeplan from trade fields when no saved chart_objects
        const ep = Number(entryPrice);
        if (Number.isFinite(ep) && ep > 0) {
          const tp = Number(tpPrice);
          const sl = Number(slPrice);
          const dir = Number.isFinite(tp) && tp > ep ? "BUY" : Number.isFinite(sl) && sl < ep ? "SELL" : "BUY";
          setAnnotations([{
            id: "tradeplan_P1",
            kind: "tradeplan",
            type: "TRADEPLAN",
            label: "TradePlan P1 (auto)",
            plan_id: "P1",
            direction: dir,
            entryPrice: ep,
            tpPrice: Number.isFinite(tp) && tp > 0 ? tp : null,
            slPrice: Number.isFinite(sl) && sl > 0 ? sl : null,
            visible: true,
            color: dir === "SELL" ? "#ef4444" : "#10b981",
            line_width: 0.1,
            line_style: "solid",
            bg_color: "transparent",
            tf: null,
            time: null,
          }]);
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [tradeSid, entryPrice, tpPrice, slPrice]);

  const handleSaveObjects = useCallback(() => {
    if (!tradeSid || !annotations.length) return;
    api.saveChartObjects(tradeSid, annotations).catch(() => {});
  }, [tradeSid, annotations]);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [viewports, setViewports] = useState({});
  const [ctxMenu, setCtxMenu] = useState(null);
  const [activeChartId, setActiveChartId] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [activePlanGroup, setActivePlanGroup] = useState("P1");
  const [drawMode, setDrawMode] = useState(null);
  const dragRef = useRef(null);
  const parentDrivenSelectionRef = useRef(null);
  const lastIncomingPlanGroupRef = useRef(null);

  const [tvSettings, setTvSettings] = useState({
    sidebar: false,
    toolbar: false,
    legend: false,
  });
  const [showTvLogin, setShowTvLogin] = useState(false);
  const [showTvControls, setShowTvControls] = useState(true);
  const [fullscreenTf, setFullscreenTf] = useState(null);
  const [snapshotModalFiles, setSnapshotModalFiles] = useState(null);
  const [capturingSnapshots, setCapturingSnapshots] = useState(false);

  useEffect(() => {
    setAnnotations([]);
    setSelectedObjectId(null);
    setActivePlanGroup("P1");
    parentDrivenSelectionRef.current = null;
    lastIncomingPlanGroupRef.current = null;
  }, [cleanSym]);

  const toggleOverlay = (key) => setOverlays((p) => ({ ...p, [key]: !p[key] }));

  useEffect(() => {
    if (
      Number.isFinite(Number(initialGridCols)) &&
      Number(initialGridCols) > 0
    ) {
      setGridCols(Number(initialGridCols));
    } else {
      setGridCols(Math.max(1, timeframes?.length || 1));
    }
  }, [initialGridCols, timeframes?.length]);

  useEffect(() => {
    if (
      Number.isFinite(Number(initialBarsCount)) &&
      Number(initialBarsCount) > 0
    ) {
      setLocalBarsCount(Number(initialBarsCount));
    }
  }, [initialBarsCount]);

  // Re-fetch when bars count changes (skip initial)
  const barsInitRef = useRef(true);
  useEffect(() => {
    if (barsInitRef.current) {
      barsInitRef.current = false;
      return;
    }
    if (mode !== "live") refresh({ force: true });
  }, [localBarsCount]);

  useEffect(() => {
    if (!rootRef.current) return;
    const updateWidth = () => {
      if (!rootRef.current) return;
      setContainerWidth(rootRef.current.clientWidth || 0);
    };
    updateWidth();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(rootRef.current);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const {
    status,
    master,
    error,
    cachedAt,
    refresh,
    refreshTf,
    liveKey,
    snapshotState,
  } = useSymbolChartData({
    symbol: cleanSym,
    timeframes,
    mode: pendingMode || mode,
    barsCount: localBarsCount,
    forceRefresh,
    skipFetch,
    provider,
    sessionPrefix,
    attachedSnapshotFiles,
    profile,
    tradeSid,
  });

  const sortedTfs = useMemo(
    () => sortTimeframes(timeframes, "desc"),
    [timeframes],
  );

  const barsCachedAt = useMemo(() => {
    const hasBars = Object.values(master?.bars || {}).some(
      (b) => Array.isArray(b) && b.length > 0,
    );
    return hasBars ? master?.cached_at || cachedAt : null;
  }, [master, cachedAt]);

  const snapsCachedAt = useMemo(() => {
    const hasSnaps = Object.values(master?.snapshots || {}).some(
      (s) => s?.uploaded_at,
    );
    if (!hasSnaps) return null;
    let latest = 0;
    for (const s of Object.values(master?.snapshots || {})) {
      if (s?.uploaded_at && s.uploaded_at > latest) latest = s.uploaded_at;
    }
    return latest || null;
  }, [master]);

  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "LOADING" && status !== "LOADING") {
      if (status === "READY" || status === "STALE") {
        if (pendingMode) {
          setMode(pendingMode);
          setPendingMode(null);
        }
        setLastError(null);
      } else if (status === "ERROR") {
        setLastError(error || "Fetch failed");
        if (pendingMode) {
          setMode(pendingMode);
          setPendingMode(null);
        }
      }
    }
    prevStatus.current = status;
  }, [status, error, pendingMode]);

  useEffect(() => {
    if (mode !== "cache") setEditObjects(false);
  }, [mode]);

  const [loadedTfs, setLoadedTfs] = useState({}); // { tf: count }
  const handleBarsLoaded = useCallback((tf, count) => {
    setLoadedTfs((prev) => ({ ...prev, [tf.toLowerCase()]: count }));
  }, []);

  const hasAnyBars = useMemo(() => {
    const fromMaster = Object.values(master?.bars || {}).some(
      (b) => Array.isArray(b) && b.length > 0,
    );
    const fromReports = Object.values(loadedTfs).some((c) => c > 0);
    return fromMaster || fromReports;
  }, [master, loadedTfs]);

  const selectedObject = useMemo(
    () => (annotations || []).find((a) => a.id === selectedObjectId) || null,
    [annotations, selectedObjectId],
  );
  const editableAnnotations = useMemo(
    () => (annotations || []).filter((a) => a.kind !== "tradeplan"),
    [annotations],
  );
  useEffect(() => {
    if (!selectedObject || selectedObject.kind !== "tradeplan") return;
    if (parentDrivenSelectionRef.current === selectedObject.id) {
      parentDrivenSelectionRef.current = null;
      return;
    }
    const planId = String(selectedObject.plan_id || "P1").toUpperCase();
    if (activePlanGroup !== planId) setActivePlanGroup(planId);
    if (typeof onTradePlanGroupChange === "function") {
      onTradePlanGroupChange(planId);
    }
  }, [selectedObject, activePlanGroup, onTradePlanGroupChange]);

  useEffect(() => {
    if (!(hasTradePlan && hasAnalysis)) return;
    const incoming = String(selectedTradePlanGroup || "").toUpperCase();
    if (!incoming) return;
    const sameIncoming = lastIncomingPlanGroupRef.current === incoming;
    // Prevent selection ping-pong: only sync when parent group actually changes.
    if (sameIncoming) return;
    lastIncomingPlanGroupRef.current = incoming;
    if (incoming !== activePlanGroup) setActivePlanGroup(incoming);
    const target = (annotations || []).find(
      (a) =>
        a.kind === "tradeplan" &&
        String(a.plan_id || "P1").toUpperCase() === incoming,
    );
    if (target?.id && target.id !== selectedObjectId) {
      parentDrivenSelectionRef.current = target.id;
      setSelectedObjectId(target.id);
    }
  }, [
    selectedTradePlanGroup,
    hasTradePlan,
    hasAnalysis,
    annotations,
    selectedObjectId,
    activePlanGroup,
  ]);
  const updateSelectedObject = useCallback(
    (patch) => {
      if (!selectedObjectId) return;
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedObjectId ? { ...a, ...patch } : a)),
      );
    },
    [selectedObjectId],
  );
  const updateSelectedField = useCallback(
    (field, value) => {
      if (!selectedObjectId) return;
      const current =
        (annotations || []).find((a) => a.id === selectedObjectId) || null;
      const numericKeys = new Set([
        "price",
        "price_top",
        "price_bottom",
        "time",
        "line_width",
        "entryPrice",
        "tpPrice",
        "slPrice",
      ]);
      const next = numericKeys.has(field)
        ? value === "" || value == null
          ? null
          : toNumLoose(value)
        : value;
      if (field === "type") {
        const t = String(value || "").toUpperCase();
        const styleByType = {
          BUY: { line_style: "solid", color: "#10b981", line_width: 2 },
          SELL: { line_style: "solid", color: "#ef4444", line_width: 2 },
          LINE: { line_style: "solid", color: "#60a5fa", line_width: 2 },
          ZONE: {
            line_style: "solid",
            color: "#22c55e",
            line_width: 2,
            bg_color: "#22c55e",
          },
          TP: { line_style: "dot", color: "#10b981", line_width: 2 },
          SL: { line_style: "dot", color: "#ef4444", line_width: 2 },
          "S/R": { line_style: "dash", color: "#eab308", line_width: 2 },
          OB: {
            line_style: "solid",
            color: "#8b5cf6",
            line_width: 2,
            bg_color: "#8b5cf6",
          },
          FVG: {
            line_style: "dash",
            color: "#f59e0b",
            line_width: 2,
            bg_color: "#f59e0b",
          },
        };
        updateSelectedObject({
          type: t,
          label: formatObjectLabel(t, current?.label || ""),
          ...(styleByType[t] || {}),
        });
      } else if (field === "label") {
        const nextType = String(current?.type || "line").toUpperCase();
        updateSelectedObject({ label: formatObjectLabel(nextType, next) });
      } else {
        updateSelectedObject({ [field]: next });
      }
      if (
        current?.kind === "tradeplan" &&
        typeof onQuickTradeIntent === "function"
      ) {
        const planId = String(current.plan_id || "P1").toUpperCase();
        if (field === "entryPrice") {
          if (Number.isFinite(Number(next))) {
            onQuickTradeIntent({
              symbol: cleanSym,
              side: String(current.direction || "BUY").toUpperCase(),
              action: "ENTRY",
              plan_id: planId,
              price: Number(next),
            });
          }
        } else if (field === "tpPrice") {
          onQuickTradeIntent({
            symbol: cleanSym,
            side: "TP",
            action: Number.isFinite(Number(next)) ? "TP" : "CLEAR_TP",
            plan_id: planId,
            price: Number.isFinite(Number(next)) ? Number(next) : null,
          });
        } else if (field === "slPrice") {
          onQuickTradeIntent({
            symbol: cleanSym,
            side: "SL",
            action: Number.isFinite(Number(next)) ? "SL" : "CLEAR_SL",
            plan_id: planId,
            price: Number.isFinite(Number(next)) ? Number(next) : null,
          });
        } else if (field === "direction") {
          updateSelectedObject({
            color:
              String(next || "BUY").toUpperCase() === "SELL"
                ? "#ef4444"
                : "#10b981",
          });
          const entryNow = Number(current.entryPrice);
          if (Number.isFinite(entryNow)) {
            onQuickTradeIntent({
              symbol: cleanSym,
              side: String(next || "BUY").toUpperCase(),
              action: "ENTRY",
              plan_id: planId,
              price: entryNow,
            });
          }
        }
      }
    },
    [
      selectedObjectId,
      annotations,
      updateSelectedObject,
      onQuickTradeIntent,
      cleanSym,
    ],
  );

  useEffect(() => {
    if (!(hasTradePlan && hasAnalysis)) return;
    const rawPlans = Array.isArray(analysisSnapshot?.trade_plan)
      ? analysisSnapshot.trade_plan
      : analysisSnapshot?.trade_plan &&
          typeof analysisSnapshot.trade_plan === "object"
        ? [analysisSnapshot.trade_plan]
        : [];
    if (!rawPlans.length) return;
    const keys = Object.keys(master?.bars || {});
    const sorted = keys.sort((a, b) => tfRankForLatest(a) - tfRankForLatest(b));
    let fallbackEntry = null;
    for (const k of sorted) {
      const bars = master?.bars?.[k] || [];
      if (!bars.length) continue;
      const close = Number(bars[bars.length - 1]?.close);
      if (Number.isFinite(close)) {
        fallbackEntry = close;
        break;
      }
    }
    setAnnotations((prev) => {
      const allowedPlanIds = new Set(
        rawPlans.slice(0, 2).map((_, idx) => (idx === 0 ? "P1" : "P2")),
      );
      let next = [...prev].filter((x) => {
        if (x.kind !== "tradeplan") return true;
        const pid = String(x.plan_id || "").toUpperCase();
        return allowedPlanIds.has(pid);
      });
      rawPlans.slice(0, 2).forEach((p, idx) => {
        const planId = idx === 0 ? "P1" : "P2";
        const id = `tradeplan_${planId}`;
        const existing =
          next.find((x) => x.id === id && x.kind === "tradeplan") || null;
        const direction =
          String(p?.direction || "BUY").toUpperCase() === "SELL"
            ? "SELL"
            : "BUY";
        const entry = toNumLoose(p?.entry ?? p?.entry_price);
        const tp = toNumLoose(p?.tp ?? p?.tp_price);
        const sl = toNumLoose(p?.sl ?? p?.sl_price);
        const effectiveEntry = Number.isFinite(entry)
          ? entry
          : Number.isFinite(existing?.entryPrice)
            ? Number(existing.entryPrice)
            : fallbackEntry;
        const defaults = defaultTpSlFromEntry(effectiveEntry, direction);
        const nextPlan = {
          id,
          kind: "tradeplan",
          type: "TRADEPLAN",
          label: String(p?.label || existing?.label || `TradePlan ${planId}`),
          plan_id: planId,
          direction,
          entryPrice: Number.isFinite(effectiveEntry) ? effectiveEntry : null,
          tpPrice: Number.isFinite(tp)
            ? tp
            : Number.isFinite(defaults.tp)
              ? defaults.tp
              : null,
          slPrice: Number.isFinite(sl)
            ? sl
            : Number.isFinite(defaults.sl)
              ? defaults.sl
              : null,
          visible: existing?.visible !== false,
          color: direction === "SELL" ? "#ef4444" : "#10b981",
          line_width: 0.1,
          line_style: "solid",
          bg_color: "transparent",
          tf: null,
          time: null,
        };
        if (existing) {
          const pos = next.findIndex(
            (x) => x.id === id && x.kind === "tradeplan",
          );
          next[pos] = { ...existing, ...nextPlan };
        } else {
          next.push(nextPlan);
        }
      });
      return next;
    });
  }, [hasTradePlan, hasAnalysis, analysisSnapshot, master]);
  const selectedObjectTfPropsText = useMemo(() => {
    if (!selectedObject) return "";
    const parts = [];
    for (const tf of sortedTfs || []) {
      const tfKey = String(tf || "").toLowerCase();
      const chartId = `${cleanSym}-${tfKey}`;
      const vp = viewports?.[chartId] || null;
      const range =
        vp &&
        Number.isFinite(Number(vp.timeStartMs)) &&
        Number.isFinite(Number(vp.timeEndMs)) &&
        Number.isFinite(Number(vp.priceTop)) &&
        Number.isFinite(Number(vp.priceBottom))
          ? {
              t0: Math.min(Number(vp.timeStartMs), Number(vp.timeEndMs)),
              t1: Math.max(Number(vp.timeStartMs), Number(vp.timeEndMs)),
              pMin: Math.min(Number(vp.priceTop), Number(vp.priceBottom)),
              pMax: Math.max(Number(vp.priceTop), Number(vp.priceBottom)),
            }
          : barsRange(master?.bars?.[tfKey] || []);
      const t1 = toEpochMs(selectedObject.anchorTimeMs);
      const t2 = toEpochMs(selectedObject.anchorTimeMs2);
      const p1 = Number(selectedObject.anchorPrice);
      const p2 = Number(selectedObject.anchorPrice2);
      const rT1 = Number.isFinite(t1)
        ? t1
        : anchorTimeFromRatio(Number(selectedObject.xRatio ?? 0.5), range);
      const rT2 = Number.isFinite(t2)
        ? t2
        : anchorTimeFromRatio(Number(selectedObject.x2Ratio ?? 0.8), range);
      const rP1 = Number.isFinite(p1)
        ? p1
        : anchorPriceFromRatio(
            Number(selectedObject.yRatio ?? selectedObject.y1Ratio ?? 0.5),
            range,
          );
      const rP2 = Number.isFinite(p2)
        ? p2
        : anchorPriceFromRatio(Number(selectedObject.y2Ratio ?? 0.6), range);
      const xVal = Number.isFinite(rT1) ? rT1 : "n/a";
      const yVal = Number.isFinite(rP1) ? Number(rP1).toFixed(2) : "n/a";
      parts.push(
        `time_${tfKey}=${rT1 ?? "n/a"} | price_${tfKey}=${yVal} | x_${tfKey}=${xVal} | y_${tfKey}=${yVal} | time2_${tfKey}=${rT2 ?? "n/a"} | price2_${tfKey}=${Number.isFinite(rP2) ? rP2.toFixed(2) : "n/a"}`,
      );
    }
    return parts.join(" | ");
  }, [selectedObject, sortedTfs, cleanSym, viewports, master]);

  const openSnapshotFileList = useCallback(async () => {
    const attachedItems = (
      Array.isArray(attachedSnapshotFiles) ? attachedSnapshotFiles : []
    )
      .map((file) => String(file || "").trim())
      .filter(Boolean)
      .map((file) => ({
        name: file,
        file_name: file,
        url: tradeSid
          ? `/v2/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(file)}/content`
          : `/v2/chart/snapshots/${encodeURIComponent(file)}`,
      }));
    const listed = tradeSid
      ? await api.tradeSnapshots(tradeSid)
      : await api.chartSnapshots(200);
    const listedItems = Array.isArray(listed?.items) ? listed.items : [];
    const all = [...listedItems, ...attachedItems];
    if (all.length) {
      setSnapshotModalFiles(
        all.map((item) => ({
          name: item.name || item.file_name || "snapshot",
          url:
            item.url ||
            `/v2/chart/snapshots/${encodeURIComponent(item.file_name || "")}`,
          size_bytes: item.size_bytes || 0,
        })),
      );
    }
    return all;
  }, [attachedSnapshotFiles, tradeSid]);

  const handleModeClick = useCallback(
    async (newMode) => {
      if (newMode === "live") {
        setMode("live");
        setPendingMode(null);
        setLastError(null);
        return;
      }
      if (newMode === "snapshots") {
        setMode("snapshots");
        setPendingMode(null);
        setLastError(null);
        setCapturingSnapshots(true);
        try {
          // Capture snapshots first, then list
          await refresh();
          await openSnapshotFileList();
        } catch (err) {
          setLastError(err?.message || "Failed to capture/load snapshots");
        } finally {
          setCapturingSnapshots(false);
        }
        return;
      }
      // Re-click same mode: force refresh
      if (mode === newMode && !pendingMode && status !== "LOADING") {
        refresh({ force: forceRefresh === true });
        return;
      }
      // Switch immediately so user sees mode change right away, then fetch.
      setMode(newMode);
      setPendingMode(null);
      setLastError(null);
    },
    [mode, pendingMode, status, refresh, forceRefresh, openSnapshotFileList],
  );

  const handleCaptureSnapshots = useCallback(async () => {
    if (!cleanSym || capturingSnapshots) return;
    try {
      setCapturingSnapshots(true);
      setLastError(null);
      const out = await api.chartSnapshotCreateBatch({
        symbol: cleanSym,
        timeframes,
        provider,
        session_prefix: sessionPrefix,
        trade_sid: tradeSid || undefined,
        lookbackBars: 300,
        format: "png",
        quality: 80,
      });
      const copied = Array.isArray(out?.copied) ? out.copied : [];
      const capturedItems =
        tradeSid && copied.length
          ? copied.map((name) => ({
              name,
              file_name: name,
              url: `/v2/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(name)}/content`,
            }))
          : Array.isArray(out?.items)
            ? out.items
            : [];
      if (capturedItems.length) {
        setSnapshotModalFiles(
          capturedItems.map((item) => ({
            name: item.name || item.file_name || "snapshot",
            url:
              item.url ||
              `/v2/chart/snapshots/${encodeURIComponent(item.file_name || "")}`,
            size_bytes: item.size_bytes || 0,
          })),
        );
      }
      await refresh({ force: true });
    } catch (err) {
      setLastError(err?.message || "Snapshot capture failed");
    } finally {
      setCapturingSnapshots(false);
    }
  }, [
    cleanSym,
    capturingSnapshots,
    timeframes,
    provider,
    sessionPrefix,
    tradeSid,
    refresh,
  ]);

  const btnColor = (m) => {
    const active = pendingMode || mode;
    if (m !== active) return "var(--muted)";
    if (m === "live") return "var(--muted)";
    if (status === "LOADING") return STATUS_COLORS.LOADING;
    if (lastError || error) return STATUS_COLORS.ERROR;
    if (m === "cache" && barsCachedAt) return STATUS_COLORS.READY;
    if (m === "snapshots" && snapsCachedAt) return STATUS_COLORS.READY;
    return "var(--muted)";
  };

  const btnTitle = (m) => {
    const active = pendingMode || mode;
    if (m !== active) return MODE_LABELS[m];
    if (lastError || error) return lastError || error;
    if (m === "cache" && barsCachedAt)
      return "Bars cached " + timeAgo(barsCachedAt);
    if (m === "snapshots" && snapsCachedAt)
      return "Snapshots cached " + timeAgo(snapsCachedAt);
    if (status === "LOADING") return "Loading...";
    return MODE_LABELS[m] + " (no data)";
  };

  const chartHeight = useMemo(() => {
    const cols = Math.max(1, gridCols);
    const gapPx = 8;
    const usableWidth = Math.max(0, containerWidth - gapPx * (cols - 1));
    const tileWidth = usableWidth > 0 ? usableWidth / cols : 0;
    const targetAspectRatio = cols <= 2 ? 1.7 : 1.45;
    if (!tileWidth) {
      return cols <= 2 ? 280 : 240;
    }
    return Math.round(
      Math.max(210, Math.min(360, tileWidth / targetAspectRatio)),
    );
  }, [containerWidth, gridCols]);

  const showControls = !(hasTradePlan && hasAnalysis);
  const tvTimezone = toTradingViewTimezone();
  const overlayButtons = [
    { key: "plan1", label: "P1" },
    { key: "plan2", label: "P2" },
    { key: "pdArrays", label: "PD" },
    { key: "keyLevels", label: "KL" },
  ];

  useEffect(() => {
    const onDocClick = () => setCtxMenu(null);
    const onMove = (evt) => {
      if (!dragRef.current) return;
      const d = dragRef.current;
      const rect = d.rect;
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      const xr = Math.max(0, Math.min(1, x / Math.max(rect.width, 1)));
      const yr = Math.max(0, Math.min(1, y / Math.max(rect.height, 1)));
      const range = d.range || null;
      const nextAnchorTime = anchorTimeFromRatio(xr, range);
      const nextAnchorPrice = anchorPriceFromRatio(yr, range);
      setAnnotations((prev) =>
        prev.map((a) => {
          if (a.id !== d.id) return a;
          if (a.kind === "line")
            return {
              ...a,
              yRatio: yr,
              anchorPrice: Number.isFinite(nextAnchorPrice)
                ? Number(nextAnchorPrice)
                : a.anchorPrice,
            };
          if (a.kind === "point")
            return {
              ...a,
              xRatio: xr,
              yRatio: yr,
              anchorTimeMs: Number.isFinite(nextAnchorTime)
                ? Number(nextAnchorTime)
                : a.anchorTimeMs,
              anchorPrice: Number.isFinite(nextAnchorPrice)
                ? Number(nextAnchorPrice)
                : a.anchorPrice,
            };
          if (a.kind === "zone") {
            if (d.edge === "top")
              return {
                ...a,
                y1Ratio: yr,
                anchorPrice: Number.isFinite(nextAnchorPrice)
                  ? Number(nextAnchorPrice)
                  : a.anchorPrice,
              };
            if (d.edge === "bottom")
              return {
                ...a,
                y2Ratio: yr,
                anchorPrice2: Number.isFinite(nextAnchorPrice)
                  ? Number(nextAnchorPrice)
                  : a.anchorPrice2,
              };
          }
          return a;
        }),
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    document.addEventListener("click", onDocClick);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleContextRequest = useCallback((payload) => {
    if (payload?.chartId) setActiveChartId(payload.chartId);
    setCtxMenu(payload || null);
  }, []);

  const handleViewportChange = useCallback((payload) => {
    if (!payload?.chartId) return;
    setViewports((prev) => ({ ...prev, [payload.chartId]: payload }));
  }, []);

  const handleRefreshTf = useCallback(
    (tf) => {
      if (!tf) return;
      refreshTf?.(tf, { force: true });
    },
    [refreshTf],
  );

  const handleCrosshairSync = useCallback(
    (payload) => {
      setSyncedCrosshair(payload);
      if (!payload?.active) return;
      if (
        activeChartId &&
        payload?.sourceId &&
        payload.sourceId !== activeChartId
      ) {
        // Sync
      }
    },
    [activeChartId],
  );

  const toggleTvSetting = (key) => {
    setTvSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAllTvSettings = () => {
    setTvSettings((prev) => {
      const allEnabled = !!(prev.sidebar && prev.toolbar && prev.legend);
      const next = !allEnabled;
      return {
        ...prev,
        sidebar: next,
        toolbar: next,
        legend: next,
      };
    });
  };

  const handleTvLogin = async (username, password) => {
    const res = await fetch("/v2/tv/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `TV login failed - server returned non-JSON (${res.status}): ${text.slice(0, 100)}`,
      );
    }
    if (!data.ok) throw new Error(data.error || "Login failed");
    return data;
  };

  const handleDrawLine = useCallback(() => {
    if (!ctxMenu || !Number.isFinite(Number(ctxMenu.yRatio))) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const price = Number(ctxMenu?.price);
    const time = Number(ctxMenu?.time);
    setAnnotations((prev) => [
      ...prev,
      {
        ...createLineObject({
          id,
          type: "LINE",
          color: "#60a5fa",
          yRatio: Number(ctxMenu.yRatio),
          ctxMenu,
        }),
        tf: null,
        price_top: Number.isFinite(price) ? price : null,
        price_bottom: Number.isFinite(price) ? price : null,
        price: Number.isFinite(price) ? price : null,
        time: Number.isFinite(time) ? time : null,
        line_style: "dash",
        line_width: 0.1,
        bg_color: "rgba(96,165,250,0.14)",
        label: "Line",
      },
    ]);
    setSelectedObjectId(id);
    setCtxMenu(null);
  }, [ctxMenu]);

  const addObject = useCallback(
    (type, color, kind = "line") => {
      if (!ctxMenu) return;
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const price = Number(ctxMenu?.price);
      const time = Number(ctxMenu?.time);
      if (kind === "point") {
        setAnnotations((prev) => [
          ...prev,
          createPointObject({
            id,
            type,
            color,
            xRatio: Number(ctxMenu.xRatio || 0.5),
            yRatio: Number(ctxMenu.yRatio || 0.5),
            ctxMenu,
          }),
        ]);
        setSelectedObjectId(id);
      } else if (kind === "zone") {
        setDrawMode("zone");
      } else {
        setAnnotations((prev) => [
          ...prev,
          {
            ...createLineObject({
              id,
              type,
              color,
              yRatio: Number(ctxMenu.yRatio || 0.5),
              ctxMenu,
            }),
            tf: null,
            price_top: Number.isFinite(price) ? price : null,
            price_bottom: Number.isFinite(price) ? price : null,
            price: Number.isFinite(price) ? price : null,
            time: Number.isFinite(time) ? time : null,
            line_style: "solid",
            line_width: 0.1,
            bg_color: "rgba(255,255,255,0.14)",
            label: type,
          },
        ]);
        setSelectedObjectId(id);
      }
      setCtxMenu(null);
    },
    [ctxMenu],
  );

  const latestCachedPrice = useMemo(() => {
    const keys = Object.keys(master?.bars || {});
    const sorted = keys.sort((a, b) => tfRankForLatest(a) - tfRankForLatest(b));
    for (const k of sorted) {
      const bars = master?.bars?.[k] || [];
      if (!bars.length) continue;
      const close = Number(bars[bars.length - 1]?.close);
      if (Number.isFinite(close)) return close;
    }
    return null;
  }, [master]);

  const handleQuickTrade = useCallback(
    (side, explicitPrice = null) => {
      const sourceChartId = String(ctxMenu?.chartId || activeChartId || "");
      const activeTf = sourceChartId.split("-").slice(-1)[0];
      const activeBars = master?.bars?.[activeTf] || [];
      const activeLastClose = Number(activeBars[activeBars.length - 1]?.close);
      const usePrice = Number.isFinite(Number(explicitPrice))
        ? Number(explicitPrice)
        : Number.isFinite(Number(ctxMenu?.price))
          ? Number(ctxMenu?.price)
          : Number.isFinite(Number(hoverInfo?.price))
            ? Number(hoverInfo.price)
            : Number.isFinite(activeLastClose)
              ? activeLastClose
              : Number.isFinite(Number(latestCachedPrice))
                ? Number(latestCachedPrice)
                : null;
      if (!Number.isFinite(usePrice)) return;
      const payload = {
        symbol: cleanSym,
        side: String(side || "BUY").toUpperCase(),
        action: "ENTRY",
        plan_id: activePlanGroup,
        price: usePrice,
        time: ctxMenu?.time || null,
        interval: ctxMenu?.interval || null,
      };
      if (typeof onQuickTradeIntent === "function") {
        onQuickTradeIntent(payload);
      }
      setCtxMenu(null);
    },
    [
      ctxMenu,
      cleanSym,
      onQuickTradeIntent,
      hoverInfo,
      latestCachedPrice,
      activeChartId,
      master,
      activePlanGroup,
    ],
  );

  const handleQuickLevel = useCallback(
    (kind) => {
      const sourceChartId = String(ctxMenu?.chartId || activeChartId || "");
      const activeTf = sourceChartId.split("-").slice(-1)[0];
      const activeBars = master?.bars?.[activeTf] || [];
      const activeLastClose = Number(activeBars[activeBars.length - 1]?.close);
      const levelPrice = Number.isFinite(Number(ctxMenu?.price))
        ? Number(ctxMenu.price)
        : Number.isFinite(Number(hoverInfo?.price))
          ? Number(hoverInfo.price)
          : Number.isFinite(activeLastClose)
            ? activeLastClose
            : Number.isFinite(Number(latestCachedPrice))
              ? Number(latestCachedPrice)
              : null;
      if (!Number.isFinite(levelPrice)) return;
      const payload = {
        symbol: cleanSym,
        side: String(kind || "").toUpperCase() === "SL" ? "SL" : "TP",
        action: String(kind || "").toUpperCase(),
        plan_id: activePlanGroup,
        price: levelPrice,
        time: ctxMenu.time || null,
        interval: ctxMenu.interval || null,
      };
      if (typeof onQuickTradeIntent === "function") onQuickTradeIntent(payload);
      const isTp = String(kind || "").toUpperCase() === "TP";
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setAnnotations((prev) => [
        ...prev,
        {
          ...createLineObject({
            id,
            type: isTp ? "TP" : "SL",
            color: isTp ? "#10b981" : "#ef4444",
            yRatio: Number(ctxMenu?.yRatio || 0.5),
            ctxMenu,
          }),
          kind: "line",
          visible: true,
          tf: null,
          price_top: levelPrice,
          price_bottom: levelPrice,
          price: levelPrice,
          time: Number.isFinite(Number(ctxMenu?.time))
            ? Number(ctxMenu?.time)
            : null,
          line_style: "dot",
          line_width: 0.1,
          label: isTp ? "TP" : "SL",
          bg_color: "transparent",
        },
      ]);
      setSelectedObjectId(id);
      setCtxMenu(null);
    },
    [
      ctxMenu,
      cleanSym,
      onQuickTradeIntent,
      hoverInfo,
      latestCachedPrice,
      activeChartId,
      master,
      activePlanGroup,
    ],
  );

  const handleClearLevel = useCallback(
    (kind) => {
      const payload = {
        symbol: cleanSym,
        side: String(kind || "").toUpperCase(),
        action: `CLEAR_${String(kind || "").toUpperCase()}`,
        plan_id: activePlanGroup,
        price: null,
        time: null,
        interval: null,
      };
      if (typeof onQuickTradeIntent === "function") onQuickTradeIntent(payload);
    },
    [cleanSym, onQuickTradeIntent, activePlanGroup],
  );

  return (
    <div
      ref={rootRef}
      className="browser-card-v1"
      style={{ position: "relative", width: "100%" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 800, fontSize: 14 }}>{symbol}</span>

          {(pendingMode || mode) === "snapshots" && (
            <button
              className="secondary-button"
              type="button"
              onClick={handleCaptureSnapshots}
              disabled={capturingSnapshots}
              title={
                tradeSid
                  ? "Capture new timestamped snapshots into this trade SID folder"
                  : "Capture new snapshots"
              }
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 4,
                color: capturingSnapshots ? "#f59e0b" : "#10b981",
                borderColor: capturingSnapshots
                  ? "rgba(245,158,11,0.45)"
                  : "rgba(16,185,129,0.45)",
                backgroundColor: capturingSnapshots
                  ? "rgba(245,158,11,0.1)"
                  : "rgba(16,185,129,0.1)",
              }}
            >
              {capturingSnapshots ? "Snapshots ..." : "Snapshots"}
            </button>
          )}

          {showControls && (onToggleWatchlist || onRemove) && (
            <button
              className="secondary-button"
              style={{
                width: 18,
                height: 18,
                padding: 0,
                fontSize: 10,
                lineHeight: 1,
                minWidth: 18,
                borderRadius: 4,
                color: isInWatchlist ? "rgba(239,68,68,0.7)" : "var(--muted)",
                borderColor: isInWatchlist
                  ? "rgba(239,68,68,0.35)"
                  : "rgba(255,255,255,0.08)",
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (typeof onToggleWatchlist === "function")
                  onToggleWatchlist(symbol);
                else if (typeof onRemove === "function") onRemove(symbol);
              }}
              title={
                isInWatchlist ? "Remove from watchlist" : "Add to watchlist"
              }
            >
              {isInWatchlist ? "-" : "+"}
            </button>
          )}
          {showControls &&
            isInSelected &&
            typeof onRemoveSelected === "function" && (
              <button
                className="secondary-button"
                style={{
                  width: 18,
                  height: 18,
                  padding: 0,
                  fontSize: 10,
                  lineHeight: 1,
                  minWidth: 18,
                  borderRadius: 4,
                  color: "#fca5a5",
                  borderColor: "rgba(248,113,113,0.4)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveSelected(symbol);
                }}
                title="Remove from selected symbols"
              >
                x
              </button>
            )}
          {(pendingMode || mode) === "snapshots" &&
            snapshotState?.message &&
            snapshotState.stage === "error" && (
              <span
                className="minor-text"
                style={{
                  fontSize: 9,
                  color: "#ef4444",
                }}
              >
                {snapshotState.message}
              </span>
            )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {(showPerCardLayoutControls || mode === "cache") && (
            <select
              className="secondary-button"
              value={localBarsCount}
              onChange={(e) => {
                const n = Number(e.target.value);
                setLocalBarsCount(n);
              }}
              style={{ fontSize: 10, padding: "2px 4px", height: 22 }}
              title="Bars per TF"
            >
              <option value={100}>100</option>
              {[300, 600, 900, 1200, 1500, 1800, 2200, 2600, 3000].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          )}

          {mode === "live" && (
            <button
              className="secondary-button"
              onClick={() => setShowTvControls((v) => !v)}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "3px 7px",
                borderRadius: 4,
                marginRight: 4,
                borderColor: "var(--border)",
              }}
              title="Toggle TV Controls Visibility"
            >
              {showTvControls ? "«" : "⚙"}
            </button>
          )}

          {mode === "live" && showTvControls && (
            <>
              <button
                className="secondary-button"
                onClick={() => setShowTvLogin(true)}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "3px 7px",
                  borderRadius: 4,
                  marginRight: 4,
                  borderColor: "#60a5fa44",
                }}
              >
                Login
              </button>
              <button
                className="secondary-button"
                onClick={toggleAllTvSettings}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "3px 7px",
                  borderRadius: 4,
                  marginRight: 8,
                  color:
                    tvSettings.sidebar &&
                    tvSettings.toolbar &&
                    tvSettings.legend
                      ? "#60a5fa"
                      : "var(--muted)",
                  borderColor:
                    tvSettings.sidebar &&
                    tvSettings.toolbar &&
                    tvSettings.legend
                      ? "#60a5fa66"
                      : "var(--border)",
                }}
                title="Toggle Side + Top + Legend"
              >
                UI
              </button>
            </>
          )}

          {mode !== "live" && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => refresh({ force: true })}
              title="Refresh charts now (force=true)"
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "3px 7px",
                borderRadius: 4,
                color: "#60a5fa",
                borderColor: "#60a5fa66",
                background: "#60a5fa22",
              }}
            >
              ⟳
            </button>
          )}
          {mode === "cache" && showControls && showEditButton && (
            <button
              className={editObjects ? "primary-button" : "secondary-button"}
              type="button"
              onClick={() => setEditObjects((v) => !v)}
              title={
                editObjects
                  ? "Editing objects (drag/resize)"
                  : "Navigate chart (pan/zoom)"
              }
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "3px 7px",
                borderRadius: 4,
                minWidth: 34,
              }}
            >
              Edit
            </button>
          )}
          {/* Removed redundant P1/P2/PD/KL mini-row; use Objects panel as source of truth */}
          {(showPerCardLayoutControls || mode === "cache") && (
            <>
              <button
                className="secondary-button"
                style={{
                  width: 22,
                  height: 22,
                  padding: 0,
                  fontSize: 14,
                  lineHeight: 1,
                  minWidth: 22,
                  fontWeight: 700,
                }}
                onClick={() => setGridCols((prev) => Math.max(1, prev - 1))}
                title="Larger charts (fewer columns)"
              >
                +
              </button>
              <button
                className="secondary-button"
                style={{
                  width: 22,
                  height: 22,
                  padding: 0,
                  fontSize: 14,
                  lineHeight: 1,
                  minWidth: 22,
                  fontWeight: 700,
                }}
                onClick={() => setGridCols((prev) => Math.min(6, prev + 1))}
                title="Smaller charts (more columns)"
              >
                -
              </button>
            </>
          )}
          <button
            className="secondary-button"
            style={{
              height: 22,
              padding: "0 8px",
              fontSize: 10,
              lineHeight: 1,
              fontWeight: 700,
              display:
                showControls && showTradeButton && typeof onTrade === "function"
                  ? "block"
                  : "none",
            }}
            onClick={() =>
              onTrade?.({
                symbol,
                timeframes,
                latestPrice: latestCachedPrice,
                mode,
              })
            }
            title="Open Trade page"
          >
            Trade
          </button>
          <button
            className="secondary-button"
            style={{
              minWidth: 58,
              height: 22,
              padding: "0 8px",
              fontSize: 10,
              lineHeight: 1,
              fontWeight: 700,
              display: showControls && showAnalyzeButton ? "block" : "none",
            }}
            onClick={() => onAnalyze?.(symbol, timeframes)}
            title={analyzeLabel === ">" ? "Open symbol" : "Analyze"}
          >
            {analyzeLabel}
          </button>
        </div>
      </div>

      {(() => {
        const isMasterSnapshot =
          mode === "snapshots" &&
          master?.snapshots &&
          Object.values(master.snapshots).some((s) =>
            String(s?.file_name).toUpperCase().includes("_MASTER"),
          );
        const activeGridCols = isMasterSnapshot ? 1 : gridCols;
        const displayTfs =
          isMasterSnapshot && sortedTfs.length ? [sortedTfs[0]] : sortedTfs;
        return (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${activeGridCols}, 1fr)`,
              gap: 8,
            }}
          >
            {displayTfs.map((tf) => {
              const isLive = mode === "live";
              const context = master?.context?.[tf.toLowerCase()];
              const chartId = `${cleanSym}-${String(tf).toLowerCase()}`;
              const barsForTf = master?.bars?.[tf.toLowerCase()] || [];
              const hasBars = status !== "LOADING" && barsForTf.length > 0;
              const noData = !isLive && !hasBars && status !== "LOADING";
              const tfViewport = viewports[chartId] || null;
              const tfRangeFromViewport =
                tfViewport &&
                Number.isFinite(Number(tfViewport.timeStartMs)) &&
                Number.isFinite(Number(tfViewport.timeEndMs)) &&
                Number.isFinite(Number(tfViewport.priceTop)) &&
                Number.isFinite(Number(tfViewport.priceBottom))
                  ? {
                      t0: Math.min(
                        Number(tfViewport.timeStartMs),
                        Number(tfViewport.timeEndMs),
                      ),
                      t1: Math.max(
                        Number(tfViewport.timeStartMs),
                        Number(tfViewport.timeEndMs),
                      ),
                      pMin: Math.min(
                        Number(tfViewport.priceTop),
                        Number(tfViewport.priceBottom),
                      ),
                      pMax: Math.max(
                        Number(tfViewport.priceTop),
                        Number(tfViewport.priceBottom),
                      ),
                    }
                  : null;
              const tfRange = tfRangeFromViewport || barsRange(barsForTf);

              const projectedAnnotations = (annotations || [])
                .filter(
                  (a) =>
                    !a.tf ||
                    String(a.tf).toLowerCase() === String(tf).toLowerCase(),
                )
                .map((a) => {
                  const baseTime = Number(a.time);
                  const lineTime =
                    Number.isFinite(baseTime) && baseTime > 0
                      ? baseTime
                      : toEpochMs(a.anchorTimeMs);
                  const lineTop = Number(a.price ?? a.price_top);
                  const lineBottom = Number(
                    a.price ?? a.price_bottom ?? a.price_top,
                  );
                  const p1 = Number.isFinite(lineTop)
                    ? lineTop
                    : Number(a.anchorPrice);
                  const p2 = Number.isFinite(lineBottom)
                    ? lineBottom
                    : Number(a.anchorPrice2);
                  const timeRatio = ratioFromAnchorTime(lineTime, tfRange);
                  const priceRatio = ratioFromAnchorPrice(p1, tfRange);
                  const priceRatio2 = ratioFromAnchorPrice(p2, tfRange);
                  const x1TimeRatio = ratioFromAnchorTime(
                    toEpochMs(a.anchorTimeMs),
                    tfRange,
                  );
                  const x2TimeRatio = ratioFromAnchorTime(
                    toEpochMs(a.anchorTimeMs2),
                    tfRange,
                  );
                  return {
                    ...a,
                    _xRatio: Number.isFinite(timeRatio)
                      ? timeRatio
                      : clamp01(Number(a.xRatio ?? 0.5)),
                    _yRatio: Number.isFinite(priceRatio)
                      ? priceRatio
                      : clamp01(Number(a.yRatio ?? 0.5)),
                    _y1Ratio: Number.isFinite(priceRatio)
                      ? priceRatio
                      : clamp01(Number(a.y1Ratio ?? 0.4)),
                    _y2Ratio: Number.isFinite(priceRatio2)
                      ? priceRatio2
                      : clamp01(Number(a.y2Ratio ?? 0.6)),
                    _x1Ratio: Number.isFinite(x1TimeRatio)
                      ? x1TimeRatio
                      : clamp01(Number(a.x1Ratio ?? 0.2)),
                    _x2Ratio: Number.isFinite(x2TimeRatio)
                      ? x2TimeRatio
                      : clamp01(Number(a.x2Ratio ?? 0.8)),
                  };
                })
                .filter((a) => {
                  if (a.kind === "line") {
                    return (
                      Number.isFinite(Number(a._yRatio)) &&
                      Number(a._yRatio) >= 0 &&
                      Number(a._yRatio) <= 1
                    );
                  }
                  if (a.kind === "point") {
                    return (
                      Number.isFinite(Number(a._xRatio)) &&
                      Number.isFinite(Number(a._yRatio)) &&
                      Number(a._xRatio) >= 0 &&
                      Number(a._xRatio) <= 1 &&
                      Number(a._yRatio) >= 0 &&
                      Number(a._yRatio) <= 1
                    );
                  }
                  if (a.kind === "zone") {
                    const y1 = Number(a._y1Ratio);
                    const y2 = Number(a._y2Ratio);
                    const x1 = Number(a._x1Ratio);
                    const x2 = Number(a._x2Ratio);
                    const yIn =
                      Number.isFinite(y1) &&
                      Number.isFinite(y2) &&
                      !(Math.max(y1, y2) < 0 || Math.min(y1, y2) > 1);
                    const xIn =
                      Number.isFinite(x1) &&
                      Number.isFinite(x2) &&
                      !(Math.max(x1, x2) < 0 || Math.min(x1, x2) > 1);
                    return yIn && xIn;
                  }
                  return true;
                });

              // ANNOTATION_LINES_CONVERSION
              const annotationLines = [];
              for (const a of projectedAnnotations) {
                if (a.visible === false) continue;
                const p = a.price ?? a.anchorPrice;
                const c = a.color || "#60a5fa";
                const lb = formatObjectLabel(a.type, a.label || "");
                if (a.kind === "line" && Number.isFinite(Number(p)))
                  annotationLines.push({
                    price: Number(p),
                    color: c,
                    label: lb,
                  });
                else if (a.kind === "point" && Number.isFinite(Number(p)))
                  annotationLines.push({
                    price: Number(p),
                    color: c,
                    label: lb || "\u25CF",
                  });
                else if (a.kind === "zone") {
                  const t = a.price_top ?? a.anchorPrice;
                  const b = a.price_bottom ?? a.anchorPrice2;
                  if (Number.isFinite(Number(t)))
                    annotationLines.push({
                      price: Number(t),
                      color: c,
                      label: lb ? lb + " T" : "ZT",
                    });
                  if (Number.isFinite(Number(b)))
                    annotationLines.push({
                      price: Number(b),
                      color: c,
                      label: lb ? lb + " B" : "ZB",
                    });
                }
              }
              const isActiveTf = activeChartId === chartId;

              return (
                <div
                  key={`${mode}-${tf}`}
                  style={{
                    minWidth: 0,
                    position: "relative",
                    border: "1px solid",
                    borderColor: isActiveTf ? "#22d3ee" : "transparent",
                    borderRadius: 8,
                    padding: 0,
                  }}
                  onMouseEnter={() => setActiveChartId(chartId)}
                  onMouseDown={() => setActiveChartId(chartId)}
                  onMouseMove={() => {
                    if (activeChartId !== chartId) setActiveChartId(chartId);
                  }}
                >
                  <TfHeader
                    tf={tf}
                    context={context}
                    master={master}
                    mode={mode}
                    analysisSnapshot={analysisSnapshot}
                    barsStatus={barsStatus}
                    snapshotStatus={snapshotStatus}
                    onRefreshTf={mode === "cache" ? handleRefreshTf : null}
                    forceRefresh={forceRefresh}
                  />
                  {isLive ? (
                    <div style={{ position: "relative", height: chartHeight }}>
                      <iframe
                        key={`tv-${symbol}-${tf}-${liveKey}`}
                        title={`tv-${symbol}-${tf}`}
                        className="browser-chart-v1"
                        style={{
                          width: "100%",
                          height: "100%",
                          border: "none",
                        }}
                        src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(cleanSym)}&interval=${encodeURIComponent(liveTfToTvInterval(tf))}&theme=dark&style=1&locale=en&toolbarbg=%230f1729&hide_side_toolbar=${tvSettings.sidebar ? "0" : "1"}&hide_top_toolbar=${tvSettings.toolbar ? "0" : "1"}&hide_legend=${tvSettings.legend ? "0" : "1"}&saveimage=0&timezone=${encodeURIComponent(tvTimezone)}`}
                      />
                      <button
                        className="secondary-button"
                        onClick={() => setFullscreenTf(tf)}
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 6,
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "rgba(0,0,0,0.6)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          color: "#fff",
                          zIndex: 10,
                        }}
                        title="Fullscreen"
                      >
                        ⛶
                      </button>
                    </div>
                  ) : mode === "snapshots" &&
                    master?.snapshots?.[tf.toLowerCase()] ? (
                    /* Snapshot image */
                    <div
                      style={{
                        position: "relative",
                        height: isMasterSnapshot ? 410 : chartHeight,
                        overflow: "hidden",
                        borderRadius: 6,
                      }}
                    >
                      <img
                        src={
                          master.snapshots[tf.toLowerCase()].url ||
                          `${window.location.origin}/v2/chart/snapshots/${encodeURIComponent(master.snapshots[tf.toLowerCase()].file_name || "")}`
                        }
                        alt={`snapshot-${tf}`}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: isMasterSnapshot ? "fill" : "contain",
                          background: "#000",
                          cursor: "pointer",
                        }}
                        onError={(e) => {
                          e.target.style.display = "none";
                        }}
                        onClick={() => {
                          const snap = master?.snapshots?.[tf.toLowerCase()];
                          if (snap) {
                            const url =
                              snap.url ||
                              `${window.location.origin}/v2/chart/snapshots/${encodeURIComponent(snap.file_name || "")}`;
                            setSnapshotModalFiles([
                              {
                                name: snap.file_name || `snapshot-${tf}`,
                                url,
                                size_bytes: snap.size_bytes || 0,
                              },
                            ]);
                          }
                        }}
                      />
                    </div>
                  ) : hasBars ? (
                    <>
                      <TradeSignalChart
                        key={`tsc-${symbol}-${tf}-${tp1Price}-${tp2Price}-${tp3Price}`}
                        chartId={chartId}
                        symbol={cleanSym}
                        interval={tf}
                        historicalData={barsForTf}
                        height={chartHeight}
                        analysisSnapshot={analysisSnapshot || null}
                        entryPrice={overlays.plan1 ? entryPrice : null}
                        slPrice={overlays.plan1 ? slPrice : null}
                        tpPrice={overlays.plan1 ? tpPrice : null}
                        tp1Price={overlays.plan1 ? tp1Price : null}
                        tp2Price={overlays.plan1 ? tp2Price : null}
                        tp3Price={overlays.plan1 ? tp3Price : null}
                        createdAt={createdAt}
                        openedAt={openedAt}
                        closedAt={closedAt}
                        showPrimaryPlan={overlays.plan1}
                        showExtraPlans={overlays.plan2}
                        showPdArrays={overlays.pdArrays}
                        showKeyLevels={overlays.keyLevels}
                        onPlanLevelChange={onPlanLevelChange}
                        syncedCrosshair={
                          mode === "cache" ? syncedCrosshair : null
                        }
                        onCrosshairSync={
                          mode === "cache" ? handleCrosshairSync : undefined
                        }
                        onBarsLoaded={handleBarsLoaded}
                        sharedLines={annotationLines}
                        onContextRequest={
                          mode === "cache" ? handleContextRequest : undefined
                        }
                        onViewportChange={
                          mode === "cache" ? handleViewportChange : undefined
                        }
                      />
                      {mode === "cache" && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            zIndex: 25,
                            pointerEvents:
                              drawMode === "zone" || editObjects
                                ? "auto"
                                : "none",
                          }}
                          onMouseDown={(evt) => {
                            const rect =
                              evt.currentTarget.getBoundingClientRect();
                            const x = evt.clientX - rect.left;
                            const y = evt.clientY - rect.top;
                            const xr = Math.max(
                              0,
                              Math.min(1, x / Math.max(rect.width, 1)),
                            );
                            const yr = Math.max(
                              0,
                              Math.min(1, y / Math.max(rect.height, 1)),
                            );
                            if (drawMode === "zone") {
                              const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                              const start = { x: xr, y: yr };
                              const onUp = (upEvt) => {
                                const ux = upEvt.clientX - rect.left;
                                const uy = upEvt.clientY - rect.top;
                                const xr2 = Math.max(
                                  0,
                                  Math.min(1, ux / Math.max(rect.width, 1)),
                                );
                                const yr2 = Math.max(
                                  0,
                                  Math.min(1, uy / Math.max(rect.height, 1)),
                                );
                                const p1 = anchorPriceFromRatio(
                                  start.y,
                                  tfRange,
                                );
                                const p2 = anchorPriceFromRatio(yr2, tfRange);
                                const t1 = anchorTimeFromRatio(
                                  Math.min(start.x, xr2),
                                  tfRange,
                                );
                                setAnnotations((prev) => [
                                  ...prev,
                                  {
                                    id,
                                    kind: "zone",
                                    visible: true,
                                    type: "ZONE",
                                    color: "#22c55e",
                                    tf: null,
                                    price_top:
                                      Number.isFinite(Number(p1)) &&
                                      Number.isFinite(Number(p2))
                                        ? Math.max(Number(p1), Number(p2))
                                        : null,
                                    price_bottom:
                                      Number.isFinite(Number(p1)) &&
                                      Number.isFinite(Number(p2))
                                        ? Math.min(Number(p1), Number(p2))
                                        : null,
                                    price:
                                      Number.isFinite(Number(p1)) &&
                                      Number.isFinite(Number(p2))
                                        ? Number(p1)
                                        : null,
                                    time: Number.isFinite(Number(t1))
                                      ? Number(t1)
                                      : null,
                                    line_style: "solid",
                                    line_width: 1,
                                    bg_color: "rgba(34,197,94,0.18)",
                                    label: "Zone",
                                    x1Ratio: Math.min(start.x, xr2),
                                    x2Ratio: Math.max(start.x, xr2),
                                    y1Ratio: start.y,
                                    y2Ratio: yr2,
                                    anchorTimeMs: anchorTimeFromRatio(
                                      Math.min(start.x, xr2),
                                      tfRange,
                                    ),
                                    anchorTimeMs2: anchorTimeFromRatio(
                                      Math.max(start.x, xr2),
                                      tfRange,
                                    ),
                                    anchorPrice: anchorPriceFromRatio(
                                      start.y,
                                      tfRange,
                                    ),
                                    anchorPrice2: anchorPriceFromRatio(
                                      yr2,
                                      tfRange,
                                    ),
                                  },
                                ]);
                                setSelectedObjectId(id);
                                setDrawMode(null);
                                window.removeEventListener("mouseup", onUp);
                              };
                              window.addEventListener("mouseup", onUp);
                              evt.preventDefault();
                              return;
                            }
                            const hit = (projectedAnnotations || [])
                              .map((a) => {
                                if (a.kind === "line") {
                                  const ay = Number(a._yRatio) * rect.height;
                                  return { a, d: Math.abs(ay - y), edge: null };
                                }
                                if (a.kind === "point") {
                                  const ax = Number(a._xRatio) * rect.width;
                                  const ay = Number(a._yRatio) * rect.height;
                                  return {
                                    a,
                                    d: Math.hypot(ax - x, ay - y),
                                    edge: null,
                                  };
                                }
                                if (a.kind === "zone") {
                                  const y1 = Number(a._y1Ratio) * rect.height;
                                  const y2 = Number(a._y2Ratio) * rect.height;
                                  const lo = Math.min(y1, y2);
                                  const hi = Math.max(y1, y2);
                                  if (y < lo - 6 || y > hi + 6) return null;
                                  const dTop = Math.abs(y - lo);
                                  const dBot = Math.abs(y - hi);
                                  return {
                                    a,
                                    d: Math.min(dTop, dBot),
                                    edge: dTop < dBot ? "top" : "bottom",
                                  };
                                }
                                return null;
                              })
                              .filter(Boolean)
                              .sort((p, q) => p.d - q.d)[0];
                            if (hit && hit.d <= 10) {
                              dragRef.current = {
                                id: hit.a.id,
                                edge: hit.edge,
                                rect,
                                range: tfRange,
                              };
                              setSelectedObjectId(hit.a.id);
                              evt.preventDefault();
                            }
                          }}
                        >
                          {/* All annotations now rendered via createPriceLine API */}
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        height: chartHeight,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--muted)",
                        fontSize: 11,
                      }}
                    >
                      {status === "LOADING"
                        ? "Loading..."
                        : mode === "snapshots"
                          ? "No saved snapshots"
                          : "No data — click C to fetch"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {(lastError || error) && (
        <div style={{ marginTop: 4, fontSize: 9, color: "#ef4444" }}>
          {lastError || error}
        </div>
      )}
      {mode === "cache" && ctxMenu && (
        <div
          style={{
            position: "fixed",
            left: Math.max(8, Number(ctxMenu.clientX || 0)),
            top: Math.max(8, Number(ctxMenu.clientY || 0)),
            background: "#0f1729",
            border: "1px solid rgba(148,163,184,0.35)",
            borderRadius: 8,
            zIndex: 9999,
            minWidth: 140,
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Price at mouse */}
          <div
            style={{
              padding: "4px 8px",
              fontSize: 10,
              color: "#94a3b8",
              borderBottom: "1px solid rgba(148,163,184,0.15)",
              fontFamily: "monospace",
            }}
          >
            {Number(ctxMenu?.price || 0).toFixed(
              Number(ctxMenu?.price) >= 1000
                ? 1
                : Number(ctxMenu?.price) >= 100
                  ? 2
                  : 3,
            )}
          </div>
          {(() => {
            const price = Number(ctxMenu?.price || 0);
            const priceStr = price.toFixed(
              price >= 1000 ? 1 : price >= 100 ? 2 : 3,
            );
            return [
              { label: "Line", color: "#60a5fa", fn: handleDrawLine },
              {
                label: "Zone",
                color: "#22c55e",
                fn: () => addObject("ZONE", "#22c55e", "zone"),
              },
              { label: `Buy @ ${priceStr}`, fn: () => handleQuickTrade("BUY") },
              {
                label: `Sell @ ${priceStr}`,
                fn: () => handleQuickTrade("SELL"),
              },
              {
                label: `Entry @ ${priceStr}`,
                fn: () => {
                  const p = Number(ctxMenu?.price);
                  console.log(
                    "[ctxMenu] Entry clicked price=",
                    p,
                    "onPlanLevelChange=",
                    typeof onPlanLevelChange,
                    "onQuickTradeIntent=",
                    typeof onQuickTradeIntent,
                    "mode=",
                    mode,
                  );
                  if (typeof onPlanLevelChange === "function") {
                    onPlanLevelChange("entry", p);
                    console.log("[ctxMenu] Entry → onPlanLevelChange done");
                  }
                  if (typeof onQuickTradeIntent === "function") {
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: "ENTRY",
                      action: "ENTRY",
                      plan_id: activePlanGroup,
                      price: p,
                    });
                    console.log("[ctxMenu] Entry → onQuickTradeIntent done");
                  }
                  if (
                    typeof onPlanLevelChange !== "function" &&
                    typeof onQuickTradeIntent !== "function"
                  ) {
                    console.log("[ctxMenu] Entry → NO HANDLER available");
                  }
                  setCtxMenu(null);
                },
              },
              ...["TP1", "TP2", "TP3"].map((tpKey) => ({
                label: `${tpKey} @ ${priceStr}`,
                fn: () => {
                  const p = Number(ctxMenu?.price);
                  if (typeof onPlanLevelChange === "function") {
                    onPlanLevelChange(tpKey.toLowerCase(), p);
                  }
                  if (typeof onQuickTradeIntent === "function") {
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: tpKey,
                      action: tpKey,
                      plan_id: activePlanGroup,
                      price: p,
                    });
                  }
                  setCtxMenu(null);
                },
              })),
              {
                label: `SL @ ${priceStr}`,
                fn: () => {
                  const p = Number(ctxMenu?.price);
                  console.log("[ctxMenu] SL clicked price=", p, "mode=", mode);
                  if (typeof onPlanLevelChange === "function") {
                    onPlanLevelChange("sl", p);
                  }
                  if (typeof onQuickTradeIntent === "function") {
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: "SL",
                      action: "SL",
                      plan_id: activePlanGroup,
                      price: p,
                    });
                  }
                  setCtxMenu(null);
                },
              },
            ].map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={it.fn}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  color:
                    it.label.startsWith("Buy") ||
                    it.label.startsWith("Entry") ||
                    it.label.startsWith("TP")
                      ? "#10b981"
                      : it.label.startsWith("Sell") || it.label.startsWith("SL")
                        ? "#ef4444"
                        : "#e2e8f0",
                  border: "none",
                  padding: "6px 8px",
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {it.color ? (
                  <span
                    style={{
                      width: 16,
                      height: it.label === "Zone" ? 10 : 2,
                      borderRadius: 2,
                      border: `1px solid ${it.color}`,
                      background:
                        it.label === "Zone" ? `${it.color}33` : it.color,
                      display: "inline-block",
                    }}
                  />
                ) : null}
                {it.label}
              </button>
            ));
          })()}
        </div>
      )}
      {mode === "cache" && (
        <div
          style={{
            marginTop: 8,
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 8px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {editableAnnotations.map((a) => (
            <span
              key={a.id}
              onClick={() => setSelectedObjectId(a.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border:
                  selectedObjectId === a.id
                    ? `1px solid ${a.visible === false ? "#94a3b8" : a.color || "#60a5fa"}`
                    : "1px solid var(--border)",
                color:
                  selectedObjectId === a.id
                    ? a.visible === false
                      ? "#94a3b8"
                      : a.color || "var(--foreground)"
                    : "var(--foreground)",
                borderRadius: 12,
                padding: "1px 6px",
                fontSize: 9,
                cursor: "pointer",
                background:
                  selectedObjectId === a.id
                    ? `${a.visible === false ? "#cbd5e1" : a.color || "#60a5fa"}22`
                    : "transparent",
              }}
              title={a.id}
            >
              {formatObjectLabel(a.type, a.label || "") || a.type}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAnnotations((prev) =>
                    prev.map((x) =>
                      x.id === a.id
                        ? { ...x, visible: x.visible === false ? true : false }
                        : x,
                    ),
                  );
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  fontSize: 10,
                  lineHeight: 1,
                }}
                title={a.visible === false ? "Show" : "Hide"}
              >
                {a.visible === false ? "◌" : "👁"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAnnotations((prev) => prev.filter((x) => x.id !== a.id));
                  if (
                    a.kind === "tradeplan" &&
                    typeof onQuickTradeIntent === "function"
                  ) {
                    const planId = String(a.plan_id || "P1").toUpperCase();
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: "ENTRY",
                      action: "CLEAR_ENTRY",
                      plan_id: planId,
                      price: null,
                    });
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: "TP",
                      action: "CLEAR_TP",
                      plan_id: planId,
                      price: null,
                    });
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: "SL",
                      action: "CLEAR_SL",
                      plan_id: planId,
                      price: null,
                    });
                  }
                  setSelectedObjectId((prev) => (prev === a.id ? null : prev));
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1,
                }}
                title="Remove"
              >
                x
              </button>
            </span>
          ))}
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <button type="button" onClick={() => { setAnnotations([]); setSelectedObjectId(null); }} style={{ fontSize:10, padding:"3px 8px", background:"rgba(220,38,38,0.15)", color:"#dc2626", border:"1px solid rgba(220,38,38,0.3)", borderRadius:4, cursor:"pointer" }}>X</button>
            <button type="button" onClick={handleSaveObjects} style={{ fontSize:10, padding:"3px 8px", background:"#3b82f6", color:"#fff", border:"none", borderRadius:4, cursor:"pointer" }}>Save</button>
          </div>
          {selectedObject ? (
            <div
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "repeat(6, minmax(120px, 1fr))",
                gap: 8,
              }}
            >
              {selectedObject.kind === "tradeplan" ? (
                <>
                  <div
                    className="minor-text"
                    style={{
                      gridColumn: "1 / -1",
                      fontSize: 10,
                      opacity: 0.9,
                    }}
                  >
                    TradePlan values are read-only here. Edit Trade Plan in the
                    top panel.
                  </div>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-label`}
                    style={{ display: "grid", gap: 4, fontSize: 10 }}
                  >
                    Label
                    <input
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-label`}
                      name="label"
                      value={selectedObject.label || ""}
                      readOnly
                      placeholder="TradePlan label"
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-direction`}
                    style={{ display: "grid", gap: 4, fontSize: 10 }}
                  >
                    Direction
                    <select
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-direction`}
                      name="direction"
                      value={String(
                        selectedObject.direction || "BUY",
                      ).toUpperCase()}
                      disabled
                    >
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-entry`}
                    style={{ display: "grid", gap: 4, fontSize: 10 }}
                  >
                    Entry
                    <NumberAdjuster
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-entry`}
                      value={selectedObject.entryPrice ?? ""}
                      onChange={() => {}}
                      min={0}
                      max={200000}
                      step={1}
                      fallbackValue={latestCachedPrice}
                      placeholder="entry"
                      disabled
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-tp`}
                    style={{ display: "grid", gap: 4, fontSize: 10 }}
                  >
                    TP
                    <NumberAdjuster
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-tp`}
                      value={selectedObject.tpPrice ?? ""}
                      onChange={() => {}}
                      min={0}
                      max={200000}
                      step={1}
                      fallbackValue={latestCachedPrice}
                      placeholder="tp"
                      disabled
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-sl`}
                    style={{ display: "grid", gap: 4, fontSize: 10 }}
                  >
                    SL
                    <NumberAdjuster
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-sl`}
                      value={selectedObject.slPrice ?? ""}
                      onChange={() => {}}
                      min={0}
                      max={200000}
                      step={1}
                      fallbackValue={latestCachedPrice}
                      placeholder="sl"
                      disabled
                    />
                  </label>
                </>
              ) : (
                <>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-label`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 3",
                    }}
                  >
                    Label
                    <input
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-label`}
                      name="label"
                      value={selectedObject.label || ""}
                      onChange={(e) =>
                        updateSelectedField("label", e.target.value)
                      }
                      placeholder="label"
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-type`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 3",
                    }}
                  >
                    Type
                    <select
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-type`}
                      name="type"
                      value={selectedObject.type || "line"}
                      onChange={(e) =>
                        updateSelectedField("type", e.target.value)
                      }
                    >
                      {["buy", "sell", "line", "zone", "s/r", "ob", "fvg"].map(
                        (x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-tf`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 2",
                    }}
                  >
                    TF
                    <select
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-tf`}
                      name="tf"
                      value={selectedObject.tf || ""}
                      onChange={(e) =>
                        updateSelectedField("tf", e.target.value || null)
                      }
                    >
                      <option value="">all TFs</option>
                      {(sortedTfs || []).map((tf) => (
                        <option key={tf} value={String(tf).toLowerCase()}>
                          {String(tf).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-price`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 2",
                    }}
                  >
                    Price
                    <NumberAdjuster
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-price`}
                      value={
                        selectedObject.price ?? selectedObject.price_top ?? ""
                      }
                      onChange={(v) => {
                        updateSelectedField("price", v);
                        updateSelectedField("price_top", v);
                        updateSelectedField("price_bottom", v);
                      }}
                      min={0}
                      max={200000}
                      step={1}
                      placeholder="price"
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-style`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 2",
                    }}
                  >
                    Line Style
                    <select
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-style`}
                      name="line_style"
                      value={selectedObject.line_style || "solid"}
                      onChange={(e) =>
                        updateSelectedField("line_style", e.target.value)
                      }
                    >
                      {["solid", "dot", "dash"].map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-width`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 3",
                    }}
                  >
                    Line Width
                    <select
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-width`}
                      name="line_width"
                      value={selectedObject.line_width || 2}
                      onChange={(e) =>
                        updateSelectedField("line_width", e.target.value)
                      }
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 10].map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-color`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 1",
                    }}
                  >
                    Color
                    <input
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-color`}
                      name="color"
                      type="color"
                      value={toHexColor(selectedObject.color)}
                      onChange={(e) =>
                        updateSelectedField("color", e.target.value)
                      }
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-bg`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 1",
                    }}
                  >
                    Background Color
                    <input
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-bg`}
                      name="bg_color"
                      type="color"
                      value={toHexColor(selectedObject.bg_color || "#22c55e")}
                      onChange={(e) =>
                        updateSelectedField("bg_color", e.target.value)
                      }
                    />
                  </label>
                </>
              )}
            </div>
          ) : null}
        </div>
      )}

      <TvLoginOverlay
        isOpen={showTvLogin}
        onClose={() => setShowTvLogin(false)}
        onLogin={handleTvLogin}
      />
    </div>
  );
}

function TvLoginOverlay({ isOpen, onClose, onLogin }) {
  return (
    <TradingViewLoginModal
      isOpen={isOpen}
      onClose={onClose}
      onLogin={onLogin}
    />
  );
}
