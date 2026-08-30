import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { chartFetchManager } from "../services/chartFetchManager";
import { api } from "../../../app/api";
import {
  chartStreamStore,
  realtimeClient,
  realtimeTransport,
} from "../realtime/realtimeClientSingleton";
import {
  mergeHistoricalBarsIntoTfData,
  mergeRealtimeBarsIntoTfData,
} from "../../../shared/utils/symbolChartStreaming";
import {
  normalizeHybridArtifacts,
  normalizeHybridTradePlans,
} from "../chartArtifacts/clientChartAnalysis.js";

const DEFAULT_BARS_COUNT = 2000;
const MAX_CHART_HISTORY_BARS = 20000;
const BROKER_HISTORY_PAGE_SIZE = 5000;
const DEFAULT_TIMEFRAMES = Object.freeze(["D", "4H", "15M", "5M"]);
const EMPTY_ATTACHED_SNAPSHOT_FILES = Object.freeze([]);

function tfNorm(tf) {
  return String(tf || "")
    .toLowerCase()
    .trim();
}
function tfSnapshotTokens(tf) {
  const t = tfNorm(tf);
  if (t === "d" || t === "1d" || t === "1day") return ["d", "1d", "day"];
  if (t === "4h" || t === "240") return ["4h", "240"];
  if (t === "1h" || t === "60") return ["1h", "60"];
  if (t === "15m" || t === "15") return ["15m", "15"];
  if (t === "5m" || t === "5") return ["5m", "5"];
  return [t];
}
function normalizeSnapshotTf(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase();
  if (!t) return "";
  if (["d", "1d", "1day", "day"].includes(t)) return "d";
  if (["4h", "240"].includes(t)) return "4h";
  if (["1h", "60"].includes(t)) return "1h";
  if (["15m", "15", "15min"].includes(t)) return "15m";
  if (["5m", "5", "5min"].includes(t)) return "5m";
  return t;
}
function inferTfFromFileName(fileName = "") {
  const f = String(fileName || "").toLowerCase();
  if (/(^|[_-])(d|1d|day)([_-]|$)/.test(f)) return "d";
  if (/(^|[_-])(4h|240)([_-]|$)/.test(f)) return "4h";
  if (/(^|[_-])(1h|60)([_-]|$)/.test(f)) return "1h";
  if (/(^|[_-])(15m|15)([_-]|$)/.test(f)) return "15m";
  if (/(^|[_-])(5m|5)([_-]|$)/.test(f)) return "5m";
  return "";
}
function normSym(s) {
  const r = String(s || "")
    .trim()
    .toUpperCase();
  return r.includes(":") ? r.split(":").pop().trim().toUpperCase() : r;
}
function symAliases(sym) {
  const s = normSym(sym);
  const out = new Set([s]);
  if (s.endsWith("USD")) out.add(`${s.slice(0, -3)}USDT`);
  if (s.endsWith("USDT")) out.add(`${s.slice(0, -4)}USD`);
  return [...out];
}

export function buildRealtimeChartTopic(symbol, timeframe) {
  const sym = normSym(symbol);
  return sym ? `chart:${sym}` : "";
}

function buildHistoryTrackingTopic(symbol, timeframe, endTimeSec = null) {
  const sym = normSym(symbol);
  const tf = tfNorm(timeframe);
  const baseTopic = sym && tf ? `chart-history:${sym}:${tf}` : "";
  const anchorSec =
    Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0
      ? Math.floor(Number(endTimeSec))
      : null;
  if (!baseTopic || !anchorSec) return baseTopic;
  return `${baseTopic}:anchor:${anchorSec}`;
}

function isChartHistoryDebugEnabled() {
  if (typeof window === "undefined") return false;
  if (window.__chartHistoryDebug === true) return true;
  try {
    return String(window.localStorage?.getItem("chart_history_debug") || "").trim() === "1";
  } catch {
    return false;
  }
}

function debugChartHistory(event, payload = {}) {
  if (!isChartHistoryDebugEnabled()) return;
  try {
    console.debug(`[chart-history] ${event}`, payload);
  } catch {
    // ignore console failures
  }
}

function formatHistoryTimeSec(value) {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  try {
    return new Date(sec * 1000).toISOString();
  } catch {
    return null;
  }
}

function logHistoryConsole(event, payload = {}) {
  if (!isChartHistoryDebugEnabled()) return;
  try {
    console.info(`[chart-history] ${event}`, payload);
  } catch {
    // ignore console failures
  }
}

function toStreamSnapshot(tfData = {}) {
  return {
    bars: Array.isArray(tfData?.bars) ? tfData.bars : [],
    lastPrice:
      Number(tfData?.last_price) ||
      Number(tfData?.bars?.[tfData?.bars?.length - 1]?.close) ||
      null,
    metadata: tfData?.metadata && typeof tfData.metadata === "object" ? tfData.metadata : null,
    range: {
      startSec: Number(tfData?.bar_start || tfData?.bars?.[0]?.time || 0) || 0,
      endSec:
        Number(
          tfData?.bar_end ||
            tfData?.bars?.[tfData?.bars?.length - 1]?.time ||
            0,
        ) || 0,
    },
  };
}

function tfRankMinutes(tf) {
  const t = tfNorm(tf);
  if (t === "1m" || t === "1min") return 1;
  if (t === "5m" || t === "5min") return 5;
  if (t === "15m" || t === "15min") return 15;
  if (t === "1h" || t === "60") return 60;
  if (t === "4h" || t === "240") return 240;
  if (t === "d" || t === "1d" || t === "day") return 1440;
  if (t === "w" || t === "1w" || t === "week") return 10080;
  if (t === "mn" || t === "1mn" || t === "1month") return 43200;
  return Number.MAX_SAFE_INTEGER;
}

function normalizeBrokerHistoryBars(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((bar) => ({
      time: Number(bar?.t ?? bar?.time),
      open: Number(bar?.o ?? bar?.open),
      high: Number(bar?.h ?? bar?.high),
      low: Number(bar?.l ?? bar?.low),
      close: Number(bar?.c ?? bar?.close),
      volume: Number(bar?.v ?? bar?.volume ?? 0),
    }))
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close),
    )
    .sort((left, right) => left.time - right.time);
}

function normalizeServerCoverage(source = {}, tf = "", bars = []) {
  const startFromBars = Number(bars?.[0]?.time || 0) || null;
  const endFromBars = Number(bars?.[bars.length - 1]?.time || 0) || null;
  return {
    timeframe: tfNorm(source?.timeframe || source?.tf || tf),
    start_bar:
      Number(source?.coverage?.start_bar ?? source?.start_bar ?? source?.bar_start) ||
      startFromBars,
    end_bar:
      Number(source?.coverage?.end_bar ?? source?.end_bar ?? source?.bar_end) ||
      endFromBars,
  };
}

function extractServerArtifacts(source = {}, tf = "", bars = []) {
  const rawItems = Array.isArray(source?.artifacts)
    ? source.artifacts
    : Array.isArray(source?.artifact_items)
      ? source.artifact_items
      : Array.isArray(source?.items)
        ? source.items
      : [];
  return normalizeHybridArtifacts(
    rawItems,
    tf,
    normalizeServerCoverage(source, tf, bars),
  );
}

function extractServerTradePlans(source = {}, tf = "", bars = []) {
  const rawPlans = Array.isArray(source?.trade_plans)
    ? source.trade_plans
    : Array.isArray(source?.tradePlans)
      ? source.tradePlans
      : Array.isArray(source?.trade_plan)
        ? source.trade_plan
        : source?.trade_plan &&
            typeof source.trade_plan === "object" &&
            !Array.isArray(source.trade_plan)
          ? [source.trade_plan]
          : [];
  return normalizeHybridTradePlans(
    rawPlans,
    tf,
    normalizeServerCoverage(source, tf, bars),
  );
}

const BARS_BY_PROFILE = {
  position: { d: 300, "4h": 500, "1h": 800, "15m": 0, "5m": 0, "1m": 0 },
  swing:    { d: 250, "4h": 400, "1h": 640, "15m": 720, "5m": 0, "1m": 0 },
  day:      { d: 200, "4h": 360, "1h": 600, "15m": 720, "5m": 900, "1m": 0 },
  scalp:    { d: 60,  "4h": 240, "1h": 480, "15m": 600, "5m": 720, "1m": 900 },
};

function barsForTf(tf, barsCount, profile = "day") {
  const n = Number(barsCount);
  // Explicit bars count (non-zero, non-default) → use directly
  if (Number.isFinite(n) && n > 0) {
    return Math.max(50, Math.min(MAX_CHART_HISTORY_BARS, Math.round(n)));
  }
  // Default (0 or invalid) → use profile-based counts
  const t = String(tf || "").toLowerCase();
  let key = t;
  if (t === "1d" || t === "day") key = "d";
  else if (t === "240" || t === "4hour") key = "4h";
  else if (t === "60" || t === "1hour") key = "1h";
  else if (t === "15" || t === "15min") key = "15m";
  else if (t === "5" || t === "5min") key = "5m";
  else if (t === "1" || t === "1min") key = "1m";
  const p = BARS_BY_PROFILE[profile] || BARS_BY_PROFILE.day;
  return p[key] || 300;
}

function alignLatestPriceAcrossTf(entries = {}, tfs = []) {
  const keys = [...new Set((tfs || []).map(tfNorm).filter(Boolean))];
  const sorted = keys.sort((a, b) => tfRankMinutes(a) - tfRankMinutes(b));
  let latest = null;
  for (const tf of sorted) {
    const bars = Array.isArray(entries?.[tf]?.bars) ? entries[tf].bars : [];
    if (!bars.length) continue;
    const last = bars[bars.length - 1] || {};
    const close = Number(last.close);
    if (Number.isFinite(close)) {
      latest = { price: close, tf };
      break;
    }
  }
  if (!latest) return entries;
  const out = { ...entries };
  for (const tf of sorted) {
    if (tfRankMinutes(tf) <= tfRankMinutes(latest.tf)) continue;
    const cur = out[tf];
    const bars = Array.isArray(cur?.bars) ? [...cur.bars] : [];
    if (!bars.length) continue;
    const i = bars.length - 1;
    const b = { ...(bars[i] || {}) };
    const h = Number(b.high);
    const l = Number(b.low);
    b.close = latest.price;
    if (Number.isFinite(h)) b.high = Math.max(h, latest.price);
    if (Number.isFinite(l)) b.low = Math.min(l, latest.price);
    bars[i] = b;
    out[tf] = {
      ...cur,
      bars,
      last_price: latest.price,
      cache_source: cur?.cache_source || "memory",
      synthetic_recent: { source_tf: latest.tf, close: latest.price },
    };
  }
  return out;
}

