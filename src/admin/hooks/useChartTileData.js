import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { chartFetchManager } from "../services/chartFetchManager";
import { api } from "../api";

const DEFAULT_BARS_COUNT = 1000;

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

const BARS_BY_PROFILE = {
  position: { d: 300, "4h": 500, "1h": 800, "15m": 0, "5m": 0, "1m": 0 },
  swing:    { d: 250, "4h": 400, "1h": 640, "15m": 720, "5m": 0, "1m": 0 },
  day:      { d: 200, "4h": 360, "1h": 600, "15m": 720, "5m": 900, "1m": 0 },
  scalp:    { d: 60,  "4h": 240, "1h": 480, "15m": 600, "5m": 720, "1m": 900 },
};

function barsForTf(tf, barsCount, profile = "day") {
  const n = Number(barsCount);
  // Explicit bars count (non-zero, non-default) → use directly
  if (Number.isFinite(n) && n > 0) return Math.max(50, Math.min(5000, Math.round(n)));
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

export function useSymbolChartData({
  symbol,
  timeframes = ["D", "4H", "15M", "5M"],
  mode = "fixed",
  barsCount = DEFAULT_BARS_COUNT,
  forceRefresh = false,
  skipFetch = false,
  provider = "ICMARKETS",
  sessionPrefix = "",
  profile = "day",
  attachedSnapshotFiles = [],
  tradeSid = "",
  endTimeSec = null,
}) {
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
        const results = await Promise.allSettled(
          tfs.map(async (tf) => {
            const key = tfNorm(tf);
            const hasAnchoredEndTime =
              Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0;
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
                      cache_source: local?.cache_source || "memory",
                      cached_at: local?.cached_at || local?.created_at || null,
                      reason: local?.reason || "",
                    },
                  };
                }
              }
              const requestedBars = barsForTf(tf, barsCount, profile);
              let out = null;
              let snap = null;
              if (hasAnchoredEndTime) {
                if (force) {
                  await api.chartCandles(
                    sym,
                    tf,
                    requestedBars,
                    true,
                    tradeSid,
                    "latest",
                  ).catch(() => null);
                }
                out = await api.brokerBars(sym, tf, requestedBars, endTimeSec);
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
                };
              } else {
                if (force) {
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
                  if (snap) {
                    out = {
                      ...out,
                      source: "realtime_bootstrap",
                      cached_at: Date.now(),
                    };
                  }
                } catch {
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
      const requestedBars = Math.max(
        50,
        Math.min(
          Number(opts.bars) || barsForTf(tfKey, barsCount, profile),
          5000,
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
      try {
        if (mode === "cache") {
          const hasAnchoredEndTime =
            Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0;
          let out = null;
          let snap = null;
          if (hasAnchoredEndTime) {
            if (force) {
              await api.chartCandles(
                sym,
                tfKey,
                requestedBars,
                true,
                tradeSid,
                direction,
              ).catch(() => null);
            }
            out = await api.brokerBars(sym, tfKey, requestedBars, endTimeSec);
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
          } else {
            if (force) {
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
            try {
              out = await api.realtimeChartBootstrap(sym, tfKey, requestedBars);
              snap =
                out?.snapshot && typeof out.snapshot === "object"
                  ? out.snapshot
                  : null;
              if (snap) {
                out = {
                  ...out,
                  source: "realtime_bootstrap",
                  cached_at: Date.now(),
                };
              }
            } catch {
              out = await api.chartCandles(
                sym,
                tfKey,
                requestedBars,
                false,
                tradeSid,
                direction,
              );
              snap =
                out?.snapshot && typeof out.snapshot === "object"
                  ? out.snapshot
                  : null;
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
          const nextStoredBars = Math.max(
            0,
            Number(tfData?.metadata?.stored_bars) ||
              (Array.isArray(tfData?.bars) ? tfData.bars.length : 0) ||
              0,
          );
          const updatedBars = Math.max(
            0,
            Number(tfData?.metadata?.updated_bars) || 0,
          );
          const refreshResult = {
            tf: tfKey,
            direction,
            requestedBars,
            previousStoredBars,
            storedBars: nextStoredBars,
            addedBars: Math.max(0, nextStoredBars - previousStoredBars),
            updatedBars,
            hasAnchoredEndTime,
          };
          if (tfData.bars.length > 0) {
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
              chartFetchManager.invalidate(sym);
              const reloaded = await fetchAll({ force: false });
              const nextEntries =
                reloaded?.entries && typeof reloaded.entries === "object"
                  ? reloaded.entries
                  : null;
              if (nextEntries) {
                setData(nextEntries);
                lastChartDataRef.current = nextEntries;
              } else {
                chartFetchManager.set(sym, tfKey, tfData);
                setData((prev) => {
                  const next = {
                    ...(prev || {}),
                    [tfKey]: { ...tfData, created_at: Date.now() },
                  };
                  const aligned = alignLatestPriceAcrossTf(next, tfs);
                  for (const tf of tfs) {
                    const key = tfNorm(tf);
                    if (Array.isArray(aligned?.[key]?.bars) && aligned[key].bars.length) {
                      chartFetchManager.set(sym, key, aligned[key]);
                    }
                  }
                  return aligned;
                });
                lastChartDataRef.current = {
                  ...(lastChartDataRef.current || {}),
                  [tfKey]: { ...tfData, created_at: Date.now() },
                };
              }
            }
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
        const msg = String(err?.message || err || "Refresh failed");
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
    [sym, mode, skipFetch, refresh, fetchAll, barsCount, profile, tfs, tradeSid, endTimeSec],
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
  }, [sym, mode, skipFetch, tfs, endTimeSec]);

  // Build master-compatible shape for existing components
  const master = useMemo(() => {
    if (!data || !Object.keys(data).length) return null;
    const bars = {},
      context = {},
      snapshots = {};
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
    }
    return {
      bars,
      context,
      snapshots,
      cached_at: Object.values(data)[0]?.created_at,
    };
  }, [data]);

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
