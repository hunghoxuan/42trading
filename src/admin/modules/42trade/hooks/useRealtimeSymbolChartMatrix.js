import { useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import { chartStreamStore, realtimeClient } from "../realtime/realtimeClientSingleton";

const EMPTY_TIMEFRAMES = Object.freeze([]);

function normalizeSymbol(rawSymbol = "") {
  const base = String(rawSymbol || "")
    .trim()
    .toUpperCase();
  if (!base) return "";
  return base.includes(":") ? base.split(":").pop().trim().toUpperCase() : base;
}

function normalizeTimeframe(rawTf = "") {
  const value = String(rawTf || "")
    .trim()
    .toLowerCase();
  if (!value) return "";
  if (["1", "1m", "1min", "m1"].includes(value)) return "1m";
  if (["5", "5m", "5min", "m5"].includes(value)) return "5m";
  if (["15", "15m", "15min", "m15"].includes(value)) return "15m";
  if (["60", "1h", "h1"].includes(value)) return "1h";
  if (["240", "4h", "h4"].includes(value)) return "4h";
  if (["d", "1d", "day", "1440"].includes(value)) return "d";
  return value;
}

function buildChartTopic(symbol) {
  const sym = normalizeSymbol(symbol);
  return sym ? `chart:${sym}` : "";
}

function bootstrapBarsForTimeframe(timeframe, requestedBars) {
  const tf = normalizeTimeframe(timeframe);
  const bars = Math.max(50, Number(requestedBars) || 300);
  if (tf === "d") return Math.min(bars, 250);
  if (tf === "4h") return Math.min(bars, 350);
  if (tf === "1h") return Math.min(bars, 500);
  if (tf === "15m") return Math.min(bars, 700);
  if (tf === "5m") return Math.min(bars, 800);
  return Math.min(bars, 1000);
}

const EMPTY_STATE = {
  status: "IDLE",
  error: "",
  cachedAt: null,
  liveKey: 0,
  snapMsg: "",
  snapshotState: {
    stage: "idle",
    message: "",
  },
  refresh: async () => null,
  refreshTf: async () => null,
  master: null,
};

export function useRealtimeSymbolChartMatrix({
  enabled = false,
  symbol = "",
  timeframes = EMPTY_TIMEFRAMES,
  bars = 300,
  pollMs = 2500,
}) {
  const symbolNorm = useMemo(() => normalizeSymbol(symbol), [symbol]);
  const tfKeys = useMemo(
    () =>
      [...new Set((Array.isArray(timeframes) ? timeframes : []).map(normalizeTimeframe).filter(Boolean))],
    [timeframes],
  );
  const tfKeySignature = tfKeys.join("|");
  const topicKey = useMemo(() => buildChartTopic(symbolNorm), [symbolNorm]);
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !symbolNorm || !tfKeys.length || !topicKey) return undefined;
    let cancelled = false;
    const unsubscribeStore = chartStreamStore.subscribe(topicKey, () => {
      setVersion((prev) => prev + 1);
    });
    chartStreamStore.setConnected(topicKey, false);
    const applyBootstrapItem = (item) => {
      const timeframe = normalizeTimeframe(item?.timeframe || item?.tf || "");
      if (!timeframe) return;
      if (item?.ok && item?.snapshot) {
        chartStreamStore.setBootstrap(topicKey, item.snapshot);
        return;
      }
      chartStreamStore.setError(
        topicKey,
        item?.error || "Bootstrap failed",
        timeframe,
      );
    };

    const runFallbackBootstrap = async () => {
      const items = await Promise.all(
        tfKeys.map(async (timeframe) => {
          try {
            const response = await api.realtimeChartBootstrap(
              symbolNorm,
              timeframe,
              bootstrapBarsForTimeframe(timeframe, bars),
            );
            return {
              ok: true,
              timeframe,
              snapshot: response?.snapshot || null,
            };
          } catch (error) {
            return {
              ok: false,
              timeframe,
              error: error?.message || String(error || "Bootstrap failed"),
            };
          }
        }),
      );
      if (cancelled) return;
      items.forEach(applyBootstrapItem);
    };

    runFallbackBootstrap().catch((error) => {
      if (cancelled) return;
      tfKeys.forEach((timeframe) => {
        chartStreamStore.setError(topicKey, error?.message || error, timeframe);
      });
    });
    const unsubscribeRealtime = realtimeClient.subscribe(
      topicKey,
      { bars, pollMs },
      (envelope) => {
        chartStreamStore.applyEnvelope(envelope);
      },
      {
        onOpen: () => chartStreamStore.setConnected(topicKey, true),
        onError: (error) => {
          if (String(error?.type || "").trim().toLowerCase() === "disconnect") {
            chartStreamStore.setDisconnected(
              topicKey,
              error?.message || error?.reason || "Realtime connection lost",
            );
            return;
          }
          if (error) {
            chartStreamStore.setError(
              topicKey,
              error?.message || "Realtime connection lost",
            );
            return;
          }
          chartStreamStore.setDisconnected(topicKey, "");
        },
      },
    );

    return () => {
      cancelled = true;
      unsubscribeRealtime?.();
      unsubscribeStore?.();
    };
  }, [bars, enabled, pollMs, symbolNorm, tfKeySignature, topicKey]);

  return useMemo(() => {
    if (!enabled || !symbolNorm || !tfKeys.length || !topicKey) return EMPTY_STATE;
    const topicState = chartStreamStore.getState(topicKey);
    const states = tfKeys.map((timeframe) => ({
      timeframe,
      topic: topicKey,
      state: topicState?.timeframes?.[timeframe] || null,
    }));
    const hasReady = states.some((entry) => entry.state?.status === "READY");
    const hasConnecting = states.some(
      (entry) =>
        entry.state?.status === "CONNECTING" ||
        topicState?.status === "CONNECTING" ||
        topicState?.connected,
    );
    const hasError =
      String(topicState?.status || "").toUpperCase() === "ERROR" ||
      states.some((entry) => entry.state?.status === "ERROR");
    const allEmpty = states.every(
      (entry) =>
        entry.state?.status === "EMPTY" ||
        entry.state?.status === "IDLE" ||
        !Array.isArray(entry.state?.bars) ||
        entry.state?.bars.length === 0,
    );
    const cachedAt = states.reduce((latest, entry) => {
      const next = Number(entry.state?.lastUpdatedAt || 0);
      return next > latest ? next : latest;
    }, 0);
    const master = {
      bars: {},
      context: {},
      snapshots: {},
      analysis:
        topicState?.analysis && typeof topicState.analysis === "object" && !Array.isArray(topicState.analysis)
          ? topicState.analysis
          : {},
      cached_at: cachedAt || Date.now(),
    };
    for (const entry of states) {
      master.bars[entry.timeframe] = Array.isArray(entry.state?.bars)
        ? entry.state.bars
        : [];
      master.context[entry.timeframe] = {
        last_price: Number(entry.state?.lastPrice) || null,
        freshness: "stream",
        provider: "realtime",
        metadata: {
          ...(entry.state?.metadata && typeof entry.state.metadata === "object"
            ? entry.state.metadata
            : {}),
          stream_connected: Boolean(topicState?.connected),
          stream_status: String(entry.state?.status || topicState?.status || "IDLE").toUpperCase(),
          stream_topic: topicKey,
        },
        cache_source: "stream",
        reason: "realtime_stream",
        cached_at: entry.state?.lastUpdatedAt || cachedAt || Date.now(),
      };
    }
    return {
      status: hasReady ? "READY" : hasConnecting ? "LOADING" : hasError ? "ERROR" : allEmpty ? "IDLE" : "IDLE",
      error: hasError
        ? states.find((entry) => entry.state?.status === "ERROR")?.state?.error ||
          topicState?.error ||
          ""
        : "",
      cachedAt: cachedAt || Date.now(),
      liveKey: cachedAt || 0,
      snapMsg: "",
      snapshotState: {
        stage: hasError ? "error" : "idle",
        message: hasError
          ? states.find((entry) => entry.state?.status === "ERROR")?.state?.error ||
            topicState?.error ||
            ""
          : "",
      },
      refresh: async () => null,
      refreshTf: async () => null,
      master,
    };
  }, [enabled, symbolNorm, tfKeySignature, topicKey]);
}