function applyStreamLifecycleState(topic, error = null) {
  const errorType = String(error?.type || "").trim().toLowerCase();
  if (errorType === "disconnect") {
    chartStreamStore.setDisconnected(
      topic,
      error?.message || error?.reason || "Realtime socket disconnected",
    );
    return;
  }
  if (error) {
    chartStreamStore.setError(topic, error?.message || error);
    return;
  }
  chartStreamStore.setDisconnected(topic, "");
}

export function useSymbolChartData({
  symbol,
  timeframes = DEFAULT_TIMEFRAMES,
  mode = "fixed",
  liveBars = true,
  barsCount = DEFAULT_BARS_COUNT,
  barsCountByTf = null,
  forceRefresh = false,
  skipFetch = false,
  provider = "ICMARKETS",
  sessionPrefix = "",
  profile = "day",
  attachedSnapshotFiles = EMPTY_ATTACHED_SNAPSHOT_FILES,
  tradeSid = "",
  endTimeSec = null,
}) {
  const [, setStreamVersion] = useState(0);
  const [status, setStatus] = useState("IDLE");
  const [data, setData] = useState({}); // { "4h": { bars, snapshot, created_at }, ... }
  const [error, setError] = useState(null);
  const [liveKey, setLiveKey] = useState(0);
  const [snapMsg, setSnapMsg] = useState("");
  const mountedRef = useRef(true);
  const lastChartDataRef = useRef({});
  const sym = useMemo(() => normSym(symbol), [symbol]);
  const tfsKey = useMemo(
    () =>
      [...new Set((Array.isArray(timeframes) ? timeframes : []).map(tfNorm).filter(Boolean))].join(
        "|",
      ),
    [timeframes],
  );
  const tfs = useMemo(
    () => (tfsKey ? tfsKey.split("|") : []),
    [tfsKey],
  );
  const normalizedBarsCountByTf = useMemo(() => {
    if (!barsCountByTf || typeof barsCountByTf !== "object") return {};
    const out = {};
    for (const [tfRaw, valueRaw] of Object.entries(barsCountByTf)) {
      const key = tfNorm(tfRaw);
      const value = Number(valueRaw);
      if (!key || !Number.isFinite(value) || value <= 0) continue;
      out[key] = Math.max(50, Math.min(MAX_CHART_HISTORY_BARS, Math.round(value)));
    }
    return out;
  }, [barsCountByTf]);
  const loadBrokerHistoryWindow = useCallback(
    async (tf, totalBars, endTimeSecValue = null) => {
      const tfKey = tfNorm(tf);
      const targetBars = Math.max(
        50,
        Math.min(MAX_CHART_HISTORY_BARS, Math.round(Number(totalBars) || 0)),
      );
      const tfSeconds = Math.max(60, tfRankMinutes(tfKey) * 60 || 60);
      const dedup = new Map();
      let cursorEndTimeSec =
        Number.isFinite(Number(endTimeSecValue)) && Number(endTimeSecValue) > 0
          ? Math.floor(Number(endTimeSecValue))
          : null;
      let metadata = null;
      let source = "broker_history_paged";
      let exhausted = false;

      while (dedup.size < targetBars) {
        const remaining = targetBars - dedup.size;
        const limit = Math.max(1, Math.min(BROKER_HISTORY_PAGE_SIZE, remaining));
        const response = await api.brokerBars(sym, tfKey, limit, cursorEndTimeSec);
        const bars = normalizeBrokerHistoryBars(response?.bars);
        if (
          response?.metadata &&
          typeof response.metadata === "object" &&
          !Array.isArray(response.metadata)
        ) {
          metadata = { ...(metadata || {}), ...response.metadata };
        }
        if (response?.source) source = String(response.source || source);
        if (!bars.length) {
          exhausted = true;
          break;
        }
        for (const bar of bars) {
          dedup.set(bar.time, bar);
        }
        if (bars.length < limit) {
          exhausted = true;
          break;
        }
        const earliest = Number(bars[0]?.time || 0);
        if (!Number.isFinite(earliest) || earliest <= tfSeconds) {
          exhausted = true;
          break;
        }
        cursorEndTimeSec = earliest - tfSeconds;
      }

      const mergedBars = [...dedup.values()].sort((left, right) => left.time - right.time);
      return {
        out: {
          source,
          cached_at: Date.now(),
        },
        snap: {
          bars: mergedBars,
          bar_start: mergedBars[0]?.time || null,
          bar_end: mergedBars[mergedBars.length - 1]?.time || null,
          last_price: mergedBars.length
            ? Number(mergedBars[mergedBars.length - 1]?.close)
            : null,
          metadata: {
            ...(metadata || {}),
            loaded_bars: mergedBars.length,
            history_exhausted:
              metadata?.history_exhausted === true ? true : exhausted,
          },
        },
      };
    },
    [sym],
  );

  const fetchAll = useCallback(
    async (opts = {}) => {
      if (!sym) throw new Error("Symbol required");
      const entries = {};
      const force = opts.force === true;

      if (mode === "snapshots") {
        // Snapshot mode is a viewer. Capture is explicit via the Snapshots button.
        const snapshotMaxAgeMs = 15 * 60 * 1000;
        let apiItems = [];
        let apiCachedItems = [];
        let apiCreatedItems = [];
        if (tradeSid) {
          const listedTrade = await api.tradeSnapshots(tradeSid);
          apiItems = Array.isArray(listedTrade?.items)
            ? listedTrade.items
            : [];
        } else {
          const listed = await api.chartSnapshots(200);
          apiItems = Array.isArray(listed?.items) ? listed.items : [];
        }
        // Keep sid-attached snapshot files visible too (signal/trade context)
        const attachedItems = (
          Array.isArray(attachedSnapshotFiles) ? attachedSnapshotFiles : []
        )
          .map((file) => String(file || "").trim())
          .filter(Boolean)
          .map((file) => ({
            file_name: file,
            url: tradeSid
              ? `/api/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(file)}/content`
              : `/api/chart/snapshots/${encodeURIComponent(file)}`,
            attached: true,
          }));
        const items = [...apiItems, ...attachedItems];
        const createdByName = new Set(
          apiCreatedItems
            .map((x) => String(x?.file_name || ""))
            .filter(Boolean),
        );
        const cachedByName = new Set(
          apiCachedItems
            .map((x) => String(x?.file_name || ""))
            .filter(Boolean),
        );
        // Filter by symbol
        const symbolTokens = symAliases(sym);
        const matchingItems = items.filter((x) => {
          const f = String(x?.file_name || "").toUpperCase();
          return symbolTokens.some((tok) => f.includes(tok));
        });
        const usedFiles = new Set();
        for (const tf of tfs) {
          const key = tfNorm(tf);
          const tfWanted = normalizeSnapshotTf(tf);
          let found = matchingItems.find((x) => {
            if (usedFiles.has(String(x?.file_name || ""))) return false;
            const tfApi = normalizeSnapshotTf(x?.timeframe || x?.tf);
            const tfFile = inferTfFromFileName(x?.file_name || "");
            return tfApi === tfWanted || tfFile === tfWanted;
          });
          if (!found) {
            const tfTokens = tfSnapshotTokens(tf);
            found = matchingItems.find((x) => {
              if (usedFiles.has(String(x?.file_name || ""))) return false;
              const f = String(x?.file_name || "").toLowerCase();
              return tfTokens.some((token) =>
                f.includes(`_${token.toLowerCase()}_`),
              );
            });
          }
          // Fallback: If no individual TF snapshot, check if we have a master grid snapshot
          if (!found) {
            found = matchingItems.find((x) => {
              const f = String(x?.file_name || "").toUpperCase();
              return x.master === true || f.includes("_MASTER");
            });
            // Don't mark master as 'usedFiles' so it can be reused for other TFs if needed,
            // though ideally the frontend should render it once.
          }
          entries[key] = {
            bars: [],
            snapshot: found
              ? {
                  file_name: found.file_name,
                  file_path: found.url || found.file_path,
                  lookback_bars: found.lookback_bars || null,
                  url:
                    found.url ||
                    `/api/chart/snapshots/${encodeURIComponent(found.file_name || "")}`,
                  reused:
                    cachedByName.has(String(found.file_name || "")) ||
                    found.reused === true,
                  is_new:
                    createdByName.has(String(found.file_name || "")) &&
                    found.reused !== true,
                  mtime_ms: found.created_at
                    ? new Date(found.created_at).getTime()
                    : Date.now(),
                  expires_at_ms: found.created_at
                    ? new Date(found.created_at).getTime() + snapshotMaxAgeMs
                    : Date.now() + snapshotMaxAgeMs,
                }
              : null,
          };
          if (found) {
            usedFiles.add(String(found.file_name || ""));
          }
        }
      } else {
        // Cache mode: fetch bars per TF via Twelve Data (parallel)
        const hasAnchoredEndTime =
          Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0;
        const requestMetaByTf = new Map(
          tfs.map((tf) => {
            const key = tfNorm(tf);
            const requestedBars =
              normalizedBarsCountByTf[key] || barsForTf(tf, barsCount, profile);
            return [key, { tf, key, requestedBars }];
          }),
        );
        let forcedBatchCandlesByTf = new Map();
        if (force && tfs.length > 1 && !hasAnchoredEndTime) {
          forcedBatchCandlesByTf = new Map(
            (
              await Promise.all(
                tfs.map(async (tf) => {
                  const key = tfNorm(tf);
                  const requestedBars =
                    requestMetaByTf.get(key)?.requestedBars ||
                    barsForTf(tf, barsCount, profile);
                  try {
                    const response = await api.chartCandles(
                      sym,
                      tf,
                      requestedBars,
                      true,
                      tradeSid,
                      "latest",
                      hasAnchoredEndTime ? endTimeSec : null,
                    );
                    return [key, { ...response, timeframe: tf, tf }];
                  } catch {
                    return null;
                  }
                }),
              )
            ).filter(Boolean),
          );
        }
        let anchoredBrokerBarsByTf = new Map();
        if (hasAnchoredEndTime && tfs.length > 1) {
          anchoredBrokerBarsByTf = new Map(
            (
              await Promise.all(
                tfs.map(async (tf) => {
                  const key = tfNorm(tf);
                  const requestedBars =
                    requestMetaByTf.get(key)?.requestedBars ||
                    barsForTf(tf, barsCount, profile);
                  try {
                    const response = await api.brokerBars(
                      sym,
                      tf,
                      requestedBars,
                      Number(endTimeSec),
                    );
                    return [key, { ...response, timeframe: tf, tf }];
                  } catch {
                    return null;
                  }
                }),
              )
            ).filter(Boolean),
          );
        }
        const results = await Promise.allSettled(
          tfs.map(async (tf) => {
            const key = tfNorm(tf);
            try {
              if (!force && !hasAnchoredEndTime) {
                const local = chartFetchManager.get(sym, tf);
                if (local?.bars?.length && local.stale !== true) {
                  return {
                    key,
                    data: {
                      bars: Array.isArray(local.bars) ? local.bars : [],
                      bar_start: local?.bar_start || local?.bars?.[0]?.time,
                      bar_end:
                        local?.bar_end ||
                        local?.bars?.[local?.bars?.length - 1]?.time,
                      last_price: local?.last_price ?? null,
                      provider: local?.provider || null,
                      indicators:
                        local?.indicators && typeof local.indicators === "object"
                          ? local.indicators
                          : null,
                      metadata:
                        local?.metadata && typeof local.metadata === "object"
                          ? local.metadata
                          : null,
                      cache_source: local?.cache_source || "memory",
                      cached_at: local?.cached_at || local?.created_at || null,
                      reason: local?.reason || "",
                    },
                  };
                }
              }
              const requestedBars =
                requestMetaByTf.get(key)?.requestedBars ||
                normalizedBarsCountByTf[key] ||
                barsForTf(tf, barsCount, profile);
              let out = null;
              let snap = null;
              const forcedBatchItem = forcedBatchCandlesByTf.get(key) || null;
              const anchoredBrokerBatchItem = anchoredBrokerBarsByTf.get(key) || null;
              if (hasAnchoredEndTime) {
                out =
                  anchoredBrokerBatchItem?.ok === true
                    ? anchoredBrokerBatchItem
                    : await api.brokerBars(sym, tf, requestedBars, endTimeSec);
                const normalizedBars = Array.isArray(out?.bars)
                  ? out.bars.map((bar) => ({
                      time: Number(bar?.t ?? bar?.time),
                      open: Number(bar?.o ?? bar?.open),
                      high: Number(bar?.h ?? bar?.high),
                      low: Number(bar?.l ?? bar?.low),
                      close: Number(bar?.c ?? bar?.close),
                      volume: Number(bar?.v ?? bar?.volume ?? 0),
                    }))
                  : [];
                snap = {
                  bars: normalizedBars,
                  bar_start: normalizedBars[0]?.time || null,
                  bar_end: normalizedBars[normalizedBars.length - 1]?.time || null,
                  last_price: normalizedBars.length
                    ? Number(normalizedBars[normalizedBars.length - 1]?.close)
                    : null,
                  metadata:
                    out?.metadata && typeof out.metadata === "object"
                      ? out.metadata
                      : null,
                };
                out = {
                  ...out,
                  source: out?.source || "broker_bars_anchored",
                  cached_at: out?.cached_at || Date.now(),
                };
                if (forcedBatchItem?.ok && forcedBatchItem?.snapshot) {
                  out = forcedBatchItem;
                  snap = forcedBatchItem.snapshot;
                }
              } else {
                if (force && !forcedBatchItem) {
                  Promise.resolve(
                    api.chartCandles(
                      sym,
                      tf,
                      requestedBars,
                      true,
                      tradeSid,
                    ),
                  ).catch(() => null);
                }
                try {
                  out = await api.realtimeChartBootstrap(sym, tf, requestedBars);
                  snap =
                    out?.snapshot && typeof out.snapshot === "object"
                      ? out.snapshot
                      : null;
                  if (Array.isArray(snap?.bars) && snap.bars.length > 0) {
                    out = {
                      ...out,
                      source: "realtime_bootstrap",
                      cached_at: Date.now(),
                    };
                  } else {
                    snap = null;
                  }
                } catch {
                  out = null;
                  snap = null;
                }
                if (!Array.isArray(snap?.bars) || snap.bars.length === 0) {
                  try {
                    out = await api.brokerBars(sym, tf, requestedBars, null);
                    const normalizedBars = normalizeBrokerHistoryBars(out?.bars);
                    if (normalizedBars.length > 0) {
                      snap = {
                        bars: normalizedBars,
                        bar_start: normalizedBars[0]?.time || null,
                        bar_end: normalizedBars[normalizedBars.length - 1]?.time || null,
                        last_price: Number(
                          normalizedBars[normalizedBars.length - 1]?.close,
                        ) || null,
                        metadata:
                          out?.metadata && typeof out.metadata === "object"
                            ? out.metadata
                            : null,
                      };
                      out = {
                        ...out,
                        source: out?.source || "broker_bars_latest",
                        cached_at: out?.cached_at || Date.now(),
                      };
                    }
                  } catch {
                    out = null;
                    snap = null;
                  }
                }
                if (!Array.isArray(snap?.bars) || snap.bars.length === 0) {
                  if (forcedBatchItem?.ok && forcedBatchItem?.snapshot) {
                    out = forcedBatchItem;
                    snap = forcedBatchItem.snapshot;
                  } else {
                    out = await api.chartCandles(
                      sym,
                      tf,
                      requestedBars,
                      false,
                      tradeSid,
                    );
                    snap =
                      out?.snapshot && typeof out.snapshot === "object"
                        ? out.snapshot
                        : null;
                  }
                }
              }
              const tfData = {
                bars: Array.isArray(snap?.bars) ? snap.bars : [],
                bar_start: snap?.bar_start || snap?.bars?.[0]?.time,
                bar_end: snap?.bar_end || snap?.bars?.[snap?.bars?.length - 1]?.time,
                last_price: snap?.last_price ?? null,
                provider: snap?.provider || null,
                indicators:
                  snap?.indicators && typeof snap.indicators === "object"
                    ? snap.indicators
                    : null,
                metadata:
                  snap?.metadata && typeof snap.metadata === "object"
                    ? snap.metadata
                    : null,
                cache_source: out?.source || "remote_api",
                cached_at: snap?.cached_at || out?.cached_at || Date.now(),
                reason:
                  out?.cache_debug && typeof out.cache_debug === "object"
                    ? `redis=${out.cache_debug.redis_key || "-"} ttl=${out.cache_debug.ttl_sec || "-"}s tf=${out.cache_debug.timeframe_normalized || "-"} api=${out.cache_debug.binance_interval || "-"}`
                    : hasAnchoredEndTime
                      ? `anchored<=${Number(endTimeSec)}`
                      : "",
              };
              // Candles and shared artifacts are separate API resources. Load the
              // cTrader snapshot here so SymbolChart can render the canonical events.
              let sharedArtifacts = null;
              try {
                sharedArtifacts = await api.loadMarketChartArtifacts(
                  sym,
                  tf,
                  tfData.bar_start,
                  tfData.bar_end,
                );
              } catch {
                sharedArtifacts = null;
              }
              const sharedArtifactEnvelope =
                sharedArtifacts?.artifacts &&
                typeof sharedArtifacts.artifacts === "object"
                  ? sharedArtifacts.artifacts
                  : null;
              tfData.server_artifacts = extractServerArtifacts(
                sharedArtifactEnvelope || out,
                tf,
                tfData.bars,
              );
              if (!tfData.server_artifacts.length) {
                tfData.server_artifacts = extractServerArtifacts(snap, tf, tfData.bars);
              }
              tfData.server_trade_plans = extractServerTradePlans(out, tf, tfData.bars);
              if (!tfData.server_trade_plans.length) {
                tfData.server_trade_plans = extractServerTradePlans(snap, tf, tfData.bars);
              }
              tfData.server_coverage = normalizeServerCoverage(out, tf, tfData.bars);
              if (tfData.bars.length > 0) {
                chartStreamStore.setBootstrap(
                  buildHistoryTrackingTopic(
                    sym,
                    tf,
                    hasAnchoredEndTime ? endTimeSec : null,
                  ),
                  toStreamSnapshot(tfData),
                );
              }
              if (tfData.bars.length > 0 && !hasAnchoredEndTime) {
                chartFetchManager.set(sym, tf, tfData);
              }
              if (mountedRef.current && (tfData.bars.length > 0 || tfData.snapshot)) {
                setData((prev) => {
                  const next = {
                    ...(prev && typeof prev === "object" ? prev : {}),
                    [key]: tfData,
                  };
                  const aligned = alignLatestPriceAcrossTf(next, tfs);
                  lastChartDataRef.current = aligned;
                  return aligned;
                });
              }
              return {
                key,
                data: tfData,
              };
            } catch (e) {
              return { key, data: { bars: [] } };
            }
          }),
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            entries[r.value.key] = r.value.data;
          }
        }
        // Ensure all TFs have an entry
        for (const tf of tfs) {
          const key = tfNorm(tf);
          if (!entries[key]) entries[key] = { bars: [] };
        }
        const aligned = alignLatestPriceAcrossTf(entries, tfs);
        for (const tf of tfs) {
          const key = tfNorm(tf);
          if (Array.isArray(aligned?.[key]?.bars) && aligned[key].bars.length) {
            chartFetchManager.set(sym, key, aligned[key]);
          }
        }
        Object.assign(entries, aligned);
      }

      const hasAny = Object.values(entries).some(
        (e) => e.bars?.length > 0 || e.snapshot,
      );
      if (!hasAny) throw new Error("No data from provider");
      return { symbol: sym, entries };
    },
    [
      sym,
      tfs,
      mode,
      barsCount,
      normalizedBarsCountByTf,
      provider,
      sessionPrefix,
      profile,
      attachedSnapshotFiles,
      tradeSid,
      endTimeSec,
    ],
  );

  const refresh = useCallback(
    async (opts = {}) => {
      if (!sym) return null;
      if (mode === "live") {
        setLiveKey((p) => p + 1);
        setError(null);
        return null;
      }
      if (skipFetch) return null;
      setStatus("LOADING");
      setError(null);
      if (mode === "snapshots") setSnapMsg("Fetching...");

      try {
        const result = await fetchAll(opts);
        if (!mountedRef.current) return null;
        const entries = result?.entries || {};
        const hasBars = Object.values(entries).some((e) => e.bars?.length > 0);
        const hasSnap = Object.values(entries).some((e) => e.snapshot);
        setData(entries);
        if (Object.keys(entries).length) {
          lastChartDataRef.current = entries;
        }
        if (mode === "snapshots") {
          if (!hasSnap) {
            setStatus("ERROR");
            setError("No snapshots");
            setSnapMsg("Snapshots unavailable");
            return null;
          }
          setStatus("READY");
          setSnapMsg("");
          return { data: { entries } };
        }
        if (!hasBars) {
          if (opts.force || mode !== "cache") {
            setStatus("ERROR");
            setError("No data");
          }
          return null;
        }
        setStatus("READY");
        return result;
      } catch (err) {
        if (!mountedRef.current) return null;
        setStatus("ERROR");
        const msg = String(err?.message || err || "Failed");
        setError(msg);
        if (mode === "snapshots") setSnapMsg(msg);
        return null;
      }
    },
    [sym, tfs, mode, skipFetch, fetchAll],
  );

  const refreshTf = useCallback(
    async (tf, opts = {}) => {
      if (!sym) return null;
      if (mode === "live") return null;
      if (skipFetch) return null;
      const tfKey = tfNorm(tf);
      if (!tfKey) return null;
      const force = opts.force === true;
      const direction =
        String(opts.direction || "").trim().toLowerCase() === "history"
          ? "history"
          : "latest";
      const historyLoadMode = String(opts.loadMode || "").trim().toLowerCase();
      const storageOnlyHistory = direction === "history" && historyLoadMode === "storage_only";
      const remoteHistoryOnly =
        direction === "history" && historyLoadMode === "remote_history";
      const mergeHistoryIntoCurrent =
        direction === "history" &&
        (storageOnlyHistory || remoteHistoryOnly);
      const requestedBars = Math.max(
        50,
        Math.min(
          Number(opts.bars) ||
            normalizedBarsCountByTf[tfKey] ||
            barsForTf(tfKey, barsCount, profile),
          MAX_CHART_HISTORY_BARS,
        ),
      );
      const previousEntry =
        lastChartDataRef.current &&
        typeof lastChartDataRef.current === "object"
          ? lastChartDataRef.current[tfKey]
          : null;
      const previousStoredBars = Math.max(
        0,
        Number(previousEntry?.metadata?.stored_bars) ||
          (Array.isArray(previousEntry?.bars) ? previousEntry.bars.length : 0) ||
          0,
      );
      const previousChartBars = Array.isArray(previousEntry?.bars)
        ? previousEntry.bars.length
        : 0;
      const previousFirstBarSec =
        Array.isArray(previousEntry?.bars) && previousEntry.bars.length
          ? Number(previousEntry.bars[0]?.time || 0) || 0
          : 0;
      const tfSeconds = Math.max(60, tfRankMinutes(tfKey) * 60 || 60);
      let historyTopic = "";
      let historyRequestKey = "";
      let historyRequestRange = null;
      let historyFirstLoadedBarSec = null;
      let historyRequestStarted = false;
      let historyTransport = "http_fallback";
      try {
        if (mode === "cache") {
          const hasAnchoredEndTime =
            Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0;
          let historyRequestEndTimeSec = null;
          debugChartHistory("refreshTf:start", {
            symbol: sym,
            timeframe: tfKey,
            requestedBars,
            direction,
            hasAnchoredEndTime,
            force,
          });
          let out = null;
          let snap = null;
          const isSocketHistoryRequest = direction === "history";
          const shouldUseSocketHistory =
            isSocketHistoryRequest &&
            typeof realtimeTransport?.requestChartHistory === "function";
          let historyRefreshMetadata = null;
          let historyStorageBarsLoaded = 0;
          if (isSocketHistoryRequest) {
            const previousBars = Array.isArray(previousEntry?.bars) ? previousEntry.bars : [];
            const firstLoadedBarSec = Number(previousBars[0]?.time);
            historyFirstLoadedBarSec = firstLoadedBarSec;
            const historyEndTimeSec =
              Number.isFinite(firstLoadedBarSec) && firstLoadedBarSec > tfSeconds
                ? firstLoadedBarSec - tfSeconds
                : null;
            if (historyEndTimeSec) {
              historyRequestEndTimeSec = historyEndTimeSec;
              const viewportStartTimeSec =
                Number.isFinite(Number(opts.viewportStartMs)) && Number(opts.viewportStartMs) > 0
                  ? Math.floor(Number(opts.viewportStartMs) / 1000)
                  : historyEndTimeSec - requestedBars * tfSeconds;
              const requestRange = {
                startSec: Math.max(1, viewportStartTimeSec),
                endSec: historyEndTimeSec,
              };
              const topic = buildHistoryTrackingTopic(
                sym,
                tfKey,
                hasAnchoredEndTime ? endTimeSec : null,
              );
              const requestKey = `${topic}:${requestRange.startSec}:${requestRange.endSec}:${requestedBars}`;
              historyTopic = topic;
              historyRequestKey = requestKey;
              historyRequestRange = requestRange;
              historyTransport = shouldUseSocketHistory ? "socket" : "http_fallback";
              const started = chartStreamStore.beginHistoryRequest(topic, {
                key: requestKey,
                ...requestRange,
              });
              if (!started.accepted) {
                logHistoryConsole("skip", {
                  symbol: sym,
                  timeframe: tfKey,
                  requestKey,
                  reason: started.reason,
                  requestStartSec: requestRange.startSec,
                  requestStartIso: formatHistoryTimeSec(requestRange.startSec),
                  requestEndSec: requestRange.endSec,
                  requestEndIso: formatHistoryTimeSec(requestRange.endSec),
                });
                return {
                  ok: true,
                  skipped: true,
                  refresh_result: {
                    tf: tfKey,
                    direction,
                    requestedBars,
                    previousStoredBars,
                    storedBars: previousStoredBars,
                    addedBars: 0,
                    updatedBars: 0,
                    hasAnchoredEndTime,
                    skipReason: started.reason,
                  },
                };
              }
              historyRequestStarted = true;
              logHistoryConsole(shouldUseSocketHistory ? "request" : "fallback", {
                symbol: sym,
                timeframe: tfKey,
                requestKey,
                requestedBars,
                reason: shouldUseSocketHistory
                  ? undefined
                  : "socket_history_disabled_using_http_fallback",
                requestStartSec: requestRange.startSec,
                requestStartIso: formatHistoryTimeSec(requestRange.startSec),
                requestEndSec: requestRange.endSec,
                requestEndIso: formatHistoryTimeSec(requestRange.endSec),
                viewportStartSec: viewportStartTimeSec,
                viewportStartIso: formatHistoryTimeSec(viewportStartTimeSec),
                firstLoadedBarSec,
                firstLoadedBarIso: formatHistoryTimeSec(firstLoadedBarSec),
              });
              const loadHistorySnapshotFromStorage = async () =>
                loadBrokerHistoryWindow(tfKey, requestedBars, historyEndTimeSec);
              const localHistory = await loadHistorySnapshotFromStorage().catch(() => null);
              if (localHistory?.snap) {
                out = localHistory.out;
                snap = localHistory.snap;
                historyStorageBarsLoaded = Array.isArray(localHistory.snap?.bars)
                  ? localHistory.snap.bars.length
                  : 0;
              }
              if (storageOnlyHistory) {
                out = localHistory?.out || null;
                snap = localHistory?.snap || null;
              } else if (remoteHistoryOnly) {
                let forcedRefreshOut = null;
                let forcedRefreshSnap = null;
                try {
                  forcedRefreshOut = await api.chartCandles(
                    sym,
                    tfKey,
                    requestedBars,
                    true,
                    tradeSid,
                    "history",
                    historyEndTimeSec,
                  );
                  forcedRefreshSnap =
                    forcedRefreshOut?.snapshot &&
                    typeof forcedRefreshOut.snapshot === "object"
                      ? forcedRefreshOut.snapshot
                      : null;
                } catch {
                  forcedRefreshOut = null;
                  forcedRefreshSnap = null;
                }
                const reloadedHistory = await loadHistorySnapshotFromStorage().catch(
                  () => null,
                );
                const reloadedSnap =
                  reloadedHistory?.snap && typeof reloadedHistory.snap === "object"
                    ? reloadedHistory.snap
                    : null;
                if (reloadedSnap) {
                  out = {
                    ...reloadedHistory.out,
                    source: "remote_history_refresh",
                    cached_at: Date.now(),
                  };
                  snap = reloadedSnap;
                } else if (forcedRefreshSnap) {
                  out = {
                    ...forcedRefreshOut,
                    source: "remote_history_refresh",
                    cached_at: Date.now(),
                  };
                  snap = forcedRefreshSnap;
                }
                historyRefreshMetadata =
                  forcedRefreshSnap?.metadata &&
                  typeof forcedRefreshSnap.metadata === "object"
                    ? forcedRefreshSnap.metadata
                    : historyRefreshMetadata;
              }
              if (
                !storageOnlyHistory &&
                !remoteHistoryOnly &&
                shouldUseSocketHistory &&
                historyStorageBarsLoaded < requestedBars
              ) {
                try {
                  debugChartHistory("history:request", {
                    symbol: sym,
                    timeframe: tfKey,
                    topic,
                    requestKey,
                    requestRange,
                    requestedBars,
                    visibleBars: Number(opts.visibleBars) || 0,
                  });
                  logHistoryConsole("request", {
                    symbol: sym,
                    timeframe: tfKey,
                    requestKey,
                    requestedBars,
                    requestStartSec: requestRange.startSec,
                    requestStartIso: formatHistoryTimeSec(requestRange.startSec),
                    requestEndSec: requestRange.endSec,
                    requestEndIso: formatHistoryTimeSec(requestRange.endSec),
                    viewportStartSec: viewportStartTimeSec,
                    viewportStartIso: formatHistoryTimeSec(viewportStartTimeSec),
                    firstLoadedBarSec,
                    firstLoadedBarIso: formatHistoryTimeSec(firstLoadedBarSec),
                  });
                  const response = await realtimeTransport.requestChartHistory({
                    requestId: requestKey,
                    topic,
                    symbol: sym,
                    timeframe: tfKey,
                    bars: requestedBars,
                    visibleBars: Math.max(
                      requestedBars,
                      Number(opts.visibleBars) || 0,
                    ),
                    direction,
                    endTimeSec: historyEndTimeSec,
                    viewportStartTimeSec,
                    viewportEndTimeSec:
                      Number.isFinite(Number(opts.viewportEndMs)) &&
                      Number(opts.viewportEndMs) > 0
                        ? Math.ceil(Number(opts.viewportEndMs) / 1000)
                        : null,
                  });
                  snap =
                    response?.snapshot && typeof response.snapshot === "object"
                      ? response.snapshot
                      : null;
                  out = {
                    ...response,
                    source: "socket_history",
                    cached_at: Date.now(),
                  };
                  debugChartHistory("history:response", {
                    symbol: sym,
                    timeframe: tfKey,
                    topic,
                    requestKey,
                    bars: Array.isArray(snap?.bars) ? snap.bars.length : 0,
                    metadata: snap?.metadata || null,
                  });
                  logHistoryConsole("response", {
                    symbol: sym,
                    timeframe: tfKey,
                    requestKey,
                    returnedBars: Array.isArray(snap?.bars) ? snap.bars.length : 0,
                    returnedStartSec:
                      Number(snap?.bar_start || snap?.bars?.[0]?.time || 0) || null,
                    returnedStartIso: formatHistoryTimeSec(
                      Number(snap?.bar_start || snap?.bars?.[0]?.time || 0) || null,
                    ),
                    returnedEndSec:
                      Number(
                        snap?.bar_end || snap?.bars?.[snap?.bars?.length - 1]?.time || 0,
                      ) || null,
                    returnedEndIso: formatHistoryTimeSec(
                      Number(
                        snap?.bar_end || snap?.bars?.[snap?.bars?.length - 1]?.time || 0,
                      ) || null,
                    ),
                    historyStatus: snap?.metadata?.history_status || null,
                    historyExhausted: snap?.metadata?.history_exhausted ?? null,
                    storageHadEarlier: snap?.metadata?.storage_had_earlier ?? null,
                    remoteAttempted: snap?.metadata?.remote_attempted ?? null,
                    remoteReturnedBars: snap?.metadata?.remote_returned_bars ?? null,
                    resolutionPath: snap?.metadata?.resolution_path || null,
                    remoteRefreshed: snap?.metadata?.remote_refreshed ?? null,
                  });
                  if (snap?.bars?.length) {
                    chartStreamStore.completeHistoryRequest(topic, requestKey, {
                      bars: snap.bars,
                      lastPrice: snap.lastPrice ?? snap.last_price ?? null,
                      metadata: snap.metadata,
                      range: {
                        startSec:
                          Number(snap?.bar_start || snap?.bars?.[0]?.time || 0) || 0,
                        endSec:
                          Number(
                            snap?.bar_end ||
                              snap?.bars?.[snap?.bars?.length - 1]?.time ||
                              0,
                          ) || 0,
                      },
                    });
                  } else {
                    const exhausted = snap?.metadata?.history_exhausted === true;
                    logHistoryConsole(exhausted ? "exhausted" : "response-empty", {
                      symbol: sym,
                      timeframe: tfKey,
                      requestKey,
                      reason: exhausted
                        ? "remote provider has no older bars for requested range"
                        : "no bars returned for requested gap range",
                      historyStatus: snap?.metadata?.history_status || null,
                      storageHadEarlier: snap?.metadata?.storage_had_earlier ?? null,
                      remoteAttempted: snap?.metadata?.remote_attempted ?? null,
                      remoteReturnedBars: snap?.metadata?.remote_returned_bars ?? null,
                      earliestBeforeSec: snap?.metadata?.earliest_before_sec ?? null,
                      earliestBeforeIso: formatHistoryTimeSec(
                        snap?.metadata?.earliest_before_sec ?? null,
                      ),
                      earliestAfterSec: snap?.metadata?.earliest_after_sec ?? null,
                      earliestAfterIso: formatHistoryTimeSec(
                        snap?.metadata?.earliest_after_sec ?? null,
                      ),
                    });
                    if (exhausted) {
                      chartStreamStore.markHistoryExhausted(
                        topic,
                        requestRange,
                        snap?.metadata || null,
                      );
                    }
                    chartStreamStore.failHistoryRequest(topic, requestKey);
                  }
                } catch (error) {
                  debugChartHistory("history:error", {
                    symbol: sym,
                    timeframe: tfKey,
                    topic,
                    requestKey,
                    message: error?.message || String(error || "unknown"),
                  });
                  logHistoryConsole("error", {
                    symbol: sym,
                    timeframe: tfKey,
                    requestKey,
                    message: error?.message || String(error || "unknown"),
                  });
                  chartStreamStore.failHistoryRequest(topic, requestKey);
                  out = null;
                  snap = null;
                }
              }
            }
          }
          if (
            !storageOnlyHistory &&
            !remoteHistoryOnly &&
            isSocketHistoryRequest &&
            historyRequestEndTimeSec &&
            (Array.isArray(snap?.bars) ? snap.bars.length : 0) < requestedBars
          ) {
            try {
              const historyRefreshOut = await api.chartCandles(
                sym,
                tfKey,
                requestedBars,
                true,
                tradeSid,
                "history",
                historyRequestEndTimeSec,
              );
              const historyRefreshSnap =
                historyRefreshOut?.snapshot &&
                typeof historyRefreshOut.snapshot === "object"
                  ? historyRefreshOut.snapshot
                  : null;
              historyRefreshMetadata =
                historyRefreshSnap?.metadata &&
                typeof historyRefreshSnap.metadata === "object"
                  ? historyRefreshSnap.metadata
                  : null;
              if (historyRefreshSnap) {
                const reloadedHistory = await loadBrokerHistoryWindow(
                  tfKey,
                  requestedBars,
                  historyRequestEndTimeSec,
                ).catch(() => null);
                const reloadedSnap =
                  reloadedHistory?.snap &&
                  typeof reloadedHistory.snap === "object"
                    ? reloadedHistory.snap
                    : null;
                if (reloadedSnap) {
                  out = {
                    ...reloadedHistory.out,
                    source: "history_storage_reloaded",
                    cached_at: Date.now(),
                  };
                  snap = {
                    ...reloadedSnap,
                    metadata: {
                      ...(reloadedSnap?.metadata &&
                      typeof reloadedSnap.metadata === "object"
                        ? reloadedSnap.metadata
                        : {}),
                      ...(historyRefreshMetadata || {}),
                    },
                  };
                  historyStorageBarsLoaded = Array.isArray(reloadedSnap?.bars)
                    ? reloadedSnap.bars.length
                    : historyStorageBarsLoaded;
                } else {
                  out = {
                    ...historyRefreshOut,
                    source: "remote_history_refresh",
                    cached_at: Date.now(),
                  };
                  snap = historyRefreshSnap;
                }
              } else if (snap) {
                out = {
                  ...out,
                  source: "remote_history_refresh",
                  cached_at: Date.now(),
                };
                snap = {
                  ...snap,
                  metadata: {
                    ...(snap?.metadata && typeof snap.metadata === "object"
                      ? snap.metadata
                      : {}),
                    ...(historyRefreshMetadata || {}),
                  },
                };
              }
            } catch (error) {
              logHistoryConsole("error", {
                symbol: sym,
                timeframe: tfKey,
                requestKey: historyRequestKey || `${sym}:${tfKey}:history`,
                transport: "remote_history_refresh",
                message: error?.message || String(error || "unknown"),
              });
            }
          }
          if (hasAnchoredEndTime) {
            if (force && !isSocketHistoryRequest) {
              try {
                const forcedRefreshOut = await api.chartCandles(
                  sym,
                  tfKey,
                  requestedBars,
                  true,
                  tradeSid,
                  direction,
                  endTimeSec,
                );
                const forcedRefreshSnap =
                  forcedRefreshOut?.snapshot &&
                  typeof forcedRefreshOut.snapshot === "object"
                    ? forcedRefreshOut.snapshot
                    : null;
                if (Array.isArray(forcedRefreshSnap?.bars) && forcedRefreshSnap.bars.length > 0) {
                  out = {
                    ...forcedRefreshOut,
                    source:
                      forcedRefreshOut?.source ||
                      "chart_candles_trade_copy",
                    cached_at:
                      forcedRefreshOut?.cached_at || Date.now(),
                  };
                  snap = forcedRefreshSnap;
                }
              } catch {
                // Fall through to anchored bootstrap / broker history fallbacks.
              }
            }
            if (!snap) {
              try {
                out = await api.realtimeChartBootstrap(
                  sym,
                  tfKey,
                  requestedBars,
                  isSocketHistoryRequest ? historyRequestEndTimeSec : endTimeSec,
                  isSocketHistoryRequest ? "history" : direction,
                );
                snap =
                  out?.snapshot && typeof out.snapshot === "object"
                    ? out.snapshot
                    : null;
                if (snap) {
                  out = {
                    ...out,
                    source: isSocketHistoryRequest ? "socket_history_fallback" : "realtime_bootstrap",
                    cached_at: Date.now(),
                  };
                }
              } catch {
                out = await api.brokerBars(
                  sym,
                  tfKey,
                  requestedBars,
                  isSocketHistoryRequest ? historyRequestEndTimeSec : endTimeSec,
                );
                const normalizedBars = Array.isArray(out?.bars)
                  ? out.bars.map((bar) => ({
                      time: Number(bar?.t ?? bar?.time),
                      open: Number(bar?.o ?? bar?.open),
                      high: Number(bar?.h ?? bar?.high),
                      low: Number(bar?.l ?? bar?.low),
                      close: Number(bar?.c ?? bar?.close),
                      volume: Number(bar?.v ?? bar?.volume ?? 0),
                    }))
                  : [];
                snap = {
                  bars: normalizedBars,
                  bar_start: normalizedBars[0]?.time || null,
                  bar_end: normalizedBars[normalizedBars.length - 1]?.time || null,
                  last_price: normalizedBars.length
                    ? Number(normalizedBars[normalizedBars.length - 1]?.close)
                    : null,
                  metadata:
                    out?.metadata && typeof out.metadata === "object"
                      ? out.metadata
                      : null,
                };
              }
            }
            if (!Array.isArray(snap?.bars) || snap.bars.length === 0) {
              try {
                const latestOut = await api.realtimeChartBootstrap(
                  sym,
                  tfKey,
                  requestedBars,
                  null,
                  direction === "history" ? "latest" : direction,
                );
                const latestSnap =
                  latestOut?.snapshot && typeof latestOut.snapshot === "object"
                    ? latestOut.snapshot
                    : null;
                if (latestSnap?.bars?.length) {
                  out = {
                    ...latestOut,
                    source: "realtime_bootstrap_latest_fallback",
                    cached_at: Date.now(),
                  };
                  snap = {
                    ...latestSnap,
                    metadata: {
                      ...(latestSnap?.metadata &&
                      typeof latestSnap.metadata === "object"
                        ? latestSnap.metadata
                        : {}),
                      anchored_history_fallback: true,
                    },
                  };
                }
              } catch {
                const latestOut = await api.brokerBars(
                  sym,
                  tfKey,
                  requestedBars,
                  null,
                );
                const normalizedBars = Array.isArray(latestOut?.bars)
                  ? latestOut.bars.map((bar) => ({
                      time: Number(bar?.t ?? bar?.time),
                      open: Number(bar?.o ?? bar?.open),
                      high: Number(bar?.h ?? bar?.high),
                      low: Number(bar?.l ?? bar?.low),
                      close: Number(bar?.c ?? bar?.close),
                      volume: Number(bar?.v ?? bar?.volume ?? 0),
                    }))
                  : [];
                if (normalizedBars.length) {
                  out = {
                    ...latestOut,
                    source: "broker_bars_latest_fallback",
                    cached_at: Date.now(),
                  };
                  snap = {
                    bars: normalizedBars,
                    bar_start: normalizedBars[0]?.time || null,
                    bar_end: normalizedBars[normalizedBars.length - 1]?.time || null,
                    last_price: Number(
                      normalizedBars[normalizedBars.length - 1]?.close,
                    ) || null,
                    metadata: {
                      ...(latestOut?.metadata &&
                      typeof latestOut.metadata === "object"
                        ? latestOut.metadata
                        : {}),
                      anchored_history_fallback: true,
                    },
                  };
                }
              }
            }
          } else {
            if (force && !isSocketHistoryRequest) {
              Promise.resolve(
                api.chartCandles(
                  sym,
                  tfKey,
                  requestedBars,
                  true,
                  tradeSid,
                  direction,
                ),
              ).catch(() => null);
            }
            if (!snap) {
              try {
                out = await api.realtimeChartBootstrap(
                  sym,
                  tfKey,
                  requestedBars,
                  isSocketHistoryRequest ? historyRequestEndTimeSec : null,
                  isSocketHistoryRequest ? "history" : direction,
                );
                snap =
                  out?.snapshot && typeof out.snapshot === "object"
                    ? out.snapshot
                    : null;
                if (Array.isArray(snap?.bars) && snap.bars.length > 0) {
                  out = {
                    ...out,
                    source: "realtime_bootstrap",
                    cached_at: Date.now(),
                  };
                } else {
                  snap = null;
                }
              } catch {
                out = null;
                snap = null;
              }
              if (!Array.isArray(snap?.bars) || snap.bars.length === 0) {
                try {
                  out = await api.brokerBars(
                    sym,
                    tfKey,
                    requestedBars,
                    null,
                  );
                  const normalizedBars = normalizeBrokerHistoryBars(out?.bars);
                  if (normalizedBars.length > 0) {
                    snap = {
                      bars: normalizedBars,
                      bar_start: normalizedBars[0]?.time || null,
                      bar_end: normalizedBars[normalizedBars.length - 1]?.time || null,
                      last_price: Number(
                        normalizedBars[normalizedBars.length - 1]?.close,
                      ) || null,
                      metadata:
                        out?.metadata && typeof out.metadata === "object"
                          ? out.metadata
                          : null,
                    };
                    out = {
                      ...out,
                      source: out?.source || "broker_bars_latest",
                      cached_at: out?.cached_at || Date.now(),
                    };
                  }
                } catch {
                  out = null;
                  snap = null;
                }
              }
              if (!Array.isArray(snap?.bars) || snap.bars.length === 0) {
                out = await api.chartCandles(
                  sym,
                  tfKey,
                  requestedBars,
                  false,
                  tradeSid,
                  isSocketHistoryRequest && historyRequestEndTimeSec ? "history" : direction,
                  isSocketHistoryRequest ? historyRequestEndTimeSec : null,
                );
                snap =
                  out?.snapshot && typeof out.snapshot === "object"
                    ? out.snapshot
                    : null;
              }
            } else if (out?.source === "socket_history") {
              out = {
                ...out,
                source: "socket_history",
                cached_at: Date.now(),
              }
            }
          }
          const tfData = {
            bars: Array.isArray(snap?.bars) ? snap.bars : [],
            bar_start: snap?.bar_start || snap?.bars?.[0]?.time,
            bar_end: snap?.bar_end || snap?.bars?.[snap?.bars?.length - 1]?.time,
            last_price: snap?.last_price ?? snap?.lastPrice ?? null,
            provider: snap?.provider || null,
            indicators:
              snap?.indicators && typeof snap.indicators === "object"
                ? snap.indicators
                : null,
            metadata:
              snap?.metadata && typeof snap.metadata === "object"
                ? snap.metadata
                : null,
            cache_source: out?.source || "remote_api",
            cached_at: snap?.cached_at || out?.cached_at || Date.now(),
            reason:
              out?.cache_debug && typeof out.cache_debug === "object"
                ? `redis=${out.cache_debug.redis_key || "-"} ttl=${out.cache_debug.ttl_sec || "-"}s tf=${out.cache_debug.timeframe_normalized || "-"} api=${out.cache_debug.binance_interval || "-"}`
                : hasAnchoredEndTime
                  ? `anchored<=${Number(endTimeSec)}`
                : "",
          };
          if (
            isSocketHistoryRequest &&
            historyRequestStarted &&
            historyRequestKey &&
            out?.source !== "socket_history"
          ) {
            if (tfData.bars.length > 0) {
              logHistoryConsole("response", {
                symbol: sym,
                timeframe: tfKey,
                requestKey: historyRequestKey,
                transport: "http_fallback",
                returnedBars: tfData.bars.length,
                returnedStartSec:
                  Number(tfData?.bar_start || tfData?.bars?.[0]?.time || 0) || null,
                returnedStartIso: formatHistoryTimeSec(
                  Number(tfData?.bar_start || tfData?.bars?.[0]?.time || 0) || null,
                ),
                returnedEndSec:
                  Number(
                    tfData?.bar_end || tfData?.bars?.[tfData?.bars?.length - 1]?.time || 0,
                  ) || null,
                returnedEndIso: formatHistoryTimeSec(
                  Number(
                    tfData?.bar_end || tfData?.bars?.[tfData?.bars?.length - 1]?.time || 0,
                  ) || null,
                ),
                cacheSource: tfData.cache_source || null,
                historyStatus: tfData?.metadata?.history_status || null,
                historyExhausted: tfData?.metadata?.history_exhausted ?? null,
                storageHadEarlier: tfData?.metadata?.storage_had_earlier ?? null,
                remoteAttempted: tfData?.metadata?.remote_attempted ?? null,
                remoteReturnedBars: tfData?.metadata?.remote_returned_bars ?? null,
                resolutionPath: tfData?.metadata?.resolution_path || null,
                remoteRefreshed: tfData?.metadata?.remote_refreshed ?? null,
              });
              chartStreamStore.completeHistoryRequest(historyTopic, historyRequestKey, {
                bars: tfData.bars,
                lastPrice: tfData.last_price ?? null,
                metadata: tfData.metadata,
                range: {
                  startSec: Number(tfData?.bar_start || tfData?.bars?.[0]?.time || 0) || 0,
                  endSec:
                    Number(
                      tfData?.bar_end || tfData?.bars?.[tfData?.bars?.length - 1]?.time || 0,
                    ) || 0,
                },
              });
            } else {
              const exhausted = tfData?.metadata?.history_exhausted === true;
              logHistoryConsole(exhausted ? "exhausted" : "response-empty", {
                symbol: sym,
                timeframe: tfKey,
                requestKey: historyRequestKey,
                transport: "http_fallback",
                requestStartSec: historyRequestRange?.startSec || null,
                requestStartIso: formatHistoryTimeSec(historyRequestRange?.startSec || null),
                requestEndSec: historyRequestRange?.endSec || null,
                requestEndIso: formatHistoryTimeSec(historyRequestRange?.endSec || null),
                firstLoadedBarSec: historyFirstLoadedBarSec || null,
                firstLoadedBarIso: formatHistoryTimeSec(historyFirstLoadedBarSec || null),
                cacheSource: tfData.cache_source || null,
                historyStatus: tfData?.metadata?.history_status || null,
                storageHadEarlier: tfData?.metadata?.storage_had_earlier ?? null,
                remoteAttempted: tfData?.metadata?.remote_attempted ?? null,
                remoteReturnedBars: tfData?.metadata?.remote_returned_bars ?? null,
                earliestBeforeSec: tfData?.metadata?.earliest_before_sec ?? null,
                earliestBeforeIso: formatHistoryTimeSec(
                  tfData?.metadata?.earliest_before_sec ?? null,
                ),
                earliestAfterSec: tfData?.metadata?.earliest_after_sec ?? null,
                earliestAfterIso: formatHistoryTimeSec(
                  tfData?.metadata?.earliest_after_sec ?? null,
                ),
              });
              if (exhausted) {
                chartStreamStore.markHistoryExhausted(
                  historyTopic,
                  historyRequestRange || {},
                  tfData?.metadata || null,
                );
              }
              chartStreamStore.failHistoryRequest(historyTopic, historyRequestKey);
            }
          }
          if (
            tfData.bars.length > 0 &&
            !(isSocketHistoryRequest && out?.source === "socket_history")
          ) {
            chartStreamStore.setBootstrap(
              buildHistoryTrackingTopic(
                sym,
                tfKey,
                hasAnchoredEndTime ? endTimeSec : null,
              ),
              toStreamSnapshot(tfData),
            );
          }
          const nextStoredBars = Math.max(
            previousStoredBars,
            Number(tfData?.metadata?.stored_bars) ||
              (Array.isArray(tfData?.bars) ? tfData.bars.length : 0) ||
              0,
          );
          const updatedBars = Math.max(
            0,
            Number(tfData?.metadata?.updated_bars) || 0,
          );
          const historyMergedBars =
            (isSocketHistoryRequest || mergeHistoryIntoCurrent) &&
            tfData.bars.length > 0
              ? mergeHistoricalBarsIntoTfData(previousEntry || {}, {
                  bars: tfData.bars,
                  cachedAt: tfData.cached_at,
                  metadata: tfData.metadata,
                })
              : null;
          const mergedChartBars = Array.isArray(historyMergedBars?.bars)
            ? historyMergedBars.bars.length
            : previousChartBars;
          const mergedFirstBarSec =
            Array.isArray(historyMergedBars?.bars) && historyMergedBars.bars.length
              ? Number(historyMergedBars.bars[0]?.time || 0) || 0
              : Array.isArray(tfData?.bars) && tfData.bars.length
                ? Number(tfData.bars[0]?.time || 0) || 0
                : previousFirstBarSec;
          const extendedLeftEdge =
            Number.isFinite(previousFirstBarSec) &&
            previousFirstBarSec > 0 &&
            Number.isFinite(mergedFirstBarSec) &&
            mergedFirstBarSec > 0 &&
            mergedFirstBarSec < previousFirstBarSec;
          const historyExtendedBars =
            extendedLeftEdge && tfSeconds > 0
              ? Math.max(
                  0,
                  Math.round((previousFirstBarSec - mergedFirstBarSec) / tfSeconds),
                )
              : 0;
          const storedAddedBars = Math.max(0, nextStoredBars - previousStoredBars);
          const refreshResult = {
            tf: tfKey,
            direction,
            requestedBars,
            previousStoredBars,
            storedBars: nextStoredBars,
            addedBars: isSocketHistoryRequest
              ? Math.max(0, mergedChartBars - previousChartBars)
              : storedAddedBars,
            storedAddedBars,
            updatedBars,
            hasAnchoredEndTime,
            resolutionPath: tfData?.metadata?.resolution_path || null,
            remoteAttempted: tfData?.metadata?.remote_attempted ?? null,
            remoteReturnedBars: tfData?.metadata?.remote_returned_bars ?? null,
            remoteRefreshed: tfData?.metadata?.remote_refreshed ?? null,
            remoteReason: tfData?.metadata?.remote_reason || null,
            historyStatus: tfData?.metadata?.history_status || null,
            previousFirstBarSec: previousFirstBarSec || null,
            mergedFirstBarSec: mergedFirstBarSec || null,
            extendedLeftEdge,
            historyExtendedBars,
          };
          if (tfData.bars.length > 0) {
            debugChartHistory("refreshTf:loaded", {
              symbol: sym,
              timeframe: tfKey,
              direction,
              hasAnchoredEndTime,
              cacheSource: tfData.cache_source,
              bars: tfData.bars.length,
              metadata: tfData.metadata || null,
            });
            if (isSocketHistoryRequest || mergeHistoryIntoCurrent) {
              setData((prev) => {
                const current =
                  prev && typeof prev === "object" ? prev[tfKey] || {} : {};
                const merged = mergeHistoricalBarsIntoTfData(current, {
                  bars: tfData.bars,
                  cachedAt: tfData.cached_at,
                  metadata: tfData.metadata,
                });
                const nextEntry = { ...merged, created_at: Date.now() };
                const next = {
                  ...(prev || {}),
                  [tfKey]: nextEntry,
                };
                lastChartDataRef.current = next;
                if (!hasAnchoredEndTime) {
                  chartFetchManager.set(sym, tfKey, nextEntry);
                }
                return next;
              });
              setError(null);
              setStatus("READY");
              return {
                ...tfData,
                refresh_result: refreshResult,
              };
            }
            if (hasAnchoredEndTime) {
              setData((prev) => ({
                ...(prev || {}),
                [tfKey]: { ...tfData, created_at: Date.now() },
              }));
              lastChartDataRef.current = {
                ...(lastChartDataRef.current || {}),
                [tfKey]: { ...tfData, created_at: Date.now() },
              };
            } else {
              chartFetchManager.set(sym, tfKey, tfData);
              setData((prev) => {
                const next = {
                  ...(prev || {}),
                  [tfKey]: { ...tfData, created_at: Date.now() },
                };
                const aligned = alignLatestPriceAcrossTf(next, tfs);
                lastChartDataRef.current = aligned;
                for (const tf of tfs) {
                  const key = tfNorm(tf);
                  if (Array.isArray(aligned?.[key]?.bars) && aligned[key].bars.length) {
                    chartFetchManager.set(sym, key, aligned[key]);
                  }
                }
                return aligned;
              });
            }
            setError(null);
            setStatus("READY");
          }
          if (hasAnchoredEndTime && tfData.bars.length === 0) {
            const emptyEntry = { ...tfData, created_at: Date.now() };
            setData((prev) => ({
              ...(prev || {}),
              [tfKey]: emptyEntry,
            }));
            lastChartDataRef.current = {
              ...(lastChartDataRef.current || {}),
              [tfKey]: emptyEntry,
            };
            setError(null);
            setStatus("READY");
          }
          return {
            ...tfData,
            refresh_result: refreshResult,
          };
        }
        // snapshot mode: fallback to full refresh currently
        return refresh({ force });
      } catch (err) {
        if (historyRequestStarted && historyTopic && historyRequestKey) {
          chartStreamStore.failHistoryRequest(historyTopic, historyRequestKey);
        }
        const msg = String(err?.message || err || "Refresh failed");
        if (historyRequestStarted && historyRequestKey) {
          logHistoryConsole("error", {
            symbol: sym,
            timeframe: tfKey,
            requestKey: historyRequestKey,
            transport: historyTransport,
            message: msg,
          });
        }
        setError(msg);
        return {
          ok: false,
          error: msg,
          refresh_result: {
            tf: tfKey,
            direction,
            requestedBars,
            previousStoredBars,
            storedBars: previousStoredBars,
            addedBars: 0,
            updatedBars: 0,
            hasAnchoredEndTime:
              Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0,
          },
        };
      }
    },
    [
      sym,
      mode,
      skipFetch,
      refresh,
      fetchAll,
      loadBrokerHistoryWindow,
      barsCount,
      normalizedBarsCountByTf,
      profile,
      tfs,
      tradeSid,
      endTimeSec,
    ],
  );

  useEffect(() => {
    const hasAnchoredEndTime =
      Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0;
    mountedRef.current = true;
    if (!sym) {
      setStatus("IDLE");
      setData({});
      lastChartDataRef.current = {};
      return;
    }
    if (mode === "live") {
      if (Object.keys(lastChartDataRef.current || {}).length) {
        setData(lastChartDataRef.current);
      }
      setError(null);
      return;
    }
    if (skipFetch) {
      // TradePlan mode: don't fetch, TradeSignalChart handles its own data
      setStatus("READY");
      setData({});
      return;
    }
    if (hasAnchoredEndTime) {
      setStatus("LOADING");
      setError(null);
      refresh({ force: false }).catch(() => null);
      return () => {
        mountedRef.current = false;
      };
    }
    if (!hasAnchoredEndTime && Object.keys(lastChartDataRef.current || {}).length) {
      setData(lastChartDataRef.current);
      setStatus("READY");
      return;
    }
    // Check all TFs in cache
    let allCached = true;
    let anyCached = false;
    const cachedData = {};
    for (const tf of tfs) {
      const entry = hasAnchoredEndTime ? null : chartFetchManager.get(sym, tf);
      if (entry) {
        cachedData[tfNorm(tf)] = entry;
        anyCached = true;
      } else allCached = false;
    }
    if (anyCached) {
      setData(cachedData);
      setStatus(allCached ? "READY" : "STALE");
    }
    // Never auto-call TwelveData. Only refresh button triggers API.
    if (!allCached && !anyCached) {
      setStatus("IDLE");
    }
    return () => {
      mountedRef.current = false;
    };
  }, [sym, mode, skipFetch, tfs, tradeSid, endTimeSec]);

  useEffect(() => {
    const hasAnchoredEndTime =
      Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0;
    if (
      !sym ||
      skipFetch ||
      mode !== "cache" ||
      hasAnchoredEndTime ||
      !tfs.length ||
      liveBars !== true
    ) {
      return undefined;
    }
    let cancelled = false;
    const unsubscribers = [];

    const updateTfFromStream = (tfKey, topic, streamState) => {
      if (cancelled) return;
      const tfState =
        streamState?.timeframes && typeof streamState.timeframes === "object"
          ? streamState.timeframes[tfKey] || null
          : streamState;
      const stateBars = Array.isArray(tfState?.bars) ? tfState.bars : [];
      const lastStreamBar = stateBars.length ? stateBars[stateBars.length - 1] : null;
      const lastPrice = Number(tfState?.lastPrice);
      const hasTailUpdate = Boolean(lastStreamBar) || Number.isFinite(lastPrice);

      setData((prev) => {
        const previousData =
          prev && typeof prev === "object" ? prev : {};
        const currentEntry =
          previousData[tfKey] ||
          chartFetchManager.get(sym, tfKey) ||
          null;
        if (!currentEntry) return prev;

        const nextMetadata = {
          ...(currentEntry?.metadata && typeof currentEntry.metadata === "object"
            ? currentEntry.metadata
            : {}),
          stream_connected: streamState?.connected === true,
          stream_status:
            String(tfState?.status || streamState?.status || "")
              .trim()
              .toUpperCase() || "READY",
          stream_connection_state:
            String(streamState?.connectionState || "").trim().toLowerCase() || "idle",
          stream_ever_connected: streamState?.everConnected === true,
          stream_last_data_at:
            Number.isFinite(Number(streamState?.lastDataAt))
              ? Number(streamState.lastDataAt)
              : null,
          stream_last_connected_at:
            Number.isFinite(Number(streamState?.lastConnectedAt))
              ? Number(streamState.lastConnectedAt)
              : null,
          stream_topic: topic,
        };
        const nextEntry = hasTailUpdate
          ? lastStreamBar
            ? mergeRealtimeBarsIntoTfData(currentEntry, {
                bars: [lastStreamBar],
                lastPrice,
                cachedAt: tfState?.lastUpdatedAt || streamState?.lastUpdatedAt || Date.now(),
              })
            : {
                ...currentEntry,
                last_price: lastPrice || currentEntry?.last_price || null,
                created_at:
                  tfState?.lastUpdatedAt ||
                  streamState?.lastUpdatedAt ||
                  currentEntry?.created_at ||
                  Date.now(),
                cached_at:
                  tfState?.lastUpdatedAt ||
                  streamState?.lastUpdatedAt ||
                  currentEntry?.cached_at ||
                  Date.now(),
                freshness: "stream",
                cache_source: "realtime_stream",
              }
          : {
              ...currentEntry,
              cache_source:
                currentEntry?.cache_source ||
                (streamState?.everConnected ? "realtime_stream" : currentEntry?.cache_source),
              freshness:
                streamState?.everConnected || currentEntry?.freshness === "stream"
                  ? "stream"
                  : currentEntry?.freshness,
            };
        const finalEntry = {
          ...nextEntry,
          reason:
            streamState?.everConnected || nextEntry?.reason === "realtime_stream"
              ? "realtime_stream"
              : nextEntry?.reason,
          metadata: nextMetadata,
        };
        const previousLastTime = Number(currentEntry?.bars?.[currentEntry?.bars?.length - 1]?.time || 0);
        const nextLastTime = Number(finalEntry?.bars?.[finalEntry?.bars?.length - 1]?.time || 0);
        const previousLastPrice = Number(currentEntry?.last_price || 0);
        const nextLastPrice = Number(finalEntry?.last_price || 0);
        const previousMetadata = currentEntry?.metadata || {};
        const metadataChanged =
          previousMetadata?.stream_connected !== nextMetadata.stream_connected ||
          previousMetadata?.stream_status !== nextMetadata.stream_status ||
          previousMetadata?.stream_connection_state !== nextMetadata.stream_connection_state ||
          previousMetadata?.stream_ever_connected !== nextMetadata.stream_ever_connected ||
          previousMetadata?.stream_last_data_at !== nextMetadata.stream_last_data_at ||
          previousMetadata?.stream_last_connected_at !== nextMetadata.stream_last_connected_at;
        if (
          previousLastTime === nextLastTime &&
          previousLastPrice === nextLastPrice &&
          !metadataChanged
        ) {
          return prev;
        }

        const next = {
          ...previousData,
          [tfKey]: finalEntry,
        };
        const aligned = alignLatestPriceAcrossTf(next, tfs);
        lastChartDataRef.current = aligned;
        for (const tf of tfs) {
          const key = tfNorm(tf);
          if (aligned?.[key]) {
            chartFetchManager.set(sym, key, aligned[key]);
          }
        }
        return aligned;
      });
      setStatus((current) =>
        current === "LOADING" || current === "IDLE" ? "READY" : current,
      );
    };

    const topic = buildRealtimeChartTopic(sym);
    if (topic) {
      unsubscribers.push(
        chartStreamStore.subscribe(topic, (state) => {
          setStreamVersion((prev) => prev + 1);
          for (const tf of tfs) {
            const tfKey = tfNorm(tf);
            updateTfFromStream(tfKey, topic, state);
          }
        }),
      );
      unsubscribers.push(
        realtimeClient.subscribe(
          topic,
          {
            bars: Math.max(300, Number(barsCount) || 300),
            pollMs: 2500,
          },
          (envelope) => {
            chartStreamStore.applyEnvelope(envelope);
          },
          {
            onOpen: () => chartStreamStore.setConnected(topic, true),
            onError: (error) => applyStreamLifecycleState(topic, error),
          },
        ),
      );
    }

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => {
        if (typeof unsubscribe === "function") unsubscribe();
      });
    };
  }, [barsCount, tradeSid, endTimeSec, liveBars, mode, profile, skipFetch, sym, tfs]);

  useEffect(() => {
    const hasAnchoredEndTime =
      Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0;
    if (
      !sym ||
      skipFetch ||
      mode !== "cache" ||
      hasAnchoredEndTime ||
      !tfs.length ||
      liveBars !== true
    ) {
      return undefined;
    }
    let cancelled = false;

    const mergeTailSnapshots = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const snapshots = await Promise.all(
        tfs.map(async (tf) => {
          const tfKey = tfNorm(tf);
          try {
            const response = await api.realtimeChartBootstrap(sym, tfKey, 3);
            return {
              tfKey,
              snapshot:
                response?.snapshot && typeof response.snapshot === "object"
                  ? response.snapshot
                  : null,
            };
          } catch {
            return { tfKey, snapshot: null };
          }
        }),
      );
      if (cancelled) return;
      setData((prev) => {
        const previousData =
          prev && typeof prev === "object" ? prev : {};
        let changed = false;
        const next = { ...previousData };
        for (const { tfKey, snapshot } of snapshots) {
          if (!snapshot || !Array.isArray(snapshot?.bars) || !snapshot.bars.length) continue;
          const currentEntry =
            previousData[tfKey] ||
            chartFetchManager.get(sym, tfKey) ||
            null;
          if (!currentEntry) continue;
          const mergedEntry = mergeRealtimeBarsIntoTfData(currentEntry, {
            bars: snapshot.bars,
            lastPrice: snapshot.lastPrice,
            cachedAt: Date.now(),
          });
          const finalEntry = {
            ...mergedEntry,
            freshness: "stream",
            cache_source: "storage_tail_sync",
            reason: "storage_tail_sync",
            metadata: {
              ...(currentEntry?.metadata && typeof currentEntry.metadata === "object"
                ? currentEntry.metadata
                : {}),
              ...(snapshot?.metadata && typeof snapshot.metadata === "object"
                ? snapshot.metadata
                : {}),
              stream_connected:
                currentEntry?.metadata?.stream_connected === true,
              stream_status:
                currentEntry?.metadata?.stream_status || "READY",
              stream_connection_state:
                currentEntry?.metadata?.stream_connection_state || "idle",
              stream_topic:
                currentEntry?.metadata?.stream_topic || buildRealtimeChartTopic(sym, tfKey),
              storage_tail_sync_at: Date.now(),
            },
          };
          const previousLastTime = Number(
            currentEntry?.bars?.[currentEntry?.bars?.length - 1]?.time || 0,
          );
          const nextLastTime = Number(
            finalEntry?.bars?.[finalEntry?.bars?.length - 1]?.time || 0,
          );
          const previousLastClose = Number(
            currentEntry?.bars?.[currentEntry?.bars?.length - 1]?.close || 0,
          );
          const nextLastClose = Number(
            finalEntry?.bars?.[finalEntry?.bars?.length - 1]?.close || 0,
          );
          if (
            previousLastTime === nextLastTime &&
            previousLastClose === nextLastClose
          ) {
            continue;
          }
          next[tfKey] = finalEntry;
          changed = true;
        }
        if (!changed) return prev;
        const aligned = alignLatestPriceAcrossTf(next, tfs);
        lastChartDataRef.current = aligned;
        for (const tf of tfs) {
          const key = tfNorm(tf);
          if (aligned?.[key]) {
            chartFetchManager.set(sym, key, aligned[key]);
          }
        }
        return aligned;
      });
      setStatus((current) =>
        current === "LOADING" || current === "IDLE" ? "READY" : current,
      );
    };

    mergeTailSnapshots().catch(() => {});
    const timer = window.setInterval(() => {
      mergeTailSnapshots().catch(() => {});
    }, 15_000);
    const handleFocus = () => {
      mergeTailSnapshots().catch(() => {});
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [tradeSid, endTimeSec, liveBars, mode, skipFetch, sym, tfs]);

  // Build master-compatible shape for existing components
  const master = useMemo(() => {
    if (!data || !Object.keys(data).length) return null;
    const streamState = sym ? chartStreamStore.getState(buildRealtimeChartTopic(sym)) : null;
    const bars = {},
      context = {},
      snapshots = {},
      serverArtifactsByTf = {},
      serverTradePlansByTf = {},
      serverCoverageByTf = {};
    for (const [tf, entry] of Object.entries(data)) {
      bars[tf] = entry.bars || [];
      context[tf] = {
        last_price: entry.last_price,
        freshness: entry.freshness,
        provider: entry.provider,
        metadata: entry.metadata,
        cache_source: entry.cache_source,
        reason: entry.reason,
        cached_at: entry.created_at || null,
      };
      if (entry.snapshot) snapshots[tf] = entry.snapshot;
      serverArtifactsByTf[tf] = Array.isArray(entry.server_artifacts)
        ? entry.server_artifacts
        : [];
      serverTradePlansByTf[tf] = Array.isArray(entry.server_trade_plans)
        ? entry.server_trade_plans
        : [];
      serverCoverageByTf[tf] =
        entry.server_coverage && typeof entry.server_coverage === "object"
          ? entry.server_coverage
          : null;
    }
    return {
      bars,
      context,
      snapshots,
      serverArtifactsByTf,
      serverTradePlansByTf,
      serverCoverageByTf,
      analysis:
        streamState?.analysis &&
        typeof streamState.analysis === "object" &&
        !Array.isArray(streamState.analysis)
          ? streamState.analysis
          : {},
      cached_at: Object.values(data)[0]?.created_at,
    };
  }, [data, sym]);

  return {
    status,
    data,
    master,
    error,
    cachedAt: master?.cached_at || null,
    refresh,
    refreshTf,
    liveKey,
    snapMsg,
    snapshotState: {
      stage: error ? "error" : snapMsg ? "loading" : "idle",
      message: snapMsg || error || "",
    },
  };
}
