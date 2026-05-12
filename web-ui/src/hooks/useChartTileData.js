import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { chartFetchManager } from "../services/chartFetchManager";
import { api } from "../api";
import { NotificationHub } from "../services/NotificationHub";

function tfNorm(tf) {
  return String(tf || "")
    .toLowerCase()
    .trim();
}
function normSym(s) {
  const r = String(s || "")
    .trim()
    .toUpperCase();
  return r.includes(":") ? r.split(":").pop().trim().toUpperCase() : r;
}

export function useSymbolChartData({
  symbol,
  timeframes = ["D", "4H", "15M", "5M"],
  mode = "fixed",
  skipFetch = false,
}) {
  const [status, setStatus] = useState("IDLE");
  const [data, setData] = useState({}); // { "4h": { bars, snapshot, created_at }, ... }
  const [error, setError] = useState(null);
  const [liveKey, setLiveKey] = useState(0);
  const [snapMsg, setSnapMsg] = useState("");
  const mountedRef = useRef(true);
  const sym = useMemo(() => normSym(symbol), [symbol]);
  const tfs = useMemo(
    () => [...new Set(timeframes.map(tfNorm).filter(Boolean))],
    [timeframes],
  );

  const fetchAll = useCallback(
    async (opts = {}) => {
      if (!sym) throw new Error("Symbol required");
      const types =
        mode === "snapshots"
          ? ["context", "bars", "snapshots"]
          : ["context", "bars"];
      const out = await api.chartRefresh({
        symbols: [sym],
        timeframes: tfs,
        types,
        bars: 300,
        force: opts.force === true,
      });
      const symbolData = out?.symbols?.[0] || out || {};
      const contextData = symbolData?.context || out?.context || {};
      const tfRows = Array.isArray(contextData?.timeframes)
        ? contextData.timeframes
        : [];
      const entries = {};
      for (const row of tfRows) {
        const key = tfNorm(row?.tf || row?.timeframe || "");
        if (!key) continue;
        entries[key] = {
          bars: Array.isArray(row?.bars) ? row.bars : [],
          bar_start: row?.bar_start || row?.bars?.[0]?.time,
          bar_end: row?.bar_end || row?.bars?.[row?.bars?.length - 1]?.time,
          last_price: row?.last_price ?? null,
          cache_source: row?.cache_source || null,
          reason: row?.reason || null,
        };
      }
      const snapItems = Array.isArray(symbolData?.snapshots?.items)
        ? symbolData.snapshots.items
        : Array.isArray(out?.snapshots?.items)
          ? out.snapshots.items
          : [];
      for (const item of snapItems) {
        const key = tfNorm(item?.timeframe || item?.tf || "");
        if (!key || !entries[key]) continue;
        entries[key].snapshot = {
          file_name: item?.file_name || "",
          file_path: item?.file_path || "",
        };
      }
      const hasAny = Object.values(entries).some((e) => e.bars?.length > 0);
      if (!hasAny) throw new Error("No data from provider");
      return { symbol: sym, entries };
    },
    [sym, tfs, mode],
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
      console.log("[ChartData] refresh symbol=" + sym + " mode=" + mode + " tfs=" + tfs.join(","));
      const trackType = mode === "snapshots" ? "snapshot" : "twelve_data";
      const { requestId } = NotificationHub.track(trackType, { symbol: sym }, () => Promise.resolve(null));

      try {
        const result = await chartFetchManager.enqueue(
          sym,
          tfs[0] || "4H",
          () => fetchAll(opts),
        );
        if (!mountedRef.current) return null;
        const entries = result.data?.entries || {};
        const hasBars = Object.values(entries).some((e) => e.bars?.length > 0);
        setData(entries);
        if (!hasBars) {
          if (opts.force || mode !== "cache") {
            setStatus("ERROR");
            setError("No data");
          }
          return null;
        }
        if (result.stale) setStatus("STALE");
        else if (result.error) {
          setStatus(result.data ? "STALE" : "ERROR");
          setError(result.error);
        } else setStatus("READY");
        if (mode === "snapshots") {
          const hasSnap = Object.values(entries).some((e) => e.snapshot);
          setSnapMsg(hasSnap ? "Snapshots ready" : "Snapshots unavailable");
        }
        return result;
      } catch (err) {
        if (!mountedRef.current) return null;
        setStatus("ERROR");
        setError(String(err?.message || err || "Failed"));
        return null;
      }
    },
    [sym, tfs, mode, fetchAll],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!sym) {
      setStatus("IDLE");
      setData({});
      return;
    }
    if (mode === "live") {
      setData({});
      setError(null);
      return;
    }
    if (skipFetch) {
      // TradePlan mode: don't fetch, TradeSignalChart handles its own data
      setStatus("READY");
      setData({});
      return;
    }
    // Check all TFs in cache
    let allCached = true;
    let anyCached = false;
    const cachedData = {};
    for (const tf of tfs) {
      const entry = chartFetchManager.get(sym, tf);
      if (entry) {
        cachedData[tfNorm(tf)] = entry;
        anyCached = true;
      } else allCached = false;
    }
    if (anyCached) {
      setData(cachedData);
      setStatus(allCached ? "READY" : "STALE");
    }
    if (!allCached) {
      setStatus(anyCached ? "STALE" : "LOADING");
      refresh({ force: !anyCached }).catch(() => null);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [sym, mode]);

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
        cache_source: entry.cache_source,
        reason: entry.reason,
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
    liveKey,
    snapMsg,
    snapshotState: { stage: snapMsg ? "ready" : "idle", message: snapMsg },
  };
}
