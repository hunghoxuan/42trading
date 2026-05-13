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
        // Snapshot mode: list existing snapshots from VPS
        const batch = await Promise.race([
          api.chartSnapshots(100),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Snapshot list timeout")), 15000)),
        ]);
        console.log("[ChartData] snapshots list ok=" + batch?.ok + " items=" + (batch?.items?.length || 0));
        const items = Array.isArray(batch?.items) ? batch.items : [];
        // Filter by symbol (case-insensitive match in file_name)
        const symUpper = sym.toUpperCase();
        const matchingItems = items.filter((x) => {
          const f = String(x?.file_name || "").toUpperCase();
          return f.includes(symUpper);
        });
        console.log("[ChartData] snapshots matching symbol=" + sym + " count=" + matchingItems.length);
        for (const tf of tfs) {
          const key = tfNorm(tf);
          const found = matchingItems.find((x) => {
            const f = String(x?.file_name || "");
            return f.includes("_" + tf + "_") || f.includes("_" + tf.toUpperCase() + "_");
          });
          entries[key] = {
            bars: [],
            snapshot: found ? { file_name: found.file_name, file_path: found.url || found.file_path } : null,
          };
          if (found) console.log("[ChartData] snapshot match tf=" + tf + " file=" + found.file_name);
        }
      } else {
        // Cache mode: fetch bars per TF via Twelve Data (parallel)
        const results = await Promise.allSettled(
          tfs.map(async (tf) => {
            const key = tfNorm(tf);
            try {
              if (!force) {
                const local = chartFetchManager.get(sym, tf);
                if (local?.bars?.length) {
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
                    },
                  };
                }
              }
              console.log("[ChartData] fetch tf=" + tf);
              const out = await api.chartTwelveCandles(sym, tf, 300, force);
              console.log("[ChartData] twelve tf=" + tf + " ok=" + out?.ok + " bars=" + (out?.snapshot?.bars?.length || 0));
              const snap = out?.snapshot && typeof out.snapshot === "object" ? out.snapshot : null;
              const tfData = {
                bars: Array.isArray(snap?.bars) ? snap.bars : [],
                bar_start: snap?.bar_start || snap?.bars?.[0]?.time,
                bar_end: snap?.bar_end || snap?.bars?.[snap?.bars?.length - 1]?.time,
                last_price: snap?.last_price ?? null,
                cache_source: out?.source || "remote_api",
              };
              if (tfData.bars.length > 0) {
                chartFetchManager.set(sym, tf, tfData);
              }
              return {
                key,
                data: tfData,
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
      // Note: keep existing data visible during re-fetch (don't clear setData)
      console.log("[ChartData] refresh symbol=" + sym + " mode=" + mode + " tfs=" + tfs.join(","));

      try {
        const result = await fetchAll(opts);
        if (!mountedRef.current) return null;
        const entries = result?.entries || {};
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
        setError(String(err?.message || err || "Failed"));
        console.warn("[ChartData] refresh error:", err?.message || err);
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
