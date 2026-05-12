import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { chartFetchManager } from "../services/chartFetchManager";
import { api } from "../api";

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
  provider = "ICMARKETS",
  sessionPrefix = "",
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
      const entries = {};
      const force = opts.force === true;
      console.log("[ChartData] fetchAll sym=" + sym + " tfs=" + tfs.join(",") + " mode=" + mode + " force=" + force);

      if (mode === "snapshots") {
        // Snapshot mode: use batch snapshot API
        const batch = await api.chartSnapshotCreateBatch({
          symbols: [sym],
          provider,
          session_prefix: sessionPrefix,
          tfs,
          lookbackBars: 300,
        });
        console.log("[ChartData] snapshots batch ok=" + batch?.ok + " items=" + (batch?.items?.length || 0));
        const items = Array.isArray(batch?.items) ? batch.items : [];
        for (const tf of tfs) {
          const key = tfNorm(tf);
          const found = items.find((x) => {
            const f = String(x?.file_name || "");
            return f.includes("_" + tf + "_") || f.includes("_" + tf.toUpperCase() + "_");
          });
          entries[key] = {
            bars: [],
            snapshot: found ? { file_name: found.file_name, file_path: found.file_path } : null,
          };
        }
      } else {
        // Cache mode: fetch bars per TF via Twelve Data (parallel)
        const results = await Promise.allSettled(
          tfs.map(async (tf) => {
            const key = tfNorm(tf);
            try {
              const cached = chartFetchManager.get(sym, key);
              if (cached && !force) {
                console.log("[ChartData] cache hit tf=" + tf);
                return { key, data: cached };
              }
              console.log("[ChartData] twelve fetch tf=" + tf);
              const out = await api.chartTwelveCandles(sym, tf, 300, force);
              console.log("[ChartData] twelve tf=" + tf + " ok=" + out?.ok + " bars=" + (out?.snapshot?.bars?.length || 0));
              const snap = out?.snapshot && typeof out.snapshot === "object" ? out.snapshot : null;
              return {
                key,
                data: {
                  bars: Array.isArray(snap?.bars) ? snap.bars : [],
                  bar_start: snap?.bar_start || snap?.bars?.[0]?.time,
                  bar_end: snap?.bar_end || snap?.bars?.[snap?.bars?.length - 1]?.time,
                  last_price: snap?.last_price ?? null,
                  cache_source: out?.source || "remote_api",
                },
              };
            } catch (e) {
              console.warn("[ChartData] twelve tf=" + tf + " error=" + (e?.message || String(e)));
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
      }

      const hasAny = Object.values(entries).some(
        (e) => e.bars?.length > 0 || e.snapshot,
      );
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

      try {
        const result = await chartFetchManager.enqueue(
          sym,
          tfs[0] || "4H",
          () => fetchAll(opts),
        );
        if (!mountedRef.current) return null;
        const entries = result.data?.entries || {};
        const hasBars = Object.values(entries).some((e) => e.bars?.length > 0);
        const hasSnap = Object.values(entries).some((e) => e.snapshot);
        setData(entries);
        if (mode === "snapshots") {
          if (!hasSnap) {
            setStatus("ERROR");
            setError("No snapshots");
            setSnapMsg("Snapshots unavailable");
            return null;
          }
          setStatus("READY");
          setSnapMsg("Snapshots ready");
          return result;
        }
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
