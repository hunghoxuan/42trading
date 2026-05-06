import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useSymbolChartData } from "../../hooks/useChartTileData";
import TradeSignalChart from "../TradeSignalChart";
import { chartFetchManager } from "../../services/chartFetchManager";
import {
  getEffectiveDisplayTimezone,
  showDateTime,
  sortTimeframes,
  asNum,
  formatNumber,
} from "../../utils/format";

const MODES = ["live", "cache", "snapshots"];
const MODE_LABELS = { live: "Live", cache: "Cache", snapshots: "Snapshots" };
const STATUS_COLORS = {
  IDLE: "var(--muted)",
  LOADING: "#f59e0b",
  READY: "#10b981",
  STALE: "#f59e0b",
  ERROR: "#ef4444",
};

function liveTfToTvInterval(tf) {
  const t = String(tf || "").toUpperCase();
  if (t === "W" || t === "1W") return "W";
  if (t === "D" || t === "1D") return "D";
  if (t === "4H") return "240";
  if (t === "1H") return "60";
  if (t === "30M") return "30";
  if (t === "15M") return "15";
  if (t === "5M") return "5";
  if (t === "1M") return "1";
  return t; // fallback to original (D, W, etc)
}
function normSym(s) {
  const raw = String(s || "")
    .trim()
    .toUpperCase();
  if (raw.includes(":")) return raw.split(":").pop().trim().toUpperCase();
  return raw;
}
function timeAgo(ms) {
  if (!ms) return null;
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return Math.floor(diff / 86400000) + "d ago";
}

function toTradingViewTimezone() {
  const effective = getEffectiveDisplayTimezone();
  if (effective === "Local") {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
    } catch {
      return "Etc/UTC";
    }
  }
  return effective;
}

