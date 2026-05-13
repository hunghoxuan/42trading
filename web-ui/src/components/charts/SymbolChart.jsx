import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useSymbolChartData } from "../../hooks/useChartTileData";
import TradeSignalChart from "../TradeSignalChart";
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

const MODES = ["live", "cache", "snapshots"];
const MODE_LABELS = { live: "Live", cache: "C", snapshots: "S" };
const STATUS_COLORS = {
  IDLE: "var(--muted)",
  LOADING: "#f59e0b",
  READY: "#10b981",
  STALE: "#f59e0b",
  ERROR: "#ef4444",
};

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
          title={`Refresh ${tf} (${forceRefresh ? "force=true" : "force=false"})`}
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
              context.cache_source === "binance"
                ? "#10b981"
                : "var(--muted)",
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
  onAnalyze,
  onRemove,
  entryPrice = null,
  tpPrice = null,
  slPrice = null,
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
  attachedSnapshotFiles = [],
  onQuickTradeIntent = null,
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
  const [annotations, setAnnotations] = useState([]);
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [editObjects, setEditObjects] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [viewports, setViewports] = useState({});
  const [ctxMenu, setCtxMenu] = useState(null);
  const [drawMode, setDrawMode] = useState(null);
  const dragRef = useRef(null);

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

  const { status, master, error, cachedAt, refresh, refreshTf, liveKey, snapshotState } =
    useSymbolChartData({
      symbol: cleanSym,
      timeframes,
      mode: pendingMode || mode,
      forceRefresh,
      skipFetch,
      provider,
      sessionPrefix,
      attachedSnapshotFiles,
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
      parts.push(
        `time1_${tfKey}=${rT1 ?? "n/a"} time2_${tfKey}=${rT2 ?? "n/a"} price1_${tfKey}=${Number.isFinite(rP1) ? rP1.toFixed(2) : "n/a"} price2_${tfKey}=${Number.isFinite(rP2) ? rP2.toFixed(2) : "n/a"}`,
      );
    }
    return parts.join(" | ");
  }, [selectedObject, sortedTfs, cleanSym, viewports, master]);

  const handleModeClick = useCallback((newMode) => {
    if (newMode === "live") {
      setMode("live");
      setPendingMode(null);
      setLastError(null);
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
  }, [mode, pendingMode, status, refresh, forceRefresh]);

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
    setCtxMenu(payload || null);
  }, []);

  const handleViewportChange = useCallback((payload) => {
    if (!payload?.chartId) return;
    setViewports((prev) => ({ ...prev, [payload.chartId]: payload }));
  }, []);

  const handleRefreshTf = useCallback(
    (tf) => {
      if (!tf) return;
      refreshTf?.(tf, { force: forceRefresh });
    },
    [refreshTf, forceRefresh],
  );

  const handleDrawLine = useCallback(() => {
    if (!ctxMenu || !Number.isFinite(Number(ctxMenu.yRatio))) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setAnnotations((prev) => [
      ...prev,
      createLineObject({
        id,
        type: "LINE",
        color: "#60a5fa",
        yRatio: Number(ctxMenu.yRatio),
        ctxMenu,
      }),
    ]);
    setSelectedObjectId(id);
    setCtxMenu(null);
  }, [ctxMenu]);

  const addObject = useCallback(
    (type, color, kind = "line") => {
      if (!ctxMenu) return;
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
          createLineObject({
            id,
            type,
            color,
            yRatio: Number(ctxMenu.yRatio || 0.5),
            ctxMenu,
          }),
        ]);
        setSelectedObjectId(id);
      }
      setCtxMenu(null);
    },
    [ctxMenu],
  );

  const handleQuickTrade = useCallback(
    (side, explicitPrice = null) => {
      const usePrice =
        Number.isFinite(Number(explicitPrice))
          ? Number(explicitPrice)
          : Number(ctxMenu?.price);
      if (!Number.isFinite(usePrice)) return;
      const payload = {
        symbol: cleanSym,
        side: String(side || "BUY").toUpperCase(),
        action: "ENTRY",
        price: usePrice,
        time: ctxMenu?.time || null,
        interval: ctxMenu?.interval || null,
      };
      if (typeof onQuickTradeIntent === "function") {
        onQuickTradeIntent(payload);
      }
      try {
        window.dispatchEvent(
          new CustomEvent("tvbridge:advanced-trade", { detail: payload }),
        );
      } catch {}
      setCtxMenu(null);
    },
    [ctxMenu, cleanSym, onQuickTradeIntent],
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

  const handleQuickLevel = useCallback(
    (kind) => {
      if (!ctxMenu || !Number.isFinite(Number(ctxMenu.price))) return;
      const payload = {
        symbol: cleanSym,
        side: String(kind || "").toUpperCase() === "SL" ? "SL" : "TP",
        action: String(kind || "").toUpperCase(),
        price: Number(ctxMenu.price),
        time: ctxMenu.time || null,
        interval: ctxMenu.interval || null,
      };
      if (typeof onQuickTradeIntent === "function") onQuickTradeIntent(payload);
      setCtxMenu(null);
    },
    [ctxMenu, cleanSym, onQuickTradeIntent],
  );

  const handleClearLevel = useCallback(
    (kind) => {
      const payload = {
        symbol: cleanSym,
        side: String(kind || "").toUpperCase(),
        action: `CLEAR_${String(kind || "").toUpperCase()}`,
        price: null,
        time: null,
        interval: null,
      };
      if (typeof onQuickTradeIntent === "function") onQuickTradeIntent(payload);
    },
    [cleanSym, onQuickTradeIntent],
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
          {onRemove && showControls && (
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
                color: "rgba(239,68,68,0.5)",
                borderColor: "rgba(239,68,68,0.25)",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(symbol);
              }}
              title="Remove"
            >
              -
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
          {/* Mode buttons: Live / C (cache+bars) / S (snapshots) */}
          {MODES.map((m) => (
            <button
              key={m}
              className="secondary-button"
              onClick={() => handleModeClick(m)}
              title={btnTitle(m)}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 4,
                color: btnColor(m),
                borderColor:
                  (pendingMode || mode) === m
                    ? btnColor(m) + "60"
                    : "var(--border)",
                background:
                  (pendingMode || mode) === m
                    ? btnColor(m) + "12"
                    : "transparent",
              }}
            >
              {MODE_LABELS[m]}
              {(pendingMode || mode) === m && status === "LOADING" && " \u23F3"}
            </button>
          ))}
          {mode !== "live" && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setForceRefresh((v) => !v)}
              title={`Force refresh flag for API calls: force=${forceRefresh ? "1" : "0"}`}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "3px 7px",
                borderRadius: 4,
                color: forceRefresh ? "#60a5fa" : "var(--muted)",
                borderColor: forceRefresh ? "#60a5fa66" : "var(--border)",
                background: forceRefresh ? "#60a5fa22" : "transparent",
              }}
            >
              ⟳
            </button>
          )}
          {mode === "cache" && (
            <button
              className={editObjects ? "primary-button" : "secondary-button"}
              type="button"
              onClick={() => setEditObjects((v) => !v)}
              title={editObjects ? "Editing objects (drag/resize)" : "Navigate chart (pan/zoom)"}
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
          {mode === "cache" && (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={() => handleQuickTrade("BUY", latestCachedPrice)}
                title="Quick Buy from latest cached lowest-TF price"
                style={{ fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 4, color: "#10b981", borderColor: "#10b98166" }}
              >
                Buy
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => handleQuickTrade("SELL", latestCachedPrice)}
                title="Quick Sell from latest cached lowest-TF price"
                style={{ fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 4, color: "#ef4444", borderColor: "#ef444466" }}
              >
                Sell
              </button>
            </>
          )}
          {/* Overlay toggles (only when cache mode + hasTradePlan + hasBars) */}
          {hasTradePlan && mode === "cache" && hasAnyBars && (
            <>
              <span style={{ opacity: 0.3, fontSize: 8, margin: "0 2px" }}>
                |
              </span>
              {overlayButtons.map(({ key, label }) => (
                <button
                  key={key}
                  className={
                    overlays[key] ? "primary-button" : "secondary-button"
                  }
                  onClick={() => toggleOverlay(key)}
                  type="button"
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "3px 7px",
                    borderRadius: 4,
                    minWidth: 28,
                  }}
                >
                  {label}
                </button>
              ))}
              <span style={{ opacity: 0.3, fontSize: 8, margin: "0 2px" }}>
                |
              </span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleClearLevel("ENTRY")}
                style={{ fontSize: 10, padding: "2px 6px" }}
                title="Clear Entry"
              >
                Entry x
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleClearLevel("TP")}
                style={{ fontSize: 10, padding: "2px 6px", color: "#10b981", borderColor: "#10b98166" }}
                title="Clear TP"
              >
                TP x
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleClearLevel("SL")}
                style={{ fontSize: 10, padding: "2px 6px", color: "#ef4444", borderColor: "#ef444466" }}
                title="Clear SL"
              >
                SL x
              </button>
            </>
          )}
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
          <button
            className="secondary-button"
            style={{
              width: 22,
              height: 22,
              padding: 0,
              fontSize: 11,
              lineHeight: 1,
              minWidth: 22,
              display: showControls ? "block" : "none",
            }}
            onClick={() => onAnalyze?.(symbol, timeframes)}
            title="Analyze"
          >
            &gt;
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gap: 8,
        }}
      >
        {sortedTfs.map((tf) => {
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

          const projectedAnnotations = (annotations || []).map((a) => {
            const timeRatio = ratioFromAnchorTime(toEpochMs(a.anchorTimeMs), tfRange);
            const priceRatio = ratioFromAnchorPrice(Number(a.anchorPrice), tfRange);
            const priceRatio2 = ratioFromAnchorPrice(Number(a.anchorPrice2), tfRange);
            const x1TimeRatio = ratioFromAnchorTime(toEpochMs(a.anchorTimeMs), tfRange);
            const x2TimeRatio = ratioFromAnchorTime(toEpochMs(a.anchorTimeMs2), tfRange);
            return {
              ...a,
              _xRatio:
                Number.isFinite(timeRatio) ? timeRatio : clamp01(Number(a.xRatio ?? 0.5)),
              _yRatio:
                Number.isFinite(priceRatio) ? priceRatio : clamp01(Number(a.yRatio ?? 0.5)),
              _y1Ratio:
                Number.isFinite(priceRatio) ? priceRatio : clamp01(Number(a.y1Ratio ?? 0.4)),
              _y2Ratio:
                Number.isFinite(priceRatio2)
                  ? priceRatio2
                  : clamp01(Number(a.y2Ratio ?? 0.6)),
              _x1Ratio:
                Number.isFinite(x1TimeRatio)
                  ? x1TimeRatio
                  : clamp01(Number(a.x1Ratio ?? 0.2)),
              _x2Ratio:
                Number.isFinite(x2TimeRatio)
                  ? x2TimeRatio
                  : clamp01(Number(a.x2Ratio ?? 0.8)),
            };
          });

          return (
            <div key={`${mode}-${tf}`} style={{ minWidth: 0, position: "relative" }}>
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
                <iframe
                  key={`tv-${symbol}-${tf}-${liveKey}`}
                  title={`tv-${symbol}-${tf}`}
                  className="browser-chart-v1"
                  style={{ height: chartHeight }}
                  src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(cleanSym)}&interval=${encodeURIComponent(liveTfToTvInterval(tf))}&theme=dark&style=1&locale=en&toolbarbg=%230f1729&hide_top_toolbar=1&hide_legend=1&saveimage=0&timezone=${encodeURIComponent(tvTimezone)}`}
                />
              ) : mode === "snapshots" && master?.snapshots?.[tf.toLowerCase()] ? (
                /* Snapshot image */
                <div style={{ position: "relative", height: chartHeight, overflow: "hidden", borderRadius: 6 }}>
                  <img
                    src={master.snapshots[tf.toLowerCase()].url || `${window.location.origin}/v2/chart/snapshots/${encodeURIComponent(master.snapshots[tf.toLowerCase()].file_name || "")}`}
                    alt={`snapshot-${tf}`}
                    style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                </div>
              ) : hasBars ? (
                <>
                  <TradeSignalChart
                  key={`tsc-${symbol}-${tf}`}
                  chartId={chartId}
                  symbol={cleanSym}
                  interval={tf}
                  historicalData={barsForTf}
                  height={chartHeight}
                  analysisSnapshot={analysisSnapshot || null}
                  entryPrice={overlays.plan1 ? entryPrice : null}
                  slPrice={overlays.plan1 ? slPrice : null}
                  tpPrice={overlays.plan1 ? tpPrice : null}
                  createdAt={createdAt}
                  openedAt={openedAt}
                  closedAt={closedAt}
                  showPrimaryPlan={overlays.plan1}
                  showExtraPlans={overlays.plan2}
                  showPdArrays={overlays.pdArrays}
                  showKeyLevels={overlays.keyLevels}
                  onPlanLevelChange={onPlanLevelChange}
                  syncedCrosshair={mode === "cache" ? syncedCrosshair : null}
                  onCrosshairSync={
                    mode === "cache" ? setSyncedCrosshair : undefined
                  }
                  onBarsLoaded={handleBarsLoaded}
                  sharedLines={mode === "cache" ? [] : []}
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
                      pointerEvents: drawMode === "zone" || editObjects ? "auto" : "none",
                    }}
                    onMouseDown={(evt) => {
                      const rect = evt.currentTarget.getBoundingClientRect();
                      const x = evt.clientX - rect.left;
                      const y = evt.clientY - rect.top;
                      const xr = Math.max(0, Math.min(1, x / Math.max(rect.width, 1)));
                      const yr = Math.max(0, Math.min(1, y / Math.max(rect.height, 1)));
                      if (drawMode === "zone") {
                        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                        const start = { x: xr, y: yr };
                        const onUp = (upEvt) => {
                          const ux = upEvt.clientX - rect.left;
                          const uy = upEvt.clientY - rect.top;
                          const xr2 = Math.max(0, Math.min(1, ux / Math.max(rect.width, 1)));
                          const yr2 = Math.max(0, Math.min(1, uy / Math.max(rect.height, 1)));
                          setAnnotations((prev) => [
                            ...prev,
                            {
                              id,
                              kind: "zone",
                              type: "ZONE",
                              color: "#22c55e",
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
                              anchorPrice: anchorPriceFromRatio(start.y, tfRange),
                              anchorPrice2: anchorPriceFromRatio(yr2, tfRange),
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
                            return { a, d: Math.hypot(ax - x, ay - y), edge: null };
                          }
                          if (a.kind === "zone") {
                            const y1 = Number(a._y1Ratio) * rect.height;
                            const y2 = Number(a._y2Ratio) * rect.height;
                            const lo = Math.min(y1, y2);
                            const hi = Math.max(y1, y2);
                            if (y < lo - 6 || y > hi + 6) return null;
                            const dTop = Math.abs(y - lo);
                            const dBot = Math.abs(y - hi);
                            return { a, d: Math.min(dTop, dBot), edge: dTop < dBot ? "top" : "bottom" };
                          }
                          return null;
                        })
                        .filter(Boolean)
                        .sort((p, q) => p.d - q.d)[0];
                      if (hit && hit.d <= 10) {
                        dragRef.current = { id: hit.a.id, edge: hit.edge, rect, range: tfRange };
                        setSelectedObjectId(hit.a.id);
                        evt.preventDefault();
                      }
                    }}
                  >
                    {(projectedAnnotations || []).map((a) => {
                      if (a.kind === "line") {
                        const isSelected = selectedObjectId === a.id;
                        return (
                          <div
                            key={a.id}
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              top: `${clamp01(Number(a._yRatio || 0.5)) * 100}%`,
                              borderTop: `${isSelected ? 2 : 1}px dashed ${a.color || "#60a5fa"}`,
                              boxShadow: isSelected
                                ? `0 0 0 1px ${a.color || "#60a5fa"}55`
                                : "none",
                              pointerEvents: "none",
                              zIndex: 26,
                            }}
                          />
                        );
                      }
                      if (a.kind === "point") {
                        const isSelected = selectedObjectId === a.id;
                        return (
                          <div
                            key={a.id}
                            style={{
                              position: "absolute",
                              left: `${clamp01(Number(a._xRatio || 0.5)) * 100}%`,
                              top: `${clamp01(Number(a._yRatio || 0.5)) * 100}%`,
                              width: isSelected ? 10 : 8,
                              height: isSelected ? 10 : 8,
                              borderRadius: "50%",
                              background: a.color || "#eab308",
                              outline: isSelected ? "1px solid #fff" : "none",
                              boxShadow: isSelected
                                ? `0 0 0 2px ${a.color || "#eab308"}55`
                                : "none",
                              transform: "translate(-50%, -50%)",
                              pointerEvents: "none",
                              zIndex: 26,
                            }}
                          />
                        );
                      }
                      if (a.kind === "zone") {
                        const isSelected = selectedObjectId === a.id;
                        const y1 = Number(a._y1Ratio || 0.4);
                        const y2 = Number(a._y2Ratio || 0.6);
                        const x1 = Number(a._x1Ratio || 0.2);
                        const x2 = Number(a._x2Ratio || 0.8);
                        return (
                          <div
                            key={a.id}
                            style={{
                              position: "absolute",
                              left: `${Math.min(x1, x2) * 100}%`,
                              top: `${Math.min(y1, y2) * 100}%`,
                              width: `${Math.abs(x2 - x1) * 100}%`,
                              height: `${Math.abs(y2 - y1) * 100}%`,
                              border: `${isSelected ? 2 : 1}px solid ${a.color || "#22c55e"}`,
                              background: `${a.color || "#22c55e"}22`,
                              boxShadow: isSelected
                                ? `0 0 0 1px ${a.color || "#22c55e"}66 inset`
                                : "none",
                              pointerEvents: "none",
                              zIndex: 26,
                            }}
                          />
                        );
                      }
                      return null;
                    })}
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
                  {status === "LOADING" ? "Loading..." : mode === "snapshots" ? "No snapshots — click 📷 to capture" : "No data — click C to fetch"}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
          {[
            { label: "Draw line", fn: handleDrawLine },
            { label: "OB", fn: () => addObject("OB", "#f59e0b") },
            { label: "FVG", fn: () => addObject("FVG", "#a855f7") },
            { label: "S/R", fn: () => addObject("S/R", "#22c55e") },
            { label: "Swept", fn: () => addObject("Swept", "#ef4444") },
            { label: "Point", fn: () => addObject("Point", "#eab308", "point") },
            { label: "Rectangle Zone", fn: () => addObject("ZONE", "#22c55e", "zone") },
            { label: "TP", fn: () => handleQuickLevel("TP") },
            { label: "SL", fn: () => handleQuickLevel("SL") },
            { label: "Buy", fn: () => handleQuickTrade("BUY") },
            { label: "Sell", fn: () => handleQuickTrade("SELL") },
          ].map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={it.fn}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                color: "#e2e8f0",
                border: "none",
                padding: "8px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {it.label}
            </button>
          ))}
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
          <span className="minor-text" style={{ fontSize: 10 }}>
            Objects ({annotations.length})
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setAnnotations([]);
              setSelectedObjectId(null);
            }}
            style={{ fontSize: 10, padding: "2px 6px" }}
          >
            Remove All
          </button>
          {annotations.map((a) => (
            <span
              key={a.id}
              onClick={() => setSelectedObjectId(a.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${a.color || "var(--border)"}`,
                color: a.color || "var(--foreground)",
                borderRadius: 12,
                padding: "2px 8px",
                fontSize: 10,
                cursor: "pointer",
                background:
                  selectedObjectId === a.id
                    ? `${a.color || "#60a5fa"}22`
                    : "transparent",
              }}
              title={a.id}
            >
              {a.type}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAnnotations((prev) => prev.filter((x) => x.id !== a.id));
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
          <span className="minor-text" style={{ fontSize: 10, opacity: 0.85 }}>
            {selectedObject
              ? `${selectedObject.type || selectedObject.kind} | kind=${selectedObject.kind} | ${selectedObjectTfPropsText}`
              : "Select object to inspect live properties"}
          </span>
        </div>
      )}
    </div>
  );
}
