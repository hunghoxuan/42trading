import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useSymbolChartData } from "../../hooks/useChartTileData";
import TradeSignalChart from "../TradeSignalChart";
import { chartFetchManager } from "../../services/chartFetchManager";
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

function TfHeader({
  tf,
  context,
  master,
  mode,
  analysisSnapshot,
  barsStatus,
  snapshotStatus,
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
          }}
          title={`cached: ${showDateTime(context?.cached_at)} | source: ${cacheSourceLabel}`}
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

  const { status, master, error, cachedAt, refresh, liveKey, snapshotState } =
    useSymbolChartData({
      symbol: cleanSym,
      timeframes,
      mode: pendingMode || mode,
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

  const handleModeClick = useCallback((newMode) => {
    if (newMode === "live") {
      setMode("live");
      setPendingMode(null);
      setLastError(null);
      return;
    }
    // Re-click same mode: force refresh
    if (mode === newMode && !pendingMode && status !== "LOADING") {
      refresh({ force: false });
      return;
    }
    // Switch immediately so user sees mode change right away, then fetch.
    setMode(newMode);
    setPendingMode(null);
    setLastError(null);
  }, [mode, pendingMode, status, refresh]);

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
      setAnnotations((prev) =>
        prev.map((a) => {
          if (a.id !== d.id) return a;
          if (a.kind === "line") return { ...a, yRatio: yr };
          if (a.kind === "point") return { ...a, xRatio: xr, yRatio: yr };
          if (a.kind === "zone") {
            if (d.edge === "top") return { ...a, y1Ratio: yr };
            if (d.edge === "bottom") return { ...a, y2Ratio: yr };
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

  const handleDrawLine = useCallback(() => {
    if (!ctxMenu || !Number.isFinite(Number(ctxMenu.yRatio))) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setAnnotations((prev) => [
      ...prev,
      { id, kind: "line", type: "LINE", color: "#60a5fa", yRatio: Number(ctxMenu.yRatio) },
    ]);
    setCtxMenu(null);
  }, [ctxMenu]);

  const addObject = useCallback(
    (type, color, kind = "line") => {
      if (!ctxMenu) return;
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (kind === "point") {
        setAnnotations((prev) => [
          ...prev,
          {
            id,
            kind: "point",
            type,
            color,
            xRatio: Number(ctxMenu.xRatio || 0.5),
            yRatio: Number(ctxMenu.yRatio || 0.5),
          },
        ]);
      } else if (kind === "zone") {
        setDrawMode("zone");
      } else {
        setAnnotations((prev) => [
          ...prev,
          {
            id,
            kind: "line",
            type,
            color,
            yRatio: Number(ctxMenu.yRatio || 0.5),
          },
        ]);
      }
      setCtxMenu(null);
    },
    [ctxMenu],
  );

  const handleQuickTrade = useCallback(
    (side) => {
      if (!ctxMenu || !Number.isFinite(Number(ctxMenu.price))) return;
      const payload = {
        symbol: cleanSym,
        side: String(side || "BUY").toUpperCase(),
        price: Number(ctxMenu.price),
        time: ctxMenu.time || null,
        interval: ctxMenu.interval || null,
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
              disabled={status === "LOADING"}
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
          const hasBars = status !== "LOADING" && (master?.bars?.[tf.toLowerCase()] || []).length > 0;
          const noData = !isLive && !hasBars && status !== "LOADING";

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
                  historicalData={master?.bars?.[tf.toLowerCase()] || []}
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
                  />
                {mode === "cache" && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 25,
                      pointerEvents: drawMode === "zone" ? "auto" : "none",
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
                            },
                          ]);
                          setDrawMode(null);
                          window.removeEventListener("mouseup", onUp);
                        };
                        window.addEventListener("mouseup", onUp);
                        evt.preventDefault();
                        return;
                      }
                      const hit = (annotations || [])
                        .map((a) => {
                          if (a.kind === "line") {
                            const ay = Number(a.yRatio) * rect.height;
                            return { a, d: Math.abs(ay - y), edge: null };
                          }
                          if (a.kind === "point") {
                            const ax = Number(a.xRatio) * rect.width;
                            const ay = Number(a.yRatio) * rect.height;
                            return { a, d: Math.hypot(ax - x, ay - y), edge: null };
                          }
                          if (a.kind === "zone") {
                            const y1 = Number(a.y1Ratio) * rect.height;
                            const y2 = Number(a.y2Ratio) * rect.height;
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
                        dragRef.current = { id: hit.a.id, edge: hit.edge, rect };
                        evt.preventDefault();
                      }
                    }}
                  >
                    {(annotations || []).map((a) => {
                      if (a.kind === "line") {
                        return (
                          <div
                            key={a.id}
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              top: `${Number(a.yRatio || 0.5) * 100}%`,
                              borderTop: `1px dashed ${a.color || "#60a5fa"}`,
                              pointerEvents: "none",
                              zIndex: 26,
                            }}
                          />
                        );
                      }
                      if (a.kind === "point") {
                        return (
                          <div
                            key={a.id}
                            style={{
                              position: "absolute",
                              left: `${Number(a.xRatio || 0.5) * 100}%`,
                              top: `${Number(a.yRatio || 0.5) * 100}%`,
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: a.color || "#eab308",
                              transform: "translate(-50%, -50%)",
                              pointerEvents: "none",
                              zIndex: 26,
                            }}
                          />
                        );
                      }
                      if (a.kind === "zone") {
                        const y1 = Number(a.y1Ratio || 0.4);
                        const y2 = Number(a.y2Ratio || 0.6);
                        const x1 = Number(a.x1Ratio || 0.2);
                        const x2 = Number(a.x2Ratio || 0.8);
                        return (
                          <div
                            key={a.id}
                            style={{
                              position: "absolute",
                              left: `${Math.min(x1, x2) * 100}%`,
                              top: `${Math.min(y1, y2) * 100}%`,
                              width: `${Math.abs(x2 - x1) * 100}%`,
                              height: `${Math.abs(y2 - y1) * 100}%`,
                              border: `1px solid ${a.color || "#22c55e"}`,
                              background: `${a.color || "#22c55e"}22`,
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
            onClick={() => setAnnotations([])}
            style={{ fontSize: 10, padding: "2px 6px" }}
          >
            Remove All
          </button>
          {annotations.map((a) => (
            <span
              key={a.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${a.color || "var(--border)"}`,
                color: a.color || "var(--foreground)",
                borderRadius: 12,
                padding: "2px 8px",
                fontSize: 10,
              }}
            >
              {a.type}
              <button
                type="button"
                onClick={() =>
                  setAnnotations((prev) => prev.filter((x) => x.id !== a.id))
                }
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
        </div>
      )}
    </div>
  );
}