function TfHeader({ tf, context, master, mode, analysisSnapshot }) {
  // Get per-TF data from analysis snapshot when context is missing (skipFetch mode)
  const tfData =
    context ||
    (analysisSnapshot?.timeframes || []).find(
      (x) => String(x?.tf || "").toLowerCase() === String(tf).toLowerCase(),
    ) ||
    {};
  const price = Number(tfData?.last_price);
  const change = Number(tfData?.summary?.close_change_20);
  const previousClose =
    Number.isFinite(price) && Number.isFinite(change) ? price - change : null;
  const pct =
    Number.isFinite(previousClose) && Math.abs(previousClose) > 0
      ? change / previousClose
      : null;

  const pctLabel =
    Number.isFinite(pct) && Math.abs(pct) < 1
      ? `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(2)}%`
      : "";
  const pctColor = Number.isFinite(pct)
    ? pct > 0
      ? "#26a69a"
      : pct < 0
        ? "#ef5350"
        : "var(--muted)"
    : "inherit";

  const cachedAt =
    tfData?.freshness?.updated_time || tfData?.fetched_at || null;

  const trend = tfData?.summary?.trend || "";
  const bias = tfData?.summary?.bias || "";
  const isBullishTrend = String(trend).toLowerCase().includes("bull");
  const isBearishTrend = String(trend).toLowerCase().includes("bear");
  const isLongBias =
    String(bias).toLowerCase().includes("long") ||
    String(bias).toLowerCase().includes("buy");
  const isShortBias =
    String(bias).toLowerCase().includes("short") ||
    String(bias).toLowerCase().includes("sell");

  return (
    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
        marginBottom: 4,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span style={{ fontWeight: 800, color: "var(--foreground)" }}>
        {tf.toUpperCase()}
      </span>
      {trend && (
        <span
          style={{
            fontWeight: 600,
            fontSize: 9,
            color: isBullishTrend
              ? "#26a69a"
              : isBearishTrend
                ? "#ef5350"
                : "inherit",
          }}
        >
          {trend}
        </span>
      )}
      {bias && (
        <span
          style={{
            fontWeight: 800,
            fontSize: 11,
            color: isLongBias ? "#26a69a" : isShortBias ? "#ef5350" : "inherit",
          }}
        >
          {isLongBias ? "↑" : isShortBias ? "↓" : ""}
        </span>
      )}
      {cachedAt && (
        <>
          <span style={{ opacity: 0.3 }}>|</span>
          <span>{`cached ${showDateTime(cachedAt)}`}</span>
        </>
      )}
      {Number.isFinite(price) && (
        <>
          <span style={{ opacity: 0.3 }}>|</span>
          <span style={{ fontWeight: 600, color: "var(--foreground)" }}>
            {price.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </>
      )}
      {pctLabel && (
        <>
          <span style={{ opacity: 0.3 }}>|</span>
          <span style={{ color: pctColor, fontWeight: 700 }}>{pctLabel}</span>
        </>
      )}
      {mode === "snapshots" && master?.snapshots?.[tf.toLowerCase()] && (
        <span style={{ marginLeft: "auto", color: "#10b981", fontSize: 9 }}>
          📷 {master.snapshots[tf.toLowerCase()].file_name || "snap"}
        </span>
      )}
    </div>
  );
}

export function SymbolChart({
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
  skipFetch = false,
}) {
  const rootRef = useRef(null);
  const [mode, setMode] = useState(defaultMode);
  const [pendingMode, setPendingMode] = useState(null); // mode we're loading
  const [lastError, setLastError] = useState(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const cleanSym = useMemo(() => normSym(symbol), [symbol]);
  const defaultGridCols = useMemo(() => {
    const maxCols = Math.max(1, timeframes?.length || 4);
    if (Number.isFinite(Number(initialGridCols)) && Number(initialGridCols) > 0) {
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

  const toggleOverlay = (key) => setOverlays((p) => ({ ...p, [key]: !p[key] }));


  useEffect(() => {
    if (Number.isFinite(Number(initialGridCols)) && Number(initialGridCols) > 0) {
      setGridCols(Number(initialGridCols));
    } else {
      // Default to timeframe count if no master override
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
    });

  const sortedTfs = useMemo(
    () => sortTimeframes(timeframes, "desc"),
    [timeframes],
  );

  // Track per-mode cached time (bars vs snapshots)
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
    // Find latest uploaded_at among all snapshots
    let latest = 0;
    for (const s of Object.values(master?.snapshots || {})) {
      if (s?.uploaded_at && s.uploaded_at > latest) latest = s.uploaded_at;
    }
    return latest || null;
  }, [master]);

  // When loading finishes, either switch to pending mode or record error
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "LOADING" && status !== "LOADING") {
      if (status === "READY" || status === "STALE") {
        // Data loaded — switch to pending mode
        if (pendingMode) {
          setMode(pendingMode);
          setPendingMode(null);
        }
        setLastError(null);
      } else if (status === "ERROR") {
        setLastError(error || "Fetch failed");
        setPendingMode(null);
      }
    }
    prevStatus.current = status;
  }, [status, error, pendingMode]);

  const hasAnyBars = useMemo(
    () =>
      Object.values(master?.bars || {}).some(
        (b) => Array.isArray(b) && b.length > 0,
      ),
    [master],
  );

  const needsFallback =
    mode !== "live" && !skipFetch && !hasAnyBars && status !== "LOADING";

  // Auto-switch to TradePlan mode when hasTradePlan and bars are ready,
  // BUT fall back to live if trade plan has no data.
  useEffect(() => {
    if (hasTradePlan && hasAnyBars) {
      if (hasTradePlan && !entryPrice && !tpPrice && !slPrice) {
        setMode("live");
      } else if (mode === "live") {
        setMode("cache");
      }
    }
  }, [hasTradePlan, hasAnyBars, entryPrice, tpPrice, slPrice]);

  const handleModeClick = useCallback((newMode) => {
    if (newMode === "live") {
      setMode("live");
      setPendingMode(null);
      setLastError(null);
      return;
    }
    // Just set pending — hook detects mode change, checks cache, fetches if needed
    setPendingMode(newMode);
    setLastError(null);
  }, []);

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

  return (
    <div
      ref={rootRef}
      className="browser-card-v1"
      style={{ position: "relative", width: "100%" }}
    >
      {/* ── Header ── */}
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
          {/* Status inline */}
          {(pendingMode || mode) === "snapshots" &&
            snapshotState?.message &&
            snapshotState.stage !== "idle" && (
              <span
                className="minor-text"
                style={{
                  fontSize: 9,
                  color:
                    snapshotState.stage === "error" ? "#ef4444" : "#f59e0b",
                }}
              >
                {snapshotState.message}
              </span>
            )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {hasTradePlan ? (
            <>
              <button
                className="secondary-button"
                onClick={() => setMode("live")}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: 4,
                  color: mode === "live" ? "#10b981" : "var(--muted)",
                  borderColor: mode === "live" ? "#10b98160" : "var(--border)",
                }}
              >
                Live
              </button>
              <button
                className="primary-button"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: 4,
                }}
                onClick={() => setMode("cache")}
              >
                TradePlan
              </button>
              {/* Overlay toggles for TradePlan chart */}
              <span style={{ opacity: 0.3, fontSize: 8, margin: "0 2px" }}>
                |
              </span>
              {overlayButtons.map(({ key, label }) => (
                <button
                  key={key}
                  className={overlays[key] ? "primary-button" : "secondary-button"}
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
          ) : (
            MODES.map((m) => (
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
                {(pendingMode || mode) === m &&
                  status === "LOADING" &&
                  " \u23F3"}
              </button>
            ))
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
            }}
            onClick={() => {
              if (mode === "live") return;
              const fresh = chartFetchManager.isFresh(cleanSym, 60000);
              refresh({ force: !fresh });
            }}
            disabled={status === "LOADING" || mode === "live"}
            title="Refresh"
          >
            {status === "LOADING" ? "\u23F3" : "\u21BB"}
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

      {/* ── Charts row ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gap: 8,
        }}
      >
        {sortedTfs.map((tf) => {
          const isLive = mode === "live" || needsFallback;
          const context = master?.context?.[tf.toLowerCase()];
          const chartId = `${cleanSym}-${String(tf).toLowerCase()}`;

          return (
            <div key={`${mode}-${tf}`} style={{ minWidth: 0 }}>
              <TfHeader
                tf={tf}
                context={context}
                master={master}
                mode={mode}
                analysisSnapshot={analysisSnapshot}
              />
              {isLive ? (
                <iframe
                  key={`tv-${symbol}-${tf}-${liveKey}`}
                  title={`tv-${symbol}-${tf}`}
                  className="browser-chart-v1"
                  style={{ height: chartHeight }}
                  src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(cleanSym)}&interval=${encodeURIComponent(liveTfToTvInterval(tf))}&theme=dark&style=1&locale=en&toolbarbg=%230f1729&hide_top_toolbar=1&hide_legend=1&saveimage=0&timezone=${encodeURIComponent(tvTimezone)}`}
                />
              ) : (
                <TradeSignalChart
                  key={`tsc-${symbol}-${tf}`}
                  chartId={chartId}
                  symbol={cleanSym}
                  interval={tf}
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
                  syncedCrosshair={syncedCrosshair}
                  onCrosshairSync={setSyncedCrosshair}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Error display */}
      {(lastError || error) && (
        <div style={{ marginTop: 4, fontSize: 9, color: "#ef4444" }}>
          {lastError || error}
        </div>
      )}
    </div>
  );
}
